import { useCallback, useEffect, useRef, useState } from 'react'
import { AppShell } from '@velaros-ai/ui/product/layout/AppShell'
import { Button } from '@velaros-ai/ui/primitives/buttons/Button'
import { IconButton } from '@velaros-ai/ui/primitives/buttons/IconButton'
import { Input } from '@velaros-ai/ui/primitives/forms/Input'
import {
  InputLimits,
  type InputContent,
  type ThinkingDepth,
  type ExecutionMode,
  type ServerInfo,
  type SessionView,
} from '../../../packages/contracts/src/index.js'
import { apiUrl, request } from './api.js'
import { Conversation } from './Conversation.js'
import { ModelDialog } from './ModelDialog.js'
import { encodeAttachments, validateAttachments } from './attachments.js'
import {
  draftSession,
  hasInput,
  projectPendingChats,
  type PendingMessage,
} from './pending-chats.js'

interface PendingSubmission {
  id: string
  fingerprint: string
  sessionId: string
  text: string
  files: File[]
  scope: number
  confirmed: boolean
  error?: string
}

export function App(): React.ReactElement {
  const [csrf, setCsrf] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const [token, setToken] = useState('')
  const [info, setInfo] = useState<ServerInfo | null>(null)
  const [sessions, setSessions] = useState<SessionView[]>([])
  const [localSessions, setLocalSessions] = useState<SessionView[]>([])
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([])
  const creatingSessions = useRef(new Map<string, Promise<SessionView>>())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [thinkingDepth, setThinkingDepth] = useState<ThinkingDepth>('medium')
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('standard')
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
  const pendingInput = useRef<{
    id: string
    fingerprint: string
    sessionId: string
    text: string
    files: File[]
    scope: number
    confirmed: boolean
    error?: string
  } | null>(null)
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
      setLocalSessions([])
      setPendingMessages([])
      creatingSessions.current.clear()
      setSelectedId(null)
      setDraft('')
      setFiles([])
      setThinkingDepth('medium')
      setExecutionMode('standard')
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
      setLocalSessions((current) =>
        current.filter((local) => !nextSessions.some((server) => server.id === local.id)),
      )
      setPendingMessages((current) =>
        current.filter(
          (pending) =>
            !hasInput(
              nextSessions.find((session) => session.id === pending.sessionId),
              pending.id,
            ),
        ),
      )
      const delivery = pendingInput.current
      if (
        delivery &&
        hasInput(
          nextSessions.find((session) => session.id === delivery.sessionId),
          delivery.id,
        )
      ) {
        delivery.confirmed = true
        if (delivery.error && draftScope.current === delivery.scope) {
          setDraft((current) => (current === delivery.text ? '' : current))
          setFiles((current) =>
            current.length === delivery.files.length &&
            current.every((file, index) => file === delivery.files[index])
              ? []
              : current,
          )
          setError((current) => (current === delivery.error ? null : current))
          pendingInput.current = null
        }
      }
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
    const events = new EventSource(apiUrl(`/api/events?after=${cursor.current}`))
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

  const visibleSessions = projectPendingChats(sessions, localSessions, pendingMessages)
  const selected = visibleSessions.find((session) => session.id === selectedId) ?? null
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

  const ensureSession = (session: SessionView): Promise<SessionView> => {
    const known = sessions.find((item) => item.id === session.id)
    if (known) return Promise.resolve(known)
    const existing = creatingSessions.current.get(session.id)
    if (existing) return existing
    const creation: Promise<SessionView> = request<SessionView>('/api/sessions', csrf, 'POST', {
      id: session.id,
      title: session.title,
    })
      .then((created) => {
        if (authentication.current === csrf) {
          setSessions((current) => [created, ...current.filter((item) => item.id !== created.id)])
        }
        return created
      })
      .finally(() => {
        if (creatingSessions.current.get(session.id) === creation)
          creatingSessions.current.delete(session.id)
      })
    creatingSessions.current.set(session.id, creation)
    return creation
  }
  const startNewChat = (): void => {
    const session = draftSession(crypto.randomUUID())
    setLocalSessions((current) => [session, ...current])
    setSelectedId(session.id)
    setDraft('')
    setFiles([])
    setError(null)
    draftScope.current += 1
    if (window.innerWidth <= 640) setSidebarOpen(false)
    void ensureSession(session).catch((failure) => {
      if (authentication.current === csrf)
        setError(failure instanceof Error ? failure.message : '无法创建会话')
    })
  }
  const send = async (text: string, attached: File[]): Promise<void> => {
    if ((!text.trim() && !attached.length) || authentication.current !== csrf || submission.current)
      return
    if (!info?.execution.available) {
      setError(info?.execution.reason ?? '请先配置模型')
      return
    }
    try {
      if (text.length > InputLimits.textChars) throw new Error('消息文字不能超过 32,000 字符')
      validateAttachments(attached)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '消息内容无效')
      throw failure
    }
    const owner = {}
    const scope = draftScope.current
    const previous = pendingInput.current
    const session = selected ?? draftSession(crypto.randomUUID())
    const delivery: PendingSubmission = {
      id: crypto.randomUUID(),
      fingerprint: '',
      sessionId: session.id,
      text,
      files: attached,
      scope,
      confirmed: false,
    }
    submission.current = owner
    pendingInput.current = delivery
    setSubmitting(true)
    setError(null)
    if (!selected) {
      setLocalSessions((current) => [session, ...current])
      setSelectedId(session.id)
    }
    setPendingMessages((current) => [
      ...current,
      {
        id: delivery.id,
        sessionId: session.id,
        text,
        timestamp: new Date().toISOString(),
        accepted: false,
        attachments: attached.map((file) => ({
          name: file.name,
          kind: file.type.startsWith('image/') ? 'image' : 'text',
          mediaType: file.type.startsWith('image/') ? file.type : 'text/plain',
          bytes: file.size,
        })),
      },
    ])
    setDraft((current) => (current === text ? '' : current))
    setFiles((current) =>
      current.length === attached.length && current.every((file, index) => file === attached[index])
        ? []
        : current,
    )
    try {
      const payload: InputContent = {
        text,
        attachments: await encodeAttachments(attached),
        thinkingDepth,
        executionMode,
      }
      if (authentication.current !== csrf) return
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(payload)),
      )
      delivery.fingerprint = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('')
      if (authentication.current !== csrf) return
      if (
        previous &&
        previous.sessionId === session.id &&
        previous.fingerprint === delivery.fingerprint
      ) {
        const provisionalId = delivery.id
        delivery.id = previous.id
        setPendingMessages((current) =>
          current.map((item) => (item.id === provisionalId ? { ...item, id: delivery.id } : item)),
        )
      }
      await ensureSession(session)
      if (authentication.current !== csrf) return
      await request(`/api/sessions/${session.id}/inputs`, csrf, 'POST', {
        requestId: delivery.id,
        ...payload,
      })
      delivery.confirmed = true
      setPendingMessages((current) =>
        current.map((item) => (item.id === delivery.id ? { ...item, accepted: true } : item)),
      )
      if (pendingInput.current === delivery) pendingInput.current = null
      await refresh()
    } catch (failure) {
      if (authentication.current !== csrf) return
      if (delivery.confirmed) {
        if (pendingInput.current === delivery) pendingInput.current = null
        setPendingMessages((current) =>
          current.map((item) => (item.id === delivery.id ? { ...item, accepted: true } : item)),
        )
        await refresh()
        return
      }
      const message = failure instanceof Error ? failure.message : '发送结果未确认'
      delivery.error = message
      setPendingMessages((current) => current.filter((item) => item.id !== delivery.id))
      if (draftScope.current === scope) {
        setDraft((current) => current || text)
        setFiles((current) => (current.length ? current : attached))
      }
      setError(message)
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
        {visibleSessions.map((session) => (
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
              setFiles([])
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
          files={files}
          onFilesChange={(next) => {
            try {
              validateAttachments(next)
              setFiles(next)
              setError(null)
            } catch (failure) {
              setFiles((current) => [...current])
              setError(failure instanceof Error ? failure.message : '无法添加附件')
            }
          }}
          thinkingDepth={thinkingDepth}
          onThinkingDepthChange={setThinkingDepth}
          executionMode={executionMode}
          onExecutionModeChange={setExecutionMode}
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
