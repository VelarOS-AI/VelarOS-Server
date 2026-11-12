import { createModelRuntimeComposition } from '@velaros-ai/velaros/model'
import type { ModelCatalogView } from '../../../packages/contracts/src/index.js'
import { ModelProviderPresets } from '../../../packages/model-config/src/providers.js'
import { HttpError } from './errors.js'
import { ModelSettingsStore, modelCatalogSchema } from './model-settings.js'
import type { z } from 'zod'

/** 目录协议、鉴权缓存和远端解析由同一份 Platform 服务持有。 */
export class ServerModelCatalog {
  private readonly runtime = createModelRuntimeComposition({
    environment: {},
    providerScripts: { configPaths: [] },
  })
  private readonly closing = new AbortController()

  public constructor(private readonly settings: ModelSettingsStore) {}

  public async list(
    input: z.infer<typeof modelCatalogSchema>,
    signal?: AbortSignal,
  ): Promise<ModelCatalogView> {
    if (this.closing.signal.aborted) throw new HttpError(503, 'CLOSING', '服务正在关闭')
    const connection = this.settings.resolveConnection(input)
    const preset = ModelProviderPresets.find((entry) => entry.id === connection.provider)
    if (!connection.apiKey && !preset?.catalogWithoutKey)
      throw new HttpError(400, 'MODEL_CREDENTIAL_MISSING', '请先填写当前服务商的 API 密钥')
    const operation = signal ? AbortSignal.any([signal, this.closing.signal]) : this.closing.signal
    try {
      const catalog = await this.runtime.providerModelCatalogService.listProviderModels(
        {
          provider: connection.provider,
          baseURL: connection.baseUrl,
          apiKey: connection.apiKey,
          purpose: 'chat',
        },
        operation,
      )
      operation.throwIfAborted()
      const error =
        catalog.source !== 'remote'
          ? '此服务未返回动态模型目录，可自定义模型'
          : (catalog.error ?? null)
      return {
        models: error
          ? []
          : catalog.models
              .filter(
                (entry) =>
                  entry.id.trim() &&
                  entry.id.trim().toLowerCase() !== 'auto' &&
                  entry.available !== false,
              )
              .map((entry) => ({ id: entry.id, label: entry.label || entry.id })),
        error:
          error && connection.apiKey ? error.replaceAll(connection.apiKey, '[redacted]') : error,
        fetchedAt: catalog.fetchedAt,
      }
    } catch (failure) {
      if (this.closing.signal.aborted) throw new HttpError(503, 'CLOSING', '服务正在关闭')
      throw failure
    }
  }

  public close(): void {
    this.closing.abort()
    this.runtime.providerModelCatalogService.invalidateProviderModels()
  }
}
