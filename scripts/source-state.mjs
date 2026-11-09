// 部署打包核对当前源码与已编译产物，避免把陈旧 dist 当作本批交付。
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

export async function sourceState(root, scope) {
  const files = []
  const collect = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await collect(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  await collect(join(root, 'apps', scope === 'server' ? 'server' : 'web'))
  await collect(join(root, 'packages/contracts'))
  for (const path of ['package.json', 'bun.lock', 'resources/runtime-snapshot.json'])
    files.push(join(root, path))
  if (scope === 'server') files.push(join(root, 'tsconfig.server.json'))
  const hash = createHash('sha256')
  for (const file of files.sort()) {
    hash.update(relative(root, file).replaceAll('\\', '/'))
    hash.update('\0')
    hash.update(await readFile(file))
  }
  return hash.digest('hex')
}
