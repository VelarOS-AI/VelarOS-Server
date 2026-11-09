import { randomUUID } from 'node:crypto'
import type { LocalShellHostApi, ShellEnvironmentApi } from '@velaros-ai/velaros/execution'
import type { ShellConsoleOutputChunk } from '@velaros-ai/velaros/execution/contracts'
import { HttpError } from './errors.js'

interface TerminalConnection {
  taskId: string
  channel: string
  shell: string
}

export interface TerminalPort {
  readonly available: boolean
  open(): Promise<TerminalConnection>
  read(taskId: string, cursor: number): Promise<ShellConsoleOutputChunk>
  input(taskId: string, text: string): Promise<void>
  resize(taskId: string, cols: number, rows: number): Promise<void>
  stop(taskId: string): Promise<void>
}

/** 网络只转发现有 Host 的控制台端口，不自己 spawn 或维护另一套进程表。 */
export class HostTerminal implements TerminalPort {
  public readonly available = true
  private readonly sessionId = `server-terminal:${randomUUID()}`
  private taskId: string | null = null
  private shell = ''
  private opening: Promise<TerminalConnection> | null = null

  public constructor(
    private readonly host: LocalShellHostApi,
    private readonly environment: ShellEnvironmentApi,
  ) {}

  private assertTask(taskId: string): void {
    if (!this.taskId || taskId !== this.taskId)
      throw new HttpError(409, 'TERMINAL_CHANGED', '终端已改变，请重新连接')
  }

  public async open(): Promise<TerminalConnection> {
    if (this.opening) return this.opening
    this.opening = (async () => {
      if (this.taskId) {
        const existing = (
          await this.host.listBackgroundTasks({ taskId: this.taskId, sessionId: this.sessionId })
        )[0]
        if (existing?.status === 'running')
          return {
            taskId: this.taskId,
            channel: existing.console?.channel ?? 'pty',
            shell: this.shell,
          }
        if (existing?.status === 'unknown')
          throw new HttpError(409, 'TERMINAL_UNKNOWN', '原终端收尾未知，请先核对进程')
      }
      const shell = await this.environment.resolveShell()
      const args =
        shell.kind === 'pwsh' || shell.kind === 'powershell'
          ? ['-NoLogo', '-NoProfile']
          : shell.kind === 'cmd'
            ? ['/Q']
            : ['-i']
      const result = await this.host.runCommand('Server interactive terminal', {
        nativeCommand: { file: shell.shellPath, args },
        background: true,
        interactive: true,
        sessionId: this.sessionId,
        maxOutputChars: 32_768,
      })
      const console = result.backgroundProcess?.console
      if (!result.success || !console)
        throw new HttpError(503, 'TERMINAL_UNAVAILABLE', 'Host 没有启动可交互终端，请查看执行回执')
      this.taskId = console.taskId
      this.shell = shell.kind
      return { taskId: console.taskId, channel: console.channel, shell: this.shell }
    })().finally(() => {
      this.opening = null
    })
    return this.opening
  }

  public async read(taskId: string, cursor: number): Promise<ShellConsoleOutputChunk> {
    this.assertTask(taskId)
    return this.host.readConsoleOutput({ taskId, sessionId: this.sessionId, cursor })
  }

  public async input(taskId: string, text: string): Promise<void> {
    this.assertTask(taskId)
    const result = await this.host.writeConsoleInput({
      taskId,
      sessionId: this.sessionId,
      text,
      submit: false,
    })
    if (!result.accepted) throw new HttpError(409, 'TERMINAL_INPUT_REJECTED', result.message)
  }

  public async resize(taskId: string, cols: number, rows: number): Promise<void> {
    this.assertTask(taskId)
    const result = await this.host.resizeConsole({ taskId, sessionId: this.sessionId, cols, rows })
    if (!result.accepted) throw new HttpError(409, 'TERMINAL_RESIZE_REJECTED', result.message)
  }

  public async stop(taskId: string): Promise<void> {
    this.assertTask(taskId)
    const result = await this.host.terminateBackgroundTask({
      taskId,
      sessionId: this.sessionId,
      force: false,
    })
    if (result.statusAfter === 'unknown')
      throw new HttpError(409, 'TERMINAL_UNKNOWN', '终端收束未知，请核对原进程')
  }
}
