import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { ProductStore } from '../apps/server/src/store.js'
import { RunRequests } from '../apps/server/src/runs.js'
import { ChangeStream } from '../apps/server/src/change-stream.js'
import type { ExecutionNotice, ExecutionPort } from '../apps/server/src/execution.js'

function fixture(deliver?: ExecutionPort['submit']) {
  const store = new ProductStore(':memory:')
  const changes = new ChangeStream()
  let submissions = 0
  let observer: ((notice: ExecutionNotice) => void) | undefined
  const execution: ExecutionPort = {
    available: true,
    unavailableReason: null,
    submit: async (input, observe) => {
      submissions++
      observer = observe
      await deliver?.(input, observe)
    },
    answer: async () => {},
    cancel: async () => {},
    close: async () => {},
  }
  const runs = new RunRequests(store, changes, execution)
  return {
    store,
    runs,
    changes,
    submissions: () => submissions,
    emit: (notice: ExecutionNotice) => {
      assert.ok(observer)
      observer(notice)
    },
    close: async () => {
      try {
        await runs.close()
      } finally {
        store.close()
      }
    },
  }
}

const nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

// 故障由真实 SQLite 触发器产生；执行端口仅验证派发次数，不创建 Agent 或 Host。
test('初始投影保存失败整体回滚受理，同一 requestId 可安全再次受理', async () => {
  const value = fixture()
  try {
    const session = value.store.createSession('atomic admission')
    const requestId = randomUUID()
    let notices = 0
    value.changes.subscribe(() => {
      notices++
    })
    value.store.db.exec(`
      CREATE TRIGGER deny_projection BEFORE UPDATE ON sessions
      BEGIN SELECT RAISE(ABORT, 'projection denied'); END;
    `)
    assert.throws(() => value.runs.submit(session.id, requestId, 'inspect'), /projection denied/)
    assert.equal(
      value.store.db.prepare('SELECT id FROM requests WHERE id=?').get(requestId),
      undefined,
    )
    assert.equal(value.store.getSession(session.id).status, 'idle')
    assert.equal(value.store.getSession(session.id).messages.length, 0)
    assert.equal(value.store.changesAfter(0).notices.length, 0)
    await nextTurn()
    assert.equal(value.submissions(), 0)
    assert.equal(notices, 0)
    value.store.db.exec('DROP TRIGGER deny_projection')
    const receipt = value.runs.submit(session.id, requestId, 'inspect')
    assert.equal(receipt.replayed, false)
    assert.equal(receipt.status, 'received')
    await nextTurn()
    assert.equal(value.submissions(), 1)
    assert.equal(notices, 1)
    assert.equal(value.store.getSession(session.id).messages.length, 1)
  } finally {
    await value.close()
  }
})

test('执行投影失败同时回滚请求索引，已持久的 inputId/runId 不前进或丢失', async () => {
  const value = fixture()
  try {
    const session = value.store.createSession('atomic projection')
    const requestId = randomUUID()
    value.runs.submit(session.id, requestId, 'inspect')
    await nextTurn()
    value.emit({ type: 'accepted', inputId: 'core-input', runId: 'core-run' })
    const before = value.store.getSession(session.id)
    const row = value.store.db.prepare('SELECT * FROM requests WHERE id=?')
    const beforeReceipt = row.get(requestId)
    const sequence = value.store.changesAfter(0).current
    value.store.db.exec(`
      CREATE TRIGGER deny_projection BEFORE UPDATE ON sessions
      BEGIN SELECT RAISE(ABORT, 'projection denied'); END;
    `)
    assert.throws(() => value.emit({ type: 'state', status: 'completed' }), /projection denied/)
    assert.deepEqual(row.get(requestId), beforeReceipt)
    assert.deepEqual(value.store.getSession(session.id), before)
    assert.equal(value.store.changesAfter(0).current, sequence)
    const receipt = value.runs.submit(session.id, requestId, 'inspect')
    assert.equal(receipt.replayed, true)
    assert.equal(receipt.status, 'accepted')
    assert.equal(receipt.inputId, 'core-input')
    assert.equal(receipt.runId, 'core-run')
    assert.equal(value.submissions(), 1)
    value.store.db.exec('DROP TRIGGER deny_projection')
    value.emit({ type: 'state', status: 'completed' })
    assert.equal(value.runs.submit(session.id, requestId, 'inspect').status, 'completed')
  } finally {
    await value.close()
  }
})

test('执行可能已接纳但绑定投影未落时保留 unknown，同一身份不再次派发', async (context) => {
  context.mock.method(console, 'error', () => {})
  const value = fixture(async (_input, observe) => {
    observe({ type: 'accepted', inputId: 'core-input', runId: 'core-run' })
  })
  try {
    const session = value.store.createSession('unpersisted acceptance')
    const requestId = randomUUID()
    value.store.db.exec(`
      CREATE TRIGGER deny_binding BEFORE UPDATE ON sessions
      WHEN json_extract(NEW.projection, '$.status') = 'accepted'
      BEGIN SELECT RAISE(ABORT, 'binding projection denied'); END;
    `)
    value.runs.submit(session.id, requestId, 'inspect')
    await nextTurn()
    assert.equal(value.store.getSession(session.id).status, 'unknown')
    const replay = value.runs.submit(session.id, requestId, 'inspect')
    assert.equal(replay.replayed, true)
    assert.equal(replay.status, 'unknown')
    assert.equal(replay.inputId, null)
    assert.equal(replay.runId, null)
    assert.equal(value.submissions(), 1)
    assert.throws(() => value.runs.submit(session.id, randomUUID(), 'inspect again'), {
      code: 'SESSION_BUSY',
    })
  } finally {
    await value.close()
  }
})

test('unknown 自身不能持久化时保留最后事实并报告两类错误，不留下无主拒绝', async (context) => {
  const messages: unknown[] = []
  context.mock.method(console, 'error', (message: unknown) => {
    messages.push(message)
  })
  const value = fixture(async (_input, observe) => {
    observe({ type: 'accepted', inputId: 'core-input', runId: 'core-run' })
    value.store.db.exec(`
      CREATE TRIGGER deny_projection BEFORE UPDATE ON sessions
      BEGIN SELECT RAISE(ABORT, 'projection denied'); END;
    `)
    throw new Error('execution result unknown')
  })
  try {
    const session = value.store.createSession('unwritable unknown')
    const requestId = randomUUID()
    value.runs.submit(session.id, requestId, 'inspect')
    await nextTurn()
    const persisted = value.store.getSession(session.id)
    assert.equal(persisted.status, 'accepted')
    assert.equal(persisted.inputId, 'core-input')
    assert.equal(persisted.runId, 'core-run')
    const replay = value.runs.submit(session.id, requestId, 'inspect')
    assert.equal(replay.replayed, true)
    assert.equal(replay.status, 'accepted')
    assert.equal(replay.runId, 'core-run')
    assert.equal(value.submissions(), 1)
    assert.deepEqual(messages, [
      'Execution submission could not be reconciled',
      'Execution status could not be persisted; prior state retained',
    ])
  } finally {
    await value.close()
  }
})
