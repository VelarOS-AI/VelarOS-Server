import { ModelProviderOperationalManifests, modelCatalog } from '@velaros-ai/velaros/model/catalog'
import type { ModelProviderOperationalManifest } from '@velaros-ai/velaros/model/contracts'

const BuiltInProviders: readonly ModelProviderOperationalManifest[] =
  ModelProviderOperationalManifests

/** 与 Desktop 同源的内置目录；Server 不装 Cloud 登录、脚本适配器或本地模型专用配置。 */
export const ModelProviderPresets = BuiltInProviders.filter(
  (entry) =>
    !entry.managedByCloud &&
    entry.adapterKind !== 'custom-js' &&
    entry.adapterKind !== 'provider-script' &&
    !['ollama', 'lmstudio'].includes(entry.id) &&
    Boolean(entry.defaultBaseURL),
).map((entry) => {
  const models = modelCatalog
    .suggestedModels(entry.id)
    .filter((id) => id.trim() && id.trim().toLowerCase() !== 'auto')
  const suggested = modelCatalog.catalog(entry.id)?.defaultModel
  return {
    id: entry.id,
    label:
      entry.id === 'openai'
        ? 'OpenAI'
        : entry.id === 'openai-compatible-gateway'
          ? '自定义 · OpenAI 兼容'
          : entry.label,
    baseUrl: entry.defaultBaseURL,
    defaultModel: suggested && models.includes(suggested) ? suggested : (models[0] ?? ''),
    models,
    customEndpoint: entry.id === 'openai-compatible-gateway',
  }
})
