import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { LocalShellHostApi, ShellEnvironmentApi } from '@velaros-ai/velaros/execution'
import { HostTerminal } from '../apps/server/src/terminal.js'
import { RunRequests } from '../apps/server/src/runs.js'
import { ProductStore } from '../apps/server/src/store.js'
import { ChangeStream } from '../apps/server/src/change-stream.js'
import type { ExecutionPort } from '../apps/server/src/execution.js'

/** 只控制适配器 await 的交错，不替代或重复真实 Host/Agent/Linux 验收。 */
test('已退出终端的并发重连只启动一个替代 shell，运行中的终端复用原身份', async () => {
  let release!: () => void
  const inspect = new Promise<void>((resolve) => {
    release = resolve
  })
  let launches = 0
  let checks = 0
  let status = 'exited'
  const host = {
    listBackgroundTasks: async () => {
      checks++
      await inspect
      return [{ status, console: { channel: 'pty' } }]
    },
    runCommand: async () => ({
      success: true,
      backgroundProcess: { console: { taskId: `task-${++launches}`, channel: 'pty' } },
    }),
  } as unknown as LocalShellHostApi
  const environment = {
    resolveShell: async () => ({ kind: 'bash', shellPath: '/bin/bash' }),
  } as unknown as ShellEnvironmentApi
  const terminal = new HostTerminal(host, environment)
  assert.equal((await terminal.open()).taskId, 'task-1')
  const first = terminal.open()
  const second = terminal.open()
  release()
  const connections = await Promise.all([first, second])
  assert.equal(checks, 1)
  assert.equal(launches, 2)
  assert.deepEqual(
    connections.map((item) => item.taskId),
    ['task-2', 'task-2'],
  )
  status = 'running'
  assert.equal((await terminal.open()).taskId, 'task-2')
  assert.equal(launches, 2)
})

test('审批提交拒绝时保留待审批事实，并发回答被拒绝，成功不覆盖后续运行状态', async () => {
  const store = new ProductStore(':memory:')
  let reject!: (error: Error) => void
  const admission = new Promise<void>((_, rejectPromise) => {
    reject = rejectPromise
  })
  let answers = 0
  const session = store.createSession('审批')
  session.runId = 'run-1'
  session.status = 'waiting'
  session.interaction = { id: 'approval-1', runId: 'run-1', message: '执行？', kind: 'confirm' }
  store.saveSession(session)
  const execution: ExecutionPort = {
    available: true,
    unavailableReason: null,
    submit: async () => {},
    cancel: async () => {},
    answer: async () => {
      if (++answers === 1) return admission
      const current = store.getSession(session.id)
      current.status = 'running'
      current.interaction = null
      store.saveSession(current)
    },
    close: async () => {},
  }
  const runs = new RunRequests(store, new ChangeStream(), execution)
  try {
    const first = runs.answer(session.id, 'run-1', 'approval-1', true)
    assert.equal(store.getSession(session.id).interaction?.id, 'approval-1')
    await assert.rejects(runs.answer(session.id, 'run-1', 'approval-1', true), {
      code: 'ANSWER_PENDING',
    })
    reject(new Error('Execution rejected answer admission'))
    await assert.rejects(first, /Execution rejected answer admission/)
    assert.equal(store.getSession(session.id).interaction?.id, 'approval-1')
    await runs.answer(session.id, 'run-1', 'approval-1', true)
    assert.equal(store.getSession(session.id).status, 'running')
    assert.equal(store.getSession(session.id).interaction, null)
    await assert.rejects(runs.answer(session.id, 'run-1', 'approval-1', true), {
      code: 'STALE_INTERACTION',
    })
    assert.equal(answers, 2)
  } finally {
    await runs.close()
    store.close()
  }
})
