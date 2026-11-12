import assert from 'node:assert/strict'
import { mkdtemp, rm, realpath } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import type { DisplayMessage } from '../packages/contracts/src/index.js'
import { TranscriptLimits } from '../packages/contracts/src/index.js'
import { ExecutionTranscript } from '../apps/server/src/execution-transcript.js'
import { ProductStore } from '../apps/server/src/store.js'

test('正式正文投影替换实时预览，协议拒绝撤销预览，展示受界限约束', async () => {
  const messages = new Map<string, DisplayMessage>()
  const transcript = new ExecutionTranscript((notice) => {
    if (notice.type !== 'transcript') return
    if (notice.message) messages.set(notice.messageId, notice.message)
    else messages.delete(notice.messageId)
  })
  try {
    transcript.apply({ type: 'turn', runId: 'run', turnId: 'turn' })
    transcript.apply({
      type: 'reasoning',
      runId: 'run',
      text: '思考'.repeat(TranscriptLimits.thinkingChars),
    })
    transcript.apply({ type: 'text', runId: 'run', text: '尚未接纳' })
    await new Promise((resolve) => setTimeout(resolve, TranscriptLimits.publishMs + 30))
    assert.equal([...messages.values()][0]?.preview, '尚未接纳')
    assert.equal([...messages.values()][0]?.text, '')
    assert.equal([...messages.values()][0]?.thinking?.length, TranscriptLimits.thinkingChars)
    transcript.apply({
      type: 'accepted',
      runId: 'run',
      turnId: 'turn',
      text: '已接纳正文',
      ref: { sessionId: 'session', id: 'accepted' },
    })
    transcript.apply({ type: 'turn', runId: 'run', turnId: 'rejected' })
    transcript.apply({ type: 'text', runId: 'run', text: '应撤销' })
    await new Promise((resolve) => setTimeout(resolve, TranscriptLimits.publishMs + 30))
    assert.equal(messages.size, 2)
    transcript.apply({ type: 'rejected', runId: 'run', turnId: 'rejected', message: '协议拒绝' })
    transcript.finish()
    assert.equal(messages.size, 1)
    assert.equal([...messages.values()][0]?.text, '已接纳正文')
    assert.equal([...messages.values()][0]?.preview, undefined)
  } finally {
    transcript.finish()
  }
})

test('真实 SQLite 重启丢弃未接纳预览，未知进程结果保持未知', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'velaros-transcript-'))
  const path = join(directory, 'server.sqlite')
  let store = new ProductStore(path)
  try {
    const session = store.createSession('restart projection')
    session.status = 'running'
    session.messages = [
      {
        id: 'preview',
        role: 'assistant',
        text: '',
        preview: '未接纳',
        phase: 'preview',
        truncated: false,
      },
      {
        id: 'accepted',
        role: 'assistant',
        text: '正式正文',
        phase: 'accepted',
        truncated: false,
        executions: [
          {
            id: 'exec',
            kind: 'execute',
            status: 'running',
            source: 'console.log(1)',
            sourceTruncated: false,
            durationMs: null,
            calls: [],
          },
        ],
      },
    ]
    store.saveSession(session)
    store.close()
    store = new ProductStore(path)
    const restored = store.getSession(session.id)
    assert.equal(restored.status, 'unknown')
    assert.deepEqual(
      restored.messages.map((message) => message.id),
      ['accepted'],
    )
    assert.equal(restored.messages[0]?.executions?.[0]?.status, 'unknown')
  } finally {
    store.close()
    const actual = await realpath(directory)
    assert.equal(dirname(actual).toLowerCase(), (await realpath(tmpdir())).toLowerCase())
    assert.ok(basename(actual).startsWith('velaros-transcript-'))
    await rm(actual, { recursive: true, force: true })
  }
})
