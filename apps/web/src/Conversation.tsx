import { useMemo, useRef, useState } from 'react'
import {
  ChatConversationPane,
  ChatThinkingVisibilityProvider,
  ConversationActionPortProvider,
  ConversationBlockHooksProvider,
  ConversationLocalizationProvider,
  conversationZhCNMessages,
  emptyConversationActionPort,
  emptyConversationBlockHooks,
  type ConversationI18nContextValue,
  type ConversationView,
} from '@velaros-ai/ui/conversation/basic'
import {
  ChatSurfaceComposer,
  ConversationComposerPortProvider,
  emptyConversationComposerPort,
  type ChatComposerControl,
} from '@velaros-ai/ui/conversation/composer'
import type { SessionView } from '../../../packages/contracts/src/index.js'
import { Interaction } from './Interaction.js'

const i18n: ConversationI18nContextValue = {
  locale: 'zh-CN',
  setLocale: async () => {},
  t: (key, params) => {
    let value: unknown = conversationZhCNMessages
    for (const part of key.split('.')) {
      if (!value || typeof value !== 'object' || !(part in value)) return key
      value = Reflect.get(value, part)
    }
    if (typeof value !== 'string') return key
    return value.replace(/\{(\w+)\}/g, (original, name: string) =>
      String(params?.[name] ?? original),
    )
  },
}

const active = (session: SessionView): boolean =>
  ['received', 'accepted', 'running', 'waiting'].includes(session.status)

/** 产品投影只绑定共享展示合同，不带入 Desktop 的会话或 People 模型。 */
function project(session: SessionView): ConversationView {
  const isStreaming = active(session)
  return {
    sessionId: session.id,
    activeMemberSessionId: session.id,
    supportsProjectFiles: false,
    messages: session.messages.map((message) => ({
      id: message.id,
      role: message.role === 'user' ? 'user' : 'assistant',
      conversationKind:
        message.role === 'user'
          ? 'turn-input'
          : message.role === 'system'
            ? 'system-notice'
            : 'assistant-output',
      timestamp: Date.parse(session.updatedAt),
      blocks: [
        {
          type: 'text',
          text:
            message.text +
            (message.truncated ? '\n\n（展示已截短，完整执行结果以运行事实为准）' : ''),
        },
      ],
    })),
    messageRunMarkers: [],
    runtime: {
      status:
        session.status === 'unknown' || session.status === 'failed'
          ? 'failed'
          : session.status === 'cancelled'
            ? 'aborted'
            : session.status === 'completed'
              ? 'completed'
              : session.status === 'waiting'
                ? 'awaiting-input'
                : isStreaming
                  ? 'running'
                  : 'idle',
      teamPhase: null,
      activeTurn: null,
      completedTurns: 0,
      lastError: session.status === 'unknown' ? '原执行结果尚未确认，系统不会自动重试' : null,
      connectionRetryAttempt: null,
      connectionRetryMaxAttempts: null,
      lastRunStartedAt: null,
      awaitingConfirmationMessage: null,
      awaitingInputQuestion: session.interaction?.message ?? null,
      conversationCards: [],
      awaitingConfirmationExecutionId: null,
      lastRunFinishedAt: null,
      usageTelemetry: [],
    },
    isStreaming,
    hasStreamingThinkingBlock: false,
    runningLabel: session.status === 'received' ? '请求已受理，等待执行接纳' : '正在处理',
  }
}

export function Conversation({
  session,
  available,
  onSend,
  onStop,
  onReview,
  onAnswer,
}: {
  session: SessionView
  available: boolean
  onSend(text: string): Promise<void>
  onStop(): Promise<void>
  onReview(requestId: string): Promise<string | null>
  onAnswer(requestId: string, runId: string, value: string | boolean): Promise<void>
}): React.ReactElement {
  const [draft, setDraft] = useState('')
  const [followLocked, setFollowLocked] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const conversation = useMemo(() => project(session), [session])
  const control: ChatComposerControl = {
    scopeKey: session.id,
    input: {
      input: {
        value: draft,
        onValueChange: setDraft,
        placeholder: available
          ? '检查服务、查看日志，或描述需要处理的问题…'
          : 'Agent 暂不可用；可先使用文件与设置',
        disabled: !available || active(session) || session.status === 'unknown',
        onSend: async () => {
          const submitted = draft
          await onSend(submitted)
          setDraft((current) => (current === submitted ? '' : current))
        },
      },
      attachments: { files: [] },
      features: { voiceInput: false },
      streaming: {
        isStreaming: active(session),
        canStop: Boolean(session.runId) && active(session),
        onStop,
      },
    },
  }
  return (
    <ConversationLocalizationProvider value={i18n}>
      <ConversationActionPortProvider value={emptyConversationActionPort}>
        <ConversationComposerPortProvider value={emptyConversationComposerPort}>
          <ConversationBlockHooksProvider value={emptyConversationBlockHooks}>
            <ChatThinkingVisibilityProvider visible={false}>
              <ChatConversationPane
                conversation={conversation}
                composer={
                  <>
                    {session.interaction && (
                      <Interaction
                        key={session.interaction.id}
                        interaction={session.interaction}
                        onReview={onReview}
                        onAnswer={onAnswer}
                      />
                    )}
                    <ChatSurfaceComposer control={control} />
                  </>
                }
                followLocked={followLocked}
                onFollowLockedChange={setFollowLocked}
                scrollRef={scrollRef}
              />
            </ChatThinkingVisibilityProvider>
          </ConversationBlockHooksProvider>
        </ConversationComposerPortProvider>
      </ConversationActionPortProvider>
    </ConversationLocalizationProvider>
  )
}
