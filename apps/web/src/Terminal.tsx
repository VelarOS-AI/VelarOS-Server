import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Button } from '@velaros-ai/ui/primitives/buttons/Button'
import '@xterm/xterm/css/xterm.css'
import { request } from './api.js'

interface OutputChunk {
  text: string
  droppedChars: number
  status: 'running' | 'exited' | 'unknown'
}

export default function Terminal({
  csrf,
  available,
  reason,
  onError,
}: {
  csrf: string
  available: boolean
  reason: string | null
  onError(message: string): void
}): React.ReactElement {
  const container = useRef<HTMLDivElement>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [connection, setConnection] = useState(0)
  const [connecting, setConnecting] = useState(false)
  const [status, setStatus] = useState('尚未连接')
  const [running, setRunning] = useState(false)
  useEffect(() => {
    if (!taskId || !container.current) return
    let disposed = false
    let writable = true
    let pending = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    let queue = Promise.resolve()
    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      scrollback: 2_000,
      theme: { background: '#141719', foreground: '#e2e6e8' },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(container.current)
    fit.fit()
    terminal.focus()
    const path = `/api/terminal/${encodeURIComponent(taskId)}`
    const failure = (error: unknown): void => {
      if (disposed) return
      writable = false
      terminal.options.disableStdin = true
      setRunning(false)
      onError(error instanceof Error ? error.message : '终端输入未确认，请核对后重新连接')
    }
    const flush = (): void => {
      clearTimeout(timer)
      const value = pending
      pending = ''
      if (!value || !writable || disposed) return
      // 输入只发送一次，串行保持按键/粘贴顺序；网络未知不自动重放。
      queue = queue
        .then(async () => {
          if (!writable || disposed) return
          for (let offset = 0; offset < value.length; offset += 16_384)
            await request(`${path}/input`, csrf, 'POST', {
              text: value.slice(offset, offset + 16_384),
            })
        })
        .catch(failure)
    }
    const input = terminal.onData((text) => {
      pending += text
      clearTimeout(timer)
      timer = setTimeout(flush, 16)
    })
    const resize = (): void => {
      fit.fit()
      void request(`${path}/resize`, csrf, 'POST', {
        cols: terminal.cols,
        rows: terminal.rows,
      }).catch(failure)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container.current)
    const events = new EventSource(`${path}/events`)
    events.onopen = () => {
      setStatus('已连接')
      setRunning(true)
    }
    events.onerror = () => {
      if (!disposed) setStatus('输出连接中断，正在重连…')
    }
    events.addEventListener('output', (event: MessageEvent) => {
      const value = JSON.parse(event.data as string) as OutputChunk
      if (value.droppedChars)
        terminal.write(`\r\n[输出缓冲已越界，缺少 ${value.droppedChars} 字符]\r\n`)
      terminal.write(value.text)
      if (value.status !== 'running') {
        writable = false
        terminal.options.disableStdin = true
        setRunning(false)
        setStatus(value.status === 'exited' ? '终端已退出' : '进程状态未知，请核对')
        events.close()
      }
    })
    return () => {
      disposed = true
      clearTimeout(timer)
      events.close()
      observer.disconnect()
      input.dispose()
      terminal.dispose()
    }
  }, [taskId, connection, csrf, onError])

  const connect = async (): Promise<void> => {
    setConnecting(true)
    try {
      const value = await request<{ taskId: string }>('/api/terminal/open', csrf, 'POST', {})
      setTaskId(value.taskId)
      setConnection((value) => value + 1)
      setStatus('正在连接…')
    } catch (error) {
      onError(error instanceof Error ? error.message : '连接终端失败')
    } finally {
      setConnecting(false)
    }
  }
  return (
    <div className="terminal-page">
      <div className="section-header">
        <strong>本机终端</strong>
        <span className="muted">{status}</span>
        <div className="row">
          <Button size="sm" disabled={!available || connecting} onClick={() => void connect()}>
            {taskId ? '重新连接' : '连接终端'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!taskId || !running}
            onClick={() => {
              if (taskId)
                void request(
                  `/api/terminal/${encodeURIComponent(taskId)}/stop`,
                  csrf,
                  'POST',
                  {},
                ).catch((error: Error) => onError(error.message))
            }}
          >
            停止终端
          </Button>
        </div>
      </div>
      {!taskId && (
        <p className="terminal-hint">
          {available ? '连接或恢复当前服务器终端。离开页面后，终端继续运行。' : reason}
        </p>
      )}
      <div className="terminal-container" ref={container} />
    </div>
  )
}
