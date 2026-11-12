import { useEffect, useState } from 'react'
import { InteractionAnswerProvider, InteractionCard } from '@velaros-ai/ui/conversation/basic'
import type { PendingInteraction } from '../../../packages/contracts/src/index.js'

export function Interaction({
  interaction,
  onReview,
  onAnswer,
}: {
  interaction: PendingInteraction
  onReview(requestId: string): Promise<string | null>
  onAnswer(requestId: string, runId: string, value: string | boolean): Promise<void>
}): React.ReactElement {
  const [source, setSource] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let disposed = false
    void onReview(interaction.id)
      .then((value) => {
        if (!disposed) {
          setSource(value)
          setLoaded(true)
        }
      })
      .catch((error: Error) => {
        if (!disposed) setError(error.message)
      })
    return () => {
      disposed = true
    }
    // 此交互以 id 为身份；父组件刷新投影不重复取执行正文。
  }, [interaction.id])
  const submit = async (value: string | boolean): Promise<void> => {
    setError(null)
    try {
      await onAnswer(interaction.id, interaction.runId, value)
    } catch (error) {
      setError(error instanceof Error ? error.message : '回答未确认')
      throw error
    }
  }
  return (
    <div className="interaction-panel">
      <InteractionAnswerProvider
        value={
          loaded
            ? async (_id, answer) => {
                await submit(
                  interaction.kind === 'confirm'
                    ? answer.approved === true
                    : answer.declined
                      ? false
                      : (answer.text ?? ''),
                )
              }
            : null
        }
      >
        <InteractionCard
          block={{
            type: 'interaction',
            id: interaction.id,
            kind: interaction.kind === 'confirm' ? 'confirm' : 'input',
            message: interaction.message,
            status: 'pending',
          }}
        />
      </InteractionAnswerProvider>
      {source && (
        <details>
          <summary>查看将要执行的程序</summary>
          <pre>{source}</pre>
        </details>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </div>
  )
}
