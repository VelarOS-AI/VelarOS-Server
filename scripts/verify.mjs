// 一批改动集中验证；持有全局独占锁，每步受限，不重复已通过的测试。
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { sourceState } from './source-state.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const lockPath = resolve(
  process.env.VELAROS_VALIDATION_LOCK_PATH ?? resolve(root, '.cache/heavy-validation.lock'),
)
const token = randomUUID()
let handle
try {
  await mkdir(dirname(lockPath), { recursive: true })
  handle = await open(lockPath, 'wx')
} catch (error) {
  if (error.code === 'EEXIST') {
    console.error('共享验证锁已有 owner；本批未启动验证，不删除或抢占。')
    process.exitCode = 23
  } else throw error
}

if (handle) {
  await handle.writeFile(
    JSON.stringify({
      token,
      owner: 'velaros-server',
      pid: process.pid,
      at: new Date().toISOString(),
    }),
  )
  try {
    const steps = [
      ['format', 'node_modules/prettier/bin/prettier.cjs', '--check', '.'],
      ['server-types', 'node_modules/typescript/bin/tsc', '-p', 'tsconfig.server.json'],
      ['web-types', 'node_modules/typescript/bin/tsc', '-p', 'apps/web/tsconfig.json'],
      ['product-boundaries', '--test', 'dist/tests/product-boundaries.test.js'],
      ['control-concurrency', '--test', 'dist/tests/control-concurrency.test.js'],
      [
        'http-boundary',
        '--test',
        '--test-name-pattern=真实 HTTP',
        'dist/tests/product-boundaries.test.js',
      ],
      ['platform-seam', 'scripts/platform-seam.mjs'],
      ['terminal-seam', 'scripts/platform-seam.mjs', 'terminal'],
      [
        'web-build',
        'node_modules/vite/bin/vite.js',
        'build',
        '--config',
        'apps/web/vite.config.ts',
        '--logLevel',
        'warn',
      ],
    ]
    const requested = process.argv.slice(2)
    for (const label of requested)
      if (!steps.some(([name]) => name === label))
        throw new Error(`Unknown verification step: ${label}`)
    const selected = requested.length ? steps.filter(([label]) => requested.includes(label)) : steps
    for (const [label, ...args] of selected) {
      const scope = label === 'server-types' ? 'server' : label === 'web-build' ? 'web' : null
      const before = scope ? await sourceState(root, scope) : null
      console.log(`Checking ${label}`)
      const result = spawnSync(process.execPath, args, {
        cwd: root,
        stdio: 'inherit',
        windowsHide: true,
        timeout: 45_000,
        env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048' },
      })
      if (result.error || result.status !== 0) {
        if (result.error) console.error(result.error.message)
        process.exitCode = result.status || 1
        break
      }
      if (scope) {
        if (before !== (await sourceState(root, scope)))
          throw new Error('验证期间源码改变，不登记构建回执')
        const receiptPath = resolve(root, '.cache/build-state.json')
        let receipts = {}
        try {
          receipts = JSON.parse(await readFile(receiptPath, 'utf8'))
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
        }
        await mkdir(dirname(receiptPath), { recursive: true })
        receipts[scope] = { fingerprint: before, passedAt: new Date().toISOString() }
        await writeFile(receiptPath, `${JSON.stringify(receipts, null, 2)}\n`)
      }
    }
  } finally {
    await handle.close()
    const current = JSON.parse(await readFile(lockPath, 'utf8'))
    if (current.token === token) await unlink(lockPath)
  }
}
