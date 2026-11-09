import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createServerApplication } from '../apps/server/src/app.js'
import { HttpError } from '../apps/server/src/errors.js'
import { ServerFiles } from '../apps/server/src/files.js'
import { ProductStore } from '../apps/server/src/store.js'
import type { TerminalPort } from '../apps/server/src/terminal.js'

type Output = Awaited<ReturnType<TerminalPort['read']>>

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

async function within<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('HTTP subscription did not settle')), 2_000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function fixture(read: TerminalPort['read']) {
  const directory = await mkdtemp(join(tmpdir(), 'velaros-terminal-http-'))
  const state = join(directory, 'state')
  await mkdir(state)
  const store = new ProductStore(':memory:')
  let stops = 0
  const terminal: TerminalPort = {
    available: true,
    open: async () => ({ taskId: 'task', channel: 'pty', shell: 'bash' }),
    read,
    input: async () => {},
    resize: async () => {},
    stop: async () => {
      stops++
    },
  }
  const app = createServerApplication({
    store,
    files: await ServerFiles.create([directory], state),
    accessToken: 'terminal-http-fixture-access-token',
    publicOrigin: 'http://127.0.0.1',
    webDirectory: directory,
    terminal,
  })
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const address = app.server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'terminal-http-fixture-access-token' }),
  })
  assert.equal(login.status, 200)
  await login.json()
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!
  let closing: Promise<void> | undefined
  return {
    subscribe: (signal?: AbortSignal) =>
      fetch(`${base}/api/terminal/task/events`, {
        headers: { Cookie: cookie },
        signal,
      }),
    stopCount: () => stops,
    closeApplication: () => (closing ??= app.close()),
    close: async () => {
      await (closing ??= app.close())
      store.close()
      const actual = await realpath(directory)
      assert.equal(dirname(actual).toLowerCase(), (await realpath(tmpdir())).toLowerCase())
      assert.ok(basename(actual).startsWith('velaros-terminal-http-'))
      await rm(actual, { recursive: true, force: true })
    },
  }
}

const output: Output = {
  taskId: 'task',
  text: 'late output',
  cursor: 11,
  droppedChars: 0,
  status: 'running',
  acceptsInput: true,
}

// 只控制产品端口的 await，不创建 Host/PTY，也不重复已有 Linux/Agent 证明。
test('首次终端读取等待期间即计入 SSE 连接上限', { timeout: 5_000 }, async () => {
  const initial = deferred<Output>()
  const admitted = deferred<void>()
  let reads = 0
  const value = await fixture(async () => {
    if (++reads === 16) admitted.resolve()
    return initial.promise
  })
  const controllers: AbortController[] = []
  const requests: Promise<Response>[] = []
  const subscribe = (): Promise<Response> => {
    const controller = new AbortController()
    controllers.push(controller)
    const request = value.subscribe(controller.signal)
    void request.catch(() => {})
    requests.push(request)
    return request
  }
  try {
    for (let index = 0; index < 16; index++) subscribe()
    await within(admitted.promise)
    const denied = await within(subscribe())
    assert.equal(denied.status, 429)
    assert.equal((await denied.json()).error.code, 'CONNECTION_LIMIT')
    assert.equal(reads, 16)
    assert.equal(value.stopCount(), 0)
  } finally {
    for (const controller of controllers) controller.abort()
    initial.resolve({ ...output, status: 'exited', acceptsInput: false })
    await Promise.allSettled(requests)
    await value.close()
  }
})

test(
  '应用关闭回收等待首次读取的订阅，迟到结果不启动轮询或停止 Host',
  { timeout: 5_000 },
  async () => {
    const initial = deferred<Output>()
    const entered = deferred<void>()
    let reads = 0
    const value = await fixture(async () => {
      reads++
      entered.resolve()
      return initial.promise
    })
    const controller = new AbortController()
    const subscription = value.subscribe(controller.signal)
    void subscription.catch(() => {})
    try {
      await within(entered.promise)
      await within(value.closeApplication())
      const response = await within(subscription)
      assert.equal(await response.text(), '')
      initial.resolve(output)
      await new Promise((resolve) => setTimeout(resolve, 180))
      assert.equal(reads, 1)
      assert.equal(value.stopCount(), 0)
    } finally {
      controller.abort()
      initial.resolve(output)
      await Promise.allSettled([subscription])
      await value.close()
    }
  },
)

test('首次读取拒绝保持 HTTP 错误，失败订阅不耗尽连接额度', { timeout: 5_000 }, async () => {
  const value = await fixture(async () => {
    throw new HttpError(409, 'TERMINAL_CHANGED', '终端已改变')
  })
  try {
    for (let index = 0; index < 17; index++) {
      const response = await within(value.subscribe())
      assert.equal(response.status, 409)
      assert.equal((await response.json()).error.code, 'TERMINAL_CHANGED')
    }
    assert.equal(value.stopCount(), 0)
  } finally {
    await value.close()
  }
})
