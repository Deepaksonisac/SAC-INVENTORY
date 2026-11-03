'use client'

import useSWR, { mutate } from 'swr'

type Params = Record<string, string | number | null | undefined>

export function buildUrl(resource: string, params?: Params) {
  const sp = new URLSearchParams()
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && value !== '') sp.set(key, String(value))
    }
  }
  const qs = sp.toString()
  return `/api/${resource}${qs ? `?${qs}` : ''}`
}

const fetcher = async (url: string) => {
  const response = await fetch(url)
  const json = await response.json()
  if (!response.ok) throw new Error(json.error ?? 'Request failed')
  return json
}

export function useApi<T>(resource: string, params?: Params, enabled = true) {
  return useSWR<T>(enabled ? buildUrl(resource, params) : null, fetcher, {
    keepPreviousData: true,
    revalidateOnFocus: true,
  })
}

export async function refreshApiCache() {
  await mutate(() => true)
}

export async function apiSend<T = unknown>(
  method: 'POST' | 'PUT' | 'DELETE',
  resource: string,
  body: unknown,
  refresh = true,
): Promise<T> {
  const response = await fetch(buildUrl(resource), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(json.error ?? 'Request failed')
  // Any write can change balances on several screens, so refresh every cached query.
  if (refresh) await refreshApiCache()
  return json as T
}
