import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { VelarosRuntime, VelarosSession } from '@velaros-ai/velaros'
import type { LocalShellHostApi } from '@velaros-ai/velaros/execution'
import { ModelSettingsStore } from '../apps/server/src/model-settings.js'
import { ProductStore } from '../apps/server/src/store.js'

type ExecutionConstructor =
  typeof import('../apps/server/src/platform-execution.js').PlatformExecution

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, deny) => {
    resolve = accept
    reject = deny
  })
  return { promise, resolve, reject }
}

// 只实现生命周期场景调用的公开面，不启动 Agent、Node 程序、PTY 或供应商连接。
function runtime(close: () => Promise<void>): VelarosRuntime {
  const session = {
    async *submit() {
      yield { type: 'state', runId: 'lifecycle-run', status: 'completed' }
    },
  } as unknown as VelarosSession
  return { openSession: async () => session, close } as unknown as VelarosRuntime
}

async function fixture(Execution: ExecutionConstructor) {
  const directory = await mkdtemp(join(tmpdir(), 'velaros-runtime-lifecycle-'))
  const cwd = join(directory, 'work')
  await mkdir(cwd)
  const store = new ProductStore(':memory:')
  const settings = new ModelSettingsStore(store)
  settings.save({
    provider: 'openai',
    baseUrl: 'https://model.invalid/v1',
    model: 'first-model',
    apiKey: 'lifecycle-test-key',
  })
  const execution = new Execution(
    {
      host: {} as LocalShellHostApi,
      cwd,
      stateDirectory: join(directory, 'runtime'),
      binding: { executionIdentity: 'lifecycle-principal', authorizationScope: 'lifecycle-scope' },
      approval: 'ask',
    },
    store,
    settings,
  )
  const session = store.createSession('runtime lifecycle')
  return {
    execution,
    settings,
    input: { sessionId: session.id, requestId: randomUUID(), text: 'lifecycle probe' },
    dispose: async () => {
      store.close()
      const actual = await realpath(directory)
      assert.equal(dirname(actual).toLowerCase(), (await realpath(tmpdir())).toLowerCase())
      assert.ok(basename(actual).startsWith('velaros-runtime-lifecycle-'))
      await rm(actual, { recursive: true, force: true })
    },
  }
}

test('Runtime 初始化按模型身份装配并保留关闭 owner', async (context) => {
  let createRuntime: () => Promise<VelarosRuntime> = async () => {
    throw new Error('本场景尚未配置 Runtime')
  }
  context.mock.module('@velaros-ai/velaros/node', {
    namedExports: { createNodeRuntime: () => createRuntime() },
  })
  const { PlatformExecution } = await import('../apps/server/src/platform-execution.js')

  await context.test('模型配置改变时新提交不能加入旧初始化', async () => {
    const opening = deferred<VelarosRuntime>()
    const started = deferred<void>()
    let creations = 0
    let closes = 0
    createRuntime = async () => {
      if (++creations === 1) {
        started.resolve(undefined)
        return opening.promise
      }
      return runtime(async () => {
        closes++
      })
    }
    const value = await fixture(PlatformExecution)
    const original = value.execution.submit(value.input, () => {})
    void original.catch(() => {}) // finally 接收同一提交结果，保证故障路径也有 owner。
    let rejection: Promise<void> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await started.promise
      value.settings.save({ ...value.settings.read(), model: 'second-model' })
      rejection = assert.rejects(
        value.execution.submit({ ...value.input, requestId: randomUUID() }, () => {}),
        { code: 'MODEL_BUSY', status: 409 },
      )
      // B 必须在 A 的工厂获准返回前拒绝，不能悄悄加入旧模型。
      await Promise.race([
        rejection,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('新配置提交仍在等待旧初始化')), 2_000)
        }),
      ])
      assert.equal(creations, 1)
      opening.resolve(
        runtime(async () => {
          closes++
        }),
      )
      await original
      await value.execution.submit({ ...value.input, requestId: randomUUID() }, () => {})
      assert.equal(creations, 2)
      assert.equal(closes, 1)
    } finally {
      clearTimeout(timeout)
      opening.resolve(
        runtime(async () => {
          closes++
        }),
      )
      await Promise.allSettled([original, ...(rejection ? [rejection] : [])])
      await value.execution.close()
      await value.dispose()
    }
  })

  await context.test('首次初始化失败不阻断并发关闭后的产品资源链', async () => {
    const opening = deferred<VelarosRuntime>()
    const started = deferred<void>()
    const initializationError = new Error('initialization failed')
    let creations = 0
    createRuntime = async () => {
      creations++
      started.resolve(undefined)
      return opening.promise
    }
    const value = await fixture(PlatformExecution)
    try {
      const submission = assert.rejects(
        value.execution.submit(value.input, () => {}),
        (error) => error === initializationError,
      )
      await started.promise
      const released: string[] = []
      // 此链只代表产品在 Runtime 关闭成功后释放 Host/environment 的顺序。
      const closing = value.execution.close().then(() => {
        released.push('host', 'environment')
      })
      assert.deepEqual(released, [])
      opening.reject(initializationError)
      await Promise.all([submission, closing])
      assert.deepEqual(released, ['host', 'environment'])
      await value.execution.close()
      assert.equal(creations, 1)
    } finally {
      await value.dispose()
    }
  })

  await context.test('替换模型时旧 Runtime 关闭失败保留原错误并阻断产品资源链', async () => {
    const retirement = deferred<void>()
    const started = deferred<void>()
    const closeError = new Error('old runtime close failed')
    let creations = 0
    let closes = 0
    createRuntime = async () => {
      creations++
      return runtime(async () => {
        closes++
        started.resolve(undefined)
        await retirement.promise
      })
    }
    const value = await fixture(PlatformExecution)
    try {
      await value.execution.submit(value.input, () => {})
      value.settings.save({ ...value.settings.read(), model: 'second-model' })
      const replacement = assert.rejects(
        value.execution.submit({ ...value.input, requestId: randomUUID() }, () => {}),
        (error) => error === closeError,
      )
      await started.promise
      const released: string[] = []
      const closing = assert.rejects(
        value.execution.close().then(() => {
          released.push('host', 'environment')
        }),
        (error) => error === closeError,
      )
      retirement.reject(closeError)
      await Promise.all([replacement, closing])
      await assert.rejects(value.execution.close(), (error) => error === closeError)
      assert.deepEqual(released, [])
      assert.equal(creations, 1)
      assert.equal(closes, 1)
    } finally {
      await value.dispose()
    }
  })

  await context.test('旧 Runtime 已关闭后的新建失败不阻断产品资源链', async () => {
    const opening = deferred<VelarosRuntime>()
    const started = deferred<void>()
    const initializationError = new Error('replacement initialization failed')
    let creations = 0
    let closes = 0
    createRuntime = async () => {
      if (++creations === 1) {
        return runtime(async () => {
          closes++
        })
      }
      started.resolve(undefined)
      return opening.promise
    }
    const value = await fixture(PlatformExecution)
    try {
      await value.execution.submit(value.input, () => {})
      value.settings.save({ ...value.settings.read(), model: 'second-model' })
      const replacement = assert.rejects(
        value.execution.submit({ ...value.input, requestId: randomUUID() }, () => {}),
        (error) => error === initializationError,
      )
      await started.promise
      const released: string[] = []
      const closing = value.execution.close().then(() => {
        released.push('host', 'environment')
      })
      opening.reject(initializationError)
      await Promise.all([replacement, closing])
      assert.deepEqual(released, ['host', 'environment'])
      assert.equal(creations, 2)
      assert.equal(closes, 1)
    } finally {
      await value.dispose()
    }
  })
})
