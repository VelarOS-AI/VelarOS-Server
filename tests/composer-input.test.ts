import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'
import {
  InputLimits,
  type InputAttachment,
  type SessionView,
} from '../packages/contracts/src/index.js'
import { createServerApplication } from '../apps/server/src/app.js'
import type { ExecutionInput, ExecutionPort } from '../apps/server/src/execution.js'
import { ServerFiles } from '../apps/server/src/files.js'
import { composePlatform } from '../apps/server/src/platform-composition.js'
import { ModelSettingsStore } from '../apps/server/src/model-settings.js'
import { ProductStore } from '../apps/server/src/store.js'

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const image: InputAttachment = {
  kind: 'image',
  name: 'pixel.png',
  mediaType: 'image/png',
  data: png,
}
const text: InputAttachment = {
  kind: 'text',
  name: '服务.log',
  mediaType: 'text/plain',
  data: Buffer.from('服务器原始日志：service-ready\nsecond-line').toString('base64'),
}

async function setup(realRuntime = false, providerUrl = '') {
  const directory = await mkdtemp(join(tmpdir(), 'velaros-composer-'))
  const root = join(directory, 'root'),
    state = join(directory, 'state')
  await mkdir(root)
  await mkdir(state)
  const store = new ProductStore(':memory:')
  const captured: ExecutionInput[] = []
  const fake: ExecutionPort = {
    available: true,
    unavailableReason: null,
    async submit(input, observe) {
      captured.push(input)
      observe({ type: 'accepted', inputId: input.requestId, runId: 'attachment-run' })
      observe({
        type: 'context-usage',
        usage: {
          requestId: 'measured-request',
          model: 'measured-model',
          inputTokens: 1200,
          inputWindow: 10000,
        },
      })
      observe({ type: 'state', status: 'completed' })
    },
    async cancel() {},
    async answer() {},
    async close() {},
  }
  if (realRuntime)
    new ModelSettingsStore(store).save({
      provider: 'openai-compatible-gateway',
      baseUrl: providerUrl,
      model: 'gpt-5',
      apiKey: 'local-composer-fixture',
    })
  const platform = realRuntime
    ? await composePlatform({
        cwd: root,
        dataDirectory: state,
        roots: [root],
        store,
        mode: 'danger-full-access',
        approval: 'ask',
      })
    : null
  const app = createServerApplication({
    store,
    files: await ServerFiles.create([root], state),
    execution: platform?.execution ?? fake,
    accessToken: 'composer-fixture-token-with-24-characters',
    publicOrigin: 'http://127.0.0.1',
    webDirectory: root,
  })
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP port')
  const base = `http://127.0.0.1:${address.port}`
  let cookie = '',
    csrf = ''
  const call = (
    path: string,
    method = 'GET',
    value?: unknown,
    extra: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-VelarOS-CSRF': csrf,
        ...extra,
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      signal: AbortSignal.timeout(5000),
    })
  const login = await call('/api/auth/login', 'POST', {
    token: 'composer-fixture-token-with-24-characters',
  })
  cookie = login.headers.get('set-cookie')!.split(';')[0]!
  csrf = ((await login.json()) as { csrf: string }).csrf
  const session = store.createSession('composer input')
  return {
    store,
    captured,
    call,
    session,
    async close() {
      await app.close()
      await platform?.close()
      store.close()
      const actual = await realpath(directory)
      assert.equal(dirname(actual).toLowerCase(), (await realpath(tmpdir())).toLowerCase())
      assert.ok(basename(actual).startsWith('velaros-composer-'))
      await rm(actual, { recursive: true, force: true })
    },
  }
}

test(
  '附件真实内容交付、仅投影元数据，内容与思考深度参与去重，HTTP 拒绝超限或伪造附件',
  { timeout: 20000 },
  async () => {
    const value = await setup()
    try {
      const path = `/api/sessions/${value.session.id}/inputs`
      const input = {
        requestId: randomUUID(),
        text: '检查附件',
        attachments: [text, image],
        thinkingDepth: 'high',
      }
      assert.equal((await value.call(path, 'POST', input, { 'X-VelarOS-CSRF': '' })).status, 403)
      assert.equal((await value.call(path, 'POST', input)).status, 202)
      for (let i = 0; !value.captured.length && i < 20; i++)
        await new Promise((resolve) => setTimeout(resolve, 10))
      assert.equal(value.captured.length, 1)
      assert.ok(value.captured[0]!.text.includes('服务器原始日志：service-ready\nsecond-line'))
      assert.equal(value.captured[0]!.images?.[0]?.data, png)
      assert.equal(value.captured[0]!.thinkingDepth, 'high')
      const projection = value.store.getSession(value.session.id)
      assert.equal(projection.messages[0]?.text, input.text)
      assert.equal(projection.messages[0]?.attachments?.[0]?.name, '服务.log')
      assert.equal(projection.contextUsage?.inputTokens, 1200)
      assert.ok(!JSON.stringify(projection).includes(png))
      assert.ok(!JSON.stringify(projection).includes('service-ready'))
      assert.equal(
        ((await (await value.call(path, 'POST', input)).json()) as { replayed: boolean }).replayed,
        true,
      )
      assert.equal((await value.call(path, 'POST', { ...input, thinkingDepth: 'low' })).status, 409)
      assert.equal(
        (
          await value.call(path, 'POST', {
            ...input,
            attachments: [{ ...text, data: Buffer.from('changed').toString('base64') }, image],
          })
        ).status,
        409,
      )
      assert.equal(value.captured.length, 1)
      const submit = (attachments: InputAttachment[], overrides: Record<string, unknown> = {}) =>
        value.call(path, 'POST', { requestId: randomUUID(), text: '', attachments, ...overrides })
      assert.equal(
        (
          await submit([
            { ...text, data: Buffer.alloc(InputLimits.textFileBytes + 1, 97).toString('base64') },
          ])
        ).status,
        413,
      )
      const textPart = { ...text, data: Buffer.alloc(100 * 1024, 97).toString('base64') }
      assert.equal((await submit([textPart, textPart, textPart])).status, 413)
      assert.equal(
        (
          await submit([
            { ...image, data: Buffer.alloc(InputLimits.imageBytes + 1).toString('base64') },
          ])
        ).status,
        413,
      )
      const imagePart = Buffer.alloc(Math.floor(1.4 * 1024 * 1024))
      Buffer.from(png, 'base64').copy(imagePart)
      const largeImage = { ...image, data: imagePart.toString('base64') }
      assert.equal((await submit([largeImage, largeImage, largeImage])).status, 413)
      assert.equal((await submit([image, image, image, image, image])).status, 400)
      assert.equal(
        (await submit([{ ...image, data: 'https://example.invalid/image.png' }])).status,
        400,
      )
      assert.equal(
        (await submit([{ ...image, data: Buffer.from('pretend png').toString('base64') }])).status,
        415,
      )
      assert.equal(
        (await submit([{ ...text, data: Buffer.from([255, 254, 0]).toString('base64') }])).status,
        415,
      )
      assert.equal((await submit([text], { thinkingDepth: 'unlimited' })).status, 400)
      assert.equal(
        (await value.call(path, 'POST', { requestId: randomUUID(), text: '' })).status,
        400,
      )
      // 不声明附件也不能越过 HTTP 流的总字节上限；仍能返回明确的 413。
      assert.equal(
        (
          await value.call(path, 'POST', {
            requestId: randomUUID(),
            text: 'x'.repeat(InputLimits.bodyBytes),
          })
        ).status,
        413,
      )
      assert.equal(value.captured.length, 1)
      assert.equal((await submit([image])).status, 202, '允许仅图片输入')
    } finally {
      await value.close()
    }
  },
)

test(
  '正式 SDK 将图片原始数据、完整文件正文与思考档位发到模型，按真实 usage 投影上下文占用',
  { timeout: 25000 },
  async () => {
    let wire: Record<string, unknown> | null = null
    let wireError: unknown
    const provider = createServer((request, response) => {
      void (async () => {
        if (request.method === 'GET') {
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify({ data: [{ id: 'gpt-5' }] }))
          return
        }
        let body = ''
        for await (const chunk of request) body += chunk
        wire = JSON.parse(body) as Record<string, unknown>
        assert.equal(request.url, '/v1/chat/completions')
        assert.equal(wire.reasoning_effort, 'high')
        assert.ok(JSON.stringify(wire.messages).includes('服务器原始日志：service-ready'))
        assert.ok(JSON.stringify(wire.messages).includes(`data:image/png;base64,${png}`))
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        const chunk = (delta: unknown) => ({
          id: 'composer-wire',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'gpt-5',
          choices: [{ index: 0, delta, finish_reason: null }],
        })
        response.write(
          `data: ${JSON.stringify(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'composer-done', type: 'function', function: { name: 'done', arguments: JSON.stringify({ message: '已收到完整附件', completion: '完整内容已接收' }) } }] }))}\n\n`,
        )
        response.write(
          `data: ${JSON.stringify({ ...chunk({}), choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1200, completion_tokens: 20, total_tokens: 1220 } })}\n\n`,
        )
        response.end('data: [DONE]\n\n')
      })().catch((error) => {
        wireError = error
        response.writeHead(500)
        response.end()
      })
    })
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
    const address = provider.address()
    if (!address || typeof address === 'string') throw new Error('Expected provider TCP port')
    const value = await setup(true, `http://127.0.0.1:${address.port}/v1`)
    try {
      const result = await value.call(`/api/sessions/${value.session.id}/inputs`, 'POST', {
        requestId: randomUUID(),
        text: '读取这两个附件即可完成',
        attachments: [text, image],
        thinkingDepth: 'high',
      })
      assert.equal(result.status, 202)
      let session: SessionView = value.store.getSession(value.session.id)
      const deadline = Date.now() + 15000
      while (
        !['completed', 'failed', 'unknown'].includes(session.status) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25))
        session = value.store.getSession(value.session.id)
      }
      assert.ifError(wireError)
      assert.ok(wire)
      assert.equal(session.status, 'completed')
      assert.equal(session.contextUsage?.inputTokens, 1200)
      assert.equal(session.contextUsage?.inputWindow, 110000)
      assert.equal(session.contextUsage?.model, 'gpt-5')
      console.log(
        'Composer wire confirmed: actual inline image, full UTF-8 file, high reasoning, provider usage 1200 / configured input window 110000; no paid provider or Node execution',
      )
    } finally {
      await value.close()
      provider.closeAllConnections()
      await new Promise<void>((resolve) => provider.close(() => resolve()))
    }
  },
)
