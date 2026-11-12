import {
  ChatContextUsageGauge,
  formatChatContextUsagePercent,
  resolveChatContextUsageTone,
} from '@velaros-ai/ui/conversation/status'
import type { ContextUsage } from '../../../packages/contracts/src/index.js'

/** 分子只取供应商本次计数，分母只取执行时装配的同一输入窗口。 */
export function ContextUsageIndicator({
  usage,
}: {
  usage: ContextUsage | undefined
}): React.ReactNode {
  if (!usage) return null
  const percent = (usage.inputTokens / usage.inputWindow) * 100
  const label = formatChatContextUsagePercent(percent)
  const detail = `上下文占用 ${label} · ${usage.inputTokens.toLocaleString('zh-CN')} / ${usage.inputWindow.toLocaleString('zh-CN')} tokens`
  return (
    <ChatContextUsageGauge
      tone={resolveChatContextUsageTone(percent)}
      ringPercent={percent}
      label={label}
      ariaLabel={detail}
      tooltip={{ title: detail, meta: `${usage.model} · 上次请求的供应商计数 / 本实例输入窗口` }}
    />
  )
}
