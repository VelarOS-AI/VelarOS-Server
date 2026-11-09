// 隔离 Linux 单命令交付门：一次构建、组装、真实产品安装；不重复 Agent 或大型回归。
import { spawnSync } from 'node:child_process'
import { readFile, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join, resolve } from 'node:path'

if (process.platform !== 'linux') throw new Error('需要真实隔离 Linux 环境')
const root = fileURLToPath(new URL('..', import.meta.url))
const run = (command, args, timeout = 60_000) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', timeout })
  if (result.error || result.status !== 0)
    throw new Error(`${command} 未通过：${result.error?.message ?? result.status}`)
}
run('bun', ['install', '--frozen-lockfile'])
run(process.execPath, ['scripts/verify.mjs', 'server-types', 'web-types', 'web-build'], 150_000)
run(process.execPath, ['scripts/package.mjs'], 150_000)
const product = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const artifact = join(
  root,
  '.cache/artifacts',
  `${product.name}-${product.version}-linux-${process.arch}.tar.gz`,
)
const hash = createHash('sha256')
  .update(await readFile(artifact))
  .digest('hex')
const checksum = await readFile(`${artifact}.sha256`, 'utf8')
if (checksum.trim() !== `${hash}  ${basename(artifact)}`) throw new Error('产物校验文件不匹配')
const cache = join(root, '.cache')
const stage = join(cache, `linux-install-${randomUUID()}`)
await mkdir(stage)
let succeeded = false
try {
  run('tar', ['-xzf', artifact, '-C', stage])
  run(process.execPath, ['scripts/verify-linux-install.mjs', join(stage, 'velaros-server')], 35_000)
  const proof = JSON.parse(await readFile(join(cache, 'linux-install-proof.json'), 'utf8'))
  await writeFile(
    join(cache, 'linux-product-build.json'),
    `${JSON.stringify({ ...proof, artifact: basename(artifact), sha256: hash }, null, 2)}\n`,
  )
  succeeded = true
  console.log(
    JSON.stringify({ artifact, sha256: hash, receipt: '.cache/linux-product-build.json' }),
  )
} finally {
  if (succeeded) {
    const actual = await realpath(stage)
    if (
      dirname(actual) !== (await realpath(cache)) ||
      !basename(actual).startsWith('linux-install-')
    )
      throw new Error('拒绝回收非本次 Linux 安装目录')
    await rm(actual, { recursive: true, force: true })
  } else console.error(`安装未通过，保留现场：${resolve(stage)}`)
}
