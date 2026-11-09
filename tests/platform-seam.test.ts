import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { ModelDriver } from '@velaros-ai/velaros/kernel'
import type { SessionView } from '../packages/contracts/src/index.js'
import { createServerApplication } from '../apps/server/src/app.js'
import { ServerFiles } from '../apps/server/src/files.js'
import { composePlatform } from '../apps/server/src/platform-composition.js'
import { ProductStore } from '../apps/server/src/store.js'

async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 8_000
  while (true) {
    const value = await read()
    if (accept(value)) return value
    if (Date.now() > deadline) throw new Error(`Seam did not settle: ${JSON.stringify(value)}`)
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

test('固定 SDK 的真实 Runtime/Node 经 HTTP 确认后执行并核对文件', { timeout: 25_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'velaros-server-seam-'))
  const cwd = join(directory, 'host')
  const dataDirectory = join(directory, 'state')
  await mkdir(cwd)
  await mkdir(dataDirectory)
  const target = join(cwd, 'confirmed.txt')
  const source = `import {writeFile} from 'node:fs/promises'; await writeFile(${JSON.stringify(target)}, 'server-confirmed'); console.log('server-confirmed')`
  let calls = 0
  // 只替代外部供应商。Agent、存储、授权桥、Node 子进程和 Host 都是真实固定归档实现。
  const model: ModelDriver = {
    id: 'server-seam-deterministic',
    nativeTools: true,
    limits: { inputTokens: 100_000, contextTokens: 120_000, outputTokens: 2_000 },
    estimate: async () => ({ tokens: 1_000, precision: 'estimate', basis: 'deterministic seam' }),
    stream: async function* (request) {
      assert.equal(request.mode, 'work')
      assert.equal(request.response.type, 'tools')
      calls++
      assert.ok(calls <= 2, 'single execution and completion only')
      if (calls === 1)
        yield {
          type: 'tool-call',
          value: {
            id: 'server-exec',
            name: 'exec',
            input: { code: source, options: { async: false } },
          },
        }
      else {
        assert.equal(await readFile(target, 'utf8'), 'server-confirmed')
        yield {
          type: 'tool-call',
          value: {
            id: 'server-done',
            name: 'done',
            input: { message: '已经核实文件写入', completion: '实际文件内容已读取核对' },
          },
        }
      }
      yield { type: 'finish', reason: 'stop' }
    },
  }
  const store = new ProductStore(join(dataDirectory, 'server.sqlite'))
  const platform = await composePlatform({
    cwd,
    dataDirectory,
    roots: [cwd],
    store,
    mode: 'danger-full-access',
    approval: 'ask',
    model,
  })
  const application = createServerApplication({
    store,
    files: await ServerFiles.create([cwd], dataDirectory),
    accessToken: 'server-real-seam-test-token-only',
    publicOrigin: 'http://127.0.0.1',
    webDirectory: cwd,
    execution: platform.execution,
    terminal: platform.terminal,
  })
  await new Promise<void>((resolve) => application.server.listen(0, '127.0.0.1', resolve))
  const address = application.server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  let cookie = ''
  let csrf = ''
  const api = async (path: string, method = 'GET', body?: unknown): Promise<Response> =>
    fetch(`${base}${path}`, {
      method,
      headers: { Cookie: cookie, 'X-VelarOS-CSRF': csrf, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  try {
    const login = await api('/api/auth/login', 'POST', {
      token: 'server-real-seam-test-token-only',
    })
    assert.equal(login.status, 200)
    cookie = login.headers.get('set-cookie')!.split(';')[0]!
    csrf = ((await login.json()) as { csrf: string }).csrf
    const created = await api('/api/sessions', 'POST', { title: '真实接缝' })
    const sessionId = ((await created.json()) as SessionView).id
    const response = await api(`/api/sessions/${sessionId}/inputs`, 'POST', {
      requestId: randomUUID(),
      text: '创建确认文件并核对结果',
    })
    assert.equal(response.status, 202)
    assert.equal(((await response.json()) as { status: string }).status, 'received')
    const session = await until(
      async () => (await (await api(`/api/sessions/${sessionId}`)).json()) as SessionView,
      (view) => Boolean(view.interaction) || view.status === 'unknown',
    )
    assert.equal(session.status, 'waiting')
    assert.ok(session.runId && session.inputId && session.facts.length)
    assert.ok(session.interaction)
    await assert.rejects(readFile(target), { code: 'ENOENT' })
    const review = await api(
      `/api/sessions/${sessionId}/interaction?requestId=${encodeURIComponent(session.interaction.id)}`,
    )
    assert.equal(((await review.json()) as { source: string }).source, source)
    const answer = { requestId: session.interaction.id, runId: session.runId, value: true }
    assert.equal((await api(`/api/sessions/${sessionId}/answers`, 'POST', answer)).status, 202)
    assert.equal((await api(`/api/sessions/${sessionId}/answers`, 'POST', answer)).status, 409)
    const completed = await until(
      async () => (await (await api(`/api/sessions/${sessionId}`)).json()) as SessionView,
      (view) => ['completed', 'failed', 'unknown'].includes(view.status),
    )
    assert.equal(completed.status, 'completed')
    assert.equal(await readFile(target, 'utf8'), 'server-confirmed')
    assert.ok(completed.messages.some((item) => item.text.includes('已经核实文件写入')))
    assert.equal(calls, 2)
    console.log('Real Runtime confirmed', {
      input: true,
      approval: true,
      nodeFile: true,
      completed: true,
      host: process.platform,
      providerApi: false,
    })
  } catch (error) {
    console.error('Real seam failed', error)
    throw error
  } finally {
    await application.close()
    await platform.close()
    store.close()
    const actual = await realpath(directory)
    assert.equal(dirname(actual).toLowerCase(), (await realpath(tmpdir())).toLowerCase())
    assert.ok(basename(actual).startsWith('velaros-server-seam-'))
    await rm(actual, { recursive: true, force: true })
  }
})
