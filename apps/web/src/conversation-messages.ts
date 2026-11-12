import type { ChatMessage } from '@velaros-ai/ui/conversation/contracts'
import type { ConversationMessageRunMarker } from '@velaros-ai/ui/conversation/basic'
import type { SessionView } from '../../../packages/contracts/src/index.js'

/** Desktop 以运行承载正文段和步骤；保留块身份与顺序，不跨用户或系统消息归并。 */
export function groupRunMessages(messages: ChatMessage[]): ChatMessage[] {
  const grouped: ChatMessage[] = []
  for (const message of messages) {
    const previous = grouped.at(-1)
    if (
      message.conversationKind === 'assistant-output' &&
      message.runId &&
      previous?.conversationKind === 'assistant-output' &&
      previous.runId === message.runId
    ) {
      grouped[grouped.length - 1] = { ...previous, blocks: [...previous.blocks, ...message.blocks] }
    } else grouped.push(message)
  }
  return grouped
}

/** 只使用已观测的运行状态，不从后续出现用户消息推定先前运行成功。 */
export function projectRunMarkers(
  session: SessionView | null,
  messages: ChatMessage[],
): ConversationMessageRunMarker[] {
  if (!session) return []
  return messages.flatMap((message) => {
    if (message.conversationKind !== 'assistant-output' || !message.runId) return []
    const source = session.messages.findLast(
      (item) => item.runId === message.runId && item.runStatus,
    )
    const status = source?.runStatus
    const marker =
      status === 'completed'
        ? 'completed'
        : status === 'cancelled'
          ? 'aborted'
          : status === 'failed' || status === 'unknown'
            ? 'failed'
            : status === 'waiting'
              ? session.interaction?.kind === 'confirm'
                ? 'awaiting-confirmation'
                : 'awaiting-input'
              : null
    return marker
      ? [
          {
            messageId: message.id,
            status: marker,
            detail: status === 'unknown' ? '执行结果尚未确认' : null,
            turnCount: null,
            turnKind: null,
            timestamp: source?.runFinishedAt ? Date.parse(source.runFinishedAt) : Number.NaN,
          },
        ]
      : []
  })
}
