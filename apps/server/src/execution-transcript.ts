import { createActEventProjector } from '@velaros-ai/velaros/renderer'
import type { ActRunEvent } from '@velaros-ai/velaros/agent'
import type { ActTurnTrace } from '@velaros-ai/velaros/contracts'
import {
  TranscriptLimits as Limits,
  type DisplayExecution,
  type DisplayMessage,
} from '../../../packages/contracts/src/index.js'
import type { ExecutionNotice } from './execution.js'

/** 与 Desktop 一样分开接纳正文、实时预览和真实执行回执；不保存原始事件账。 */
export class ExecutionTranscript {
  private projector = createActEventProjector()
  private readonly turns = new Map<string, DisplayMessage>()
  private readonly programs = new Map<string, string>()
  private readonly claimed = new Set<string>()
  private readonly delivered = new Map<string, string>()
  private currentTurn: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  public constructor(private readonly emit: (notice: ExecutionNotice) => void) {}

  public apply(event: ActRunEvent): void {
    if (event.type === 'turn') this.projector = createActEventProjector()
    const presentation = this.projector.applyLive(event).runs[event.runId]
    if (event.type === 'turn') this.currentTurn = event.turnId
    const turnId = 'turnId' in event ? event.turnId : this.currentTurn
    if (!turnId) return
    if (!this.turns.has(turnId))
      this.turns.set(turnId, {
        id: `turn:${event.runId}:${turnId}`,
        role: 'assistant',
        text: '',
        truncated: false,
        timestamp: new Date().toISOString(),
        runId: event.runId,
        turnId,
        phase: 'preview',
        executions: [],
      })
    while (this.turns.size > Limits.turns) {
      const oldest = this.turns.keys().next().value!
      const previous = this.turns.get(oldest)!
      this.turns.delete(oldest)
      this.delivered.delete(previous.id)
      for (const [key, id] of this.programs)
        if (key.startsWith(`${oldest}:`)) {
          this.programs.delete(key)
          this.claimed.delete(id)
        }
    }
    const message = this.turns.get(turnId)!
    if (event.type === 'reasoning')
      message.thinking = ((message.thinking ?? '') + event.text).slice(0, Limits.thinkingChars)
    if (event.type === 'text') message.preview = (presentation?.preview ?? '').slice(0, 8000)
    if (event.type === 'accepted') {
      const accepted = presentation?.messages.find((item) => item.turnId === turnId)
      message.text = (accepted?.text ?? '').slice(0, 8000)
      message.truncated = (accepted?.text.length ?? 0) > 8000
      message.phase = 'accepted'
      delete message.preview
      for (const card of message.executions ?? [])
        if (card.kind === 'blobs') card.status = 'succeeded'
    }
    if (event.type === 'rejected') {
      this.turns.delete(turnId)
      this.deliver({ type: 'transcript', messageId: message.id, message: null })
      return
    }
    if (
      event.type === 'program' &&
      (event.kind === 'execute' || event.kind === 'observe' || event.kind === 'blobs')
    ) {
      const key = `${turnId}:${event.index}`
      let card = message.executions!.find((item) => item.id === this.programs.get(key))
      if (!card && event.phase === 'start') {
        card = message.executions!.find(
          (item) => item.kind === event.kind && !this.claimed.has(item.id),
        )
        if (!card && message.executions!.length < Limits.executions) {
          card = {
            id: `${message.id}:program:${event.index}`,
            kind: event.kind,
            status: 'writing',
            source: '',
            sourceTruncated: false,
            durationMs: null,
            calls: [],
          }
          message.executions!.push(card)
        }
        if (card) {
          this.programs.set(key, card.id)
          this.claimed.add(card.id)
        }
      }
      if (card && event.phase === 'delta') {
        const source = card.source + event.text
        card.source = source.slice(0, Limits.sourceChars)
        card.sourceTruncated ||= source.length > Limits.sourceChars
      }
      if (card && event.phase === 'end' && card.status === 'writing') card.status = 'queued'
    }
    this.schedule()
  }

  public pendingTurns(): string[] {
    return [...this.turns]
      .filter(([, message]) =>
        message.executions?.some((card) => ['writing', 'queued', 'running'].includes(card.status)),
      )
      .map(([turnId]) => turnId)
  }

  public trace(trace: ActTurnTrace): void {
    const message = this.turns.get(trace.turnId)
    if (!message) return
    const cards = (message.executions ??= [])
    for (const execution of trace.executions.slice(0, Limits.executions)) {
      let card = cards.filter((item) => item.kind === 'execute')[execution.position]
      if (!card && cards.length < Limits.executions) {
        card = {
          id: `${message.id}:execution:${execution.executionId}`,
          kind: 'execute',
          status: 'queued',
          source: '',
          sourceTruncated: false,
          durationMs: null,
          calls: [],
        }
        cards.push(card)
      }
      if (!card) continue
      card.status = execution.status
      card.source = execution.source.slice(0, Limits.sourceChars)
      card.sourceTruncated =
        execution.sourceTruncated || execution.source.length > Limits.sourceChars
      card.durationMs = execution.durationMs
      card.error = execution.failure?.message.slice(0, Limits.outputChars)
      card.processOutput = execution.processOutput?.slice(0, Limits.outputChars)
      card.processOutputTruncated =
        execution.processOutputTruncated ||
        (execution.processOutput?.length ?? 0) > Limits.outputChars
      card.calls = trace.invocations
        .filter((item) => item.executionId === execution.executionId)
        .slice(0, Limits.calls)
        .map(({ summary }) => ({
          module: summary.moduleId,
          operation: summary.operation,
          status: summary.status,
          effect: summary.effect,
          input: summary.input.slice(0, Limits.callChars),
          output: summary.output.slice(0, Limits.callChars),
          inputTruncated: summary.inputTruncated || summary.input.length > Limits.callChars,
          outputTruncated: summary.outputTruncated || summary.output.length > Limits.callChars,
        }))
    }
    const registration = trace.observation.registration
    const observation = cards.find((item) => item.kind === 'observe')
    if (registration && observation) {
      observation.status = registration.status === 'rejected' ? 'failed' : 'succeeded'
      observation.error = registration.failure?.message
      observation.calls = [
        {
          module: 'velaros',
          operation: 'observe.register',
          status: registration.status === 'rejected' ? 'failed' : 'succeeded',
          effect: 'none',
          input: '',
          output: JSON.stringify({ registration: registration.status, executed: false }),
          inputTruncated: false,
          outputTruncated: false,
        },
      ]
    }
    this.schedule()
  }

  public finish(): void {
    this.projector.finish()
    for (const message of this.turns.values()) {
      delete message.preview
      if (message.phase === 'preview') {
        this.deliver({ type: 'transcript', messageId: message.id, message: null })
        continue
      }
      for (const card of message.executions ?? [])
        if (['writing', 'queued', 'running'].includes(card.status)) card.status = 'unknown'
      this.publish(message)
    }
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      for (const message of this.turns.values()) this.publish(message)
    }, Limits.publishMs)
  }

  private publish(message: DisplayMessage): void {
    if (!message.text && !message.preview && !message.thinking && !message.executions?.length)
      return
    const serialized = JSON.stringify(message)
    if (this.delivered.get(message.id) === serialized) return
    if (
      this.deliver({ type: 'transcript', messageId: message.id, message: structuredClone(message) })
    )
      this.delivered.set(message.id, serialized)
  }

  private deliver(notice: ExecutionNotice): boolean {
    try {
      this.emit(notice)
      return true
    } catch (error) {
      console.error('Execution display delivery failed', {
        name: error instanceof Error ? error.name : 'unknown',
      })
      return false
    }
  }
}
