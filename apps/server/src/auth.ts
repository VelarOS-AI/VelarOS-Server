import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { HttpError } from './errors.js'
import { ProductStore } from './store.js'

const CookieName = 'velaros_server_session'
const SessionMs = 12 * 60 * 60 * 1_000
const sessionSchema = z.object({ csrf: z.string(), expires_at: z.number() })
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

export class BrowserAuth {
  private readonly loginFailures = new Map<string, { count: number; resetAt: number }>()

  public constructor(
    private readonly store: ProductStore,
    private readonly accessToken: string,
    private readonly secure: boolean,
  ) {}

  private cookie(request: IncomingMessage): string | null {
    return (
      request.headers.cookie
        ?.split(';')
        .map((value) => value.trim())
        .find((value) => value.startsWith(`${CookieName}=`))
        ?.slice(CookieName.length + 1) ?? null
    )
  }

  public session(request: IncomingMessage): { csrf: string } | null {
    const cookie = this.cookie(request)
    if (!cookie) return null
    const value = this.store.db
      .prepare('SELECT csrf,expires_at FROM browser_sessions WHERE digest=?')
      .get(digest(cookie))
    if (!value) return null
    const session = sessionSchema.parse(value)
    if (session.expires_at <= Date.now()) {
      this.store.db.prepare('DELETE FROM browser_sessions WHERE digest=?').run(digest(cookie))
      return null
    }
    return { csrf: session.csrf }
  }

  public require(request: IncomingMessage, mutating = false): { csrf: string } {
    const session = this.session(request)
    if (!session) throw new HttpError(401, 'AUTH_REQUIRED', '请先登录服务器')
    if (mutating && request.headers['x-velaros-csrf'] !== session.csrf)
      throw new HttpError(403, 'CSRF_REJECTED', '请求身份已失效，请刷新页面后重试')
    return session
  }

  public login(
    request: IncomingMessage,
    response: ServerResponse,
    token: string,
  ): { csrf: string } {
    const key = request.socket.remoteAddress ?? 'unknown'
    const now = Date.now()
    for (const [address, failure] of this.loginFailures) {
      if (failure.resetAt <= now) this.loginFailures.delete(address)
    }
    const failure = this.loginFailures.get(key)
    if (failure && failure.count >= 10)
      throw new HttpError(429, 'RATE_LIMIT', '登录尝试过多，请稍后再试')
    if (!timingSafeEqual(Buffer.from(digest(token)), Buffer.from(digest(this.accessToken)))) {
      if (!failure && this.loginFailures.size >= 512)
        throw new HttpError(429, 'RATE_LIMIT', '登录尝试过多，请稍后再试')
      this.loginFailures.set(key, {
        count: (failure?.count ?? 0) + 1,
        resetAt: now + 600_000,
      })
      throw new HttpError(401, 'INVALID_TOKEN', '访问令牌不正确')
    }
    this.loginFailures.delete(key)
    const cookie = randomBytes(32).toString('base64url')
    const csrf = randomBytes(24).toString('base64url')
    this.store.db.prepare('DELETE FROM browser_sessions WHERE expires_at <= ?').run(now)
    this.store.db
      .prepare('INSERT INTO browser_sessions (digest,csrf,expires_at) VALUES (?,?,?)')
      .run(digest(cookie), csrf, now + SessionMs)
    response.setHeader(
      'Set-Cookie',
      `${CookieName}=${cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SessionMs / 1000}${this.secure ? '; Secure' : ''}`,
    )
    return { csrf }
  }

  public logout(request: IncomingMessage, response: ServerResponse): void {
    const cookie = this.cookie(request)
    if (cookie)
      this.store.db.prepare('DELETE FROM browser_sessions WHERE digest=?').run(digest(cookie))
    response.setHeader(
      'Set-Cookie',
      `${CookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${this.secure ? '; Secure' : ''}`,
    )
  }
}
