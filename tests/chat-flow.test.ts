import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { test } from 'node:test'
import { createServerApplication } from '../apps/server/src/app.js'
import { ProductStore } from '../apps/server/src/store.js'
import { ServerFiles } from '../apps/server/src/files.js'
import type { SessionView } from '../packages/contracts/src/index.js'

test('真实 HTTP 会话创建身份重试不重复，消息回显复用 requestId，终态后迟到投影不丢运行尾标', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'velaros-chat-flow-'))
  await mkdir(join(directory, 'state'))
  const store = new ProductStore(':memory:')
  let submissions = 0
  const app = createServerApplication({
    store,
    files: await ServerFiles.create([directory], join(directory, 'state')),
    accessToken: 'chat-flow-local-only-token',
    publicOrigin: 'http://127.0.0.1',
    webDirectory: directory,
    execution: {
      available: true,
      unavailableReason: null,
      async submit(input, emit) {
        submissions++
        const runId = randomUUID()
        emit({ type: 'accepted', inputId: input.requestId, runId })
        const message = {
          id: 'assistant:' + runId,
          role: 'assistant' as const,
          timestamp: new Date().toISOString(),
          text: '已核对',
          truncated: false,
          runId,
          turnId: randomUUID(),
          phase: 'accepted' as const,
        }
        emit({ type: 'transcript', messageId: message.id, message })
        emit({ type: 'state', status: 'completed' })
        emit({ type: 'transcript', messageId: message.id, message })
      },
      async answer() {},
      async cancel() {},
      async close() {},
    },
  })
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const address = app.server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  let cookie = '',
    csrf = ''
  const api = (path: string, method = 'GET', body?: unknown) =>
    fetch(base + path, {
      method,
      headers: { Cookie: cookie, 'X-VelarOS-CSRF': csrf, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  try {
    const login = await api('/api/auth/login', 'POST', { token: 'chat-flow-local-only-token' })
    cookie = login.headers.get('set-cookie')!.split(';')[0]!
    csrf = ((await login.json()) as { csrf: string }).csrf
    const id = randomUUID()
    const input = { id, title: '新会话' }
    assert.equal((await api('/api/sessions', 'POST', input)).status, 201)
    assert.equal((await api('/api/sessions', 'POST', input)).status, 201)
    assert.equal(store.listSessions().length, 1)
    const requestId = randomUUID()
    const body = { requestId, text: '检查系统状态', executionMode: 'standard' }
    assert.equal((await api(`/api/sessions/${id}/inputs`, 'POST', body)).status, 202)
    for (let index = 0; store.getSession(id).status !== 'completed' && index < 30; index++)
      await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal((await api(`/api/sessions/${id}/inputs`, 'POST', body)).status, 202)
    const result = (await (await api(`/api/sessions/${id}`)).json()) as SessionView
    assert.equal(result.title, '检查系统状态')
    assert.equal(result.messages[0]!.id, requestId)
    assert.equal(result.messages.filter((message) => message.role === 'user').length, 1)
    assert.equal(result.messages.at(-1)!.runStatus, 'completed')
    assert.ok(Number.isFinite(Date.parse(result.messages.at(-1)!.runFinishedAt!)))
    assert.equal(submissions, 1)
    await api('/api/sessions', 'POST', input)
    assert.equal(store.getSession(id).title, '检查系统状态', '重试创建不覆盖已更新的会话名称和内容')
    assert.equal((await api('/api/sessions', 'POST', { ...input, id: 'invalid' })).status, 400)
  } finally {
    await app.close()
    store.close()
    const actual = await realpath(directory)
    assert.equal(dirname(actual).toLowerCase(), (await realpath(tmpdir())).toLowerCase())
    assert.ok(basename(actual).startsWith('velaros-chat-flow-'))
    await rm(actual, { recursive: true, force: true })
  }
})
