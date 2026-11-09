import { createHash, randomUUID } from 'node:crypto'
import type { InputReceipt } from '../../../packages/contracts/src/index.js'
import type { ExecutionNotice, ExecutionPort } from './execution.js'
import { ChangeStream } from './change-stream.js'
import { HttpError } from './errors.js'
import { ProductStore } from './store.js'

/** 仅桥接产品请求与执行事实，不负责模型循环或进程生命周期。 */
export class RunRequests {
  private readonly pending = new Set<Promise<void>>()
  private readonly activeRequests = new Map<string, string>()
  private readonly answering = new Set<string>()
  private closing = false

  public constructor(
    private readonly store: ProductStore,
    private readonly changes: ChangeStream,
    private readonly execution: ExecutionPort,
  ) {}

  public submit(sessionId: string, requestId: string, text: string): InputReceipt {
    if (this.closing) throw new HttpError(503, 'CLOSING', '服务正在收束运行')
    if (!this.execution.available)
      throw new HttpError(
        503,
        'EXECUTION_UNAVAILABLE',
        this.execution.unavailableReason ?? '执行不可用',
      )
    const fingerprint = createHash('sha256').update(text).digest('hex')
    const receipt = this.store.admit(requestId, sessionId, fingerprint)
    if (receipt.replayed) return receipt
    const session = this.store.getSession(sessionId)
    this.activeRequests.set(sessionId, requestId)
    session.status = 'received'
    session.runId = null
    session.inputId = null
    session.interaction = null
    session.messages.push({ id: randomUUID(), role: 'user', text, truncated: false })
    this.changes.publish(this.store.saveSession(session))

    const delivery = Promise.resolve()
      .then(() =>
        this.execution.submit({ sessionId, requestId, text }, (notice) =>
          this.observe(sessionId, requestId, notice),
        ),
      )
      .catch((error: unknown) => {
        // 未取得真实拒绝/close 证据时只记录 unknown，禁止自动重放。
        if (this.activeRequests.get(sessionId) !== requestId) return
        const current = this.store.getSession(sessionId)
        if (!['completed', 'failed', 'cancelled'].includes(current.status)) {
          current.status = 'unknown'
          current.interaction = null
          current.messages.push({
            id: randomUUID(),
            role: 'system',
            text: '执行连接未能确认结果；请核对原运行，系统不会自动重试。',
            truncated: false,
          })
          this.store.updateRequest(requestId, current)
          this.changes.publish(this.store.saveSession(current))
        }
        console.error(
          'Execution submission could not be reconciled',
          error instanceof Error ? error.name : 'unknown',
        )
      })
      .finally(() => this.pending.delete(delivery))
    this.pending.add(delivery)
    return receipt
  }

  private observe(sessionId: string, requestId: string, notice: ExecutionNotice): void {
    if (this.activeRequests.get(sessionId) !== requestId) return
    const session = this.store.getSession(sessionId)
    if (notice.type === 'accepted') {
      session.inputId = notice.inputId
      session.runId = notice.runId
      session.status = 'accepted'
    } else if (notice.type === 'text') {
      const message = session.messages.find((item) => item.id === notice.messageId)
      if (message) message.text += notice.text
      else
        session.messages.push({
          id: notice.messageId,
          role: 'assistant',
          text: notice.text,
          truncated: false,
        })
    } else if (notice.type === 'state') {
      session.status = notice.status
      if (['completed', 'failed', 'cancelled', 'unknown'].includes(notice.status))
        session.interaction = null
    } else if (notice.type === 'interaction') {
      session.interaction = notice.request
      if (notice.request) session.status = 'waiting'
    } else session.facts.push(notice.reference)
    this.store.updateRequest(requestId, session)
    this.changes.publish(this.store.saveSession(session))
  }

  public async cancel(sessionId: string, runId: string): Promise<void> {
    const session = this.store.getSession(sessionId)
    if (!session.runId || session.runId !== runId)
      throw new HttpError(409, 'STALE_RUN', '运行尚未被接纳或身份已失效')
    await this.execution.cancel(sessionId, session.runId)
    // 请求取消不是进程已关闭的证据，等待执行端的真实状态事件。
  }

  public async answer(
    sessionId: string,
    runId: string,
    requestId: string,
    value: string | boolean,
  ): Promise<void> {
    const session = this.store.getSession(sessionId)
    const request = session.interaction
    if (!request || request.id !== requestId || request.runId !== runId || session.runId !== runId)
      throw new HttpError(409, 'STALE_INTERACTION', '交互已失效或不属于当前运行')
    if (this.answering.has(sessionId))
      throw new HttpError(409, 'ANSWER_PENDING', '本次回答正在提交，请等待结果')
    this.answering.add(sessionId)
    try {
      await this.execution.answer(sessionId, request, value)
      // 执行端可能已发布后续事实；只清除仍然属于本次回答的展示提示。
      const current = this.store.getSession(sessionId)
      if (current.interaction?.id === requestId && current.interaction.runId === runId) {
        current.interaction = null
        this.changes.publish(this.store.saveSession(current))
      }
    } finally {
      this.answering.delete(sessionId)
    }
  }

  public async close(): Promise<void> {
    this.closing = true
    await this.execution.close()
    await Promise.allSettled(this.pending)
  }
}
