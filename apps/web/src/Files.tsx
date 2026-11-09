import { useEffect, useState } from 'react'
import { Button } from '@velaros-ai/ui/primitives/buttons/Button'
import { Input } from '@velaros-ai/ui/primitives/forms/Input'
import type { DirectoryView, TextFileView } from '../../../packages/contracts/src/index.js'
import { request } from './api.js'

export function Files({
  csrf,
  roots,
  onError,
}: {
  csrf: string
  roots: string[]
  onError(message: string): void
}): React.ReactElement {
  const [path, setPath] = useState(roots[0] ?? '')
  const [directory, setDirectory] = useState<DirectoryView | null>(null)
  const [file, setFile] = useState<TextFileView | null>(null)
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const openDirectory = async (target: string): Promise<void> => {
    const value = await request<DirectoryView>(
      `/api/files?path=${encodeURIComponent(target)}`,
      csrf,
    )
    setDirectory(value)
    setPath(value.path)
  }
  useEffect(() => {
    void openDirectory(roots[0] ?? '').catch((error: Error) => onError(error.message))
  }, [csrf, roots.join('\0')])
  const openFile = async (target: string): Promise<void> => {
    if (file && content !== file.content && !window.confirm('放弃当前未保存的修改？')) return
    const value = await request<TextFileView>(
      `/api/files/text?path=${encodeURIComponent(target)}`,
      csrf,
    )
    setFile(value)
    setContent(value.content)
  }
  const save = async (): Promise<void> => {
    if (!file || !window.confirm(`保存配置文件 ${file.path}？`)) return
    setSaving(true)
    try {
      const value = await request<TextFileView>('/api/files/text', csrf, 'PUT', {
        path: file.path,
        sha256: file.sha256,
        content,
      })
      setFile(value)
      setContent(value.content)
    } catch (error) {
      onError(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="files-page">
      <section className="file-browser">
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault()
            void openDirectory(path).catch((error: Error) => onError(error.message))
          }}
        >
          <Input
            aria-label="服务器目录"
            value={path}
            onChange={(event) => setPath(event.target.value)}
          />
          <Button type="submit" variant="outline">
            打开
          </Button>
        </form>
        <div className="root-list">
          {roots.map((root) => (
            <Button
              key={root}
              size="sm"
              variant="ghost"
              onClick={() =>
                void openDirectory(root).catch((error: Error) => onError(error.message))
              }
            >
              {root}
            </Button>
          ))}
        </div>
        <div className="entry-list">
          {directory?.entries.map((entry) => (
            <Button
              key={entry.path}
              variant="ghost"
              size="block"
              disabled={entry.kind === 'other'}
              onClick={() =>
                void (
                  entry.kind === 'directory' ? openDirectory(entry.path) : openFile(entry.path)
                ).catch((error: Error) => onError(error.message))
              }
            >
              {entry.kind === 'directory' ? '▸' : '·'} {entry.name}
            </Button>
          ))}
        </div>
        {directory?.truncated && <p className="muted">当前仅显示前 500 项。</p>}
      </section>
      <section className="file-editor">
        {file ? (
          <>
            <div className="section-header">
              <span title={file.path}>{file.path}</span>
              <Button
                size="sm"
                disabled={saving || content === file.content}
                onClick={() => void save()}
              >
                保存修改
              </Button>
            </div>
            <textarea
              aria-label="文件内容"
              spellCheck={false}
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
            <div className="muted file-footnote">
              {file.bytes} bytes · 保存前核对文件版本；首版支持 UTF-8 文本。
            </div>
          </>
        ) : (
          <div className="empty-state">
            <h2>文件与日志</h2>
            <p>从左侧打开配置文件，或读取日志内容。</p>
          </div>
        )}
      </section>
    </div>
  )
}
