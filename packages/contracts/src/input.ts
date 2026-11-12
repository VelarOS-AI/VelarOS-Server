/** 随输入交付实际内容；这些上限同时约束网页和 HTTP 边界。 */
export const InputLimits = {
  textChars: 32_000,
  attachments: 4,
  textFileBytes: 128 * 1024,
  imageBytes: 2 * 1024 * 1024,
  totalTextBytes: 256 * 1024,
  totalBytes: 4 * 1024 * 1024,
  bodyBytes: 6 * 1024 * 1024,
} as const

export const ThinkingDepths = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type ThinkingDepth = (typeof ThinkingDepths)[number]

export interface AttachmentSummary {
  name: string
  kind: 'text' | 'image'
  mediaType: string
  bytes: number
}

export interface InputAttachment extends Omit<AttachmentSummary, 'bytes'> {
  /** 原始内容的标准 base64，不接受 URL 或服务器路径。 */
  data: string
}

export interface InputContent {
  text: string
  attachments?: InputAttachment[]
  thinkingDepth?: ThinkingDepth
}

export interface ContextUsage {
  requestId: string
  model: string
  inputTokens: number
  /** 当前运行实际采用的输入窗口，含产品配置的窗口约束。 */
  inputWindow: number
}
