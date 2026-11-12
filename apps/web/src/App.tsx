import { useCallback, useEffect, useRef, useState } from 'react'
import { AppShell } from '@velaros-ai/ui/product/layout/AppShell'
import { Button } from '@velaros-ai/ui/primitives/buttons/Button'
import { IconButton } from '@velaros-ai/ui/primitives/buttons/IconButton'
import { Input } from '@velaros-ai/ui/primitives/forms/Input'
import type { ServerInfo, SessionView } from '../../../packages/contracts/src/index.js'
import { request } from './api.js'
import { Conversation } from './Conversation.js'
import { ModelDialog } from './ModelDialog.js'

export function App(): React.ReactElement {
  const [csrf, setCsrf] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const [token, setToken] = useState('')
  const [info, setInfo] = useState<ServerInfo | null>(null)
  const [sessions, setSessions] = useState<SessionView[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 640)
  const [error, setError] = useState<string | null>(null)
  const [authenticating, setAuthenticating] = useState(false)
  const authPending = useRef(false)
  const draftScope = useRef(0)
  const submission = useRef<object | null>(null)
  // 同步身份只由 changeAuthentication 更新；csrf 是供界面渲染的投影。
  const authentication = useRef<string | null>(null)
  const refreshing = useRef<AbortController | null>(null)
  const pendingInput = useRef<{ id: string; text: string; sessionId: string } | null>(null)
  const cursor = useRef(0)
  const cancelRefresh = useCallback((): void => {
    refreshing.current?.abort()
    refreshing.current = null
  }, [])
  const changeAuthentication = useCallback(
    (value: string | null): void => {
      cancelRefresh()
      authentication.current = value
      setCsrf(value)
      setInfo(null)
      setSessions([])
      setSelectedId(null)
      setDraft('')
      draftScope.current += 1
      submission.current = null
      setSubmitting(false)
      cursor.current = 0
      pendingInput.current = null
    },
    [cancelRefresh],
  )
  const refresh = useCallback(async (): Promise<void> => {
    if (!csrf || authentication.current !== csrf) return
    cancelRefresh()
    const controller = new AbortController()
    refreshing.current = controller
    try {
      const [nextInfo, nextSessions] = await Promise.all([
        request<ServerInfo>('/api/info', csrf, 'GET', undefined, controller.signal),
        request<SessionView[]>('/api/sessions', csrf, 'GET', undefined, controller.signal),
      ])
      if (refreshing.current !== controller || authentication.current !== csrf) return
      setInfo(nextInfo)
      setSessions(nextSessions)
      setSelectedId((current) =>
        current && nextSessions.some((item) => item.id === current) ? current : null,
      )
    } catch (failure) {
      if (refreshing.current !== controller || authentication.current !== csrf) return
      const message = failure instanceof Error ? failure.message : '无法读取会话'
      // 刷新只负责读取投影，失败不能反转已经受理的输入、回答或设置变更。
      setError(`页面刷新失败：${message}`)
    } finally {
      controller.abort()
      if (refreshing.current === controller) refreshing.current = null
    }
  }, [csrf, cancelRefresh])
  useEffect(() => {
    const controller = new AbortController()
    void request<{ csrf: string | null }>('/api/auth', '', 'GET', undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) changeAuthentication(value.csrf)
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setError(error.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false)
      })
    return () => controller.abort()
  }, [changeAuthentication])
  useEffect(() => {
    if (!csrf) return
    let disposed = false
    let connected = false
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const isCurrent = (): boolean => !disposed && authentication.current === csrf
    void refresh()
    const events = new EventSource(`/api/events?after=${cursor.current}`)
    events.onopen = () => {
      if (!isCurrent()) return
      if (connected) void refresh()
      connected = true
    }
    const schedule = (event: MessageEvent): void => {
      if (!isCurrent()) return
      cursor.current = Number(event.lastEventId) || 0
      if (refreshTimer) return
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        void refresh()
      }, 100)
    }
    events.addEventListener('change', schedule)
    events.addEventListener('reset', schedule)
    return () => {
      disposed = true
      if (authentication.current === csrf) cancelRefresh()
      events.close()
      if (refreshTimer) clearTimeout(refreshTimer)
    }
  }, [csrf, refresh, cancelRefresh])
  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 640px)')
    const resize = (): void => setSidebarOpen(!mobile.matches)
    mobile.addEventListener('change', resize)
    return () => mobile.removeEventListener('change', resize)
  }, [])

  const selected = sessions.find((session) => session.id === selectedId) ?? null
  if (checking) return <div className="login-page">正在连接服务器…</div>
  if (!csrf)
    return (
      <div className="login-page">
        <form
          className="login-card"
          onSubmit={(event) => {
            event.preventDefault()
            if (authPending.current) return
            authPending.current = true
            setAuthenticating(true)
            setError(null)
            void request<{ csrf: string }>('/api/auth/login', '', 'POST', { token })
              .then((value) => {
                setToken('')
                changeAuthentication(value.csrf)
              })
              .catch((error: Error) => setError(error.message))
              .finally(() => {
                authPending.current = false
                setAuthenticating(false)
              })
          }}
        >
          <div className="brand-mark">V</div>
          <h1>VelarOS Server</h1>
          <label>
            访问令牌
            <Input
              type="password"
              disabled={authenticating}
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
          <Button type="submit" disabled={authenticating}>
            登录
          </Button>
        </form>
      </div>
    )

  const startNewChat = (): void => {
    setSelectedId(null)
    setDraft('')
    setError(null)
    draftScope.current += 1
    if (window.innerWidth <= 640) setSidebarOpen(false)
  }
  const send = async (text: string): Promise<void> => {
    if (!text.trim() || authentication.current !== csrf || submission.current) return
    const owner = {}
    const scope = draftScope.current
    submission.current = owner
    setSubmitting(true)
    setError(null)
    try {
      let session = selected
      if (!session) {
        session = await request<SessionView>('/api/sessions', csrf, 'POST', {
          title: text.trim().split('\n')[0]!.slice(0, 40),
        })
        if (authentication.current !== csrf) return
        const created = session
        setSessions((current) => [created, ...current.filter((item) => item.id !== created.id)])
        if (draftScope.current === scope) setSelectedId(created.id)
      }
      const previous = pendingInput.current
      const input =
        previous && previous.text === text && previous.sessionId === session.id
          ? previous
          : { id: crypto.randomUUID(), text, sessionId: session.id }
      pendingInput.current = input
      await request(`/api/sessions/${session.id}/inputs`, csrf, 'POST', {
        requestId: input.id,
        text,
      })
      if (pendingInput.current === input) pendingInput.current = null
      if (authentication.current === csrf && draftScope.current === scope)
        setDraft((current) => (current === text ? '' : current))
      // POST 受理与投影读取分开；刷新失败不能把已受理输入留作可重发草稿。
      await refresh()
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '提交失败'
      if (authentication.current === csrf) setError(message)
      throw failure
    } finally {
      if (submission.current === owner) {
        submission.current = null
        setSubmitting(false)
      }
    }
  }
  const sidebar = (
    <aside className="sidebar" id="sessions-sidebar" aria-label="会话栏" inert={!sidebarOpen}>
      <div className="sidebar-header">
        <span className="sidebar-brand">VelarOS Server</span>
        <IconButton label="收起会话栏" size="icon-sm" onClick={() => setSidebarOpen(false)}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg>
        </IconButton>
      </div>
      <div className="sidebar-heading">
        <span>会话</span>
        <IconButton label="新建对话" size="icon-sm" onClick={startNewChat}>
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </IconButton>
      </div>
      <div className="session-list">
        {sessions.map((session) => (
          <Button
            key={session.id}
            variant="ghost"
            size="block"
            active={selectedId === session.id}
            aria-current={selectedId === session.id ? 'page' : undefined}
            title={session.title}
            onClick={() => {
              if (selectedId === session.id) {
                if (window.innerWidth <= 640) setSidebarOpen(false)
                return
              }
              setSelectedId(session.id)
              setDraft('')
              setError(null)
              draftScope.current += 1
              if (window.innerWidth <= 640) setSidebarOpen(false)
            }}
          >
            <span>{session.title}</span>
          </Button>
        ))}
      </div>
    </aside>
  )
  return (
    <AppShell
      embedded
      className={`server-shell ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}
      sidebar={sidebar}
      sidebarCollapsed={!sidebarOpen}
    >
      {!sidebarOpen && (
        <IconButton
          className="sidebar-reopen"
          label="展开会话栏"
          size="icon-sm"
          aria-controls="sessions-sidebar"
          onClick={() => setSidebarOpen(true)}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg>
        </IconButton>
      )}
      {sidebarOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="关闭会话栏"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      {error && (
        <div role="alert" className="notice error">
          <span>{error}</span>
          <IconButton label="关闭提示" size="icon-sm" onClick={() => setError(null)}>
            ×
          </IconButton>
        </div>
      )}
      <div className="chat-page">
        <Conversation
          session={selected}
          draft={draft}
          onDraftChange={setDraft}
          submitting={submitting}
          available={info?.execution.available ?? false}
          modelSettings={
            info && (
              <ModelDialog
                key={csrf}
                model={info.model}
                csrf={csrf}
                onSaved={(model) => {
                  if (authentication.current !== csrf) return
                  setInfo((current) => (current ? { ...current, model } : current))
                  void refresh()
                }}
              />
            )
          }
          onSend={send}
          onStop={async () => {
            if (!selected) return
            await request(`/api/sessions/${selected.id}/cancel`, csrf, 'POST', {
              runId: selected.runId,
            })
            await refresh()
          }}
          onReview={async (requestId) => {
            if (!selected) return null
            const value = await request<{ source: string | null }>(
              `/api/sessions/${selected.id}/interaction?requestId=${encodeURIComponent(requestId)}`,
              csrf,
            )
            return value.source
          }}
          onAnswer={async (requestId, runId, value) => {
            if (!selected) return
            await request(`/api/sessions/${selected.id}/answers`, csrf, 'POST', {
              requestId,
              runId,
              value,
            })
            await refresh()
          }}
        />
      </div>
    </AppShell>
  )
}
