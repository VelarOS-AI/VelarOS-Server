import assert from 'node:assert/strict'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { test } from 'node:test'
import { BrowserAuth } from '../apps/server/src/auth.js'
import { ModelSettingsStore, modelSettingsSchema } from '../apps/server/src/model-settings.js'
import { ProductStore } from '../apps/server/src/store.js'

const AccessToken = 'test-access-token-with-at-least-24-characters'
const InvalidToken = { status: 401, code: 'INVALID_TOKEN' }
const RateLimit = { status: 429, code: 'RATE_LIMIT' }
const Connection = {
  provider: 'openai' as const,
  baseUrl: 'https://model.example/v1',
  model: 'test-model',
}

function loginFrom(
  auth: BrowserAuth,
  address: string,
  token = 'incorrect-token',
): { request: IncomingMessage; response: ServerResponse; session: { csrf: string } } {
  const socket = new Socket()
  Object.defineProperty(socket, 'remoteAddress', { value: address })
  const request = new IncomingMessage(socket)
  const response = new ServerResponse(request)
  return { request, response, session: auth.login(request, response, token) }
}

test('登录失败容量满时保留 live 来源的封锁与计数，并拒绝新失败来源', (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: 0 })
  const store = new ProductStore(':memory:')
  const auth = new BrowserAuth(store, AccessToken, false)
  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      assert.throws(() => loginFrom(auth, '192.0.2.1'), InvalidToken)
    }
    for (let index = 1; index < 512; index++) {
      assert.throws(() => loginFrom(auth, `2001:db8::${index.toString(16)}`), InvalidToken)
    }
    assert.throws(() => loginFrom(auth, '2001:db8::1'), InvalidToken)
    assert.throws(() => loginFrom(auth, '192.0.2.1'), RateLimit)
    assert.throws(() => loginFrom(auth, '198.51.100.1'), RateLimit)
    assert.throws(() => loginFrom(auth, '192.0.2.1', AccessToken), RateLimit)
    for (let attempt = 0; attempt < 8; attempt++) {
      assert.throws(() => loginFrom(auth, '2001:db8::1'), InvalidToken)
    }
    assert.throws(() => loginFrom(auth, '2001:db8::1'), RateLimit)
  } finally {
    store.close()
  }
})

test('满容量仍接纳正确令牌，resetAt 到期释放容量而不删除其他 live 来源', (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: 0 })
  const store = new ProductStore(':memory:')
  const auth = new BrowserAuth(store, AccessToken, false)
  try {
    assert.throws(() => loginFrom(auth, '192.0.2.1'), InvalidToken)
    context.mock.timers.tick(1)
    for (let index = 1; index < 512; index++) {
      assert.throws(() => loginFrom(auth, `2001:db8::${index.toString(16)}`), InvalidToken)
    }
    const signedIn = loginFrom(auth, '198.51.100.1', AccessToken)
    const setCookie = signedIn.response.getHeader('Set-Cookie')
    assert.equal(typeof setCookie, 'string')
    signedIn.request.headers.cookie = String(setCookie).split(';')[0]
    assert.deepEqual(auth.session(signedIn.request), signedIn.session)
    assert.throws(() => loginFrom(auth, '198.51.100.2'), RateLimit)

    context.mock.timers.tick(599_999)
    assert.throws(() => loginFrom(auth, '198.51.100.2'), InvalidToken)
    assert.throws(() => loginFrom(auth, '198.51.100.3'), RateLimit)

    context.mock.timers.tick(1)
    assert.throws(() => loginFrom(auth, '198.51.100.3'), InvalidToken)
  } finally {
    store.close()
  }
})

test('模型提交拒绝全空白密钥，保留真实密钥原值、空值保留和显式清除语义', () => {
  const store = new ProductStore(':memory:')
  const settings = new ModelSettingsStore(store)
  const exactKey = '  real-test-key\t '
  try {
    const view = settings.save(modelSettingsSchema.parse({ ...Connection, apiKey: exactKey }))
    assert.equal(view.hasApiKey, true)
    assert.equal(Object.hasOwn(view, 'apiKey'), false)
    assert.equal(settings.read().apiKey, exactKey)

    for (const apiKey of [' ', '\t\r\n', '\u3000']) {
      assert.throws(() => settings.save(modelSettingsSchema.parse({ ...Connection, apiKey })), {
        name: 'ZodError',
      })
      assert.equal(settings.read().apiKey, exactKey)
    }

    settings.save(modelSettingsSchema.parse(Connection))
    assert.equal(settings.read().apiKey, exactKey)
    settings.save(modelSettingsSchema.parse({ ...Connection, apiKey: '' }))
    assert.equal(settings.read().apiKey, exactKey)

    const cleared = settings.save(
      modelSettingsSchema.parse({ ...Connection, apiKey: 'ignored-on-clear', clearApiKey: true }),
    )
    assert.equal(cleared.hasApiKey, false)
    assert.equal(settings.read().apiKey, '')
  } finally {
    store.close()
  }
})

test('已有同形全空白密钥配置仍能用正确密钥或显式清除纠正', () => {
  const store = new ProductStore(':memory:')
  const settings = new ModelSettingsStore(store)
  try {
    const seed = store.db.prepare(
      "INSERT INTO settings (key,value) VALUES ('model',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    const stored = JSON.stringify({ ...Connection, apiKey: ' \t ' })
    seed.run(stored)
    assert.equal(settings.read().apiKey, ' \t ')
    settings.save(modelSettingsSchema.parse({ ...Connection, apiKey: 'corrected-key' }))
    assert.equal(settings.read().apiKey, 'corrected-key')

    seed.run(stored)
    const cleared = settings.save(modelSettingsSchema.parse({ ...Connection, clearApiKey: true }))
    assert.equal(cleared.hasApiKey, false)
    assert.equal(settings.read().apiKey, '')
  } finally {
    store.close()
  }
})
