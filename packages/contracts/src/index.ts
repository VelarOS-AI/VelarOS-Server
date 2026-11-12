/** Server 产品 API 数据；不依赖 Workspace、People、IPC 或 Platform 实现。 */
import type { AttachmentSummary, ContextUsage } from './input.js'
export * from './input.js'

export type RunStatus =
  | 'idle'
  | 'received'
  | 'accepted'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown'

export interface FactReference {
  sessionId: string
  runId: string
  recordId: string
}

export interface DisplayMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  truncated: boolean
  attachments?: AttachmentSummary[]
  timestamp: string
  runId?: string
  runStatus?: RunStatus
  runFinishedAt?: string
  turnId?: string
  phase?: 'preview' | 'accepted'
  preview?: string
  thinking?: string
  executions?: DisplayExecution[]
}

/** 仅保存有界展示；实际源码、进程与调用事实仍归 Platform。 */
export const TranscriptLimits = {
  turns: 40,
  thinkingChars: 4000,
  executions: 6,
  sourceChars: 4000,
  outputChars: 4000,
  calls: 6,
  callChars: 1000,
  traceChars: 32000,
  refreshMs: 500,
  publishMs: 100,
} as const

export interface DisplayExecution {
  id: string
  kind: 'execute' | 'observe' | 'blobs'
  status: 'writing' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown'
  source: string
  sourceTruncated: boolean
  processOutput?: string
  processOutputTruncated?: boolean
  durationMs: number | null
  error?: string
  calls: {
    module: string
    operation: string
    status: 'pending' | 'succeeded' | 'failed' | 'cancelled'
    effect: 'none' | 'committed' | 'partial' | 'unknown'
    input: string
    output: string
    inputTruncated: boolean
    outputTruncated: boolean
  }[]
}

export interface PendingInteraction {
  id: string
  runId: string
  message: string
  kind: 'confirm' | 'question'
}

export interface SessionView {
  id: string
  title: string
  pinned: boolean
  archived: boolean
  revision: number
  status: RunStatus
  runId: string | null
  inputId: string | null
  updatedAt: string
  messages: DisplayMessage[]
  interaction: PendingInteraction | null
  facts: FactReference[]
  contextUsage?: ContextUsage
}

export interface SessionUpdate {
  title?: string
  pinned?: boolean
  archived?: boolean
}

export interface InputReceipt {
  requestId: string
  sessionId: string
  inputId: string | null
  runId: string | null
  status: RunStatus
  replayed: boolean
}

export interface ChangeNotice {
  sequence: number
  sessionId: string
  revision: number
}

export interface ModelSettings {
  provider: string
  baseUrl: string
  model: string
  hasApiKey: boolean
}

export interface ModelCatalogView {
  models: { id: string; label: string }[]
  error: string | null
  fetchedAt: number
}

export interface ServerInfo {
  hostname: string
  platform: string
  uptimeSeconds: number
  memory: { totalBytes: number; availableBytes: number }
  roots: string[]
  execution: { available: boolean; reason: string | null }
  terminal: { available: boolean; reason: string | null }
  model: ModelSettings
}

export interface FileEntry {
  name: string
  path: string
  kind: 'file' | 'directory' | 'other'
}

export interface DirectoryView {
  path: string
  entries: FileEntry[]
  truncated: boolean
}

export interface TextFileView {
  path: string
  content: string
  sha256: string
  bytes: number
}

export interface ApiFailure {
  error: { code: string; message: string }
}
