import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { freemem, hostname, platform, totalmem, uptime } from 'node:os'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import type { ChangeNotice, ServerInfo } from '../../../packages/contracts/src/index.js'
import { BrowserAuth } from './auth.js'
import { ChangeStream } from './change-stream.js'
import { HttpError } from './errors.js'
import type { ExecutionPort } from './execution.js'
import { UnavailableExecution } from './execution.js'
import { ServerFiles } from './files.js'
import { RunRequests } from './runs.js'
import { ProductStore } from './store.js'
import { ModelSettingsStore, modelSettingsSchema } from './model-settings.js'
import type { TerminalPort } from './terminal.js'
import { TerminalHttp } from './terminal-http.js'

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
}

async function body(request: IncomingMessage): Promise<unknown> {
  if (!request.headers['content-type']?.startsWith('application/json'))
    throw new HttpError(415, 'JSON_REQUIRED', '请求需要 JSON 内容')
  let bytes = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > 192 * 1024) throw new HttpError(413, 'BODY_LIMIT', '请求内容过大')
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'JSON 内容无效')
  }
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

export interface ServerApplicationOptions {
  store: ProductStore
  files: ServerFiles
  accessToken: string
  publicOrigin: string
  webDirectory: string
  execution?: ExecutionPort
  terminal?: TerminalPort
}

export interface ServerApplication {
  server: Server
  close(): Promise<void>
}

/** 只装产品边界；执行适配器在独立的 Platform 组合根中接入。 */
export function createServerApplication(options: ServerApplicationOptions): ServerApplication {
  const changes = new ChangeStream()
  const execution: ExecutionPort = options.execution ?? new UnavailableExecution()
  const runs = new RunRequests(options.store, changes, execution)
  const origin = new URL(options.publicOrigin).origin
  const auth = new BrowserAuth(options.store, options.accessToken, origin.startsWith('https:'))
  const eventConnections = new Set<ServerResponse>()
  const settings = new ModelSettingsStore(options.store)
  const terminal = new TerminalHttp(options.terminal, eventConnections, body, json)

  const serve = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'same-origin')
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    )
    const url = new URL(request.url ?? '/', origin)
    const method = request.method ?? 'GET'
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method)
    if (request.headers.origin && request.headers.origin !== origin)
      throw new HttpError(403, 'ORIGIN_REJECTED', '请求来源不受信任')
    // 不信任代理提供的转发头；生产通过明确 publicOrigin 绑定浏览器来源。
    if (method === 'GET' && url.pathname === '/api/health')
      return json(response, 200, {
        status: 'ok',
        version: '0.1.0',
        executionAvailable: execution.available,
      })
    if (method === 'GET' && url.pathname === '/api/auth')
      return json(response, 200, {
        authenticated: Boolean(auth.session(request)),
        csrf: auth.session(request)?.csrf ?? null,
      })
    if (method === 'POST' && url.pathname === '/api/auth/login') {
      const input = z
        .object({ token: z.string().min(1).max(4_096) })
        .strict()
        .parse(await body(request))
      return json(response, 200, auth.login(request, response, input.token))
    }
    if (url.pathname.startsWith('/api/')) auth.require(request, mutating)
    if (method === 'POST' && url.pathname === '/api/auth/logout') {
      auth.logout(request, response)
      return json(response, 200, { ok: true })
    }
    if (method === 'GET' && url.pathname === '/api/info') {
      const value: ServerInfo = {
        hostname: hostname(),
        platform: platform(),
        uptimeSeconds: Math.floor(uptime()),
        memory: { totalBytes: totalmem(), availableBytes: freemem() },
        roots: [...options.files.roots],
        execution: { available: execution.available, reason: execution.unavailableReason },
        terminal: {
          available: options.terminal?.available ?? false,
          reason: options.terminal?.available ? null : '终端 Host 尚未装配',
        },
        model: settings.view(),
      }
      return json(response, 200, value)
    }
    if (method === 'GET' && url.pathname === '/api/sessions')
      return json(response, 200, options.store.listSessions())
    if (method === 'POST' && url.pathname === '/api/sessions') {
      const input = z
        .object({ title: z.string().trim().min(1).max(100) })
        .strict()
        .parse(await body(request))
      const session = options.store.createSession(input.title)
      changes.publish(options.store.saveSession(session))
      return json(response, 201, session)
    }
    const sessionRoute = /^\/api\/sessions\/([a-f0-9-]{36})(?:\/(inputs|cancel|answers))?$/.exec(
      url.pathname,
    )
    if (sessionRoute) {
      const id = sessionRoute[1]!
      if (method === 'GET' && !sessionRoute[2])
        return json(response, 200, options.store.getSession(id))
      if (method === 'POST' && sessionRoute[2] === 'inputs') {
        const input = z
          .object({
            requestId: z.uuid(),
            text: z
              .string()
              .min(1)
              .max(32_000)
              .refine((value) => value.trim().length > 0),
          })
          .strict()
          .parse(await body(request))
        return json(response, 202, runs.submit(id, input.requestId, input.text))
      }
      if (method === 'POST' && sessionRoute[2] === 'cancel') {
        const input = z
          .object({ runId: z.string().min(1) })
          .strict()
          .parse(await body(request))
        await runs.cancel(id, input.runId)
        return json(response, 202, { cancellationRequested: true })
      }
      if (method === 'POST' && sessionRoute[2] === 'answers') {
        const input = z
          .object({
            runId: z.string().min(1),
            requestId: z.string().min(1),
            value: z.union([z.string().max(8_000), z.boolean()]),
          })
          .strict()
          .parse(await body(request))
        await runs.answer(id, input.runId, input.requestId, input.value)
        return json(response, 202, { answerSubmitted: true })
      }
    }
    const reviewRoute = /^\/api\/sessions\/([a-f0-9-]{36})\/interaction$/.exec(url.pathname)
    if (method === 'GET' && reviewRoute) {
      const session = options.store.getSession(reviewRoute[1]!)
      const requestId = url.searchParams.get('requestId')
      if (!requestId || session.interaction?.id !== requestId)
        throw new HttpError(409, 'STALE_INTERACTION', '交互已失效')
      return json(response, 200, {
        source: (await execution.review?.(session.id, requestId)) ?? null,
      })
    }
    if (url.pathname.startsWith('/api/terminal')) {
      await terminal.handle(request, response, url, () => Boolean(auth.session(request)))
      return
    }
    if (method === 'GET' && url.pathname === '/api/files')
      return json(
        response,
        200,
        await options.files.list(url.searchParams.get('path') ?? options.files.roots[0] ?? ''),
      )
    if (method === 'GET' && url.pathname === '/api/files/text')
      return json(response, 200, await options.files.read(url.searchParams.get('path') ?? ''))
    if (method === 'PUT' && url.pathname === '/api/files/text') {
      const input = z
        .object({
          path: z.string(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          content: z.string(),
        })
        .strict()
        .parse(await body(request))
      return json(response, 200, await options.files.write(input.path, input.sha256, input.content))
    }
    if (method === 'PUT' && url.pathname === '/api/settings/model') {
      return json(response, 200, settings.save(modelSettingsSchema.parse(await body(request))))
    }
    if (method === 'GET' && url.pathname === '/api/events') {
      if (eventConnections.size >= 16)
        throw new HttpError(429, 'CONNECTION_LIMIT', '事件连接数量已达上限')
      const cursor = z.coerce
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER)
        .parse(request.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0)
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      eventConnections.add(response)
      const send = (notice: ChangeNotice): void => {
        if (!auth.session(request)) {
          response.end()
          return
        }
        if (
          !response.write(
            `id: ${notice.sequence}\nevent: change\ndata: ${JSON.stringify(notice)}\n\n`,
          )
        )
          response.destroy()
      }
      const unsubscribe = changes.subscribe(send)
      const cleanup = (): void => {
        unsubscribe()
        eventConnections.delete(response)
      }
      response.once('close', cleanup)
      response.once('error', cleanup)
      const history = options.store.changesAfter(cursor)
      if (history.reset) response.write(`id: ${history.current}\nevent: reset\ndata: {}\n\n`)
      else for (const notice of history.notices) send(notice)
      response.write(': connected\n\n')
      return
    }
    if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'NOT_FOUND', '接口不存在')
    if (!['GET', 'HEAD'].includes(method))
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', '方法不受支持')
    const webRoot = resolve(options.webDirectory)
    const candidate = resolve(webRoot, `.${decodeURIComponent(url.pathname)}`)
    const part = relative(webRoot, candidate)
    if (isAbsolute(part) || part === '..' || part.startsWith(`..${sep}`))
      throw new HttpError(403, 'PATH_DENIED', '资源路径无效')
    let file = candidate
    try {
      if (!(await stat(file)).isFile()) file = join(webRoot, 'index.html')
    } catch {
      file = extname(candidate) ? candidate : join(webRoot, 'index.html')
    }
    let data: Buffer
    try {
      data = await readFile(file)
    } catch {
      throw new HttpError(404, 'WEB_NOT_BUILT', '网页尚未构建，请执行 bun run build:web')
    }
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
    })
    response.end(method === 'HEAD' ? undefined : data)
  }

  const server = createServer((request, response) => {
    void serve(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy()
        return
      }
      if (error instanceof z.ZodError)
        return json(response, 400, {
          error: { code: 'VALIDATION', message: '请求参数不符合接口要求' },
        })
      if (error instanceof HttpError)
        return json(response, error.status, { error: { code: error.code, message: error.message } })
      console.error('HTTP request failed', error instanceof Error ? error.name : 'unknown')
      return json(response, 500, {
        error: { code: 'INTERNAL', message: '服务操作失败，请查看服务器日志' },
      })
    })
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 15_000
  return {
    server,
    close: async () => {
      const closed = new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      )
      for (const response of eventConnections) response.end()
      await runs.close()
      server.closeIdleConnections()
      await closed
    },
  }
}
