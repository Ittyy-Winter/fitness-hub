import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Context, Hono } from 'hono'
import { config } from './config.ts'
import { addDays, today } from './dates.ts'
import type { Queryable } from './db.ts'

// Read-only routes behind the dashboard PWA (spec: "Dashboard PWA"). One request per page, each
// already shaped for its screen, so a page renders from a single cached response. Days are
// calendar days in Asia/Bangkok; weeks start on Monday.

const Day = /^\d{4}-\d{2}-\d{2}$/
const mealDay = `(eaten_at AT TIME ZONE 'Asia/Bangkok')::date`
const RECOVERY = ['sleep_min', 'hrv_ms', 'resting_hr'] as const
const ANALYSIS_KINDS = ['daily', 'run', 'workout', 'weekly', 'meal']

// Monday of the week containing `day`.
export const weekStart = (day: string): string => {
  const dow = new Date(day + 'T00:00:00Z').getUTCDay() // 0 = Sunday
  return addDays(day, -((dow + 6) % 7))
}

async function goals(db: Queryable): Promise<Record<string, number>> {
  const { rows } = await db.query('SELECT key, value FROM goal')
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

async function latestAnalysis(db: Queryable, kind: string) {
  const { rows } = await db.query(
    `SELECT id, date, kind, title, summary_md, scores, recommendations, created_at
       FROM analysis WHERE kind = $1 ORDER BY date DESC, created_at DESC LIMIT 1`, [kind])
  return rows[0] ?? null
}

export async function syncStatus(db: Queryable) {
  const { rows } = await db.query(`
    SELECT DISTINCT ON (source) id, source, status, error, queued_at, finished_at
      FROM sync_log ORDER BY source, queued_at DESC`)
  // "Last updated" is the newest successful finish, which an in-flight job must not hide.
  const { rows: ok } = await db.query(`
    SELECT source, max(finished_at) AS last_ok FROM sync_log WHERE status = 'ok' GROUP BY source`)
  return rows.map((r) => ({ ...r, last_ok: ok.find((o) => o.source === r.source)?.last_ok ?? null }))
}

export async function todayPage(db: Queryable, date: string) {
  const { rows: meals } = await db.query(
    `SELECT id, eaten_at, name, items, kcal, protein_g, carb_g, fat_g, confidence, photo_url, note
       FROM meal WHERE ${mealDay} = $1 ORDER BY eaten_at`, [date])
  const { rows: [day] } = await db.query('SELECT * FROM daily_summary WHERE date = $1', [date])
  const { rows: [avg] } = await db.query(
    `SELECT ${[...RECOVERY, 'steps'].map((f) => `avg(${f}) AS ${f}`).join(', ')}
       FROM daily_summary WHERE date >= $1 AND date < $2`, [addDays(date, -7), date])
  // Overnight data is often missing, so say when each was last recorded instead of a bare null.
  const { rows: [last] } = await db.query(
    `SELECT ${RECOVERY.map((f) => `(SELECT max(date) FROM daily_summary WHERE ${f} IS NOT NULL AND date <= $1) AS ${f}`).join(', ')}`,
    [date])
  const monday = weekStart(date)
  const { rows: [week] } = await db.query(
    `SELECT (SELECT count(*) FROM gym_workout WHERE date BETWEEN $1 AND $2)::int AS gym_sessions,
            (SELECT coalesce(sum(distance_m), 0) / 1000 FROM run_session WHERE date BETWEEN $1 AND $2)::float AS run_km`,
    [monday, addDays(monday, 6)])
  const sum = (k: string) => meals.reduce((a, m) => a + Number(m[k]), 0)
  const pick = (f: string) => (day?.[f] ?? null) as number | null
  return {
    today: today(),
    date,
    goals: await goals(db),
    meals,
    totals: { kcal: sum('kcal'), protein_g: sum('protein_g'), carb_g: sum('carb_g'), fat_g: sum('fat_g') },
    activity: { steps: pick('steps'), steps_avg_7d: avg.steps, kcal_out: pick('total_kcal_out'), active_kcal: pick('active_kcal') },
    recovery: Object.fromEntries(RECOVERY.map((f) => [f, { value: pick(f), avg_7d: avg[f], last_recorded: last[f] }])),
    week: { start: monday, ...week },
    analysis: await latestAnalysis(db, 'daily'),
    sync: await syncStatus(db),
  }
}

export async function trainingPage(db: Queryable, date: string) {
  const from = addDays(weekStart(date), -7 * 11) // 12 weeks including this one
  const { rows: workouts } = await db.query(
    `SELECT opengym_id AS id, date, routine, duration_s, total_volume_kg, prs
       FROM gym_workout WHERE date >= $1 ORDER BY date DESC`, [from])
  const latest = workouts[0] ?? null
  const { rows: sets } = latest ? await db.query(
    `SELECT exercise, muscle, set_no, weight_kg, reps, rir, is_warmup FROM gym_set
      WHERE workout_id = $1 ORDER BY id`, [latest.id]) : { rows: [] }
  const { rows: weeks } = await db.query(
    `SELECT date_trunc('week', date)::date AS week, count(*)::int AS sessions,
            coalesce(sum(total_volume_kg), 0)::float AS volume_kg
       FROM gym_workout WHERE date >= $1 GROUP BY 1 ORDER BY 1`, [from])
  // Working sets per muscle: this week next to the average of the 4 weeks before it.
  const monday = weekStart(date)
  const { rows: muscles } = await db.query(
    `SELECT coalesce(s.muscle, 'other') AS muscle,
            count(*) FILTER (WHERE w.date >= $2)::int AS sets_this_week,
            round(count(*) FILTER (WHERE w.date < $2) / 4.0, 1)::float AS sets_avg_4w
       FROM gym_set s JOIN gym_workout w ON w.opengym_id = s.workout_id
      WHERE w.date BETWEEN $1 AND $3 AND NOT s.is_warmup
      GROUP BY 1 ORDER BY 2 DESC, 3 DESC`, [addDays(monday, -28), monday, addDays(monday, 6)])
  return {
    today: today(),
    goals: await goals(db),
    week_start: monday,
    workouts,
    latest: latest && { ...latest, sets },
    weeks,
    muscles,
    analysis: await latestAnalysis(db, 'workout'),
  }
}

export async function runningPage(db: Queryable, date: string) {
  const from = addDays(weekStart(date), -7 * 11)
  const { rows: runs } = await db.query(
    `SELECT source_id AS id, date, start_at, duration_s, distance_m, avg_pace_s_per_km, avg_hr, max_hr,
            hr_zone_min, kcal, elevation_m
       FROM run_session WHERE date >= $1 ORDER BY start_at DESC`, [from])
  const { rows: [latest] } = await db.query(
    `SELECT source_id AS id, date, start_at, end_at, duration_s, distance_m, avg_pace_s_per_km, avg_hr, max_hr,
            hr_zone_min, kcal, elevation_m, splits
       FROM run_session ORDER BY start_at DESC LIMIT 1`)
  const { rows: hr } = latest ? await db.query(
    `SELECT round(extract(epoch FROM min(ts) - $1::timestamptz) / 60, 1)::float AS min, round(avg(bpm))::int AS bpm
       FROM (SELECT ts, bpm, ntile(90) OVER (ORDER BY ts) AS b FROM hr_sample WHERE ts >= $1 AND ts < $2) s
      GROUP BY b ORDER BY b`,
    [latest.start_at, latest.end_at ?? new Date(latest.start_at.getTime() + latest.duration_s * 1000)]) : { rows: [] }
  const { rows: weeks } = await db.query(
    `SELECT date_trunc('week', date)::date AS week, count(*)::int AS runs,
            round(coalesce(sum(distance_m), 0) / 1000, 2)::float AS km
       FROM run_session WHERE date >= $1 GROUP BY 1 ORDER BY 1`, [from])
  const { rows: vo2max } = await db.query(
    `SELECT date, vo2max FROM daily_summary WHERE vo2max IS NOT NULL AND date > $1 ORDER BY date`,
    [addDays(date, -180)])
  return {
    today: today(),
    goals: await goals(db),
    runs,
    latest: latest ? { ...latest, hr } : null,
    weeks,
    vo2max,
    analysis: await latestAnalysis(db, 'run'),
  }
}

export async function bodyPage(db: Queryable, date: string) {
  const { rows: weight } = await db.query(
    `SELECT date, weight_kg FROM daily_summary WHERE weight_kg IS NOT NULL AND date > $1 ORDER BY date`,
    [addDays(date, -365)])
  // 7-day averages only over the days that have data, so missing days don't drag them to zero.
  const { rows: energy } = await db.query(
    `SELECT d::date AS date, s.kcal_in, s.total_kcal_out AS kcal_out, s.steps,
            avg(s.kcal_in) OVER w AS kcal_in_7d, avg(s.total_kcal_out) OVER w AS kcal_out_7d,
            count(s.kcal_in) OVER w AS kcal_in_days
       FROM generate_series($1::date, $2::date, interval '1 day') d
       LEFT JOIN daily_summary s ON s.date = d::date
     WINDOW w AS (ORDER BY d ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
      ORDER BY d`, [addDays(date, -89 - 6), date])
  return {
    today: today(),
    goals: await goals(db),
    weight,
    energy: energy.slice(6),
  }
}

export async function insightsPage(db: Queryable, kind: string | null, before: string | null, limit: number) {
  const { rows } = await db.query(
    `SELECT id, date, kind, title, summary_md, scores, recommendations, created_at FROM analysis
      WHERE ($1::text IS NULL OR kind = $1) AND ($2::date IS NULL OR date < $2)
      ORDER BY date DESC, created_at DESC LIMIT $3`, [kind, before, limit + 1])
  return { analyses: rows.slice(0, limit), more: rows.length > limit }
}

function dayParam(c: Context): string | null {
  const date = c.req.query('date') ?? today()
  return Day.test(date) ? date : null
}

const PHOTO_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic',
}

export function dashboardRoutes(app: Hono, db: Queryable): void {
  const page = (route: string, load: (date: string) => Promise<unknown>) =>
    app.get(route, async (c) => {
      const date = dayParam(c)
      if (!date) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
      c.header('Cache-Control', 'no-store')
      return c.json(await load(date))
    })
  page('/api/today', (d) => todayPage(db, d))
  page('/api/training', (d) => trainingPage(db, d))
  page('/api/running', (d) => runningPage(db, d))
  page('/api/body', (d) => bodyPage(db, d))

  app.get('/api/insights', async (c) => {
    const kind = c.req.query('kind') ?? null
    const before = c.req.query('before') ?? null
    if (kind && !ANALYSIS_KINDS.includes(kind)) return c.json({ error: 'unknown kind' }, 400)
    if (before && !Day.test(before)) return c.json({ error: 'before must be YYYY-MM-DD' }, 400)
    c.header('Cache-Control', 'no-store')
    return c.json(await insightsPage(db, kind, before, 20))
  })

  // Meal photos written by hub-mcp's upload route. Names are generated there, so anything
  // else is refused rather than resolved against the directory.
  app.get('/photos/:name{[0-9]+-[0-9a-f]+\\.[a-z]+}', async (c) => {
    const name = c.req.param('name')
    const type = PHOTO_TYPES[path.extname(name).slice(1)]
    if (!type) return c.notFound()
    const bytes = await readFile(path.join(config.photoDir, name)).catch(() => null)
    if (!bytes) return c.notFound()
    return c.body(bytes, 200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable' })
  })
}
