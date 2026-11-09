import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { modelRequestEncoder, type ModelDriver } from '@velaros-ai/velaros/kernel'
import { ObservationLimits, type ObservationHistorySelectionReceipt } from '@velaros-ai/velaros'
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

test(
  '固定 SDK 的历史动态交付与真实 Runtime/Node 经 HTTP 确认后执行',
  { timeout: 25_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'velaros-server-seam-'))
    const cwd = join(directory, 'host')
    const dataDirectory = join(directory, 'state')
    await mkdir(cwd)
    await mkdir(dataDirectory)
    const target = join(cwd, 'confirmed.txt')
    const source = `import {writeFile} from 'node:fs/promises'; await writeFile(${JSON.stringify(target)}, 'server-confirmed'); console.log('server-confirmed')`
    const historyCall = {
      id: 'server-observe-history',
      name: 'observe',
      input: { code: '', options: { history: { kind: 'list' } } },
    }
    let calls = 0
    let selectionRef: string | undefined
    let observationSupport: { available: boolean; reason?: string } | undefined
    // 只替代外部供应商。Agent、存储、授权桥、Node 子进程和 Host 都是真实固定归档实现。
    const model: ModelDriver = {
      id: 'server-seam-deterministic',
      nativeTools: true,
      limits: { inputTokens: 100_000, contextTokens: 120_000, outputTokens: 2_000 },
      estimate: async () => ({ tokens: 1_000, precision: 'estimate', basis: 'deterministic seam' }),
      stream: async function* (request) {
        assert.equal(request.mode, 'work')
        assert.equal(request.response.type, 'tools')
        const layout = modelRequestEncoder.layout(request)
        const prefix = JSON.stringify(layout.messages.slice(0, layout.retainablePrefixLength))
        const tail = layout.messages.slice(layout.retainablePrefixLength)
        assert.ok(
          request.protocol,
          'The current protocol is delivered separately from the stable frame',
        )
        assert.ok(
          tail.some(
            (message) =>
              typeof message.content === 'string' && message.content.includes(request.protocol!),
          ),
        )
        if (request.dynamic) {
          assert.ok(request.dynamic.text.length <= ObservationLimits.maxChars)
          assert.ok(
            !prefix.includes(request.dynamic.text),
            'Dynamic material stays outside the prefix',
          )
        }
        calls++
        assert.ok(calls <= 3, 'one history selection, one execution and completion only')
        if (calls === 1) {
          const observe = request.response.tools.find((tool) => tool.name === 'observe')
          assert.ok(observe)
          const code = (
            observe.schema.properties as Record<string, { const?: unknown; type?: string }>
          ).code!
          const availability = request.dynamic
            ? JSON.parse(request.dynamic.text).current?.availability
            : undefined
          if (code.const === '') {
            assert.equal(availability?.available, false)
            assert.ok(availability.reason)
            assert.ok(observe.description.includes(availability.reason))
            observationSupport = { available: false, reason: availability.reason }
          } else {
            assert.equal(code.type, 'string')
            assert.equal(availability, undefined)
            observationSupport = { available: true }
          }
          yield { type: 'tool-call', value: historyCall }
        } else if (calls === 2) {
          assert.ok(request.dynamic)
          const exchange = request.dynamic.exchanges?.find((item) =>
            item.exchange.calls.some((call) => call.id === historyCall.id),
          )?.exchange
          assert.ok(exchange, 'The next turn receives the real observation call/result together')
          assert.deepEqual(exchange.calls, [historyCall])
          const result = exchange.results.find((item) => item.id === historyCall.id)
          assert.ok(result)
          const output = result.output as {
            receipt: ObservationHistorySelectionReceipt
            effect: string
          }
          assert.equal(output.effect, 'none')
          assert.equal(output.receipt.status, 'selected')
          assert.equal(output.receipt.effective, 'next-model-turn')
          assert.equal(output.receipt.executed, false)
          selectionRef = output.receipt.selectionRef
          assert.ok(selectionRef)
          const material = JSON.parse(request.dynamic.text)
          assert.equal(material.origin, 'runtime-observation')
          assert.equal(material.history.selectionRef, selectionRef)
          assert.deepEqual(material.history.result, { kind: 'list', entries: [], nextCursor: null })
          assert.ok(tail.some((message) => message.content === request.dynamic!.text))
          const deliveredExchange = tail.find(
            (message) =>
              message.role === 'assistant' &&
              message.toolExchange?.calls.some((call) => call.id === historyCall.id),
          )
          assert.ok(deliveredExchange?.role === 'assistant')
          assert.deepEqual(deliveredExchange.toolExchange, exchange)
          assert.ok(
            !prefix.includes(historyCall.id),
            'The observation exchange is not ordinary history',
          )
          await assert.rejects(readFile(target), { code: 'ENOENT' })
          yield {
            type: 'tool-call',
            value: {
              id: 'server-exec',
              name: 'exec',
              input: { code: source, options: { async: false } },
            },
          }
        } else {
          assert.ok(selectionRef)
          assert.ok(
            !JSON.stringify(request.dynamic ?? null).includes(selectionRef),
            'Selection is consumed once',
          )
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
        text: '先选择观察历史目录，再创建确认文件并核对结果',
      })
      assert.equal(response.status, 202)
      assert.equal(((await response.json()) as { status: string }).status, 'received')
      const session = await until(
        async () => (await (await api(`/api/sessions/${sessionId}`)).json()) as SessionView,
        (view) => Boolean(view.interaction) || ['failed', 'unknown'].includes(view.status),
      )
      assert.equal(session.status, 'waiting', JSON.stringify(session))
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
      assert.equal(completed.status, 'completed', JSON.stringify(completed))
      assert.equal(await readFile(target, 'utf8'), 'server-confirmed')
      assert.ok(completed.messages.some((item) => item.text.includes('已经核实文件写入')))
      assert.equal(calls, 3)
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
    console.log(
      'Real Runtime confirmed',
      JSON.stringify({
        input: true,
        observationSupport,
        historySelection: true,
        historyExecuted: false,
        nextTurnDynamicHistory: true,
        completeNativeExchangeInDynamicTail: true,
        officialRequestEncoder: true,
        selectionConsumedOnce: true,
        approval: true,
        nodeFile: true,
        completed: true,
        modelCalls: calls,
        host: process.platform,
        node: process.versions.node,
        runtimeHostClosed: true,
        providerApi: false,
        readOnlyCaptureTested: false,
        linuxInstallRepeated: false,
        webBuildRepeated: false,
      }),
    )
  },
)
