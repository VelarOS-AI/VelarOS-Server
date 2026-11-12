import { InputLimits } from '../../../packages/contracts/src/index.js'
import type { InputAttachment } from '../../../packages/contracts/src/index.js'

function imageType(file: File): string | null {
  if (file.type.startsWith('image/')) return file.type
  return /\.png$/i.test(file.name)
    ? 'image/png'
    : /\.jpe?g$/i.test(file.name)
      ? 'image/jpeg'
      : /\.webp$/i.test(file.name)
        ? 'image/webp'
        : null
}

export function validateAttachments(files: readonly File[]): void {
  if (files.length > InputLimits.attachments) throw new Error('每次最多添加 4 个附件')
  let total = 0
  let textBytes = 0
  for (const file of files) {
    if (!file.name || file.name.length > 160 || /[\x00-\x1f/\\]/.test(file.name))
      throw new Error('文件名需在 160 字符以内，且不能包含路径')
    const image = imageType(file)
    if (image) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(image))
        throw new Error('图片仅支持 PNG、JPEG、WebP')
      if (file.size > InputLimits.imageBytes) throw new Error(`${file.name} 超过图片上限 2 MiB`)
    } else {
      if (
        /\.(pdf|docx?|xlsx?|pptx?|zip|gz|exe|bin)$/i.test(file.name) ||
        (file.type &&
          !file.type.startsWith('text/') &&
          !/json|xml|yaml|javascript|toml/.test(file.type))
      )
        throw new Error('暂支持 UTF-8 文本、代码、日志和 PNG/JPEG/WebP 图片')
      if (file.size > InputLimits.textFileBytes)
        throw new Error(`${file.name} 超过文本文件上限 128 KiB`)
      textBytes += file.size
      if (textBytes > InputLimits.totalTextBytes) throw new Error('文本文件合计不能超过 256 KiB')
    }
    total += file.size
    if (total > InputLimits.totalBytes) throw new Error('附件合计不能超过 4 MiB')
  }
}

export async function encodeAttachments(files: readonly File[]): Promise<InputAttachment[]> {
  validateAttachments(files)
  return Promise.all(
    files.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const mediaType = imageType(file)
      if (!mediaType) {
        let text: string
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        } catch {
          throw new Error(`${file.name} 需要 UTF-8 文本编码`)
        }
        if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))
          throw new Error(`${file.name} 不是支持的文本文件`)
      }
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
      return {
        name: file.name,
        kind: mediaType ? 'image' : 'text',
        mediaType: mediaType ?? 'text/plain',
        data: btoa(binary),
      }
    }),
  )
}
