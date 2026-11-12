import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createNodeRuntime, type RuntimeModelConfiguration } from '@velaros-ai/velaros/node'
import type { VelarosRuntime, VelarosSession } from '@velaros-ai/velaros'
import type { ModelDriver } from '@velaros-ai/velaros/kernel'
import type { LocalShellHostApi } from '@velaros-ai/velaros/execution'
import type { PendingInteraction } from '../../../packages/contracts/src/index.js'
import type { ExecutionNotice, ExecutionPort } from './execution.js'
import type { ServerExecutionBinding } from './execution-binding.js'
import { HttpError } from './errors.js'
import { ProductStore } from './store.js'
import { ModelSettingsStore } from './model-settings.js'

export interface PlatformExecutionOptions {
  host: LocalShellHostApi
  cwd: string
  stateDirectory: string
  binding: ServerExecutionBinding
  approval: 'ask' | 'allow'
  model?: ModelDriver
}

/** 只消费 SDK 会话与事实；模型循环和标准进程均由同一个 Runtime/Host 提供。 */
export class PlatformExecution implements ExecutionPort {
  private runtime: VelarosRuntime | null = null
  private opening: { identity: string; promise: Promise<VelarosRuntime> } | null = null
  private modelIdentity: string | null = null
  private readonly active = new Map<string, VelarosSession>()
  private closing = false
  private closePromise: Promise<void> | null = null

  public constructor(
    private readonly options: PlatformExecutionOptions,
    private readonly store: ProductStore,
    private readonly settings: ModelSettingsStore,
  ) {}

  public get available(): boolean {
    const model = this.settings.read()
    return !this.closing && (Boolean(this.options.model) || Boolean(model.model && model.apiKey))
  }

  public get unavailableReason(): string | null {
    return this.available
      ? null
      : this.closing
        ? '执行环境正在收束'
        : '请先在输入框的模型配置中选择模型并填写 API 密钥'
  }

  private configuration(): RuntimeModelConfiguration | ModelDriver {
    if (this.options.model) return this.options.model
    const value = this.settings.read()
    if (!value.model || !value.apiKey)
      throw new HttpError(503, 'MODEL_NOT_CONFIGURED', '模型连接尚未配置完整')
    // 服务商身份由共享目录校验，协议继续交给底座已有适配器。
    return {
      provider: value.provider,
      baseURL: value.baseUrl,
      apiKey: value.apiKey,
      model: value.model,
    }
  }

  private async getRuntime(): Promise<VelarosRuntime> {
    if (this.closing) throw new HttpError(503, 'CLOSING', '执行环境正在收束')
    const model = this.configuration()
    const identity = this.options.model
      ? 'injected-driver'
      : createHash('sha256').update(JSON.stringify(model)).digest('hex')
    if (this.opening?.identity === identity) return this.opening.promise
    if (!this.opening && this.runtime && this.modelIdentity === identity) return this.runtime
    if (this.opening || this.active.size)
      throw new HttpError(409, 'MODEL_BUSY', '模型设置已改变，请等待现有运行收束后再开始')
    const promise = (async () => {
      if (this.runtime) {
        await this.runtime.close()
        this.runtime = null
      }
      const runtime = await createNodeRuntime({
        cwd: this.options.cwd,
        stateDirectory: this.options.stateDirectory,
        binding: this.options.binding,
        host: this.options.host,
        model,
        modules: [],
        instructions:
          '你是本机服务器运维助手。先核对状态和相关日志，再修改配置；服务变更后检查实际健康状态。没有验证的结果保留未知。不要将凭据写入回复。需要新增系统权限时说明具体需求，由操作者配置。',
        execution: {
          authorize: async (request, signal) => {
            if (request.mode === 'observe' || this.options.approval === 'allow') return
            const session = request.sessionId ? this.active.get(request.sessionId) : null
            if (!session)
              throw new HttpError(403, 'EXECUTION_IDENTITY', '未绑定当前产品运行，拒绝程序执行')
            const result = await session.request(
              'confirmation',
              `执行 Node 程序（${request.source.length} 字符）？`,
              signal,
              {
                source: request.source,
                executionId: request.executionId ?? null,
              },
            )
            if (result !== true)
              throw new HttpError(403, 'EXECUTION_DENIED', '操作者没有批准本次执行')
          },
        },
      })
      this.runtime = runtime
      this.modelIdentity = identity
      return runtime
    })().finally(() => {
      this.opening = null
    })
    this.opening = { identity, promise }
    return promise
  }

  private async validateBinding(sessionId: string): Promise<void> {
    this.store.getSession(sessionId)
    const directory = join(this.options.stateDirectory, 'product-bindings')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, `${sessionId}.json`)
    const current = JSON.stringify({
      ...this.options.binding,
      cwd: await realpath(this.options.cwd),
    })
    try {
      if ((await readFile(path, 'utf8')).trim() !== current)
        throw new HttpError(
          409,
          'EXECUTION_SCOPE_CHANGED',
          '会话执行身份或授权根已改变，请创建经过重新授权的新会话',
        )
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      await writeFile(path, `${current}\n`, { flag: 'wx', mode: 0o600 })
    }
  }

  public async submit(
    input: { sessionId: string; requestId: string; text: string },
    observe: (notice: ExecutionNotice) => void,
  ): Promise<void> {
    await this.validateBinding(input.sessionId)
    const runtime = await this.getRuntime()
    const session = await runtime.openSession(input.sessionId)
    this.active.set(input.sessionId, session)
    let terminalState = false
    try {
      for await (const event of session.submit({
        inputId: input.requestId,
        text: input.text,
        task: 'new',
      })) {
        if (event.type === 'input') {
          observe({
            type: 'accepted',
            inputId: event.inputId ?? input.requestId,
            runId: event.runId,
          })
          observe({
            type: 'fact',
            reference: {
              sessionId: event.ref.sessionId,
              runId: event.runId,
              recordId: event.ref.id,
            },
          })
        } else if (event.type === 'accepted') {
          observe({ type: 'text', messageId: event.ref.id, text: event.text })
          observe({
            type: 'fact',
            reference: {
              sessionId: event.ref.sessionId,
              runId: event.runId,
              recordId: event.ref.id,
            },
          })
        } else if (event.type === 'interaction') {
          observe({
            type: 'interaction',
            request: {
              id: event.request.id,
              runId: event.runId,
              message: event.request.message,
              kind: event.request.kind === 'input' ? 'question' : 'confirm',
            },
          })
        } else if (event.type === 'answer') observe({ type: 'interaction', request: null })
        else if (event.type === 'state') {
          const status =
            event.status === 'thinking' || event.status === 'executing'
              ? 'running'
              : event.status === 'context_blocked'
                ? 'failed'
                : event.status
          if (['completed', 'failed', 'cancelled'].includes(status)) terminalState = true
          observe({ type: 'state', status })
        } else if (event.type === 'error' || event.type === 'stalled')
          observe({ type: 'text', messageId: `${event.runId}:notice`, text: event.message })
        // text/program 是预览，不冒充被接纳正文或进程执行回执。
      }
      if (!terminalState) observe({ type: 'state', status: 'unknown' })
    } finally {
      this.active.delete(input.sessionId)
    }
  }

  public async cancel(sessionId: string, runId: string): Promise<void> {
    const session = this.active.get(sessionId)
    if (!session || (await session.inspect()).id !== runId)
      throw new HttpError(409, 'STALE_RUN', '运行已结束或身份不匹配')
    session.cancel()
  }

  public async answer(
    sessionId: string,
    request: PendingInteraction,
    value: string | boolean,
  ): Promise<void> {
    const session = this.active.get(sessionId)
    if (!session) throw new HttpError(409, 'STALE_INTERACTION', '运行已不再等待此回答')
    await session.answer({ id: request.id, runId: request.runId, value })
  }

  public async review(sessionId: string, requestId: string): Promise<string | null> {
    const session = this.active.get(sessionId)
    if (!session) throw new HttpError(409, 'STALE_INTERACTION', '运行已结束')
    const request = (await session.inspect()).pending.find((item) => item.id === requestId)
    if (!request) throw new HttpError(409, 'STALE_INTERACTION', '交互已失效')
    return request.detail &&
      typeof request.detail === 'object' &&
      'source' in request.detail &&
      typeof request.detail.source === 'string'
      ? request.detail.source
      : null
  }

  public async close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closing = true
    this.closePromise = (async () => {
      if (this.opening) {
        try {
          await this.opening.promise
        } catch (error) {
          // 旧 Runtime 关闭失败时仍保留 owner；未交付 Runtime 的初始化错误由提交路径接收。
          if (this.runtime) throw error
        }
      }
      if (this.runtime) await this.runtime.close()
    })()
    return this.closePromise
  }
}
