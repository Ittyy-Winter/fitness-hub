import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { config } from '../config.ts'
import { tx, type Queryable } from '../db.ts'
import { fetchJson, HttpError } from '../http.ts'
import { loadToken, saveToken } from '../secrets.ts'

// openGym (spec: Data sources → openGym API). Read-only: the hub never writes back.
// Auth is a bearer token from pairing; the state is one JSON document per profile, so a
// sync is "has the revision moved? then fetch it all and diff by workout".

const LB_TO_KG = 0.45359237
const SESSION_DAYS = 90 // openGym's default SESSION_DAYS

type OgSet = { w?: number; r?: number; done?: boolean; rir?: number; rpe?: number; phase?: string; warmup?: boolean }
type OgEntry = { id: string; sets?: OgSet[] }
type OgWorkout = {
  id: string; d?: string; start?: number; end?: number; routineId?: string; name?: string
  vol?: number; prs?: string[]; entries?: OgEntry[]
}
type OgState = {
  _wid?: string
  unit?: 'kg' | 'lb'
  workouts?: OgWorkout[]
  routines?: { id: string; name?: string }[]
  customEx?: { id: string; n?: string; bp?: string }[]
}

export type GymWorkoutRow = {
  opengym_id: string; date: string; routine: string | null; duration_s: number | null
  total_volume_kg: number | null; prs: { id: string; name: string }[]; src_hash: string
}
export type GymSetRow = {
  id: string; workout_id: string; exercise: string; muscle: string | null; set_no: number
  weight_kg: number | null; reps: number | null; rir: number | null; is_warmup: boolean
}

// Exercise id → [name, target muscle], generated from openGym's catalogue when the image is
// built (hub/Dockerfile). Without it sets keep the bare id, which is still correct data.
export type Catalogue = Record<string, [string, string | null]>
let catalogue: Catalogue | undefined
function loadCatalogue(): Catalogue {
  if (!catalogue) {
    try {
      catalogue = JSON.parse(readFileSync(new URL('./opengym-exercises.json', import.meta.url), 'utf8')) as Catalogue
    } catch {
      console.warn('opengym-exercises.json missing: exercise names fall back to ids')
      catalogue = {}
    }
  }
  return catalogue
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places

// Same rule as openGym's phaseForSet(): an explicit phase wins over the legacy boolean.
function isWarmup(s: OgSet): boolean {
  if (s.phase != null && s.phase !== '') return /^warm[-_]?up$/i.test(String(s.phase).trim())
  return s.warmup === true
}

function bangkokDay(ms: number): string {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: config.timeZone })
}

/** openGym state → our rows. Pure, so it is unit-tested against fixtures. */
export function workoutsFromState(
  state: OgState, exercises: Catalogue = loadCatalogue(),
): { workout: GymWorkoutRow; sets: GymSetRow[] }[] {
  const toKg = state.unit === 'lb' ? LB_TO_KG : 1
  const custom = new Map((state.customEx ?? []).map((e) => [e.id, e]))
  const routines = new Map((state.routines ?? []).map((r) => [r.id, r.name]))
  const exercise = (id: string): [string, string | null] => {
    const c = custom.get(id)
    if (c) return [c.n ?? id, c.bp ?? null]
    const known = exercises[id]
    return known ? [capitalise(known[0]), known[1]] : [id, null]
  }

  return (state.workouts ?? [])
    .filter((w) => w && typeof w.id === 'string' && (w.d || num(w.start) !== null))
    .map((w) => {
      const sets: GymSetRow[] = []
      let computedVolume = 0
      ;(w.entries ?? []).forEach((entry, ei) => {
        const [name, muscle] = exercise(entry.id)
        let setNo = 0
        ;(entry.sets ?? []).forEach((s, si) => {
          if (!s?.done) return
          const weight = num(s.w)
          const reps = num(s.r)
          const warm = isWarmup(s)
          if (!warm && weight !== null && reps !== null) computedVolume += weight * reps
          const rpe = num(s.rpe)
          sets.push({
            id: `${w.id}:${ei}:${si}`,
            workout_id: w.id,
            exercise: name,
            muscle,
            set_no: ++setNo,
            weight_kg: weight === null ? null : round(weight * toKg, 2),
            reps: reps === null ? null : Math.round(reps),
            rir: num(s.rir) ?? (rpe === null ? null : Math.max(0, Math.round(10 - rpe))),
            is_warmup: warm,
          })
        })
      })
      const start = num(w.start)
      const end = num(w.end)
      // openGym writes `vol` (warm-ups, per-side and per-dumbbell rules already applied);
      // our own sum is only a fallback for workouts saved without it.
      const volume = num(w.vol) ?? (sets.length ? computedVolume : null)
      return {
        workout: {
          opengym_id: w.id,
          date: w.d ?? bangkokDay(start!),
          routine: w.name ?? (w.routineId ? routines.get(w.routineId) ?? null : null),
          duration_s: start !== null && end !== null && end > start ? Math.round((end - start) / 1000) : null,
          total_volume_kg: volume === null ? null : round(volume * toKg, 1),
          prs: (w.prs ?? []).map((id) => ({ id, name: exercise(id)[0] })),
          src_hash: createHash('sha1').update(state.unit ?? 'kg').update(JSON.stringify(w)).digest('hex'),
        },
        sets,
      }
    })
}

// --- I/O -----------------------------------------------------------------------------------

async function call<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  return fetchJson<T>(config.opengymUrl + path, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
}

/** Redeem a pairing code from openGym's Settings → "Pair the mobile app". */
export async function pair(db: Queryable, code: string): Promise<string> {
  const res = await fetchJson<{ token: string; user: { name?: string } }>(config.opengymUrl + '/api/pair/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.trim() }),
  })
  await saveToken(db, 'opengym', {
    accessToken: res.token,
    refreshToken: null,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
  })
  return res.user?.name ?? 'profile'
}

export type SyncResult = { rows: number; dates: string[] }

export async function syncOpengym(db: Queryable): Promise<SyncResult> {
  const stored = await loadToken(db, 'opengym')
  if (!stored) throw new Error('openGym is not paired yet: run `scripts/hub-cli.sh opengym-pair <CODE>`')
  let token = stored.accessToken

  try {
    // Past half its lifetime, /api/me hands back a renewed token; keep it.
    const me = await call<{ token?: string }>('/api/me', token)
    if (me.token) {
      token = me.token
      await saveToken(db, 'opengym', {
        accessToken: token, refreshToken: null, expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
      })
    }
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      throw new Error('openGym token expired or revoked: pair again with `scripts/hub-cli.sh opengym-pair <CODE>`')
    }
    throw err
  }

  const { rows: cur } = await db.query("SELECT cursor FROM sync_cursor WHERE source = 'opengym'")
  const last = cur[0]?.cursor as { rev: number; wid?: string } | undefined
  const head = await call<{ rev: number; wid?: string }>('/api/data/rev', token)
  if (last && last.rev === head.rev && last.wid === head.wid) return { rows: 0, dates: [] }

  const { state, rev } = await call<{ state: OgState | null; rev: number }>('/api/data', token)
  const incoming = workoutsFromState(state ?? {})

  return tx(async (c) => {
    const { rows: existing } = await c.query('SELECT opengym_id, date, src_hash FROM gym_workout')
    const before = new Map(existing.map((r) => [r.opengym_id as string, r as { date: string; src_hash: string | null }]))
    const dates = new Set<string>()
    let rows = 0

    for (const { workout: w, sets } of incoming) {
      const old = before.get(w.opengym_id)
      before.delete(w.opengym_id)
      if (old?.src_hash === w.src_hash) continue
      if (old) dates.add(old.date) // the workout may have moved to another day
      dates.add(w.date)
      await c.query(
        `INSERT INTO gym_workout (opengym_id, date, routine, duration_s, total_volume_kg, prs, src_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (opengym_id) DO UPDATE SET date = EXCLUDED.date, routine = EXCLUDED.routine,
           duration_s = EXCLUDED.duration_s, total_volume_kg = EXCLUDED.total_volume_kg,
           prs = EXCLUDED.prs, src_hash = EXCLUDED.src_hash`,
        [w.opengym_id, w.date, w.routine, w.duration_s, w.total_volume_kg, JSON.stringify(w.prs), w.src_hash],
      )
      await c.query('DELETE FROM gym_set WHERE workout_id = $1', [w.opengym_id])
      for (const s of sets) {
        await c.query(
          `INSERT INTO gym_set (id, workout_id, exercise, muscle, set_no, weight_kg, reps, rir, is_warmup)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [s.id, s.workout_id, s.exercise, s.muscle, s.set_no, s.weight_kg, s.reps, s.rir, s.is_warmup],
        )
      }
      rows += 1 + sets.length
    }

    // Whatever is left was deleted in openGym.
    for (const [id, old] of before) {
      await c.query('DELETE FROM gym_workout WHERE opengym_id = $1', [id])
      dates.add(old.date)
      rows += 1
    }

    await c.query(
      `INSERT INTO sync_cursor (source, cursor) VALUES ('opengym', $1)
       ON CONFLICT (source) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = now()`,
      [JSON.stringify({ rev, wid: state?._wid })],
    )
    return { rows, dates: [...dates] }
  })
}
