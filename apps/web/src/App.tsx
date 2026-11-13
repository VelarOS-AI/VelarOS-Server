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
  type SessionUpdate,
} from '../../../packages/contracts/src/index.js'
import { apiUrl, request } from './api.js'
import { Conversation } from './Conversation.js'
import { ModelDialog } from './ModelDialog.js'
import { SessionsSidebar } from './SessionsSidebar.js'
import { encodeAttachments, validateAttachments } from './attachments.js'
import {
  draftSession,
  hasInput,
  mergeSessions,
  singleDraft,
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
  const newSession = useRef<SessionView | null>(null)
  const initialDraftRequested = useRef(false)
  const [showArchived, setShowArchived] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const currentSelection = useRef(selectedId)
  currentSelection.current = selectedId
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
      const initial = value ? draftSession(crypto.randomUUID()) : null
      newSession.current = initial
      initialDraftRequested.current = false
      setLocalSessions(initial ? [initial] : [])
      setShowArchived(false)
      setPendingMessages([])
      creatingSessions.current.clear()
      setSelectedId(initial?.id ?? null)
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
      setSessions((current) => mergeSessions(current, nextSessions))
      const knownDraft = nextSessions.find((session) => session.id === newSession.current?.id)
      if (knownDraft && (knownDraft.archived || knownDraft.messages.length > 0))
        newSession.current = null
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
  const ensureSession = useCallback(
    (session: SessionView): Promise<SessionView> => {
      const known = sessions.find((item) => item.id === session.id)
      if (known) return Promise.resolve(known)
      const existing = creatingSessions.current.get(session.id)
      if (existing) return existing
      const creation: Promise<SessionView> = request<SessionView>('/api/sessions', csrf!, 'POST', {
        id: session.id,
        title: session.title,
      })
        .then((created) => {
          if (authentication.current === csrf) {
            setSessions((current) => mergeSessions(current, [created]))
            setLocalSessions((current) => current.filter((item) => item.id !== session.id))
            if (newSession.current?.id === session.id) newSession.current = created
            if (created.id !== session.id) {
              setSelectedId((current) => (current === session.id ? created.id : current))
              setPendingMessages((current) =>
                current.map((item) =>
                  item.sessionId === session.id ? { ...item, sessionId: created.id } : item,
                ),
              )
              if (pendingInput.current?.sessionId === session.id)
                pendingInput.current.sessionId = created.id
            }
          }
          return created
        })
        .finally(() => {
          if (creatingSessions.current.get(session.id) === creation)
            creatingSessions.current.delete(session.id)
        })
      creatingSessions.current.set(session.id, creation)
      return creation
    },
    [csrf, sessions],
  )
  useEffect(() => {
    if (!csrf || initialDraftRequested.current || !newSession.current) return
    initialDraftRequested.current = true
    void ensureSession(newSession.current).catch((failure) => {
      if (authentication.current === csrf)
        setError(failure instanceof Error ? failure.message : '无法创建会话')
    })
  }, [csrf, ensureSession])
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

  const visibleSessions = singleDraft(
    projectPendingChats(sessions, localSessions, pendingMessages),
    newSession.current?.id,
  )
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
    const session =
      newSession.current ??
      visibleSessions.find(
        (item) => !item.archived && item.status === 'idle' && item.messages.length === 0,
      ) ??
      draftSession(crypto.randomUUID())
    newSession.current = session
    if (!visibleSessions.some((item) => item.id === session.id))
      setLocalSessions((current) => [session, ...current])
    setShowArchived(false)
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
  }
  const updateSession = async (session: SessionView, update: SessionUpdate): Promise<void> => {
    try {
      const stored = await ensureSession(session)
      if (authentication.current !== csrf) return
      const updated = await request<SessionView>(
        `/api/sessions/${stored.id}`,
        csrf,
        'PATCH',
        update,
      )
      if (authentication.current !== csrf) return
      setSessions((current) => mergeSessions(current, [updated]))
      setError(null)
      if (update.archived !== undefined) {
        if (newSession.current?.id === updated.id) newSession.current = null
        if (
          update.archived &&
          (currentSelection.current === session.id || currentSelection.current === updated.id)
        ) {
          const next =
            newSession.current ??
            visibleSessions.find(
              (item) =>
                item.id !== updated.id &&
                !item.archived &&
                item.status === 'idle' &&
                item.messages.length === 0,
            ) ??
            draftSession(crypto.randomUUID())
          newSession.current = next
          if (!visibleSessions.some((item) => item.id === next.id))
            setLocalSessions((current) => [
              next,
              ...current.filter((item) => item.id !== session.id),
            ])
          setSelectedId(next.id)
          setShowArchived(false)
          setDraft('')
          setFiles([])
          draftScope.current += 1
        } else if (!update.archived) {
          if (updated.status === 'idle' && updated.messages.length === 0) {
            newSession.current = updated
            setLocalSessions((current) =>
              current.filter((item) => item.messages.length > 0 || item.id === updated.id),
            )
          }
          setShowArchived(false)
          setSelectedId(updated.id)
          setDraft('')
          setFiles([])
          draftScope.current += 1
        }
      }
    } catch (failure) {
      if (authentication.current === csrf)
        setError(failure instanceof Error ? failure.message : '无法更新会话')
      throw failure
    }
  }
  const send = async (text: string, attached: File[]): Promise<void> => {
    if ((!text.trim() && !attached.length) || authentication.current !== csrf || submission.current)
      return
    if (selected?.archived) {
      setError('会话已归档，请先取消归档')
      return
    }
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
    if (newSession.current?.id === session.id) newSession.current = null
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
      const stored = await ensureSession(session)
      delivery.sessionId = stored.id
      if (authentication.current !== csrf) return
      await request(`/api/sessions/${stored.id}/inputs`, csrf, 'POST', {
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
    <SessionsSidebar
      key={csrf}
      open={sidebarOpen}
      sessions={visibleSessions}
      selectedId={selectedId}
      archived={showArchived}
      onCollapse={() => setSidebarOpen(false)}
      onNew={startNewChat}
      onSelect={(session) => {
        if (selectedId !== session.id) {
          setSelectedId(session.id)
          setDraft('')
          setFiles([])
          setError(null)
          draftScope.current += 1
        }
        if (window.innerWidth <= 640) setSidebarOpen(false)
      }}
      onArchivedChange={setShowArchived}
      onUpdate={updateSession}
    />
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
          available={!selected?.archived && (info?.execution.available ?? false)}
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
