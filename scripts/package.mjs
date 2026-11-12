// 仅生成本地部署归档；不部署、不发布、不复制开发依赖或用户数据。
import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { sourceState } from './source-state.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const cache = join(root, '.cache')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const runtime = JSON.parse(await readFile(join(root, 'resources/runtime-snapshot.json'), 'utf8'))
if (!runtime.platform?.sha256 || !runtime.platform?.sourceCommit)
  throw new Error('尚未登记固定 Platform 基础归档，不能生成完整产品部署包')
for (const asset of [runtime.platform, runtime.ui]) {
  if (!asset?.file) continue
  const bytes = await readFile(join(root, asset.file))
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256)
    throw new Error(`${asset.name} 的固定归档 SHA-256 不匹配`)
}
if (manifest.dependencies['@velaros-ai/velaros'] !== runtime.platform.url)
  throw new Error('生产依赖未指向已登记的正式基础归档 URL')
const builds = JSON.parse(await readFile(join(cache, 'build-state.json'), 'utf8'))
for (const scope of ['server', 'web'])
  if (builds[scope]?.fingerprint !== (await sourceState(root, scope)))
    throw new Error(`${scope} 的构建回执与当前源码不符，请只重建受影响部分`)
const git = (args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error('无法核对产品源码身份')
  return result.stdout.trim()
}
if (git(['status', '--porcelain'])) throw new Error('部署归档要求当前源码已逐批提交')
const sourceCommit = git(['rev-parse', 'HEAD'])
const stage = join(cache, `server-package-${randomUUID()}`)
const bundle = join(stage, 'velaros-server')
const output = join(cache, 'artifacts')
await mkdir(bundle, { recursive: true })
try {
  for (const entry of ['package.json', 'bun.lock', 'README.md', 'LICENSE', 'resources'])
    await cp(join(root, entry), join(bundle, entry), { recursive: true })
  await mkdir(join(bundle, 'deploy'))
  for (const entry of [
    'README.md',
    'server.env.example',
    'velaros-server.service',
    'Caddyfile.example',
  ])
    await cp(join(root, 'deploy', entry), join(bundle, 'deploy', entry))
  // 生产只需要基础运行时归档；UI 是构建输入，交付的是已编译网页。
  await mkdir(dirname(join(bundle, runtime.platform.file)), { recursive: true })
  await cp(join(root, runtime.platform.file), join(bundle, runtime.platform.file))
  await mkdir(join(bundle, 'dist'), { recursive: true })
  for (const entry of ['apps/server', 'packages/contracts', 'packages/model-config', 'web'])
    await cp(join(root, 'dist', entry), join(bundle, 'dist', entry), { recursive: true })
  const install = spawnSync('bun', ['install', '--production', '--frozen-lockfile'], {
    cwd: bundle,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 60_000,
  })
  if (install.error || install.status !== 0) throw new Error('固定生产依赖安装失败，未生成归档')
  await mkdir(join(bundle, 'licenses'), { recursive: true })
  await cp(
    join(root, 'node_modules/@velaros-ai/ui/LICENSE'),
    join(bundle, 'licenses/velaros-ui.LICENSE'),
  )
  const files = []
  const collect = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await collect(path)
      else if (entry.isFile())
        files.push({
          path: relative(bundle, path).replaceAll('\\', '/'),
          sha256: createHash('sha256')
            .update(await readFile(path))
            .digest('hex'),
        })
    }
  }
  await collect(bundle)
  await writeFile(
    join(bundle, 'artifact-manifest.json'),
    `${JSON.stringify(
      {
        product: manifest.name,
        version: manifest.version,
        sourceCommit,
        platform: process.platform,
        architecture: process.arch,
        node: process.versions.node,
        runtime,
        builds,
        files: files.sort((a, b) => a.path.localeCompare(b.path)),
      },
      null,
      2,
    )}\n`,
  )
  await mkdir(output, { recursive: true })
  const artifact = join(
    output,
    `${manifest.name}-${manifest.version}-${process.platform}-${process.arch}.tar.gz`,
  )
  const tar = spawnSync('tar', ['-czf', artifact, '-C', stage, basename(bundle)], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 60_000,
  })
  if (tar.error || tar.status !== 0) throw new Error('部署归档生成失败')
  const sha256 = createHash('sha256')
    .update(await readFile(artifact))
    .digest('hex')
  await writeFile(`${artifact}.sha256`, `${sha256}  ${basename(artifact)}\n`)
  console.log(
    JSON.stringify({
      artifact,
      sha256,
      sourceCommit,
      platform: process.platform,
      architecture: process.arch,
    }),
  )
} finally {
  const actual = await realpath(stage)
  const cacheRoot = await realpath(cache)
  if (
    resolve(dirname(actual)).toLowerCase() !== resolve(cacheRoot).toLowerCase() ||
    !basename(actual).startsWith('server-package-')
  )
    throw new Error('拒绝回收不属于本次运行的打包目录')
  await rm(actual, { recursive: true, force: true })
}
