import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { spawn } from '@lydell/node-pty'
import { createLocalShellHost, createShellEnvironment } from '@velaros-ai/velaros/execution/local'
import { HostTerminal } from '../apps/server/src/terminal.js'

test('真实 Host/PTY 输出、停止身份与退出收尾', { timeout: 15_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'velaros-server-terminal-'))
  const environment = createShellEnvironment({ env: () => process.env })
  let spawned: ReturnType<typeof spawn> | null = null
  let initialPid: number | undefined
  const host = createLocalShellHost({
    cwd: directory,
    environment,
    processConfinement: { mode: 'danger-full-access', workspaceRoot: directory },
    terminal: {
      spawn: (file, args, settings) => {
        spawned = spawn(file, args, settings)
        initialPid = spawned.pid
        return spawned
      },
    },
  })
  const terminal = new HostTerminal(host, environment)
  try {
    const connection = await terminal.open()
    assert.equal(connection.channel, 'pty')
    const marker = 'SERVER_PTY_REAL_SENTINEL'
    const command =
      connection.shell === 'pwsh' || connection.shell === 'powershell'
        ? "Write-Output ('SERVER_PTY_REAL_' + 'SENTINEL')\r"
        : connection.shell === 'cmd'
          ? 'set SERVER_PTY_TEST=SERVER_PTY_REAL_\r\necho %SERVER_PTY_TEST%SENTINEL\r\n'
          : "printf '%s\\n' 'SERVER_PTY_REAL_''SENTINEL'\r"
    await terminal.input(connection.taskId, command)
    const deadline = Date.now() + 5_000
    while (!(await terminal.read(connection.taskId, 0)).text.includes(marker)) {
      if (Date.now() > deadline) throw new Error('PTY output missing')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const task = (await host.listBackgroundTasks({ taskId: connection.taskId }))[0]!
    console.log('PTY identity evidence', {
      initialPid,
      currentPid: (spawned as ReturnType<typeof spawn> | null)?.pid,
      taskPid: task.pid,
      shell: connection.shell,
      outputVerified: true,
    })
    await terminal.stop(connection.taskId)
    assert.equal((await terminal.read(connection.taskId, 0)).status, 'exited')
  } catch (error) {
    console.error('Original terminal failure', error)
    throw error
  } finally {
    await host.dispose()
    await environment.dispose()
    console.log('Resources after Host close', process.getActiveResourcesInfo())
    const actual = await realpath(directory)
    assert.equal(dirname(actual).toLowerCase(), (await realpath(tmpdir())).toLowerCase())
    assert.ok(basename(actual).startsWith('velaros-server-terminal-'))
    await rm(actual, { recursive: true, force: true })
  }
})
