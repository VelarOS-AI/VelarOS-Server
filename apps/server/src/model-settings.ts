import { z } from 'zod'
import type { ModelSettings } from '../../../packages/contracts/src/index.js'
import { ProductStore } from './store.js'

const storedModelSettingsSchema = z
  .object({
    provider: z.enum(['openai', 'openai-compatible-gateway']),
    baseUrl: z.url().refine((value) => {
      const url = new URL(value)
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      )
    }),
    model: z.string().trim().max(160),
    apiKey: z.string().max(4096).optional(),
    clearApiKey: z.boolean().optional(),
  })
  .strict()

export const modelSettingsSchema = storedModelSettingsSchema.refine(
  ({ apiKey }) => apiKey === undefined || apiKey === '' || apiKey.trim().length > 0,
  { path: ['apiKey'], message: 'API 密钥不能只包含空白字符' },
)

export class ModelSettingsStore {
  public constructor(private readonly store: ProductStore) {}

  public read(): {
    provider: ModelSettings['provider']
    baseUrl: string
    model: string
    apiKey: string
  } {
    const row = this.store.db.prepare("SELECT value FROM settings WHERE key='model'").get()
    if (!row)
      return { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', apiKey: '' }
    const value = storedModelSettingsSchema.parse(
      JSON.parse(z.object({ value: z.string() }).parse(row).value),
    )
    return {
      provider: value.provider,
      baseUrl: value.baseUrl,
      model: value.model,
      apiKey: value.apiKey ?? '',
    }
  }

  public view(): ModelSettings {
    const { apiKey, ...value } = this.read()
    return { ...value, hasApiKey: Boolean(apiKey) }
  }

  public save(value: z.infer<typeof modelSettingsSchema>): ModelSettings {
    const previous = this.read()
    const next = {
      provider: value.provider,
      baseUrl: value.baseUrl,
      model: value.model,
      apiKey: value.clearApiKey ? '' : value.apiKey || previous.apiKey,
    }
    this.store.db
      .prepare(
        "INSERT INTO settings (key,value) VALUES ('model',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(next))
    return this.view()
  }
}
