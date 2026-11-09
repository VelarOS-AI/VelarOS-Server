// 只验证既有 Linux 制品的 Agent 闭环，不重装、不构建、不调用外部供应商。
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createServer as createPortReservation } from 'node:net'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

assert.equal(process.platform, 'linux', 'Only the existing Linux product is exercised')
assert.ok(process.argv[2], 'Expected an unpacked production bundle')
const bundle = await realpath(resolve(process.argv[2]))
const manifest = JSON.parse(await readFile(join(bundle, 'artifact-manifest.json'), 'utf8'))
assert.equal(manifest.sourceCommit, '19d426196d43238f38d83ae1c3712438e1b0fd48')
assert.equal(manifest.runtime.platform.version, '0.9.3')
const foundationSha = createHash('sha256')
  .update(await readFile(join(bundle, manifest.runtime.platform.file)))
  .digest('hex')
assert.equal(foundationSha, '7e65c6627a046aecc937e13b0442cd14dcf3e323bc583147eae8b0b072f0ca59')
const main = join(bundle, 'dist/apps/server/src/main.js')
assert.equal(
  createHash('sha256')
    .update(await readFile(main))
    .digest('hex'),
  manifest.files.find((f) => f.path === 'dist/apps/server/src/main.js').sha256,
)

const directory = await mkdtemp(join(tmpdir(), 'velaros-server-agent-chain-'))
const host = join(directory, 'host')
const state = join(directory, 'state')
await mkdir(host)
await mkdir(state)
const outputPath = join(host, 'agent-confirmed.json')
const waitingPath = join(host, 'agent-waiting.json')
const marker = 'SERVER_AGENT_NODE_READ_WRITE_CONFIRMED'
const writeSource = `import {writeFile,readFile} from 'node:fs/promises'; const record={marker:${JSON.stringify(marker)},pid:process.pid,ppid:process.ppid}; await writeFile(${JSON.stringify(outputPath)},JSON.stringify(record)); const actual=JSON.parse(await readFile(${JSON.stringify(outputPath)},'utf8')); if(actual.marker!==record.marker) throw new Error('readback mismatch'); console.log(JSON.stringify(actual));`
const waitingSource = `import {writeFile,rename} from 'node:fs/promises'; await writeFile(${JSON.stringify(waitingPath + '.pending')},JSON.stringify({pid:process.pid,ppid:process.ppid})); await rename(${JSON.stringify(waitingPath + '.pending')},${JSON.stringify(waitingPath)}); console.log('SERVER_AGENT_NODE_WAITING'); await new Promise(()=>{setInterval(()=>{},1000)});`
const accessToken = randomBytes(32).toString('base64url')
const modelKey = 'local-agent-proof-not-a-provider-secret'
const controller = new AbortController()
const workTimeout = setTimeout(
  () => controller.abort(new Error('Agent chain exceeded its 25s work budget')),
  25_000,
)
let calls = 0
let stubFailure
let toolResultObserved = false
let serverLog = ''
let child
let closed
let didClose = false
let exit
let eventTask
let events = 0
let cookie = ''
let csrf = ''
let succeeded = false
let failure
let receipt
const eventAbort = new AbortController()
const ownedProcesses = new Map()

async function identity(pid) {
  try {
    const text = await readFile(`/proc/${pid}/stat`, 'utf8')
    return text.slice(text.lastIndexOf(')') + 2).split(' ')[19]
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return null
    throw error
  }
}

async function captureNode(record) {
  assert.ok(Number.isSafeInteger(record.pid) && record.pid > 1 && record.pid !== child.pid)
  let pid = record.pid
  for (let depth = 0; depth < 10 && pid !== child.pid; depth++) {
    const current = await identity(pid)
    assert.ok(current, `Node descendant ${pid} must still be alive when admitted`)
    ownedProcesses.set(pid, current)
    const status = await readFile(`/proc/${pid}/status`, 'utf8')
    pid = Number(/^PPid:\s+(\d+)/mu.exec(status)?.[1])
  }
  assert.equal(pid, child.pid, 'Node execution must belong to this Server Host')
}

async function until(read, accept, label, signal = controller.signal, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    signal?.throwIfAborted()
    const value = await read()
    if (accept(value)) return value
    if (Date.now() >= deadline) throw new Error(`${label} did not settle: ${JSON.stringify(value)}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function readOptional(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function byDeadline(promise, deadlineAt) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Agent cleanup deadline exceeded')),
        Math.max(0, deadlineAt - Date.now()),
      )
    }),
  ]).finally(() => clearTimeout(timer))
}

const model = createServer((request, response) => {
  void (async () => {
    assert.equal(request.method, 'POST')
    assert.equal(request.url, '/v1/chat/completions')
    assert.equal(request.headers.authorization, `Bearer ${modelKey}`)
    let body = ''
    for await (const chunk of request) {
      body += chunk
      assert.ok(body.length < 1_000_000)
    }
    const input = JSON.parse(body)
    assert.equal(input.model, 'server-agent-proof')
    assert.equal(input.stream, true)
    assert.ok(input.tools.some((tool) => tool.function?.name === 'exec'))
    assert.ok(input.tools.some((tool) => tool.function?.name === 'done'))
    calls++
    assert.ok(calls <= 3, 'One completed task and one cancelled task only')
    let name = 'exec'
    let arguments_ = { code: calls === 1 ? writeSource : waitingSource, options: { async: false } }
    if (calls === 2) {
      assert.equal((await readOptional(outputPath))?.marker, marker)
      const results = input.messages.filter((message) => message.role === 'tool')
      assert.ok(
        results.some((result) => JSON.stringify(result.content).includes(marker)),
        'Model must receive the real Node result',
      )
      toolResultObserved = true
      name = 'done'
      arguments_ = { message: 'Agent 已完成真实文件读写核对', completion: marker }
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    const chunk = (delta) => ({
      id: `server-agent-${calls}`,
      object: 'chat.completion.chunk',
      created: 1,
      model: input.model,
      choices: [{ index: 0, delta, finish_reason: null }],
    })
    response.write(
      `data: ${JSON.stringify(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `call-${calls}`, type: 'function', function: { name, arguments: JSON.stringify(arguments_) } }] }))}\n\n`,
    )
    response.write(
      `data: ${JSON.stringify({ ...chunk({}), choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\n`,
    )
    response.end('data: [DONE]\n\n')
  })().catch((error) => {
    stubFailure = error
    if (!response.headersSent) response.writeHead(500)
    response.end()
  })
})

let base
const api = (path, method = 'GET', body) =>
  fetch(`${base}${path}`, {
    method,
    headers: { Cookie: cookie, 'X-VelarOS-CSRF': csrf, 'Content-Type': 'application/json' },
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2_000)]),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

try {
  await new Promise((resolve) => model.listen(0, '127.0.0.1', resolve))
  const modelBase = `http://127.0.0.1:${model.address().port}/v1`
  const reservation = createPortReservation()
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve))
  const port = reservation.address().port
  await new Promise((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  )
  base = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, [main], {
    cwd: bundle,
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      VELAROS_SERVER_BIND: '127.0.0.1',
      VELAROS_SERVER_PUBLIC_ORIGIN: base,
      VELAROS_SERVER_DATA_DIR: state,
      VELAROS_SERVER_EXECUTION_ROOT: host,
      VELAROS_SERVER_FILE_ROOTS_JSON: JSON.stringify([host]),
      VELAROS_SERVER_EXECUTION_MODE: 'danger-full-access',
      VELAROS_SERVER_APPROVAL: 'ask',
      VELAROS_SERVER_ACCESS_TOKEN: accessToken,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const pipe of [child.stdout, child.stderr]) {
    pipe.setEncoding('utf8')
    pipe.on('data', (text) => {
      serverLog = (serverLog + text).slice(-16_000)
    })
  }
  closed = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      didClose = true
      exit = { code, signal }
      resolve(exit)
    })
  })
  await until(
    async () => {
      try {
        return (await api('/api/health')).ok
      } catch {
        return false
      }
    },
    Boolean,
    'Server startup',
  )
  const login = await api('/api/auth/login', 'POST', { token: accessToken })
  assert.equal(login.status, 200)
  cookie = login.headers.get('set-cookie').split(';')[0]
  csrf = (await login.json()).csrf
  assert.equal(
    (
      await api('/api/settings/model', 'PUT', {
        provider: 'openai-compatible-gateway',
        baseUrl: modelBase,
        model: 'server-agent-proof',
        apiKey: modelKey,
      })
    ).status,
    200,
  )
  const created = await api('/api/sessions', 'POST', { title: '0.9.3 actual Agent proof' })
  assert.equal(created.status, 201)
  const sessionId = (await created.json()).id
  const stream = await fetch(`${base}/api/events`, {
    headers: { Cookie: cookie },
    signal: eventAbort.signal,
  })
  assert.equal(stream.status, 200)
  eventTask = (async () => {
    let text = ''
    const decoder = new TextDecoder()
    for await (const chunk of stream.body) {
      text += decoder.decode(chunk, { stream: true })
      let split
      while ((split = text.indexOf('\n\n')) >= 0) {
        const packet = text.slice(0, split)
        text = text.slice(split + 2)
        if (packet.includes('event: change')) {
          const notice = JSON.parse(
            packet
              .split('\n')
              .find((line) => line.startsWith('data: '))
              .slice(6),
          )
          if (notice.sessionId === sessionId) events++
        }
      }
    }
  })()
  void eventTask.catch(() => {}) // finally 取消订阅并 await 同一任务。
  const view = async () => {
    const response = await api(`/api/sessions/${sessionId}`)
    assert.equal(response.status, 200)
    return response.json()
  }
  const approve = async (requestId, text, expectedSource) => {
    const accepted = await api(`/api/sessions/${sessionId}/inputs`, 'POST', { requestId, text })
    assert.equal(accepted.status, 202)
    assert.equal((await accepted.json()).status, 'received')
    const waiting = await until(
      view,
      (value) => Boolean(value.interaction) || ['failed', 'unknown'].includes(value.status),
      'Agent approval',
    )
    assert.equal(waiting.status, 'waiting')
    assert.equal(waiting.inputId, requestId)
    assert.ok(waiting.runId && waiting.facts.length)
    const review = await api(
      `/api/sessions/${sessionId}/interaction?requestId=${encodeURIComponent(waiting.interaction.id)}`,
    )
    assert.equal((await review.json()).source, expectedSource)
    assert.equal(
      (
        await api(`/api/sessions/${sessionId}/answers`, 'POST', {
          runId: waiting.runId,
          requestId: waiting.interaction.id,
          value: true,
        })
      ).status,
      202,
    )
    return waiting
  }
  const first = await approve(randomUUID(), '写入并读取核对文件，然后完成任务', writeSource)
  const completed = await until(
    view,
    (value) => ['completed', 'failed', 'unknown'].includes(value.status),
    'Agent completion',
  )
  assert.equal(completed.status, 'completed')
  assert.equal(completed.runId, first.runId)
  assert.ok(
    completed.messages.some((message) => message.text.includes('Agent 已完成真实文件读写核对')),
  )
  const actual = await readOptional(outputPath)
  assert.equal(actual.marker, marker)
  assert.ok(actual.pid > 1 && actual.pid !== child.pid)
  if (await identity(actual.pid)) await captureNode(actual)
  assert.equal(toolResultObserved, true)
  const second = await approve(
    randomUUID(),
    '启动一条真实等待程序，稍后由操作者取消',
    waitingSource,
  )
  assert.notEqual(second.runId, first.runId)
  const waitingNode = await until(() => readOptional(waitingPath), Boolean, 'Real Node startup')
  await captureNode(waitingNode)
  assert.equal(
    (await api(`/api/sessions/${sessionId}/cancel`, 'POST', { runId: second.runId })).status,
    202,
  )
  const cancelled = await until(
    view,
    (value) => ['cancelled', 'failed', 'completed', 'unknown'].includes(value.status),
    'Agent cancellation',
  )
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.runId, second.runId)
  await until(
    async () => events,
    (value) => value > 2,
    'SSE changes',
  )
  assert.equal(calls, 3)
  assert.equal(stubFailure, undefined)
  receipt = {
    artifactSourceCommit: manifest.sourceCommit,
    foundationVersion: '0.9.3',
    foundationSha256: foundationSha,
    platform: process.platform,
    node: process.versions.node,
    modelProtocol: 'local-openai-compatible-chat-http-sse',
    modelRequests: calls,
    productHttpSession: true,
    approvalRoundTrips: 2,
    distinctRunIds: true,
    agentKernel: true,
    realNodeReadWrite: true,
    modelObservedRealToolResult: true,
    completed: true,
    cancelRequestAccepted: true,
    cancelledStateObserved: true,
    sseChanges: events,
    providerApi: false,
    artifactRebuilt: false,
    dependenciesReinstalled: false,
    confinement: 'danger-full-access',
    productionDeployed: false,
  }
  succeeded = true
} catch (error) {
  failure = error
  console.error('Agent chain failed', error, stubFailure, serverLog)
} finally {
  clearTimeout(workTimeout)
  const cleanupDeadline = Date.now() + 5_000
  const errors = []
  eventAbort.abort()
  if (eventTask)
    await byDeadline(eventTask, cleanupDeadline).catch((error) => {
      if (error.name !== 'AbortError') errors.push(error)
    })
  if (child && !didClose) child.kill('SIGTERM')
  if (closed) {
    try {
      await byDeadline(closed, cleanupDeadline)
      if (succeeded) assert.deepEqual(exit, { code: 0, signal: null })
    } catch (error) {
      errors.push(error)
    }
  }
  if (model.listening) {
    model.closeAllConnections()
    await byDeadline(
      new Promise((resolve, reject) => model.close((error) => (error ? reject(error) : resolve()))),
      cleanupDeadline,
    ).catch((error) => errors.push(error))
  }
  for (const [pid, start] of ownedProcesses) {
    try {
      assert.notEqual(
        await identity(pid),
        start,
        `Owned Node resource ${pid} still alive after Host close`,
      )
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length || (child && !didClose)) {
    console.error(`Cleanup unconfirmed; retained ${directory}; Server PID ${child?.pid}`)
    if (child && !didClose) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch (error) {
        if (error.code !== 'ESRCH') errors.push(error)
      }
    }
  } else {
    const actual = await realpath(directory)
    assert.equal(dirname(actual), await realpath(tmpdir()))
    assert.ok(basename(actual).startsWith('velaros-server-agent-chain-'))
    await rm(actual, { recursive: true, force: true })
  }
  if (failure || errors.length)
    throw new AggregateError(
      [...(failure ? [failure] : []), ...errors],
      'Agent chain or cleanup failed',
    )
}
assert.ok(succeeded)
receipt.ownedNodeProcessesObserved = ownedProcesses.size
receipt.ownedNodeResourcesClosedAfterHostClose = true
receipt.serverExitCode = exit.code
receipt.serverCloseConfirmed = didClose
await mkdir('.cache', { recursive: true })
await writeFile('.cache/agent-chain-proof.json', JSON.stringify(receipt, null, 2) + '\n')
console.log(JSON.stringify(receipt))
