import { useState } from 'react'
import { Button } from '@velaros-ai/ui/primitives/buttons/Button'
import { IconButton } from '@velaros-ai/ui/primitives/buttons/IconButton'
import { Input } from '@velaros-ai/ui/primitives/forms/Input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@velaros-ai/ui/primitives/overlays/Dialog'
import {
  BusinessCascadingMenu,
  BusinessCascadingMenuItem,
} from '@velaros-ai/ui/product/menus/BusinessCascadingMenu'
import type { SessionUpdate, SessionView } from '../../../packages/contracts/src/index.js'
import { sidebarSessions } from './pending-chats.js'

export function SessionsSidebar({
  open,
  sessions,
  selectedId,
  archived,
  onCollapse,
  onNew,
  onSelect,
  onArchivedChange,
  onUpdate,
}: {
  open: boolean
  sessions: SessionView[]
  selectedId: string | null
  archived: boolean
  onCollapse(): void
  onNew(): void
  onSelect(session: SessionView): void
  onArchivedChange(value: boolean): void
  onUpdate(session: SessionView, update: SessionUpdate): Promise<void>
}): React.ReactElement {
  const [menuId, setMenuId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<SessionView | null>(null)
  const [title, setTitle] = useState('')
  const [pending, setPending] = useState<string[]>([])
  const update = async (session: SessionView, value: SessionUpdate): Promise<boolean> => {
    setPending((current) => [...current, session.id])
    try {
      await onUpdate(session, value)
      return true
    } catch {
      return false
    } finally {
      setPending((current) => current.filter((id) => id !== session.id))
    }
  }
  return (
    <aside className="sidebar" id="sessions-sidebar" aria-label="会话栏" inert={!open}>
      <div className="sidebar-header">
        <span className="sidebar-brand">VelarOS Server</span>
        <IconButton label="收起会话栏" size="icon-sm" onClick={onCollapse}>
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
        <span>{archived ? '已归档' : '会话'}</span>
        <IconButton label="新建对话" size="icon-sm" onClick={onNew}>
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
      <div className="session-list" aria-label={archived ? '已归档会话' : '当前会话'}>
        {sidebarSessions(sessions, archived).map((session) => (
          <div
            key={session.id}
            className="session-row"
            data-active={selectedId === session.id || undefined}
          >
            <Button
              variant="ghost"
              size="block"
              className="session-select"
              active={selectedId === session.id}
              aria-current={selectedId === session.id ? 'page' : undefined}
              title={session.title}
              onClick={() => onSelect(session)}
            >
              {session.pinned && (
                <svg
                  className="session-pin"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  aria-label="已置顶"
                >
                  <path d="m16 3 5 5-5 2-2 5-5-5 5-2zM10 14l-6 6" />
                </svg>
              )}
              <span>{session.title}</span>
            </Button>
            <BusinessCascadingMenu
              open={menuId === session.id}
              onOpenChange={(value) => setMenuId(value ? session.id : null)}
              activeSubmenuId={null}
              onActiveSubmenuChange={() => {}}
              side="right"
              align="start"
              sideOffset={4}
              anchor={({ getAnchorProps }) => (
                <IconButton
                  {...getAnchorProps({ disabled: pending.includes(session.id) })}
                  className="session-actions"
                  label={`会话操作：${session.title}`}
                  size="icon-sm"
                  disabled={pending.includes(session.id)}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <circle cx="5" cy="12" r="1.5" />
                    <circle cx="12" cy="12" r="1.5" />
                    <circle cx="19" cy="12" r="1.5" />
                  </svg>
                </IconButton>
              )}
            >
              {(menu) => (
                <div {...menu.getPrimaryPanelProps({ className: 'session-menu' })}>
                  <BusinessCascadingMenuItem
                    menu={menu}
                    onClick={() => {
                      setRenaming(session)
                      setTitle(session.title)
                      menu.close()
                    }}
                  >
                    重命名
                  </BusinessCascadingMenuItem>
                  {!archived && (
                    <BusinessCascadingMenuItem
                      menu={menu}
                      onClick={() => {
                        menu.close()
                        void update(session, { pinned: !session.pinned })
                      }}
                    >
                      {session.pinned ? '取消置顶' : '置顶'}
                    </BusinessCascadingMenuItem>
                  )}
                  <BusinessCascadingMenuItem
                    menu={menu}
                    disabled={
                      !archived &&
                      ['received', 'accepted', 'running', 'waiting'].includes(session.status)
                    }
                    onClick={() => {
                      menu.close()
                      void update(session, { archived: !session.archived })
                    }}
                  >
                    {archived ? '取消归档' : '归档'}
                  </BusinessCascadingMenuItem>
                </div>
              )}
            </BusinessCascadingMenu>
          </div>
        ))}
        {archived && !sessions.some((session) => session.archived) && (
          <p className="archive-empty">暂无归档会话</p>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="archive-toggle"
        onClick={() => {
          setMenuId(null)
          onArchivedChange(!archived)
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          {archived ? (
            <path d="m14 6-6 6 6 6" />
          ) : (
            <>
              <path d="M4 8v12h16V8M3 4h18v4H3zM9 12h6" />
            </>
          )}
        </svg>
        {archived ? '返回会话' : '已归档'}
      </Button>
      <Dialog
        open={renaming !== null}
        onOpenChange={(value) => {
          if (!value && !pending.includes(renaming?.id ?? '')) setRenaming(null)
        }}
      >
        <DialogContent className="rename-dialog" aria-describedby={undefined}>
          <DialogTitle>重命名会话</DialogTitle>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (renaming && title.trim() && !pending.includes(renaming.id))
                void update(renaming, { title: title.trim() }).then((saved) => {
                  if (saved) setRenaming(null)
                })
            }}
          >
            <label htmlFor="session-title">名称</label>
            <Input
              id="session-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onFocus={(event) => event.target.select()}
              maxLength={100}
              required
              disabled={pending.includes(renaming?.id ?? '')}
              autoFocus
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={pending.includes(renaming?.id ?? '')}
                onClick={() => setRenaming(null)}
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={!title.trim() || pending.includes(renaming?.id ?? '')}
              >
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
