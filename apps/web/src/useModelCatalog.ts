import { useEffect, useMemo, useState } from 'react'
import type { ModelCatalogView } from '../../../packages/contracts/src/index.js'
import { request } from './api.js'

/** 列表只属于当前连接草稿；取消旧请求，也不让迟到结果进入新配置。 */
export function useModelCatalog({
  open,
  csrf,
  provider,
  baseUrl,
  apiKey,
  keepKey,
  catalogWithoutKey,
}: {
  open: boolean
  csrf: string
  provider: string
  baseUrl: string
  apiKey: string
  keepKey: boolean
  catalogWithoutKey: boolean
}): ModelCatalogView & { loading: boolean; ready: boolean; refresh(): void } {
  const query = useMemo(
    () => ({ csrf, provider, baseUrl: baseUrl.trim(), apiKey, keepKey, catalogWithoutKey }),
    [csrf, provider, baseUrl, apiKey, keepKey, catalogWithoutKey],
  )
  const ready =
    open && URL.canParse(query.baseUrl) && Boolean(apiKey.trim() || keepKey || catalogWithoutKey)
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<
    ModelCatalogView & { query: typeof query | null; loading: boolean }
  >({
    query: null,
    models: [],
    error: null,
    fetchedAt: 0,
    loading: false,
  })
  useEffect(() => {
    if (!ready) return
    const controller = new AbortController()
    setState({ query, models: [], error: null, fetchedAt: 0, loading: true })
    const timer = setTimeout(() => {
      void request<ModelCatalogView>(
        '/api/settings/model/catalog',
        query.csrf,
        'POST',
        {
          provider: query.provider,
          baseUrl: query.baseUrl,
          ...(query.apiKey ? { apiKey: query.apiKey } : {}),
        },
        controller.signal,
      )
        .then((value) => {
          if (!controller.signal.aborted) setState({ ...value, query, loading: false })
        })
        .catch((failure: unknown) => {
          if (!controller.signal.aborted)
            setState({
              query,
              models: [],
              error: failure instanceof Error ? failure.message : '无法获取模型列表',
              fetchedAt: 0,
              loading: false,
            })
        })
    }, 350)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, ready, revision])
  const current = ready && state.query === query
  return {
    models: current ? state.models : [],
    error: current ? state.error : null,
    fetchedAt: current ? state.fetchedAt : 0,
    loading: ready && (!current || state.loading),
    ready,
    refresh: () => setRevision((value) => value + 1),
  }
}
