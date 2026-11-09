import { createHash, randomUUID } from 'node:crypto'
import { open, readdir, realpath, rename, stat, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { constants } from 'node:fs'
import type { DirectoryView, TextFileView } from '../../../packages/contracts/src/index.js'
import { HttpError } from './errors.js'

const MaxTextBytes = 128 * 1024
const MaxEntries = 500

function isWithin(root: string, path: string): boolean {
  const part = relative(root, path)
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`))
}

/** 网页文件操作只接入宿主明确登记的根；状态和凭据目录始终不向网页开放。 */
export class ServerFiles {
  private readonly writes = new Map<string, Promise<void>>()

  private constructor(
    public readonly roots: readonly string[],
    private readonly protectedRoot: string,
  ) {}

  public static async create(
    roots: readonly string[],
    protectedRoot: string,
  ): Promise<ServerFiles> {
    return new ServerFiles(
      await Promise.all(roots.map((root) => realpath(root))),
      await realpath(protectedRoot),
    )
  }

  private async resolve(path: string): Promise<string> {
    if (!isAbsolute(path)) throw new HttpError(400, 'INVALID_PATH', '需要服务器上的绝对路径')
    let actual: string
    try {
      actual = await realpath(path)
    } catch {
      throw new HttpError(404, 'NOT_FOUND', '路径不存在或无法访问')
    }
    if (!this.roots.some((root) => isWithin(root, actual)) || isWithin(this.protectedRoot, actual))
      throw new HttpError(403, 'PATH_DENIED', '路径不在当前授权范围内')
    return actual
  }

  public async list(path: string): Promise<DirectoryView> {
    const actual = await this.resolve(path)
    const entries = await readdir(actual, { withFileTypes: true })
    return {
      path: actual,
      truncated: entries.length > MaxEntries,
      entries: entries
        .sort(
          (a, b) =>
            Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
        )
        .slice(0, MaxEntries)
        .filter((entry) => !isWithin(this.protectedRoot, join(actual, entry.name)))
        .map((entry) => ({
          name: entry.name,
          path: join(actual, entry.name),
          kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
        })),
    }
  }

  public async read(path: string): Promise<TextFileView> {
    const actual = await this.resolve(path)
    const file = await open(actual, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const metadata = await file.stat()
      if (!metadata.isFile() || metadata.size > MaxTextBytes)
        throw new HttpError(413, 'TEXT_LIMIT', '仅支持不超过 128 KiB 的普通文本文件')
      const buffer = Buffer.alloc(MaxTextBytes + 1)
      const result = await file.read(buffer, 0, buffer.length, 0)
      const bytes = buffer.subarray(0, result.bytesRead)
      if (bytes.length > MaxTextBytes || bytes.includes(0))
        throw new HttpError(413, 'TEXT_LIMIT', '文件过大或不是支持的文本格式')
      let content: string
      try {
        content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
      } catch {
        throw new HttpError(415, 'TEXT_ENCODING', '首版只支持 UTF-8 文本')
      }
      return {
        path: actual,
        content,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
      }
    } finally {
      await file.close()
    }
  }

  public async write(path: string, sha256: string, content: string): Promise<TextFileView> {
    if (Buffer.byteLength(content) > MaxTextBytes || content.includes('\0'))
      throw new HttpError(413, 'TEXT_LIMIT', '文本过大或含有二进制内容')
    const actual = await this.resolve(path)
    const write = (this.writes.get(actual) ?? Promise.resolve()).then(() =>
      this.replaceFile(path, actual, sha256, content),
    )
    // 队列只等待前一次收尾；具体失败仍交给原请求，不阻断下一次独立的版本核对。
    const settled = write.then(
      () => {},
      () => {},
    )
    this.writes.set(actual, settled)
    try {
      return await write
    } finally {
      if (this.writes.get(actual) === settled) this.writes.delete(actual)
    }
  }

  private async replaceFile(
    path: string,
    actual: string,
    sha256: string,
    content: string,
  ): Promise<TextFileView> {
    const baseline = await this.read(path)
    if (baseline.path !== actual || baseline.sha256 !== sha256)
      throw new HttpError(409, 'FILE_CHANGED', '文件已被其他操作修改，请重新读取并核对差异')
    const parent = await this.resolve(dirname(baseline.path))
    const metadata = await stat(baseline.path)
    const temporary = join(parent, `.velaros-write-${randomUUID()}`)
    let published = false
    try {
      const file = await open(temporary, 'wx', metadata.mode & 0o777)
      try {
        await file.writeFile(content, 'utf8')
        if (process.platform !== 'win32') await file.chown(metadata.uid, metadata.gid)
        await file.chmod(metadata.mode & 0o777)
        await file.sync()
      } finally {
        await file.close()
      }
      const current = await this.read(path)
      if (
        current.path !== baseline.path ||
        current.sha256 !== sha256 ||
        (await realpath(parent)) !== parent
      )
        throw new HttpError(409, 'FILE_CHANGED', '发布前文件或目录发生变化，请重新核对')
      await rename(temporary, baseline.path)
      published = true
      return await this.read(baseline.path)
    } finally {
      if (!published)
        await unlink(temporary).catch((error: unknown) => {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        })
    }
  }
}
