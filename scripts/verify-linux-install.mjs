// 单轮 Linux 产品安装接缝；消费已组装的生产目录，不重跑 Agent/供应商或浏览器矩阵。
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, mkdir, writeFile, access, stat } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

if (process.platform !== 'linux')
  throw new Error('此验证只接受真实 Linux，不把其他平台结果当作部署证明')
if (!process.argv[2]) throw new Error('需要已解压的 Linux 生产包目录')
const bundle = await realpath(resolve(process.argv[2]))
const manifest = JSON.parse(await readFile(join(bundle, 'artifact-manifest.json'), 'utf8'))
assert.equal(manifest.platform, process.platform)
assert.equal(manifest.architecture, process.arch)
const snapshot = JSON.parse(await readFile(join(bundle, 'resources/runtime-snapshot.json'), 'utf8'))
const expectedMain = manifest.files.find((file) => file.path === 'dist/apps/server/src/main.js')
assert.ok(expectedMain)
assert.equal(
  createHash('sha256')
    .update(await readFile(join(bundle, expectedMain.path)))
    .digest('hex'),
  expectedMain.sha256,
)
const archive = await readFile(join(bundle, snapshot.platform.file))
assert.equal(createHash('sha256').update(archive).digest('hex'), snapshot.platform.sha256)
assert.equal(
  JSON.parse(await readFile(join(bundle, 'node_modules/@velaros-ai/velaros/package.json'), 'utf8'))
    .version,
  snapshot.platform.version,
)
for (const unwanted of ['@velaros-ai/ui', '@velaros-ai/capabilities', 'react', 'electron']) {
  await assert.rejects(access(join(bundle, 'node_modules', unwanted)), { code: 'ENOENT' })
}
// 端口仅用于本轮隔离服务，不复用用户正在运行的主机或数据根。
const reservation = createServer()
await new Promise((done) => reservation.listen(0, '127.0.0.1', done))
const port = reservation.address().port
await new Promise((done, reject) => reservation.close((error) => (error ? reject(error) : done())))
const base = `http://127.0.0.1:${port}`
const directory = await mkdtemp(join(tmpdir(), 'velaros-server-linux-install-'))
const host = join(directory, 'host'),
  state = join(directory, 'state')
await mkdir(host)
await mkdir(state)
await writeFile(join(host, 'example.conf'), 'port=8080\n')
const originalFileMode = (await stat(join(host, 'example.conf'))).mode & 0o777
const token = randomBytes(32).toString('base64url')
const child = spawn(process.execPath, [join(bundle, 'dist/apps/server/src/main.js')], {
  cwd: bundle,
  env: {
    ...process.env,
    PORT: String(port),
    VELAROS_SERVER_BIND: '127.0.0.1',
    VELAROS_SERVER_PUBLIC_ORIGIN: base,
    VELAROS_SERVER_DATA_DIR: state,
    VELAROS_SERVER_EXECUTION_ROOT: host,
    VELAROS_SERVER_FILE_ROOTS_JSON: JSON.stringify([host]),
    // 明确测试服务用户的直接权限；本轮不宣称验证 bubblewrap 或 systemd。
    VELAROS_SERVER_EXECUTION_MODE: 'danger-full-access',
    VELAROS_SERVER_APPROVAL: 'ask',
    VELAROS_SERVER_ACCESS_TOKEN: token,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let diagnostic = ''
for (const stream of [child.stdout, child.stderr])
  stream.on('data', (chunk) => {
    diagnostic = (diagnostic + chunk.toString()).slice(-16_000)
  })
const exited = new Promise((done, reject) => {
  child.once('error', reject)
  child.once('exit', (code, signal) => done({ code, signal }))
})
let cookie = '',
  csrf = '',
  stopRequested = false,
  closed = false
const api = (path, method = 'GET', value) =>
  fetch(`${base}${path}`, {
    method,
    headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-VelarOS-CSRF': csrf },
    signal: AbortSignal.timeout(5_000),
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  })
const close = async () => {
  if (!stopRequested && child.exitCode === null && child.signalCode === null) {
    stopRequested = true
    child.kill('SIGTERM')
  }
  let timeout
  let result
  try {
    result = await Promise.race([
      exited,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`未确认进程退出，保留 PID ${child.pid} 与 ${directory}`)),
          8_000,
        )
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
  assert.equal(result.code, 0)
  assert.equal(result.signal, null)
  closed = true
}
try {
  const deadline = Date.now() + 8_000
  while (true) {
    try {
      if ((await api('/api/health')).ok) break
    } catch {
      /* 只等待新进程的监听就绪。 */
    }
    if (Date.now() > deadline || child.exitCode !== null)
      throw new Error(`产品启动失败：${diagnostic}`)
    await new Promise((done) => setTimeout(done, 50))
  }
  const login = await api('/api/auth/login', 'POST', { token })
  assert.equal(login.status, 200)
  cookie = login.headers.get('set-cookie').split(';')[0]
  csrf = (await login.json()).csrf
  const info = await (await api('/api/info')).json()
  assert.equal(info.platform, 'linux')
  assert.equal(info.model.hasApiKey, false)
  assert.equal((await api('/')).status, 200)
  const file = await (
    await api(`/api/files/text?path=${encodeURIComponent(join(host, 'example.conf'))}`)
  ).json()
  assert.equal(file.content, 'port=8080\n')
  const saved = await api('/api/files/text', 'PUT', {
    path: file.path,
    sha256: file.sha256,
    content: 'port=9090\n',
  })
  assert.equal(saved.status, 200)
  assert.equal(await readFile(join(host, 'example.conf'), 'utf8'), 'port=9090\n')
  assert.equal((await stat(join(host, 'example.conf'))).mode & 0o777, originalFileMode)
  const opened = await api('/api/terminal/open', 'POST', {})
  assert.equal(opened.status, 200)
  const terminal = await opened.json()
  assert.equal(terminal.channel, 'pty')
  const path = `/api/terminal/${encodeURIComponent(terminal.taskId)}`
  const controller = new AbortController()
  const output = await fetch(`${base}${path}/events`, {
    headers: { Cookie: cookie },
    signal: controller.signal,
  })
  assert.equal(output.status, 200)
  const reader = output.body.getReader()
  assert.equal(
    (await api(`${path}/input`, 'POST', { text: "printf '%s\\n' 'SERVER_LINUX_''INSTALL_OK'\r" }))
      .status,
    200,
  )
  let text = ''
  const outputTimeout = setTimeout(() => controller.abort(), 5_000)
  try {
    while (!text.includes('SERVER_LINUX_INSTALL_OK')) {
      const chunk = await reader.read()
      assert.equal(chunk.done, false)
      text += new TextDecoder().decode(chunk.value)
    }
  } finally {
    clearTimeout(outputTimeout)
    controller.abort()
  }
  assert.equal((await api(`${path}/stop`, 'POST', {})).status, 200)
  const stopped = await api(`${path}/events`)
  assert.equal(stopped.status, 200)
  assert.match(await stopped.text(), /"status":"exited"/)
  await close()
  const receipt = {
    productCommit: manifest.sourceCommit,
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    foundation: snapshot.platform,
    productionDependenciesOnly: true,
    httpLogin: true,
    fileRead: true,
    fileWriteWithModePreserved: true,
    nativePtyOutput: true,
    nativePtyStop: true,
    processExitCode: 0,
    providerApi: false,
    agentChainRepeated: false,
    systemd: false,
    confinement: 'danger-full-access',
  }
  await mkdir('.cache', { recursive: true })
  await writeFile('.cache/linux-install-proof.json', `${JSON.stringify(receipt, null, 2)}\n`)
  console.log(JSON.stringify(receipt))
} catch (error) {
  console.error('Linux 产品安装验证失败', error, diagnostic)
  throw error
} finally {
  if (!closed) await close()
  const actual = await realpath(directory)
  assert.equal(dirname(actual), await realpath(tmpdir()))
  assert.ok(basename(actual).startsWith('velaros-server-linux-install-'))
  await rm(actual, { recursive: true, force: true })
}
