import { useEffect, useMemo, useRef, useState } from 'react'
import {
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
import { ChatConversationPane } from '@velaros-ai/ui/conversation'
import {
  ChatSurfaceComposer,
  ConversationComposerPortProvider,
  emptyConversationComposerPort,
  type ChatComposerControl,
} from '@velaros-ai/ui/conversation/composer'
import {
  ExecutionModes,
  type ExecutionMode,
  type SessionView,
  type ThinkingDepth,
} from '../../../packages/contracts/src/index.js'
import { Interaction } from './Interaction.js'
import { ContextUsageIndicator } from './ContextUsageIndicator.js'

const i18n: ConversationI18nContextValue = {
  locale: 'zh-CN',
  setLocale: async () => {},
  t: (key, params) => {
    if (key === 'chat.composerThinkingDepthHint')
      return '控制模型推理力度；模型不支持的档位由对应适配器降到支持的档位。'
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

const active = (session: SessionView | null): boolean =>
  Boolean(session && ['received', 'accepted', 'running', 'waiting'].includes(session.status))

/** 产品投影只绑定共享展示合同，不带入 Desktop 的会话或 People 模型。 */
function project(session: SessionView | null): ConversationView {
  const isStreaming = active(session)
  return {
    sessionId: session?.id ?? 'new-chat',
    activeMemberSessionId: session?.id ?? 'new-chat',
    supportsProjectFiles: false,
    messages:
      session?.messages.map((message) => ({
        id: message.id,
        role: message.role === 'user' ? 'user' : 'assistant',
        conversationKind:
          message.role === 'user'
            ? 'turn-input'
            : message.role === 'system'
              ? 'system-notice'
              : 'assistant-output',
        timestamp: message.timestamp ? Date.parse(message.timestamp) : Number.NaN,
        runId: message.runId,
        turnId: message.turnId,
        attachments: message.attachments?.map((attachment, index) => ({
          id: `${message.id}:${index}`,
          kind: attachment.kind === 'image' ? ('image' as const) : ('file' as const),
          name: attachment.name,
          mediaType: attachment.mediaType,
          size: attachment.bytes,
        })),
        blocks: [
          ...(message.thinking
            ? [
                {
                  type: 'thinking' as const,
                  text: message.thinking,
                  streamId: `${message.id}:thinking`,
                },
              ]
            : []),
          ...((message.preview ?? message.text)
            ? [
                {
                  type: 'text',
                  text:
                    (message.preview ?? message.text) +
                    (message.truncated ? '\n\n（展示已截短，完整执行结果以运行事实为准）' : ''),
                } as const,
              ]
            : []),
          ...(message.executions ?? []).map((card) => ({
            type: 'script-execution' as const,
            id: card.id,
            kind: card.kind,
            title:
              card.source
                .split('\n')
                .find((line) => line.trim())
                ?.match(/^\s*\/\/\s*(.+)$/)?.[1]
                ?.trim() ?? '',
            status: card.status === 'unknown' ? ('failed' as const) : card.status,
            source: card.source,
            sourceTruncated: card.sourceTruncated,
            error: card.status === 'unknown' ? '执行结果尚未确认，请核对原进程。' : card.error,
            durationMs: card.durationMs,
            calls: [
              ...(card.processOutput
                ? [
                    {
                      module: 'node',
                      operation: 'execute',
                      status:
                        card.status === 'succeeded'
                          ? ('succeeded' as const)
                          : card.status === 'failed'
                            ? ('failed' as const)
                            : card.status === 'cancelled'
                              ? ('cancelled' as const)
                              : ('pending' as const),
                      effect: 'unknown' as const,
                      input: '',
                      output: card.processOutput,
                      inputTruncated: false,
                      outputTruncated: !!card.processOutputTruncated,
                    },
                  ]
                : []),
              ...card.calls,
            ],
          })),
        ],
      })) ?? [],
    messageRunMarkers: [],
    runtime: {
      status:
        session?.status === 'unknown' || session?.status === 'failed'
          ? 'failed'
          : session?.status === 'cancelled'
            ? 'aborted'
            : session?.status === 'completed'
              ? 'completed'
              : session?.status === 'waiting'
                ? 'awaiting-input'
                : isStreaming
                  ? 'running'
                  : 'idle',
      teamPhase: isStreaming
        ? session?.messages.some((message) =>
            message.executions?.some((card) => card.status === 'running'),
          )
          ? 'executing'
          : 'researching'
        : null,
      activeTurn: null,
      completedTurns: 0,
      lastError: session?.status === 'unknown' ? '执行结果尚未确认' : null,
      connectionRetryAttempt: null,
      connectionRetryMaxAttempts: null,
      lastRunStartedAt: null,
      awaitingConfirmationMessage: null,
      awaitingInputQuestion: session?.interaction?.message ?? null,
      conversationCards: [],
      awaitingConfirmationExecutionId: null,
      lastRunFinishedAt: null,
      usageTelemetry: [],
    },
    isStreaming,
    hasStreamingThinkingBlock: isStreaming && Boolean(session?.messages.at(-1)?.thinking),
    runningLabel: session?.status === 'received' ? '等待处理' : '正在处理',
  }
}

export function Conversation({
  session,
  draft,
  onDraftChange,
  files,
  onFilesChange,
  thinkingDepth,
  onThinkingDepthChange,
  executionMode,
  onExecutionModeChange,
  submitting,
  available,
  modelSettings,
  onSend,
  onStop,
  onReview,
  onAnswer,
}: {
  session: SessionView | null
  draft: string
  onDraftChange(text: string): void
  files: File[]
  onFilesChange(files: File[]): void
  thinkingDepth: ThinkingDepth
  onThinkingDepthChange(value: ThinkingDepth): void
  executionMode: ExecutionMode
  onExecutionModeChange(value: ExecutionMode): void
  submitting: boolean
  available: boolean
  modelSettings: React.ReactNode
  onSend(text: string, files: File[]): Promise<void>
  onStop(): Promise<void>
  onReview(requestId: string): Promise<string | null>
  onAnswer(requestId: string, runId: string, value: string | boolean): Promise<void>
}): React.ReactElement {
  const [followLocked, setFollowLocked] = useState(false)
  const [showThinking, setShowThinking] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => setFollowLocked(false), [session?.id])
  const conversation = useMemo(() => project(session), [session])
  const control: ChatComposerControl = {
    scopeKey: session?.id ?? 'new-chat',
    leftSlot: modelSettings,
    capabilityControls: [
      {
        id: 'execution-mode',
        kind: 'choice',
        placement: 'toolbar',
        label: '执行',
        value: executionMode,
        disabled: submitting || active(session),
        choices: [
          {
            id: 'standard',
            label: '标准模式',
            description: '工作区内自动执行；不可恢复的操作先确认。',
          },
          {
            id: 'full',
            label: '完全访问',
            description: '使用服务账户的主机权限，不启用工作区沙箱，自动批准执行。',
            tone: 'danger',
          },
          { id: 'ask', label: '每次询问', description: '保留工作区沙箱，每次执行程序前确认。' },
        ],
        onChange: (value) => {
          if (ExecutionModes.some((mode) => mode === value))
            onExecutionModeChange(value as ExecutionMode)
        },
      },
    ],
    modelRunSummary: {
      primaryLabel: '思考深度',
      secondaryLabel: { low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高' }[
        thinkingDepth
      ],
    },
    slots: { contextUsageIndicator: <ContextUsageIndicator usage={session?.contextUsage} /> },
    input: {
      input: {
        value: draft,
        onValueChange: onDraftChange,
        placeholder: available ? '发送消息…' : '模型未连接',
        disabled: submitting || active(session) || session?.status === 'unknown',
        onSend: (submission) => onSend(submission?.value ?? draft, submission?.files ?? files),
      },
      attachments: {
        files,
        onFilesChange:
          submitting || active(session) || session?.status === 'unknown'
            ? undefined
            : onFilesChange,
      },
      thinkingDepth: {
        value: thinkingDepth,
        onChange: onThinkingDepthChange,
        disabled: submitting || active(session),
      },
      thinkingVisibility: { value: showThinking, onChange: setShowThinking },
      features: { voiceInput: false },
      streaming: {
        isStreaming: active(session),
        canStop: Boolean(session?.runId) && active(session),
        onStop,
      },
    },
  }
  const interaction = session?.interaction ? (
    <Interaction
      key={session.interaction.id}
      interaction={session.interaction}
      onReview={onReview}
      onAnswer={onAnswer}
    />
  ) : null
  const composer = <ChatSurfaceComposer control={control} />
  return (
    <ConversationLocalizationProvider value={i18n}>
      <ConversationActionPortProvider value={emptyConversationActionPort}>
        <ConversationComposerPortProvider value={emptyConversationComposerPort}>
          <ConversationBlockHooksProvider value={emptyConversationBlockHooks}>
            <ChatThinkingVisibilityProvider visible={showThinking}>
              {!session || (session.messages.length === 0 && session.status === 'idle') ? (
                <section className="new-conversation" aria-label="对话">
                  <div className="new-conversation-content">
                    <h1>今天想完成什么？</h1>
                    {composer}
                  </div>
                </section>
              ) : (
                <ChatConversationPane
                  conversation={conversation}
                  composer={composer}
                  streamSlot={interaction}
                  followLocked={followLocked}
                  onFollowLockedChange={setFollowLocked}
                  scrollRef={scrollRef}
                />
              )}
            </ChatThinkingVisibilityProvider>
          </ConversationBlockHooksProvider>
        </ConversationComposerPortProvider>
      </ConversationActionPortProvider>
    </ConversationLocalizationProvider>
  )
}
