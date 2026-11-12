import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatMessage } from '@velaros-ai/ui/conversation/contracts'
import { groupRunMessages, projectRunMarkers } from '../apps/web/src/conversation-messages.js'
import {
  draftSession,
  projectPendingChats,
  sidebarSessions,
  singleDraft,
  mergeSessions,
} from '../apps/web/src/pending-chats.js'

function assistant(id: string, runId?: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    conversationKind: 'assistant-output',
    runId,
    timestamp: 1,
    blocks: [{ type: 'text', text: id, segmentId: id }],
  }
}

test('同次运行回合归为一条助手消息，保留块顺序和稳定身份，不跨输入或其他运行', () => {
  const first = assistant('first', 'run')
  const grouped = groupRunMessages([first, assistant('step', 'run'), assistant('summary', 'run')])
  assert.equal(grouped.length, 1)
  assert.equal(grouped[0]!.id, groupRunMessages([first])[0]!.id)
  assert.deepEqual(
    grouped[0]!.blocks.map((block) => (block.type === 'text' ? block.segmentId : '')),
    ['first', 'step', 'summary'],
  )
  assert.equal(first.blocks.length, 1)
  const user: ChatMessage = {
    id: 'user',
    role: 'user',
    conversationKind: 'turn-input',
    timestamp: 2,
    blocks: [],
  }
  assert.equal(groupRunMessages([first, user, assistant('next', 'run')]).length, 3)
  assert.equal(groupRunMessages([first, assistant('other', 'other-run')]).length, 2)
  assert.equal(groupRunMessages([assistant('unknown'), assistant('unknown2')]).length, 2)
  const system = { ...assistant('notice', 'run'), conversationKind: 'system-notice' as const }
  assert.equal(groupRunMessages([first, system, assistant('after', 'run')]).length, 3)
})

test('侧栏只留一个空白入口，置顶优先、归档分开，迟到列表不覆盖新名称和组织信息', () => {
  const local = draftSession('local')
  const remote = draftSession('remote')
  const pinned = {
    ...draftSession('pinned'),
    pinned: true,
    messages: [
      {
        id: 'input',
        role: 'user' as const,
        text: '检查',
        truncated: false,
        timestamp: new Date().toISOString(),
      },
    ],
  }
  const archived = { ...pinned, id: 'archived', pinned: false, archived: true }
  const visible = singleDraft([remote, local, pinned, archived], local.id)
  assert.deepEqual(
    visible.map((session) => session.id),
    ['local', 'pinned', 'archived'],
  )
  assert.deepEqual(
    sidebarSessions(visible, false).map((session) => session.id),
    ['pinned', 'local'],
  )
  assert.deepEqual(
    sidebarSessions(visible, true).map((session) => session.id),
    ['archived'],
  )
  const current = { ...pinned, revision: 5, title: '服务器维护', archived: true, pinned: false }
  const merged = mergeSessions([current, local], [{ ...pinned, revision: 4 }])
  assert.equal(merged.find((session) => session.id === pinned.id)!.title, current.title)
  assert.equal(merged.find((session) => session.id === pinned.id)!.archived, true)
  assert.equal(
    merged.some((session) => session.id === local.id),
    true,
    '读取开始后创建的新会话不被旧快照抹掉',
  )
})

test('运行尾标保留已知的失败与未知，不把旧运行推定为完成', () => {
  const session = draftSession('session')
  session.runId = 'new'
  session.status = 'completed'
  session.messages = [
    {
      id: 'old',
      role: 'assistant',
      runId: 'old',
      runStatus: 'failed',
      text: 'failed',
      truncated: false,
      timestamp: new Date().toISOString(),
    },
    {
      id: 'new',
      role: 'assistant',
      runId: 'new',
      runStatus: 'completed',
      timestamp: new Date().toISOString(),
      runFinishedAt: new Date().toISOString(),
      text: 'done',
      truncated: false,
    },
  ]
  const markers = projectRunMarkers(session, [
    assistant('old', 'old'),
    assistant('new', 'new'),
    assistant('untracked', 'untracked'),
  ])
  assert.deepEqual(
    markers.map((marker) => [marker.messageId, marker.status]),
    [
      ['old', 'failed'],
      ['new', 'completed'],
    ],
  )
  session.status = 'unknown'
  session.messages.at(-1)!.runStatus = 'unknown'
  delete session.messages.at(-1)!.runFinishedAt
  assert.equal(projectRunMarkers(session, [assistant('new', 'new')])[0]!.detail, '执行结果尚未确认')
})

test('新会话和待发送消息立即投影，迟到空快照不抹掉草稿，正式回显按请求身份原位接管', () => {
  const local = draftSession('session')
  const pending = {
    id: 'request',
    sessionId: local.id,
    text: '先检查服务器',
    timestamp: new Date().toISOString(),
    attachments: [],
    accepted: false,
  }
  const immediate = projectPendingChats([], [local], [pending])
  assert.equal(immediate.length, 1)
  assert.equal(immediate[0]!.messages[0]!.text, pending.text)
  assert.equal(immediate[0]!.messages[0]!.id, pending.id)
  assert.equal(immediate[0]!.status, 'idle', '尚未获得网络接纳时不伪报服务器受理')
  assert.equal(projectPendingChats([], [local], [])[0]!.title, '新会话')
  assert.equal(
    projectPendingChats([], [local], [{ ...pending, accepted: true }])[0]!.status,
    'received',
  )
  const server = {
    ...local,
    inputId: pending.id,
    messages: [
      {
        id: pending.id,
        role: 'user' as const,
        text: pending.text,
        timestamp: pending.timestamp,
        truncated: false,
      },
    ],
  }
  const confirmed = projectPendingChats([server], [local], [pending])
  assert.equal(confirmed.length, 1)
  assert.equal(confirmed[0]!.messages.length, 1)
  assert.equal(confirmed[0]!.messages[0]!.id, pending.id)
  assert.equal(local.messages.length, 0)
})
