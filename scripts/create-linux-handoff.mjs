// 只生成本地自含 Git bundle，不上传、不推送、不调度远程任务。
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`Git 交接失败：${result.stderr.trim()}`)
  return result.stdout.trim()
}
if (git('status', '--porcelain')) throw new Error('交接输入必须已完整提交')
const commit = git('rev-parse', 'HEAD'),
  branch = git('branch', '--show-current')
if (!branch) throw new Error('交接需要具名产品分支')
const snapshot = JSON.parse(await readFile(join(root, 'resources/runtime-snapshot.json'), 'utf8'))
for (const asset of [snapshot.platform, snapshot.ui]) {
  if (!asset?.file) throw new Error('基础与最终 UI 都必须固定到本仓归档后再生成交接')
  const provenance = JSON.parse(await readFile(join(root, asset.provenance), 'utf8'))
  if (
    !provenance.publication?.published ||
    provenance.publication.sha256 !== asset.sha256 ||
    provenance.publication.sourceCommit !== asset.sourceCommit
  )
    throw new Error(`${asset.name} 尚未登记匹配的真实正式发行，不能生成最终 Linux 输入`)
  git('ls-files', '--error-unmatch', asset.file)
  if (
    createHash('sha256')
      .update(await readFile(join(root, asset.file)))
      .digest('hex') !== asset.sha256
  )
    throw new Error('交接依赖归档 SHA 不匹配')
}
const directory = join(root, '.cache', `private-linux-handoff-${commit.slice(0, 12)}`)
await mkdir(directory)
const bundle = join(directory, 'VelarOS-Server.bundle')
git('bundle', 'create', bundle, `refs/heads/${branch}`)
git('bundle', 'verify', bundle)
const bytes = await readFile(bundle)
await writeFile(
  join(directory, 'handoff.json'),
  `${JSON.stringify(
    {
      productCommit: commit,
      branch,
      bundle: 'VelarOS-Server.bundle',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      foundation: snapshot.platform,
      ui: snapshot.ui,
      privateCarrierRequired: true,
    },
    null,
    2,
  )}\n`,
)
await copyFile(join(root, 'deploy/private-linux-bootstrap.mjs'), join(directory, 'run.mjs'))
await copyFile(join(root, 'deploy/private-linux-ci.yml'), join(directory, 'ci.yml'))
console.log(
  JSON.stringify({ directory, commit, bundleBytes: bytes.length, uploadPerformed: false }),
)
