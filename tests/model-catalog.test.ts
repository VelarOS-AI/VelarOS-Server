import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'
import { createServerApplication } from '../apps/server/src/app.js'
import { ServerFiles } from '../apps/server/src/files.js'
import { ModelSettingsStore } from '../apps/server/src/model-settings.js'
import { ProductStore } from '../apps/server/src/store.js'

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'velaros-server-catalog-'))
  const root = join(directory, 'root')
  const state = join(directory, 'state')
  await mkdir(root)
  await mkdir(state)
  let mode: 'models' | 'empty' | 'failure' | 'slow' = 'models'
  const calls: { path: string; authorization: string | undefined }[] = []
  let signalStarted: () => void = () => {}
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve
  })
  const remote = createServer((request, response) => {
    calls.push({ path: request.url ?? '', authorization: request.headers.authorization })
    if (mode === 'slow') {
      signalStarted()
      return
    }
    response.setHeader('Content-Type', 'application/json')
    if (mode === 'failure') {
      response.writeHead(401)
      response.end(
        JSON.stringify({ error: { message: `Invalid ${request.headers.authorization}` } }),
      )
    } else
      response.end(
        JSON.stringify({
          data:
            mode === 'empty'
              ? []
              : [
                  {
                    id:
                      request.headers.authorization === 'Bearer draft-key'
                        ? 'draft-only'
                        : 'saved-only',
                  },
                ],
        }),
      )
  })
  await new Promise<void>((resolve) => remote.listen(0, '127.0.0.1', resolve))
  const remoteAddress = remote.address()
  if (!remoteAddress || typeof remoteAddress === 'string')
    throw new Error('Expected provider TCP port')
  const baseUrl = `http://127.0.0.1:${remoteAddress.port}/v1`
  const store = new ProductStore(':memory:')
  const app = createServerApplication({
    store,
    files: await ServerFiles.create([root], state),
    accessToken: 'model-catalog-test-token-with-24-characters',
    publicOrigin: 'http://127.0.0.1',
    webDirectory: root,
  })
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('Expected product TCP port')
  const origin = `http://127.0.0.1:${address.port}`
  let cookie = ''
  let csrf = ''
  const call = (
    path: string,
    method = 'POST',
    value?: unknown,
    extra: Record<string, string> = {},
  ) =>
    fetch(`${origin}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-VelarOS-CSRF': csrf,
        ...extra,
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    })
  const login = async () => {
    const response = await call('/api/auth/login', 'POST', {
      token: 'model-catalog-test-token-with-24-characters',
    })
    cookie = response.headers.get('set-cookie')!.split(';')[0]!
    csrf = ((await response.json()) as { csrf: string }).csrf
  }
  let closed = false
  const closeApp = async () => {
    if (!closed) {
      closed = true
      await app.close()
    }
  }
  return {
    baseUrl,
    calls,
    started,
    call,
    login,
    closeApp,
    settings: new ModelSettingsStore(store),
    setMode(value: typeof mode) {
      mode = value
    },
    async close() {
      await closeApp()
      store.close()
      remote.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        remote.close((error) => (error ? reject(error) : resolve())),
      )
      const actual = await realpath(directory)
      assert.equal(dirname(actual).toLowerCase(), (await realpath(tmpdir())).toLowerCase())
      assert.ok(basename(actual).startsWith('velaros-server-catalog-'))
      await rm(actual, { recursive: true, force: true })
    },
  }
}

test(
  '动态目录复用同连接密钥，查询草稿不保存，跨连接与未授权请求不能取用旧密钥',
  { timeout: 10_000 },
  async () => {
    const value = await fixture()
    const connection = { provider: 'openai-compatible-gateway', baseUrl: value.baseUrl }
    try {
      assert.equal(
        (await value.call('/api/settings/model/catalog', 'POST', connection)).status,
        401,
      )
      await value.login()
      assert.equal(
        (
          await value.call('/api/settings/model/catalog', 'POST', connection, {
            'X-VelarOS-CSRF': '',
          })
        ).status,
        403,
      )
      assert.equal(
        (
          await value.call('/api/settings/model', 'PUT', {
            ...connection,
            model: 'saved-model',
            apiKey: 'saved-key',
          })
        ).status,
        200,
      )
      const catalog = await value.call('/api/settings/model/catalog', 'POST', connection)
      assert.equal(catalog.status, 200)
      const body = await catalog.text()
      assert.deepEqual(
        JSON.parse(body).models.map((entry: { id: string }) => entry.id),
        ['saved-only'],
      )
      assert.ok(!body.includes('saved-key'))
      assert.equal(value.calls[0]?.authorization, 'Bearer saved-key')
      const draft = await value.call('/api/settings/model/catalog', 'POST', {
        ...connection,
        apiKey: 'draft-key',
      })
      assert.deepEqual(
        ((await draft.json()) as { models: { id: string }[] }).models.map((entry) => entry.id),
        ['draft-only'],
      )
      assert.equal(value.settings.read().apiKey, 'saved-key')
      assert.equal(value.settings.read().model, 'saved-model')
      for (const changed of [
        { ...connection, baseUrl: `${value.baseUrl}/other` },
        { ...connection, provider: 'anthropic' },
      ])
        assert.equal((await value.call('/api/settings/model/catalog', 'POST', changed)).status, 400)
      assert.equal(value.calls.length, 2)
    } finally {
      await value.close()
    }
  },
)

test('目录失败和空结果不补预置型号，关闭服务取消在飞目录请求', { timeout: 10_000 }, async () => {
  const value = await fixture()
  const query = {
    provider: 'openai-compatible-gateway',
    baseUrl: value.baseUrl,
    apiKey: 'draft-key',
  }
  try {
    await value.login()
    value.setMode('failure')
    const failed = (await (
      await value.call('/api/settings/model/catalog', 'POST', query)
    ).json()) as { models: unknown[]; error: string }
    assert.deepEqual(failed.models, [])
    assert.ok(failed.error)
    assert.ok(!failed.error.includes('draft-key'))
    value.setMode('empty')
    const empty = (await (
      await value.call('/api/settings/model/catalog', 'POST', query)
    ).json()) as { models: unknown[]; error: string | null }
    assert.deepEqual(empty.models, [])
    assert.equal(empty.error, null)
    value.setMode('slow')
    const pending = value.call('/api/settings/model/catalog', 'POST', query)
    await value.started
    await value.closeApp()
    assert.equal((await pending).status, 503)
  } finally {
    await value.close()
  }
})
