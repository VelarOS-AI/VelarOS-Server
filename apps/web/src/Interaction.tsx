import { useEffect, useState } from 'react'
import { Button } from '@velaros-ai/ui/primitives/buttons/Button'
import { Input } from '@velaros-ai/ui/primitives/forms/Input'
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
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
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
    setBusy(true)
    setError(null)
    try {
      await onAnswer(interaction.id, interaction.runId, value)
    } catch (error) {
      setError(error instanceof Error ? error.message : '回答未确认')
      setBusy(false)
    }
  }
  return (
    <div className="interaction-panel">
      <strong>{interaction.message}</strong>
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
      {interaction.kind === 'confirm' ? (
        <div className="row">
          <Button size="sm" disabled={!loaded || busy} onClick={() => void submit(true)}>
            允许本次执行
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void submit(false)}>
            拒绝
          </Button>
        </div>
      ) : (
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault()
            void submit(answer)
          }}
        >
          <Input
            value={answer}
            disabled={busy}
            onChange={(event) => setAnswer(event.target.value)}
            aria-label="回答"
          />
          <Button type="submit" size="sm" disabled={busy || !answer.trim()}>
            发送回答
          </Button>
        </form>
      )}
    </div>
  )
}
