import { config } from '../config.ts'
import { tx, type Queryable } from '../db.ts'
import { fetchJson, HttpError } from '../http.ts'
import type { SyncJob } from '../queue.ts'
import { loadToken, saveToken } from '../secrets.ts'
import type { SyncResult } from './opengym.ts'

// Google Health API v4 (spec: Data sources → Google Health). Read-only.
// Every sync re-fetches the last few days (data reaches the API only after the phone app
// syncs), and the nightly run also walks history backwards one chunk at a time.

const API = 'https://health.googleapis.com/v4/users/me'
export const SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.nutrition.readonly',
]
const RUN_TYPES = new Set(['RUNNING', 'TRAIL_RUN', 'TREADMILL'])
const PIECE_DAYS = 14 // heart-rate and total-calories allow at most 14 days per request
const RECENT_DAYS = 2
const FIRST_SYNC_DAYS = 14
const BACKFILL_CHUNK_DAYS = 90
const BACKFILL_FLOOR_DAYS = 730
export const CONSENT_PATH = '/auth/google'

// --- civil days ----------------------------------------------------------------------------

type GDate = { year: number; month: number; day: number }

export const addDays = (day: string, n: number): string => {
  const d = new Date(day + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const today = (): string => new Date().toLocaleDateString('en-CA', { timeZone: config.timeZone })
const toGDate = (day: string): GDate => {
  const [year, month, day_] = day.split('-').map(Number)
  return { year: year!, month: month!, day: day_! }
}
const fromGDate = (d: GDate): string =>
  `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`

/** Split [start, end) into pieces of at most `size` days. */
export function pieces(start: string, end: string, size = PIECE_DAYS): [string, string][] {
  const out: [string, string][] = []
  for (let from = start; from < end; ) {
    const to = addDays(from, size) < end ? addDays(from, size) : end
    out.push([from, to])
    from = to
  }
  return out
}

// --- OAuth ---------------------------------------------------------------------------------

export class ConsentNeeded extends Error {
  constructor(reason: string) {
    super(`Google Health needs consent (${reason}): open http://localhost:8081${CONSENT_PATH} on the server`)
  }
}

export function consentUrl(state: string): string {
  const { clientId, redirectUri } = config.google
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID is not set in .env')
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent', // always hand out a refresh token
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string }

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  return fetchJson<TokenResponse>('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      ...params,
    }),
  })
}

/** Finish the consent flow: trade the code for tokens and check the account is linked. */
export async function completeConsent(db: Queryable, code: string): Promise<void> {
  const t = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: config.google.redirectUri })
  if (!t.refresh_token) throw new Error('Google returned no refresh token; remove the app at myaccount.google.com/permissions and retry')
  // 400 ACCOUNT_NOT_LINKED when the Google account never signed in to the Google Health app.
  await fetchJson(`${API}/identity`, { headers: { Authorization: `Bearer ${t.access_token}` } })
  await saveToken(db, 'google_health', {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: new Date(Date.now() + t.expires_in * 1000),
  })
}

async function accessToken(db: Queryable): Promise<string> {
  const stored = await loadToken(db, 'google_health')
  if (!stored?.refreshToken) throw new ConsentNeeded('never connected')
  if (stored.expiresAt.getTime() - Date.now() > 60_000) return stored.accessToken
  try {
    const t = await tokenRequest({ refresh_token: stored.refreshToken, grant_type: 'refresh_token' })
    await saveToken(db, 'google_health', {
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? null, // null keeps the stored one
      expiresAt: new Date(Date.now() + t.expires_in * 1000),
    })
    return t.access_token
  } catch (err) {
    if (err instanceof HttpError && err.status === 400 && err.body.includes('invalid_grant')) {
      throw new ConsentNeeded('refresh token expired or revoked')
    }
    throw err
  }
}

// --- API calls -----------------------------------------------------------------------------

type Api = {
  list: (dataType: string, filter: string, pageSize?: number) => Promise<any[]>
  daily: (dataType: string, start: string, end: string) => Promise<any[]>
}

function client(token: string): Api {
  const headers = { Authorization: `Bearer ${token}` }
  return {
    async list(dataType, filter, pageSize = 1000) {
      const out: any[] = []
      let pageToken = ''
      do {
        const q = new URLSearchParams({ filter, pageSize: String(pageSize), ...(pageToken ? { pageToken } : {}) })
        const res = await fetchJson<{ dataPoints?: any[]; nextPageToken?: string }>(
          `${API}/dataTypes/${dataType}/dataPoints?${q}`, { headers })
        out.push(...(res.dataPoints ?? []))
        pageToken = res.nextPageToken ?? ''
      } while (pageToken)
      return out
    },
    async daily(dataType, start, end) {
      const res = await fetchJson<{ rollupDataPoints?: any[] }>(
        `${API}/dataTypes/${dataType}/dataPoints:dailyRollUp`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            range: { start: { date: toGDate(start) }, end: { date: toGDate(end) } },
            windowSizeDays: 1,
          }),
        })
      return res.rollupDataPoints ?? []
    },
  }
}

// --- transform -----------------------------------------------------------------------------

export type GoogleRows = {
  daily: { date: string; metric: string; value: number }[]
  runs: {
    source_id: string; date: string; start_at: string; end_at: string; duration_s: number
    distance_m: number | null; avg_pace_s_per_km: number | null; avg_hr: number | null
    hr_zone_min: Record<string, number> | null; kcal: number | null; elevation_m: number | null
  }[]
  sleeps: { source_id: string; date: string; start_at: string; end_at: string; stages: object }[]
}

const n = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
const seconds = (duration: unknown): number | null => n(typeof duration === 'string' ? duration.replace(/s$/, '') : null)
const civilDay = (civil: { date?: GDate } | undefined): string | null => (civil?.date ? fromGDate(civil.date) : null)
// Sessions carry an instant plus the UTC offset the user was in ("25200s"), not always the
// civil time the docs list. The local day is the instant shifted by that offset.
export const localDay = (time: string | undefined, offset: string | undefined, civil?: { date?: GDate }): string | null => {
  if (civil?.date) return fromGDate(civil.date)
  if (!time) return null
  const shift = seconds(offset) ?? 0
  return new Date(Date.parse(time) + shift * 1000).toISOString().slice(0, 10)
}

/** Raw Google data points → our rows. Pure, so it is unit-tested against fixtures. */
export function transform(raw: {
  steps: any[]; totalCalories: any[]; activeEnergy: any[]
  restingHr: any[]; hrv: any[]; vo2max: any[]; weight: any[]; exercise: any[]; sleep: any[]
}): GoogleRows {
  const daily: GoogleRows['daily'] = []
  const push = (date: string | null, metric: string, value: number | null) => {
    if (date && value !== null) daily.push({ date, metric, value })
  }

  for (const p of raw.steps) push(civilDay(p.civilStartTime), 'steps', n(p.steps?.countSum))
  for (const p of raw.totalCalories) push(civilDay(p.civilStartTime), 'total_kcal_out', n(p.totalCalories?.kcalSum))
  for (const p of raw.activeEnergy) push(civilDay(p.civilStartTime), 'active_kcal', n(p.activeEnergyBurned?.kcalSum))
  for (const p of raw.restingHr) {
    push(p.dailyRestingHeartRate?.date && fromGDate(p.dailyRestingHeartRate.date), 'resting_hr', n(p.dailyRestingHeartRate?.beatsPerMinute))
  }
  for (const p of raw.hrv) {
    const v = p.dailyHeartRateVariability
    push(v?.date && fromGDate(v.date), 'hrv_ms', n(v?.averageHeartRateVariabilityMilliseconds))
  }
  for (const p of raw.vo2max) push(p.dailyVo2Max?.date && fromGDate(p.dailyVo2Max.date), 'vo2max', n(p.dailyVo2Max?.vo2Max))

  // Weight: the first reading of each day (the morning weigh-in), never carried forward.
  const firstWeight = new Map<string, { at: string; kg: number }>()
  for (const p of raw.weight) {
    const day = localDay(p.weight?.sampleTime?.physicalTime, p.weight?.sampleTime?.utcOffset, p.weight?.sampleTime?.civilTime)
    const grams = n(p.weight?.weightGrams)
    const at = p.weight?.sampleTime?.physicalTime
    if (!day || grams === null || !at) continue
    const seen = firstWeight.get(day)
    if (!seen || at < seen.at) firstWeight.set(day, { at, kg: Math.round(grams / 10) / 100 })
  }
  for (const [day, w] of firstWeight) push(day, 'weight_kg', w.kg)

  const runs: GoogleRows['runs'] = []
  for (const p of raw.exercise) {
    const e = p.exercise
    if (!e || !RUN_TYPES.has(e.exerciseType) || !p.name) continue
    const start = e.interval?.startTime
    const end = e.interval?.endTime
    const date = localDay(start, e.interval?.startUtcOffset, e.interval?.civilStartTime)
    if (!start || !end || !date) continue
    const m = e.metricsSummary ?? {}
    const duration = seconds(e.activeDuration) ?? (Date.parse(end) - Date.parse(start)) / 1000
    const distanceM = n(m.distanceMillimeters) === null ? null : n(m.distanceMillimeters)! / 1000
    const pace = n(m.averagePaceSecondsPerMeter)
    const zones = m.heartRateZoneDurations
    runs.push({
      source_id: p.name,
      date,
      start_at: start,
      end_at: end,
      duration_s: Math.round(duration),
      distance_m: distanceM === null ? null : Math.round(distanceM * 10) / 10,
      avg_pace_s_per_km: pace !== null ? Math.round(pace * 1000) : distanceM ? Math.round(duration / (distanceM / 1000)) : null,
      avg_hr: n(m.averageHeartRateBeatsPerMinute),
      hr_zone_min: zones
        ? Object.fromEntries(
            ['light', 'moderate', 'vigorous', 'peak'].map((z) => [z, Math.round((seconds(zones[`${z}Time`]) ?? 0) / 6) / 10]))
        : null,
      kcal: n(m.caloriesKcal) === null ? null : Math.round(n(m.caloriesKcal)!),
      elevation_m: n(m.elevationGainMillimeters) === null ? null : Math.round(n(m.elevationGainMillimeters)! / 100) / 10,
    })
  }

  const sleeps: GoogleRows['sleeps'] = []
  for (const p of raw.sleep) {
    const s = p.sleep
    const date = localDay(s?.interval?.endTime, s?.interval?.endUtcOffset, s?.interval?.civilEndTime) // the wake-up day
    if (!s || !p.name || !date || !s.interval.startTime || !s.interval.endTime) continue
    sleeps.push({
      source_id: p.name,
      date,
      start_at: s.interval.startTime,
      end_at: s.interval.endTime,
      stages: {
        type: s.type ?? null,
        minutesAsleep: n(s.summary?.minutesAsleep),
        minutesAwake: n(s.summary?.minutesAwake),
        stages: (s.stages ?? []).map((st: any) => ({ type: st.type, start: st.startTime, end: st.endTime })),
      },
    })
  }

  return { daily, runs, sleeps }
}

// --- sync ----------------------------------------------------------------------------------

type Cursor = { syncedThrough?: string; backfilledFrom?: string; backfillDone?: boolean }

async function fetchRange(api: Api, start: string, end: string) {
  const civil = (field: string) => `${field} >= "${start}" AND ${field} < "${end}"`
  const raw = { steps: [], totalCalories: [], activeEnergy: [], restingHr: [], hrv: [], vo2max: [], weight: [], exercise: [], sleep: [] } as Record<string, any[]>
  for (const [from, to] of pieces(start, end)) {
    raw.steps!.push(...(await api.daily('steps', from, to)))
    raw.totalCalories!.push(...(await api.daily('total-calories', from, to)))
    raw.activeEnergy!.push(...(await api.daily('active-energy-burned', from, to)))
  }
  raw.restingHr = await api.list('daily-resting-heart-rate', civil('daily_resting_heart_rate.date'))
  raw.hrv = await api.list('daily-heart-rate-variability', civil('daily_heart_rate_variability.date'))
  raw.vo2max = await api.list('daily-vo2-max', civil('daily_vo2_max.date'))
  raw.weight = await api.list('weight', civil('weight.sample_time.civil_time'))
  raw.exercise = await api.list('exercise', civil('exercise.interval.civil_start_time'), 25)
  raw.sleep = await api.list('sleep', civil('sleep.interval.civil_end_time'), 25)
  return transform(raw as Parameters<typeof transform>[0])
}

async function store(db: Queryable, api: Api, start: string, end: string, rows: GoogleRows): Promise<number> {
  // Heart-rate samples only for the time ranges covered by a run (spec: hr_sample).
  const samples = new Map<string, number>()
  const maxHr = new Map<string, number>()
  for (const run of rows.runs) {
    const points = await api.list('heart-rate',
      `heart_rate.sample_time.physical_time >= "${run.start_at}" AND heart_rate.sample_time.physical_time < "${run.end_at}"`, 10000)
    for (const p of points) {
      const at = p.heartRate?.sampleTime?.physicalTime
      const bpm = n(p.heartRate?.beatsPerMinute)
      if (!at || bpm === null) continue
      samples.set(at, bpm)
      maxHr.set(run.source_id, Math.max(maxHr.get(run.source_id) ?? 0, bpm))
    }
  }

  return tx(async (c) => {
    // The window is re-fetched in full, so whatever it no longer returns was deleted upstream.
    await c.query('DELETE FROM gh_daily WHERE date >= $1 AND date < $2', [start, end])
    for (const d of rows.daily) {
      await c.query(
        'INSERT INTO gh_daily (date, metric, value) VALUES ($1, $2, $3) ON CONFLICT (date, metric) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
        [d.date, d.metric, d.value])
    }
    await c.query('DELETE FROM run_session WHERE date >= $1 AND date < $2 AND NOT (source_id = ANY($3))',
      [start, end, rows.runs.map((r) => r.source_id)])
    for (const r of rows.runs) {
      await c.query(
        `INSERT INTO run_session (source_id, date, start_at, duration_s, distance_m, avg_pace_s_per_km, avg_hr, max_hr, hr_zone_min, kcal, elevation_m)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (source_id) DO UPDATE SET date = EXCLUDED.date, start_at = EXCLUDED.start_at,
           duration_s = EXCLUDED.duration_s, distance_m = EXCLUDED.distance_m,
           avg_pace_s_per_km = EXCLUDED.avg_pace_s_per_km, avg_hr = EXCLUDED.avg_hr, max_hr = EXCLUDED.max_hr,
           hr_zone_min = EXCLUDED.hr_zone_min, kcal = EXCLUDED.kcal, elevation_m = EXCLUDED.elevation_m`,
        [r.source_id, r.date, r.start_at, r.duration_s, r.distance_m, r.avg_pace_s_per_km, r.avg_hr,
          maxHr.get(r.source_id) ?? null, r.hr_zone_min && JSON.stringify(r.hr_zone_min), r.kcal, r.elevation_m])
    }
    for (const [ts, bpm] of samples) {
      await c.query('INSERT INTO hr_sample (ts, bpm) VALUES ($1, $2) ON CONFLICT (ts) DO UPDATE SET bpm = EXCLUDED.bpm', [ts, bpm])
    }
    await c.query('DELETE FROM sleep_session WHERE date >= $1 AND date < $2 AND NOT (source_id = ANY($3))',
      [start, end, rows.sleeps.map((s) => s.source_id)])
    for (const s of rows.sleeps) {
      await c.query(
        `INSERT INTO sleep_session (source_id, date, start_at, end_at, stages) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source_id) DO UPDATE SET date = EXCLUDED.date, start_at = EXCLUDED.start_at,
           end_at = EXCLUDED.end_at, stages = EXCLUDED.stages`,
        [s.source_id, s.date, s.start_at, s.end_at, JSON.stringify(s.stages)])
    }
    return rows.daily.length + rows.runs.length + rows.sleeps.length + samples.size
  })
}

async function saveCursor(db: Queryable, cursor: Cursor): Promise<void> {
  await db.query(
    `INSERT INTO sync_cursor (source, cursor) VALUES ('google_health', $1)
     ON CONFLICT (source) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = now()`,
    [JSON.stringify(cursor)])
}

const daysIn = (start: string, end: string) => {
  const out: string[] = []
  for (let d = start; d < end; d = addDays(d, 1)) out.push(d)
  return out
}

export async function syncGoogleHealth(db: Queryable, job?: Pick<SyncJob, 'trigger'>): Promise<SyncResult> {
  const api = client(await accessToken(db))
  const { rows: cur } = await db.query("SELECT cursor FROM sync_cursor WHERE source = 'google_health'")
  const cursor: Cursor = cur[0]?.cursor ?? {}
  const end = addDays(today(), 1)

  // Recent window: the last few days, stretched back to the last synced day after downtime.
  let start = cursor.syncedThrough ? addDays(cursor.syncedThrough, -RECENT_DAYS) : addDays(end, -FIRST_SYNC_DAYS)
  if (start > addDays(end, -RECENT_DAYS - 1)) start = addDays(end, -RECENT_DAYS - 1)
  if (start < addDays(end, -BACKFILL_CHUNK_DAYS)) start = addDays(end, -BACKFILL_CHUNK_DAYS)

  let rows = await store(db, api, start, end, await fetchRange(api, start, end))
  const dates = daysIn(start, end)
  cursor.syncedThrough = today()
  cursor.backfilledFrom = cursor.backfilledFrom && cursor.backfilledFrom < start ? cursor.backfilledFrom : start

  // History: one chunk per nightly run, until a chunk comes back empty or we hit the floor.
  if (job?.trigger === 'cron' && !cursor.backfillDone) {
    const to = cursor.backfilledFrom
    const from = addDays(to, -BACKFILL_CHUNK_DAYS)
    const chunk = await fetchRange(api, from, to)
    const found = chunk.daily.length + chunk.runs.length + chunk.sleeps.length
    rows += await store(db, api, from, to, chunk)
    dates.push(...daysIn(from, to))
    cursor.backfilledFrom = from
    cursor.backfillDone = found === 0 || from <= addDays(end, -BACKFILL_FLOOR_DAYS)
  }

  await saveCursor(db, cursor)
  return { rows, dates }
}
