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
