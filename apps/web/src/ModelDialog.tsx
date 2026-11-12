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
import { ModelProviderPresets } from '../../../packages/model-config/src/providers.js'
import { request } from './api.js'

const CustomModel = '__custom_model__'

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
  const [customAddress, setCustomAddress] = useState(false)
  const [customModel, setCustomModel] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const preset = ModelProviderPresets.find((entry) => entry.id === provider)
  const keepKey = model.hasApiKey && provider === model.provider && baseUrl.trim() === model.baseUrl
  const changeOpen = (next: boolean): void => {
    if (pending.current) return
    if (next) {
      setProvider(model.provider)
      setBaseUrl(model.baseUrl)
      const current = ModelProviderPresets.find((entry) => entry.id === model.provider)
      const selected = model.model || current?.defaultModel || ''
      setName(selected)
      setCustomModel(!current?.models.includes(selected))
      setCustomAddress(Boolean(current?.customEndpoint || model.baseUrl !== current?.baseUrl))
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
          <div className="model-field">
            <div className="model-field-heading">
              <label htmlFor="model-provider">服务商</label>
              {!preset?.customEndpoint && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="model-custom-address"
                  disabled={saving}
                  onClick={() => {
                    setCustomAddress(!customAddress)
                    if (customAddress && preset) setBaseUrl(preset.baseUrl)
                  }}
                >
                  {customAddress ? '使用默认地址' : '自定义地址'}
                </Button>
              )}
            </div>
            <Select
              id="model-provider"
              value={provider}
              disabled={saving}
              searchable
              searchPlaceholder="搜索服务商"
              onChange={(value) => {
                const next = ModelProviderPresets.find((entry) => entry.id === value)
                if (!next) return
                setProvider(next.id)
                setBaseUrl(next.baseUrl)
                setName(next.defaultModel)
                setCustomAddress(next.customEndpoint)
                setCustomModel(!next.models.length)
                setApiKey('')
                setError(null)
              }}
              options={ModelProviderPresets.map((entry) => ({
                value: entry.id,
                label: entry.label,
              }))}
            />
          </div>
          {customAddress && (
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
          )}
          <div className="model-field">
            <label htmlFor="model-name">模型</label>
            <Select
              id="model-name"
              value={customModel ? CustomModel : name}
              disabled={saving}
              searchable
              searchPlaceholder="搜索模型"
              options={[
                ...(preset?.models ?? []).map((id) => ({ value: id, label: id })),
                { value: CustomModel, label: '自定义模型…' },
              ]}
              onChange={(value) => {
                setCustomModel(value === CustomModel)
                setName(value === CustomModel ? '' : value)
              }}
            />
          </div>
          {customModel && (
            <label>
              自定义模型
              <Input
                required
                maxLength={160}
                value={name}
                disabled={saving}
                placeholder="服务商提供的模型 ID"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          )}
          <label>
            API 密钥
            <Input
              type="password"
              required={!keepKey}
              autoComplete="off"
              maxLength={4096}
              value={apiKey}
              disabled={saving}
              placeholder={keepKey ? '已配置，留空保留' : '输入此服务商的 API 密钥'}
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
