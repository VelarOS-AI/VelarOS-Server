import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, realpath, rm, symlink, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ExecutionNotice, ExecutionPort } from '../apps/server/src/execution.js'
import { createServerApplication } from '../apps/server/src/app.js'
import { ChangeStream } from '../apps/server/src/change-stream.js'
import { ServerFiles } from '../apps/server/src/files.js'
import { ProductStore } from '../apps/server/src/store.js'
import { RunRequests } from '../apps/server/src/runs.js'

async function fixture(): Promise<{
  directory: string
  data: string
  store: ProductStore
  files: ServerFiles
  close(): Promise<void>
}> {
  const directory = await mkdtemp(join(tmpdir(), 'velaros-server-test-'))
  const data = join(directory, 'state')
  await mkdir(data)
  const store = new ProductStore(join(data, 'server.sqlite'))
  return {
    directory,
    data,
    store,
    files: await ServerFiles.create([directory], data),
    close: async () => {
      store.close()
      const actual = await realpath(directory)
      assert.equal(dirname(actual).toLowerCase(), (await realpath(tmpdir())).toLowerCase())
      assert.ok(basename(actual).startsWith('velaros-server-test-'))
      await rm(actual, { recursive: true, force: true })
    },
  }
}

/** 测试端口只验证产品适配边界，不能证明真实 Platform 或 Linux 执行。 */
class ObservedExecution implements ExecutionPort {
  public readonly available = true
  public readonly unavailableReason = null
  public submissions = 0
  public observer: ((notice: ExecutionNotice) => void) | null = null
  public async submit(
    _input: { sessionId: string; requestId: string; text: string },
    observe: (notice: ExecutionNotice) => void,
  ): Promise<void> {
    this.submissions++
    this.observer = observe
  }
  public async cancel(): Promise<void> {}
  public async answer(): Promise<void> {}
  public async close(): Promise<void> {}
}

test('网络受理、Agent 接纳、重复提交及关闭证据分别处理；坏订阅不影响运行', async () => {
  const value = await fixture()
  const execution = new ObservedExecution()
  const changes = new ChangeStream()
  changes.subscribe(() => {
    throw new Error('disconnected subscriber')
  })
  let notifications = 0
  changes.subscribe(() => {
    notifications++
  })
  const runs = new RunRequests(value.store, changes, execution)
  try {
    const session = value.store.createSession('维护')
    const requestId = randomUUID()
    const receipt = runs.submit(session.id, requestId, '检查服务')
    assert.equal(receipt.status, 'received')
    assert.equal(receipt.inputId, null)
    assert.equal(runs.submit(session.id, requestId, '检查服务').replayed, true)
    assert.throws(() => runs.submit(session.id, requestId, '重启服务'), {
      code: 'REQUEST_CONFLICT',
    })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(execution.submissions, 1)
    execution.observer!({ type: 'accepted', inputId: 'input-1', runId: 'run-1' })
    assert.equal(value.store.getSession(session.id).status, 'accepted')
    await runs.cancel(session.id, 'run-1')
    assert.equal(value.store.getSession(session.id).status, 'accepted')
    execution.observer!({ type: 'text', messageId: 'answer-1', text: '服务正常' })
    execution.observer!({ type: 'state', status: 'completed' })
    assert.equal(value.store.getSession(session.id).status, 'completed')
    assert.equal(notifications, 4)
    assert.equal(changes.subscriberCount, 1)
    const fields = value.store.db
      .prepare('PRAGMA table_info(changes)')
      .all()
      .map((row) => row.name)
    assert.deepEqual(fields, ['sequence', 'session_id', 'revision'])
    const replay = runs.submit(session.id, requestId, '检查服务')
    assert.equal(replay.status, 'completed')
    assert.equal(execution.submissions, 1)
  } finally {
    await runs.close()
    await value.close()
  }
})

test('重启保留 unknown，不自动重放；展示文本有明确上限', async () => {
  const value = await fixture()
  try {
    const session = value.store.createSession('恢复')
    session.status = 'running'
    session.messages.push({
      id: 'long',
      role: 'assistant',
      text: 'x'.repeat(20_000),
      truncated: false,
    })
    value.store.saveSession(session)
    assert.equal(value.store.getSession(session.id).messages[0]?.text.length, 8_000)
    assert.equal(value.store.getSession(session.id).messages[0]?.truncated, true)
    const reopened = new ProductStore(join(value.data, 'server.sqlite'))
    try {
      assert.equal(reopened.getSession(session.id).status, 'unknown')
    } finally {
      reopened.close()
    }
  } finally {
    await value.close()
  }
})

test('真实文件编辑拒绝旧版本、越界与状态目录，并保持 UTF-8 内容', async () => {
  const value = await fixture()
  try {
    const path = join(value.directory, 'service.conf')
    await writeFile(path, '\ufeffenabled=true\r\n')
    const baseline = await value.files.read(path)
    assert.equal(baseline.content, '\ufeffenabled=true\r\n')
    await writeFile(path, 'enabled=external\n')
    await assert.rejects(value.files.write(path, baseline.sha256, 'enabled=false\n'), {
      code: 'FILE_CHANGED',
    })
    const current = await value.files.read(path)
    await value.files.write(path, current.sha256, 'enabled=false\n')
    assert.equal(await readFile(path, 'utf8'), 'enabled=false\n')
    await assert.rejects(value.files.list(value.data), { code: 'PATH_DENIED' })
    await assert.rejects(value.files.list(tmpdir()), { code: 'PATH_DENIED' })
    const link = join(value.directory, 'escape')
    // Windows junction 不要求开发者模式，真实路径仍必须经过授权根校验。
    await symlink(value.data, link, process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(value.files.list(link), { code: 'PATH_DENIED' })
  } finally {
    await value.close()
  }
})

test('真实 HTTP 鉴权、CSRF、来源与密钥隐藏；SSE 断开不取消已接纳任务', async () => {
  const value = await fixture()
  const execution = new ObservedExecution()
  const app = createServerApplication({
    store: value.store,
    files: value.files,
    accessToken: 'test-token-with-at-least-24-characters',
    publicOrigin: 'http://127.0.0.1:8787',
    webDirectory: value.directory,
    execution,
  })
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const address = app.server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  let cookie = ''
  let csrf = ''
  const call = (
    path: string,
    method = 'GET',
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<Response> =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-VelarOS-CSRF': csrf,
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  try {
    assert.equal((await call('/api/info')).status, 401)
    const login = await call('/api/auth/login', 'POST', {
      token: 'test-token-with-at-least-24-characters',
    })
    assert.equal(login.status, 200)
    cookie = login.headers.get('set-cookie')!.split(';')[0]!
    csrf = ((await login.json()) as { csrf: string }).csrf
    assert.equal(
      (await call('/api/sessions', 'POST', { title: '维护' }, { 'X-VelarOS-CSRF': '' })).status,
      403,
    )
    assert.equal(
      (
        await call(
          '/api/sessions',
          'POST',
          { title: '维护' },
          { Origin: 'https://untrusted.example' },
        )
      ).status,
      403,
    )
    const created = await call('/api/sessions', 'POST', { title: '维护' })
    const session = (await created.json()) as { id: string }
    const streamAbort = new AbortController()
    const stream = await fetch(`${base}/api/events`, {
      headers: { Cookie: cookie },
      signal: streamAbort.signal,
    })
    const reader = stream.body!.getReader()
    await reader.read()
    const input = await call(`/api/sessions/${session.id}/inputs`, 'POST', {
      requestId: randomUUID(),
      text: '检查服务',
    })
    assert.equal(input.status, 202)
    await new Promise((resolve) => setImmediate(resolve))
    execution.observer!({ type: 'accepted', inputId: 'input-1', runId: 'run-1' })
    streamAbort.abort()
    execution.observer!({ type: 'state', status: 'completed' })
    assert.equal(value.store.getSession(session.id).status, 'completed')
    const model = await call('/api/settings/model', 'PUT', {
      provider: 'openai-compatible-gateway',
      baseUrl: 'https://model.example/v1',
      model: 'test-model',
      apiKey: 'private-test-key',
    })
    assert.equal(model.status, 200)
    assert.equal(((await model.json()) as { hasApiKey: boolean }).hasApiKey, true)
    assert.ok(!(await (await call('/api/info')).text()).includes('private-test-key'))
    assert.equal((await call('/api/auth/logout', 'POST', {})).status, 200)
    assert.equal((await call('/api/info')).status, 401)
  } finally {
    await app.close()
    await value.close()
  }
})
