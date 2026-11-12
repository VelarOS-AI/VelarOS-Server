import { z } from 'zod'
import { InputLimits, ThinkingDepths } from '../../../packages/contracts/src/index.js'
import type { AttachmentSummary, InputContent } from '../../../packages/contracts/src/index.js'
import { HttpError } from './errors.js'

const attachmentSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(160)
      .refine((value) => !/[\x00-\x1f/\\]/.test(value)),
    kind: z.enum(['text', 'image']),
    mediaType: z.string().max(80),
    data: z.string().max(Math.ceil(InputLimits.imageBytes / 3) * 4),
  })
  .strict()

export const inputSchema = z
  .object({
    requestId: z.uuid(),
    text: z.string().max(InputLimits.textChars),
    attachments: z.array(attachmentSchema).max(InputLimits.attachments).optional(),
    thinkingDepth: z.enum(ThinkingDepths).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.text.trim() || value.attachments?.length), {
    message: '请输入消息或添加附件',
  })

/** 仅解码有界的内联内容；不下载链接、不写服务器文件。 */
export function decodeInput(input: InputContent): {
  text: string
  summaries: AttachmentSummary[]
  images: { type: 'image-data'; origin: 'user'; mediaType: string; data: string; label: string }[]
} {
  let total = 0
  let textBytes = 0
  const texts = [input.text]
  const summaries: AttachmentSummary[] = []
  const images: ReturnType<typeof decodeInput>['images'] = []
  for (const attachment of input.attachments ?? []) {
    const { data, name, mediaType, kind } = attachment
    if (data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(data))
      throw new HttpError(400, 'ATTACHMENT_INVALID', '附件必须包含原始内容，不能是链接或路径')
    const bytes = Buffer.from(data, 'base64')
    if (bytes.toString('base64') !== data)
      throw new HttpError(400, 'ATTACHMENT_INVALID', '附件编码无效')
    total += bytes.length
    if (total > InputLimits.totalBytes)
      throw new HttpError(413, 'ATTACHMENT_LIMIT', '附件合计不能超过 4 MiB')
    if (kind === 'image') {
      if (bytes.length > InputLimits.imageBytes)
        throw new HttpError(413, 'ATTACHMENT_LIMIT', '每张图片不能超过 2 MiB')
      const valid =
        (mediaType === 'image/png' &&
          bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
        (mediaType === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
        (mediaType === 'image/webp' &&
          bytes.toString('ascii', 0, 4) === 'RIFF' &&
          bytes.toString('ascii', 8, 12) === 'WEBP')
      if (!valid) throw new HttpError(415, 'ATTACHMENT_TYPE', '图片仅支持 PNG、JPEG、WebP 原始内容')
      images.push({ type: 'image-data', origin: 'user', mediaType, data, label: name })
    } else {
      textBytes += bytes.length
      if (bytes.length > InputLimits.textFileBytes || textBytes > InputLimits.totalTextBytes)
        throw new HttpError(413, 'ATTACHMENT_LIMIT', '文本文件单个限 128 KiB，合计限 256 KiB')
      let content: string
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        throw new HttpError(415, 'ATTACHMENT_TYPE', '文件需要 UTF-8 文本编码')
      }
      if (
        mediaType !== 'text/plain' ||
        /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content) ||
        content.startsWith('%PDF-')
      )
        throw new HttpError(
          415,
          'ATTACHMENT_TYPE',
          '暂支持 UTF-8 文本、代码、日志和 PNG/JPEG/WebP 图片',
        )
      texts.push(`附件 ${JSON.stringify(name)}（UTF-8 原文）：\n${content}`)
    }
    summaries.push({ name, kind, mediaType, bytes: bytes.length })
  }
  return { text: texts.join('\n\n'), summaries, images }
}
