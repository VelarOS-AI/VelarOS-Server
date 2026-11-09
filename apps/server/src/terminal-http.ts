import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { HttpError } from './errors.js'
import type { TerminalPort } from './terminal.js'

/** HTTP 只持有订阅；输出缓冲、进程身份及生命周期仍属于 Host。 */
export class TerminalHttp {
  public constructor(
    private readonly terminal: TerminalPort | undefined,
    private readonly connections: Set<ServerResponse>,
    private readonly body: (request: IncomingMessage) => Promise<unknown>,
    private readonly json: (response: ServerResponse, status: number, value: unknown) => void,
  ) {}

  public async handle(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    authenticated: () => boolean,
  ): Promise<void> {
    const terminal = this.terminal
    if (!terminal?.available) throw new HttpError(503, 'TERMINAL_UNAVAILABLE', '终端 Host 尚未装配')
    if (request.method === 'POST' && url.pathname === '/api/terminal/open')
      return this.json(response, 200, await terminal.open())
    const route = /^\/api\/terminal\/([^/]+)\/(input|resize|stop|events)$/.exec(url.pathname)
    if (!route) throw new HttpError(404, 'NOT_FOUND', '终端接口不存在')
    const taskId = z.string().min(1).max(200).parse(decodeURIComponent(route[1]!))
    if (request.method === 'POST') {
      if (route[2] === 'input') {
        const input = z
          .object({ text: z.string().min(1).max(16_384) })
          .strict()
          .parse(await this.body(request))
        await terminal.input(taskId, input.text)
      } else if (route[2] === 'resize') {
        const input = z
          .object({
            cols: z.number().int().min(2).max(500),
            rows: z.number().int().min(2).max(300),
          })
          .strict()
          .parse(await this.body(request))
        await terminal.resize(taskId, input.cols, input.rows)
      } else if (route[2] === 'stop') await terminal.stop(taskId)
      else throw new HttpError(405, 'METHOD_NOT_ALLOWED', '方法不受支持')
      return this.json(response, 200, { ok: true })
    }
    if (request.method !== 'GET' || route[2] !== 'events')
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', '方法不受支持')
    if (this.connections.size >= 16)
      throw new HttpError(429, 'CONNECTION_LIMIT', '事件连接数量已达上限')
    let cursor = z.coerce
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .parse(request.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0)
    // 先验证 task；发送 SSE 响应头后无法再返回可靠的 HTTP 错误。
    let chunk = await terminal.read(taskId, cursor)
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    this.connections.add(response)
    let closed = false
    let lastDelivery = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = (): void => {
      closed = true
      clearTimeout(timer)
      this.connections.delete(response)
    }
    response.once('close', cleanup)
    response.once('error', cleanup)
    const poll = async (): Promise<void> => {
      if (closed) return
      if (!authenticated()) {
        response.end()
        return
      }
      try {
        if (chunk.text || chunk.droppedChars || chunk.status !== 'running' || !lastDelivery) {
          if (
            !response.write(
              `id: ${chunk.cursor}\nevent: output\ndata: ${JSON.stringify(chunk)}\n\n`,
            )
          ) {
            response.destroy()
            return
          }
          lastDelivery = Date.now()
        } else if (Date.now() - lastDelivery > 15_000) {
          if (!response.write(': connected\n\n')) {
            response.destroy()
            return
          }
          lastDelivery = Date.now()
        }
        cursor = chunk.cursor
        if (chunk.status !== 'running') {
          response.end()
          return
        }
        timer = setTimeout(() => {
          void terminal
            .read(taskId, cursor)
            .then((next) => {
              chunk = next
              return poll()
            })
            .catch(() => response.destroy())
        }, 150)
      } catch {
        response.destroy()
      }
    }
    await poll()
  }
}
