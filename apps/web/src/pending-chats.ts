import type { AttachmentSummary, SessionView } from '../../../packages/contracts/src/index.js'

export interface PendingMessage {
  id: string
  sessionId: string
  text: string
  timestamp: string
  attachments: AttachmentSummary[]
  accepted: boolean
}

export function draftSession(id: string): SessionView {
  return {
    id,
    title: '新会话',
    revision: 0,
    status: 'idle',
    runId: null,
    inputId: null,
    updatedAt: new Date().toISOString(),
    messages: [],
    interaction: null,
    facts: [],
  }
}

export function hasInput(session: SessionView | undefined, id: string): boolean {
  return (
    !!session && (session.inputId === id || session.messages.some((message) => message.id === id))
  )
}

/** 本地即时反馈是网络投影；服务端回显相同身份后原位接管，不复制正式消息。 */
export function projectPendingChats(
  remote: SessionView[],
  local: SessionView[],
  pending: PendingMessage[],
): SessionView[] {
  const sessions = [
    ...local.filter((item) => !remote.some((server) => server.id === item.id)),
    ...remote,
  ]
  return sessions.map((session) => {
    const additions = pending.filter(
      (item) => item.sessionId === session.id && !hasInput(session, item.id),
    )
    if (!additions.length) return session
    const first = additions[0]!
    return {
      ...session,
      title:
        session.messages.length === 0 && session.title === '新会话'
          ? (first.text.trim().split('\n')[0] || first.attachments[0]?.name || '附件对话').slice(
              0,
              40,
            )
          : session.title,
      status:
        additions.some((item) => item.accepted) && session.status === 'idle'
          ? 'received'
          : session.status,
      messages: [
        ...session.messages,
        ...additions.map((item) => ({
          id: item.id,
          role: 'user' as const,
          text: item.text,
          timestamp: item.timestamp,
          attachments: item.attachments,
          truncated: false,
        })),
      ],
    }
  })
}
