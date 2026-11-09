import { useState } from 'react'
import { Button } from '@velaros-ai/ui/primitives/buttons/Button'
import { Input } from '@velaros-ai/ui/primitives/forms/Input'
import { Select } from '@velaros-ai/ui/primitives/forms/Select'
import type { ModelSettings } from '../../../packages/contracts/src/index.js'
import { request } from './api.js'

export function Settings({
  model,
  csrf,
  onSaved,
  onError,
}: {
  model: ModelSettings
  csrf: string
  onSaved(): Promise<void>
  onError(message: string): void
}): React.ReactElement {
  const [baseUrl, setBaseUrl] = useState(model.baseUrl)
  const [provider, setProvider] = useState(model.provider)
  const [name, setName] = useState(model.model)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  return (
    <div className="settings-page">
      <h2>模型连接</h2>
      <p className="muted">按服务商支持的协议连接。密钥只保存在服务器，留空保留已配置密钥。</p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          setSaving(true)
          void request('/api/settings/model', csrf, 'PUT', {
            provider,
            baseUrl,
            model: name,
            apiKey: key,
          })
            .then(async () => {
              setKey('')
              await onSaved()
            })
            .catch((error: Error) => onError(error.message))
            .finally(() => setSaving(false))
        }}
      >
        <label htmlFor="model-provider">
          接口协议
          <Select<ModelSettings['provider']>
            id="model-provider"
            value={provider}
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
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>
        <label>
          模型名称
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="填写服务商提供的模型 ID"
          />
        </label>
        <label>
          API 密钥
          <Input
            type="password"
            autoComplete="new-password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={model.hasApiKey ? '已配置，留空保留' : '尚未配置'}
          />
        </label>
        <Button type="submit" disabled={saving}>
          {saving ? '保存中…' : '保存连接'}
        </Button>
      </form>
      <div className="settings-note">
        <h3>执行与访问</h3>
        <p>授权目录、执行用户和访问地址由服务器启动配置控制，网页请求不能扩大范围。</p>
        <p>模型连接变更在现有运行结束后用于下一次运行。</p>
      </div>
    </div>
  )
}
