import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { z } from 'zod'
import { createServerApplication } from './app.js'
import { ServerFiles } from './files.js'
import { ProductStore } from './store.js'
import { composePlatform } from './platform-composition.js'

process.umask(0o077)
const defaultState =
  process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA ?? homedir(), 'VelarOS-Server')
    : join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'velaros-server')
const dataDirectory = resolve(process.env.VELAROS_SERVER_DATA_DIR ?? defaultState)
await mkdir(dataDirectory, { recursive: true, mode: 0o700 })
await chmod(dataDirectory, 0o700)
const tokenPath = join(dataDirectory, 'access-token')
let accessToken = process.env.VELAROS_SERVER_ACCESS_TOKEN
if (!accessToken) {
  try {
    accessToken = (await readFile(tokenPath, 'utf8')).trim()
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    accessToken = randomBytes(32).toString('base64url')
    await writeFile(tokenPath, `${accessToken}\n`, { flag: 'wx', mode: 0o600 })
  }
}
if (accessToken.length < 24) throw new Error('服务器访问令牌至少需要 24 个字符')
const port = z.coerce
  .number()
  .int()
  .min(1)
  .max(65_535)
  .parse(process.env.PORT ?? 8787)
const host = process.env.VELAROS_SERVER_BIND ?? '127.0.0.1'
const publicOrigin = process.env.VELAROS_SERVER_PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`
const roots = z
  .array(z.string().min(1))
  .min(1)
  .parse(JSON.parse(process.env.VELAROS_SERVER_FILE_ROOTS_JSON ?? JSON.stringify([process.cwd()])))
const store = new ProductStore(join(dataDirectory, 'server.sqlite'))
await chmod(join(dataDirectory, 'server.sqlite'), 0o600)
const files = await ServerFiles.create(roots, dataDirectory)
const mode = z
  .enum(['read-only', 'workspace-write', 'danger-full-access'])
  .parse(process.env.VELAROS_SERVER_EXECUTION_MODE ?? 'workspace-write')
const approval = z.enum(['ask', 'allow']).parse(process.env.VELAROS_SERVER_APPROVAL ?? 'ask')
const platform = await composePlatform({
  cwd: resolve(process.env.VELAROS_SERVER_EXECUTION_ROOT ?? process.cwd()),
  dataDirectory,
  roots: files.roots,
  store,
  mode,
  approval,
})
const application = createServerApplication({
  store,
  accessToken,
  publicOrigin,
  files,
  execution: platform.execution,
  terminal: platform.terminal,
  webDirectory: resolve('dist/web'),
})
application.server.listen(port, host, () => {
  console.log(`VelarOS Server listening at ${publicOrigin}`)
  console.log(`Access-token file: ${tokenPath}; token contents are never logged`)
  console.log(`Execution confinement: ${mode}; program approval: ${approval}`)
})
let closing = false
const shutdown = (): void => {
  if (closing) return
  closing = true
  void application
    .close()
    .then(() => platform.close())
    .then(() => store.close())
    .catch((error: unknown) => {
      console.error('Shutdown did not complete', error instanceof Error ? error.name : 'unknown')
      process.exitCode = 1
    })
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
