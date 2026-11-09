import { mkdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { spawn } from '@lydell/node-pty'
import { createLocalShellHost, createShellEnvironment } from '@velaros-ai/velaros/execution/local'
import type { ShellProcessConfinementMode } from '@velaros-ai/velaros/execution/contracts'
import type { ModelDriver } from '@velaros-ai/velaros/kernel'
import { bindExecutionEnvironment } from './execution-binding.js'
import { ModelSettingsStore } from './model-settings.js'
import { PlatformExecution } from './platform-execution.js'
import { ProductStore } from './store.js'
import { HostTerminal } from './terminal.js'

export async function composePlatform(options: {
  cwd: string
  dataDirectory: string
  roots: readonly string[]
  store: ProductStore
  mode: ShellProcessConfinementMode
  approval: 'ask' | 'allow'
  model?: ModelDriver
}): Promise<{ execution: PlatformExecution; terminal: HostTerminal; close(): Promise<void> }> {
  const cwd = await realpath(options.cwd)
  const dataDirectory = await realpath(options.dataDirectory)
  const relativeState = relative(cwd, dataDirectory)
  if (!isAbsolute(relativeState) && relativeState !== '..' && !relativeState.startsWith(`..${sep}`))
    throw new Error('Server 状态目录必须位于执行根目录之外')
  const stateDirectory = join(options.dataDirectory, 'runtime')
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 })
  const binding = await bindExecutionEnvironment({
    stateDirectory: options.dataDirectory,
    cwd,
    roots: options.roots,
    policy: { mode: options.mode, network: true, revision: 'server-execution-v1' },
  })
  const environment = createShellEnvironment({
    env: () => {
      const values = { ...process.env }
      delete values.VELAROS_SERVER_ACCESS_TOKEN
      for (const key of Object.keys(values)) if (key.endsWith('_API_KEY')) delete values[key]
      return values
    },
  })
  const host = createLocalShellHost({
    cwd,
    environment,
    processConfinement: { mode: options.mode, workspaceRoot: cwd, writeRoots: [...options.roots] },
    terminal: { spawn: (file, args, settings) => spawn(file, args, settings) },
  })
  const execution = new PlatformExecution(
    {
      host,
      cwd,
      stateDirectory,
      binding,
      approval: options.approval,
      ...(options.model ? { model: options.model } : {}),
    },
    options.store,
    new ModelSettingsStore(options.store),
  )
  const terminal = new HostTerminal(host, environment)
  return {
    execution,
    terminal,
    close: async () => {
      await execution.close()
      await host.dispose()
      await environment.dispose()
    },
  }
}
