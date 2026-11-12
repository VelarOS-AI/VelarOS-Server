import type { ApiFailure } from '../../../packages/contracts/src/index.js'

/** 同一份网页可放在根目录或由反向代理挂到子路径。 */
export function apiUrl(path: string): string {
  return new URL(`.${path}`, document.baseURI).href
}

export async function request<T>(
  path: string,
  csrf: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method,
    signal,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-VelarOS-CSRF': csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const value: unknown = await response.json()
  if (!response.ok) {
    const error = value as ApiFailure
    throw new Error(error.error?.message ?? `请求失败 (${response.status})`)
  }
  return value as T
}
