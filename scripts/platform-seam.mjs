// 只重编单条真实接缝，修复它不重复完整类型或其他已通过场景。
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const cwd = fileURLToPath(new URL('..', import.meta.url))
const seam = process.argv[2] === 'terminal' ? 'terminal' : 'platform'
for (const [command, args] of [
  [
    'bun',
    [
      'build',
      `tests/${seam}-seam.test.ts`,
      '--target',
      'node',
      '--packages',
      'external',
      '--outdir',
      '.cache/platform-seam',
    ],
  ],
  [
    process.execPath,
    ['--test', '--test-reporter=tap', `.cache/platform-seam/${seam}-seam.test.js`],
  ],
]) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 30_000,
  })
  if (result.error || result.status !== 0) {
    if (result.error) console.error(result.error.message)
    process.exitCode = result.status || 1
    break
  }
}
