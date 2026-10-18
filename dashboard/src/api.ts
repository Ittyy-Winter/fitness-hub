import { useCallback, useEffect, useState } from 'react'
import type { SyncJob } from './types.ts'

// Every page loads one hub response. The last copy of each is kept in localStorage so the app
// paints at once from cache, then refreshes (spec: Dashboard PWA → behaviour).

export class HubError extends Error {
  // True when the hub could not be reached at all, usually an expired Cloudflare Access
  // session: its redirect to the sign-in page is cross-origin, so fetch fails outright.
  readonly unreachable: boolean
  constructor(message: string, unreachable = false) {
    super(message)
    this.unreachable = unreachable
  }
}

export async function hub<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { ...init, headers: { Accept: 'application/json', ...init?.headers } })
  } catch {
    throw new HubError(navigator.onLine ? 'Your sign-in may have expired.' : 'You are offline.', true)
  }
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null
  if (res.status === 401 || !body) throw new HubError('Your sign-in may have expired.', true)
  if (!res.ok) throw new HubError(body.error ?? `The hub answered ${res.status}.`)
  return body as T
}

// Two components asking for the same page at once (the header and Today) share one request.
const inflight = new Map<string, Promise<unknown>>()
function load<T>(path: string): Promise<T> {
  let p = inflight.get(path)
  if (!p) {
    p = hub<T>(path).finally(() => inflight.delete(path))
    inflight.set(path, p)
  }
  return p as Promise<T>
}

const cacheKey = (path: string) => `fh:${path}`

function readCache<T>(path: string): T | null {
  try {
    const raw = localStorage.getItem(cacheKey(path))
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeCache(path: string, data: unknown): void {
  try {
    localStorage.setItem(cacheKey(path), JSON.stringify(data))
  } catch {
    // Storage full or blocked: the app still works, it just won't open from cache.
  }
}

// Fired after a sync finishes so every mounted page reloads.
export const refreshBus = new EventTarget()

export type Resource<T> = { data: T | null; error: HubError | null; loading: boolean; reload: () => void }

export function useResource<T>(path: string): Resource<T> {
  const [data, setData] = useState<T | null>(() => readCache<T>(path))
  const [error, setError] = useState<HubError | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!path) return setLoading(false) // a page that loads its own data
    setLoading(true)
    try {
      const fresh = await load<T>(path)
      setData(fresh)
      setError(null)
      writeCache(path, fresh)
    } catch (err) {
      setError(err instanceof HubError ? err : new HubError(String(err)))
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => {
    setData(readCache<T>(path))
    void reload()
    const onRefresh = () => void reload()
    const onVisible = () => document.visibilityState === 'visible' && void reload()
    refreshBus.addEventListener('refresh', onRefresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      refreshBus.removeEventListener('refresh', onRefresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [path, reload])

  return { data, error, loading, reload }
}

/** Sync now: queue both sources, poll every 3 s until they finish (spec: POST /api/sync). */
export async function syncNow(): Promise<SyncJob[]> {
  const { jobs } = await hub<{ jobs: { source: string; sync_id: number }[] }>('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const deadline = Date.now() + 5 * 60_000
  for (;;) {
    const states = await Promise.all(jobs.map((j) => hub<SyncJob>(`/api/sync/${j.sync_id}`)))
    if (states.every((s) => s.status === 'ok' || s.status === 'error') || Date.now() > deadline) return states
    await new Promise((r) => setTimeout(r, 3000))
  }
}
