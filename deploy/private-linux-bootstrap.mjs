// 私有 CI owner 的最小 bootstrap；不访问 Server 远程仓，也不启动 Desktop 构建。
import { readFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'linux' || process.env.PRIVATE_CI !== 'true')
  throw new Error('只允许隔离 Linux 私有 CI 承载此未公开输入')
const payload = resolve('server-validation')
const record = JSON.parse(await readFile(join(payload, 'handoff.json'), 'utf8'))
const bundle = join(payload, 'VelarOS-Server.bundle')
if (!record.privateCarrierRequired || !/^[a-f0-9]{40}$/.test(record.productCommit))
  throw new Error('交接身份无效')
if (
  createHash('sha256')
    .update(await readFile(bundle))
    .digest('hex') !== record.sha256
)
  throw new Error('交接 bundle SHA 不匹配')
const run = (command, args, cwd, timeout = 60_000, capture = false) => {
  const result = spawnSync(command, args, {
    cwd,
    timeout,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  })
  if (result.error || result.status !== 0)
    throw new Error(`${command} 未通过：${result.error?.message ?? result.status}`)
  return result.stdout?.trim()
}
await mkdir('server-install-source')
run('git', ['clone', '--branch', record.branch, bundle, '.'], resolve('server-install-source'))
const source = resolve('server-install-source')
if (run('git', ['rev-parse', 'HEAD'], source, 10_000, true) !== record.productCommit)
  throw new Error('产品提交不匹配')
run(process.execPath, ['scripts/linux-product.mjs'], source, 240_000)
