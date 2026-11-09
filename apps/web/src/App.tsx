import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { AppShell } from '@velaros-ai/ui/product/layout/AppShell'
import { Button } from '@velaros-ai/ui/primitives/buttons/Button'
import { Input } from '@velaros-ai/ui/primitives/forms/Input'
import type { ServerInfo, SessionView } from '../../../packages/contracts/src/index.js'
import { request } from './api.js'
import { Conversation } from './Conversation.js'
import { Files } from './Files.js'
import { Settings } from './Settings.js'
const Terminal = lazy(() => import('./Terminal.js'))

type Page = 'chat' | 'files' | 'terminal' | 'settings'
const pages: { id: Page; label: string; icon: string }[] = [
  { id: 'chat', label: '对话', icon: '◌' },
  { id: 'files', label: '文件', icon: '▤' },
  { id: 'terminal', label: '终端', icon: '›_' },
  { id: 'settings', label: '设置', icon: '⚙' },
]

export function App(): React.ReactElement {
  const [csrf, setCsrf] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const [token, setToken] = useState('')
  const [info, setInfo] = useState<ServerInfo | null>(null)
  const [sessions, setSessions] = useState<SessionView[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [page, setPage] = useState<Page>('chat')
  const [error, setError] = useState<string | null>(null)
  const pendingInput = useRef<{ id: string; text: string; sessionId: string } | null>(null)
  const cursor = useRef(0)
  const refresh = useCallback(async (): Promise<void> => {
    if (!csrf) return
    const [nextInfo, nextSessions] = await Promise.all([
      request<ServerInfo>('/api/info', csrf),
      request<SessionView[]>('/api/sessions', csrf),
    ])
    setInfo(nextInfo)
    setSessions(nextSessions)
    setSelectedId((current) =>
      current && nextSessions.some((item) => item.id === current)
        ? current
        : (nextSessions[0]?.id ?? null),
    )
  }, [csrf])
  useEffect(() => {
    void request<{ csrf: string | null }>('/api/auth', '')
      .then((value) => setCsrf(value.csrf))
      .catch((error: Error) => setError(error.message))
      .finally(() => setChecking(false))
  }, [])
  useEffect(() => {
    if (!csrf) return
    let disposed = false
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    void refresh().catch((error: Error) => {
      if (!disposed) setError(error.message)
    })
    const events = new EventSource(`/api/events?after=${cursor.current}`)
    const schedule = (event: MessageEvent): void => {
      cursor.current = Number(event.lastEventId) || 0
      if (refreshTimer) return
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        void refresh().catch((error: Error) => {
          if (!disposed) setError(error.message)
        })
      }, 100)
    }
    events.addEventListener('change', schedule)
    events.addEventListener('reset', schedule)
    return () => {
      disposed = true
      events.close()
      if (refreshTimer) clearTimeout(refreshTimer)
    }
  }, [csrf, refresh])

  const selected = sessions.find((session) => session.id === selectedId) ?? null
  if (checking) return <div className="login-page">正在连接服务器…</div>
  if (!csrf)
    return (
      <div className="login-page">
        <form
          className="login-card"
          onSubmit={(event) => {
            event.preventDefault()
            setError(null)
            void request<{ csrf: string }>('/api/auth/login', '', 'POST', { token })
              .then((value) => {
                setToken('')
                setCsrf(value.csrf)
              })
              .catch((error: Error) => setError(error.message))
          }}
        >
          <div className="brand-mark">V</div>
          <h1>VelarOS Server</h1>
          <p className="muted">连接你的服务器，开始管理。</p>
          <label>
            访问令牌
            <Input
              type="password"
              autoComplete="current-password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
            />
          </label>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <Button type="submit">登录服务器</Button>
        </form>
      </div>
    )

  const createSession = async (): Promise<void> => {
    const session = await request<SessionView>('/api/sessions', csrf, 'POST', {
      title: '服务器维护',
    })
    setSessions((current) => [session, ...current])
    setSelectedId(session.id)
    setPage('chat')
  }
  const send = async (text: string): Promise<void> => {
    if (!selected || !text.trim()) return
    const previous = pendingInput.current
    const input =
      previous && previous.text === text && previous.sessionId === selected.id
        ? previous
        : { id: crypto.randomUUID(), text, sessionId: selected.id }
    pendingInput.current = input
    try {
      await request(`/api/sessions/${selected.id}/inputs`, csrf, 'POST', {
        requestId: input.id,
        text,
      })
      if (pendingInput.current === input) pendingInput.current = null
      await refresh()
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '提交失败'
      setError(message)
      throw failure
    }
  }
  const sidebar = (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark small">V</span>
        <div>
          <strong>VelarOS</strong>
          <span>SERVER</span>
        </div>
      </div>
      <nav aria-label="主导航">
        {pages.map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            size="block"
            active={page === item.id}
            onClick={() => setPage(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </Button>
        ))}
      </nav>
      <div className="sidebar-heading">
        <span>维护会话</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void createSession().catch((error: Error) => setError(error.message))}
        >
          ＋ 新建
        </Button>
      </div>
      <div className="session-list">
        {sessions.map((session) => (
          <Button
            key={session.id}
            variant="ghost"
            size="block"
            active={selectedId === session.id && page === 'chat'}
            onClick={() => {
              setSelectedId(session.id)
              setPage('chat')
            }}
          >
            {session.title}
          </Button>
        ))}
      </div>
      <div className="sidebar-bottom">
        <span className="muted">本机 · {info?.platform ?? '连接中'}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void request('/api/auth/logout', csrf, 'POST', {}).then(() => {
              setCsrf(null)
              setSessions([])
              setSelectedId(null)
              cursor.current = 0
            })
          }
        >
          退出
        </Button>
      </div>
    </aside>
  )
  const header = (
    <header className="topbar">
      <div>
        <strong>{info?.hostname ?? '服务器'}</strong>
        <span className="status-dot" />
        在线
      </div>
      {info && (
        <span className="muted">
          内存 {Math.round((1 - info.memory.availableBytes / info.memory.totalBytes) * 100)}% · 运行{' '}
          {Math.floor(info.uptimeSeconds / 3600)}h
        </span>
      )}
    </header>
  )
  return (
    <AppShell embedded className="server-shell" sidebar={sidebar} header={header}>
      {error && (
        <div role="alert" className="notice error">
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={() => setError(null)}>
            关闭
          </Button>
        </div>
      )}
      {page === 'chat' && (
        <div className="chat-page">
          {info && !info.execution.available && (
            <div className="notice">Agent 暂不可用：{info.execution.reason}</div>
          )}
          {selected ? (
            <Conversation
              key={selected.id}
              session={selected}
              available={info?.execution.available ?? false}
              onSend={send}
              onStop={async () => {
                await request(`/api/sessions/${selected.id}/cancel`, csrf, 'POST', {
                  runId: selected.runId,
                })
                await refresh()
              }}
              onReview={async (requestId) => {
                const value = await request<{ source: string | null }>(
                  `/api/sessions/${selected.id}/interaction?requestId=${encodeURIComponent(requestId)}`,
                  csrf,
                )
                return value.source
              }}
              onAnswer={async (requestId, runId, value) => {
                await request(`/api/sessions/${selected.id}/answers`, csrf, 'POST', {
                  requestId,
                  runId,
                  value,
                })
                await refresh()
              }}
            />
          ) : (
            <div className="empty-state">
              <h1>开始一次服务器维护</h1>
              <p>创建会话后，可以检查服务、读取日志和处理配置。</p>
              <Button
                onClick={() =>
                  void createSession().catch((error: Error) => setError(error.message))
                }
              >
                新建维护会话
              </Button>
            </div>
          )}
        </div>
      )}
      {page === 'files' && info && <Files csrf={csrf} roots={info.roots} onError={setError} />}
      {page === 'terminal' && info && (
        <Suspense fallback={<div className="empty-state">正在加载终端…</div>}>
          <Terminal
            csrf={csrf}
            available={info.terminal.available}
            reason={info.terminal.reason}
            onError={setError}
          />
        </Suspense>
      )}
      {page === 'settings' && info && (
        <Settings model={info.model} csrf={csrf} onSaved={refresh} onError={setError} />
      )}
    </AppShell>
  )
}
