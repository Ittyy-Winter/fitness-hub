import { setTimeout as sleep } from 'node:timers/promises'

export class HttpError extends Error {
  readonly status: number
  readonly body: string
  constructor(status: number, url: string, body: string) {
    super(`HTTP ${status} from ${new URL(url).pathname}: ${body.slice(0, 300)}`)
    this.status = status
    this.body = body
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504])

// JSON request with exponential backoff on rate limits and server errors (spec: Reliability).
// Honors Retry-After when the server sends one.
export async function fetchJson<T>(url: string, init: RequestInit = {}, retries = 4): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
    if (res.ok) return (await res.json()) as T
    const body = await res.text()
    if (!RETRYABLE.has(res.status) || attempt >= retries) throw new HttpError(res.status, url, body)
    const retryAfter = Number(res.headers.get('retry-after'))
    const delay = retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt + Math.random() * 500
    await sleep(Math.min(delay, 60_000))
  }
}
