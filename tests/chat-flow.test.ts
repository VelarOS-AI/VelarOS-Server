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

test('真实 HTTP 单个空会话、运行回显、命名置顶归档及执行边界', async () => {
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
    const draftId = randomUUID()
    const next = (await (
      await api('/api/sessions', 'POST', { id: draftId, title: '新会话' })
    ).json()) as SessionView
    const reused = (await (
      await api('/api/sessions', 'POST', { id: randomUUID(), title: '新会话' })
    ).json()) as SessionView
    assert.equal(next.id, draftId)
    assert.equal(reused.id, draftId, '不同窗口的创建请求也复用唯一空会话')
    assert.equal(store.listSessions().length, 2)
    assert.equal((await api(`/api/sessions/${id}`, 'PATCH', { title: '   ' })).status, 400)
    assert.equal(
      (await api(`/api/sessions/${id}`, 'PATCH', { title: 'x'.repeat(101) })).status,
      400,
    )
    assert.equal((await api(`/api/sessions/${id}`, 'PATCH', {})).status, 400)
    assert.equal(
      (await api(`/api/sessions/${id}`, 'PATCH', { title: '日常维护', pinned: true })).status,
      200,
    )
    const list = (await (await api('/api/sessions')).json()) as SessionView[]
    assert.equal(list[0]!.id, id, '置顶会话排在更新建的空会话前面')
    assert.equal(list[0]!.title, '日常维护')
    assert.equal(list[0]!.pinned, true)
    assert.equal((await api(`/api/sessions/${id}`, 'PATCH', { archived: true })).status, 200)
    assert.equal(store.getSession(id).archived, true)
    assert.equal(store.getSession(id).pinned, false)
    assert.equal(store.getSession(id).messages.length, result.messages.length, '归档保留原消息')
    assert.equal(
      (await api(`/api/sessions/${id}/inputs`, 'POST', { ...body, requestId: randomUUID() }))
        .status,
      409,
    )
    assert.equal(submissions, 1, '已归档会话不启动新执行')
    assert.equal(
      (await api(`/api/sessions/${id}/inputs`, 'POST', body)).status,
      202,
      '原请求仍可查询回执，不能重放',
    )
    assert.equal((await api(`/api/sessions/${id}`, 'PATCH', { archived: false })).status, 200)
    assert.equal(store.getSession(id).archived, false)
    store.admitInput(randomUUID(), draftId, '待受理的执行')
    assert.equal((await api(`/api/sessions/${draftId}`, 'PATCH', { archived: true })).status, 409)
    assert.equal(store.getSession(draftId).archived, false, '拒绝归档不影响原任务')
  } finally {
    await app.close()
    store.close()
    const actual = await realpath(directory)
    assert.equal(dirname(actual).toLowerCase(), (await realpath(tmpdir())).toLowerCase())
    assert.ok(basename(actual).startsWith('velaros-chat-flow-'))
    await rm(actual, { recursive: true, force: true })
  }
})

test('会话组织信息独立于执行投影，SQLite 重启后保留命名、置顶和归档', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'velaros-chat-metadata-'))
  const path = join(directory, 'server.sqlite')
  let store = new ProductStore(path)
  try {
    const session = store.createSession('新会话')
    store.saveSession(session)
    store.updateSession(session.id, { title: '我的服务器', pinned: true })
    const renamedRevision = store.getSession(session.id).revision
    store.saveSession(session)
    assert.ok(store.getSession(session.id).revision > renamedRevision)
    assert.equal(store.getSession(session.id).title, '我的服务器')
    assert.equal(store.getSession(session.id).pinned, true)
    store.close()
    store = new ProductStore(path)
    assert.equal(store.getSession(session.id).title, '我的服务器')
    assert.equal(store.getSession(session.id).pinned, true)
    store.updateSession(session.id, { archived: true })
    store.close()
    store = new ProductStore(path)
    assert.equal(store.getSession(session.id).archived, true)
    assert.equal(store.getSession(session.id).pinned, false)
    assert.equal(store.createSession('新会话').archived, false)
    assert.equal(store.listSessions().length, 2)
  } finally {
    store.close()
    const actual = await realpath(directory)
    assert.equal(dirname(actual).toLowerCase(), (await realpath(tmpdir())).toLowerCase())
    assert.ok(basename(actual).startsWith('velaros-chat-metadata-'))
    await rm(actual, { recursive: true, force: true })
  }
})
