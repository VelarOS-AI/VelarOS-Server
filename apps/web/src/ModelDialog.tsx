import { useRef, useState } from 'react'
import { Button } from '@velaros-ai/ui/primitives/buttons/Button'
import { IconButton } from '@velaros-ai/ui/primitives/buttons/IconButton'
import { Input } from '@velaros-ai/ui/primitives/forms/Input'
import { Select } from '@velaros-ai/ui/primitives/forms/Select'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@velaros-ai/ui/primitives/overlays/Dialog'
import type { ModelSettings } from '../../../packages/contracts/src/index.js'
import { request } from './api.js'

export function ModelDialog({
  model,
  csrf,
  onSaved,
}: {
  model: ModelSettings
  csrf: string
  onSaved(value: ModelSettings): void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState(model.provider)
  const [baseUrl, setBaseUrl] = useState(model.baseUrl)
  const [name, setName] = useState(model.model)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const changeOpen = (next: boolean): void => {
    if (pending.current) return
    if (next) {
      setProvider(model.provider)
      setBaseUrl(model.baseUrl)
      setName(model.model)
      setError(null)
    }
    setApiKey('')
    setOpen(next)
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="model-button"
          aria-label="配置模型"
          title="配置模型"
        >
          <span>{model.model || '配置模型'}</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="m7 10 5 5 5-5" />
          </svg>
        </Button>
      </DialogTrigger>
      <DialogContent className="model-dialog" showClose={false} aria-describedby={undefined}>
        <div className="model-dialog-heading">
          <DialogTitle>模型配置</DialogTitle>
          <IconButton
            label="关闭模型配置"
            size="icon-sm"
            disabled={saving}
            onClick={() => changeOpen(false)}
          >
            ×
          </IconButton>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (pending.current) return
            pending.current = true
            setSaving(true)
            setError(null)
            void request<ModelSettings>('/api/settings/model', csrf, 'PUT', {
              provider,
              baseUrl: baseUrl.trim(),
              model: name.trim(),
              ...(apiKey ? { apiKey } : {}),
            })
              .then((value) => {
                onSaved(value)
                setApiKey('')
                setOpen(false)
              })
              .catch((failure: unknown) => {
                setError(failure instanceof Error ? failure.message : '保存失败')
              })
              .finally(() => {
                pending.current = false
                setSaving(false)
              })
          }}
        >
          <label htmlFor="model-provider">
            接口协议
            <Select<ModelSettings['provider']>
              id="model-provider"
              value={provider}
              disabled={saving}
              onChange={setProvider}
              options={[
                { value: 'openai', label: 'OpenAI · Responses' },
                { value: 'openai-compatible-gateway', label: 'OpenAI 兼容 · Chat Completions' },
              ]}
            />
          </label>
          <label>
            服务地址
            <Input
              type="url"
              required
              value={baseUrl}
              disabled={saving}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>
          <label>
            模型名称
            <Input
              required
              maxLength={160}
              value={name}
              disabled={saving}
              placeholder="服务商提供的模型 ID"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            API 密钥
            <Input
              type="password"
              autoComplete="off"
              maxLength={4096}
              value={apiKey}
              disabled={saving}
              placeholder={model.hasApiKey ? '已配置，留空保留' : '输入 API 密钥'}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <div className="model-dialog-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => changeOpen(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
