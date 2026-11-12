import { createHash, randomUUID } from 'node:crypto'
import { chmod, readFile, realpath, writeFile } from 'node:fs/promises'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { HttpError } from './errors.js'

/** 产品授权身份由受信部署配置派生，客户端路径和模型正文不参与。 */
export interface ServerExecutionBinding {
  executionIdentity: string
  authorizationScope: string
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function bindExecutionEnvironment(options: {
  stateDirectory: string
  cwd: string
  roots: readonly string[]
  policy: {
    mode: 'read-only' | 'workspace-write' | 'danger-full-access'
    network: boolean
    revision: string
    profiles?: readonly string[]
  }
}): Promise<ServerExecutionBinding> {
  const stateDirectory = await realpath(options.stateDirectory)
  const instancePath = join(stateDirectory, 'instance-id')
  let instanceId: string
  try {
    instanceId = (await readFile(instancePath, 'utf8')).trim()
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    instanceId = randomUUID()
    await writeFile(instancePath, `${instanceId}\n`, { flag: 'wx', mode: 0o600 })
  }
  if (!/^[a-f0-9-]{36}$/.test(instanceId))
    throw new HttpError(500, 'INVALID_INSTANCE', '部署实例身份无效，保留原文件并停止接纳运行')
  await chmod(instancePath, 0o600)
  const principal = userInfo()
  return {
    executionIdentity: fingerprint({
      instanceId,
      principal: {
        username: principal.username,
        uid: principal.uid,
        gid: principal.gid,
        groups: (process.getgroups?.() ?? []).sort((left, right) => left - right),
      },
      node: await realpath(process.execPath),
    }),
    authorizationScope: fingerprint({
      cwd: await realpath(options.cwd),
      stateDirectory,
      roots: [...new Set(await Promise.all(options.roots.map((root) => realpath(root))))].sort(),
      policy: options.policy,
    }),
  }
}
