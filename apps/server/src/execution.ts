import type {
  FactReference,
  PendingInteraction,
  RunStatus,
  ContextUsage,
  ThinkingDepth,
  ExecutionMode,
} from '../../../packages/contracts/src/index.js'
import { HttpError } from './errors.js'

/** 由唯一 Platform 消费适配器提供；Server 不驱动另一套 Agent 循环。 */
export type ExecutionNotice =
  | { type: 'accepted'; inputId: string; runId: string }
  | { type: 'text'; messageId: string; text: string }
  | { type: 'state'; status: RunStatus }
  | { type: 'interaction'; request: PendingInteraction | null }
  | { type: 'fact'; reference: FactReference }
  | { type: 'context-usage'; usage: ContextUsage }

export interface ExecutionInput {
  sessionId: string
  requestId: string
  text: string
  thinkingDepth?: ThinkingDepth
  executionMode?: ExecutionMode
  images?: { type: 'image-data'; origin: 'user'; mediaType: string; data: string; label: string }[]
}

export interface ExecutionPort {
  readonly available: boolean
  readonly unavailableReason: string | null
  validateSession?(sessionId: string): Promise<void>
  submit(input: ExecutionInput, observe: (notice: ExecutionNotice) => void): Promise<void>
  cancel(sessionId: string, runId: string): Promise<void>
  answer(sessionId: string, request: PendingInteraction, value: string | boolean): Promise<void>
  close(): Promise<void>
  review?(sessionId: string, requestId: string): Promise<string | null>
}

export class UnavailableExecution implements ExecutionPort {
  public readonly available = false
  public readonly unavailableReason = '等待 Platform 通用基础环境的固定接口与归档接入'

  public async submit(): Promise<void> {
    throw new HttpError(503, 'EXECUTION_UNAVAILABLE', this.unavailableReason)
  }

  public async cancel(): Promise<void> {
    throw new HttpError(503, 'EXECUTION_UNAVAILABLE', this.unavailableReason)
  }

  public async answer(): Promise<void> {
    throw new HttpError(503, 'EXECUTION_UNAVAILABLE', this.unavailableReason)
  }

  public async close(): Promise<void> {}
}
