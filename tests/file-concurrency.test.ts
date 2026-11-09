import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { ServerFiles } from '../apps/server/src/files.js'
import { HttpError } from '../apps/server/src/errors.js'

async function within<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Independent file write did not settle')), 2_000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'velaros-file-concurrency-'))
  const state = join(directory, 'state')
  const content = join(directory, 'config')
  await mkdir(state)
  await mkdir(content)
  return {
    directory,
    content,
    files: await ServerFiles.create([directory], state),
    close: async () => {
      const actual = await realpath(directory)
      assert.equal(dirname(actual).toLowerCase(), (await realpath(tmpdir())).toLowerCase())
      assert.ok(basename(actual).startsWith('velaros-file-concurrency-'))
      await rm(actual, { recursive: true, force: true })
    },
  }
}

test('同一真实文件经目录别名并发保存，同一 SHA 只允许一次发布', async () => {
  const value = await fixture()
  try {
    const path = join(value.content, 'service.conf')
    await writeFile(path, 'enabled=before\n')
    const baseline = await value.files.read(path)
    const alias = join(value.directory, 'alias')
    await symlink(value.content, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const results = await Promise.allSettled([
      value.files.write(path, baseline.sha256, 'enabled=first\n'),
      value.files.write(join(alias, 'service.conf'), baseline.sha256, 'enabled=second\n'),
    ])
    const published = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    assert.equal(published.length, 1)
    assert.equal(rejected.length, 1)
    assert.ok(rejected[0]!.reason instanceof HttpError)
    assert.equal(rejected[0]!.reason.code, 'FILE_CHANGED')
    assert.equal(await readFile(path, 'utf8'), published[0]!.value.content)
    assert.deepEqual(await value.files.read(path), published[0]!.value)
    assert.deepEqual(await readdir(value.content), ['service.conf'])
  } finally {
    await value.close()
  }
})

test('发布前发现外部修改后释放保存许可、回收临时文件并保留模式', async () => {
  const value = await fixture()
  const read = value.files.read.bind(value.files)
  try {
    const path = join(value.content, 'service.conf')
    await writeFile(path, 'before\n', { mode: 0o640 })
    const mode = (await stat(path)).mode & 0o777
    const baseline = await read(path)
    let reads = 0
    value.files.read = async (requested) => {
      if (++reads === 2) await writeFile(path, 'external\n')
      return read(requested)
    }
    await assert.rejects(value.files.write(path, baseline.sha256, 'stale\n'), {
      code: 'FILE_CHANGED',
    })
    assert.equal(await readFile(path, 'utf8'), 'external\n')
    assert.deepEqual(await readdir(value.content), ['service.conf'])
    value.files.read = read
    const current = await read(path)
    const saved = await value.files.write(path, current.sha256, 'confirmed\n')
    assert.equal(saved.content, 'confirmed\n')
    assert.equal((await stat(path)).mode & 0o777, mode)
    assert.deepEqual(await readdir(value.content), ['service.conf'])
  } finally {
    value.files.read = read
    await value.close()
  }
})

test('一个文件的保存等待不阻塞其他文件', { timeout: 5_000 }, async () => {
  const value = await fixture()
  const read = value.files.read.bind(value.files)
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let firstWrite: ReturnType<ServerFiles['write']> | undefined
  try {
    const firstPath = join(value.content, 'first.conf')
    const secondPath = join(value.content, 'second.conf')
    await writeFile(firstPath, 'before\n')
    await writeFile(secondPath, 'before\n')
    const first = await read(firstPath)
    const second = await read(secondPath)
    let waiting = true
    value.files.read = async (path) => {
      if (path === firstPath && waiting) {
        waiting = false
        enter()
        await held
      }
      return read(path)
    }
    firstWrite = value.files.write(firstPath, first.sha256, 'first\n')
    void firstWrite.catch(() => {})
    await within(entered)
    const saved = await within(value.files.write(secondPath, second.sha256, 'second\n'))
    assert.equal(saved.content, 'second\n')
    assert.equal(await readFile(firstPath, 'utf8'), 'before\n')
  } finally {
    release()
    try {
      if (firstWrite) await firstWrite
    } finally {
      value.files.read = read
      await value.close()
    }
  }
})
