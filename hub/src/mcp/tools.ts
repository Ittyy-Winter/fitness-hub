import { createHash, randomBytes } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { config } from '../config.ts'
import { addDays, daysBetween, today } from '../dates.ts'
import type { Queryable } from '../db.ts'
import { enqueue, getJob, SOURCES } from '../queue.ts'

// The tools Claude uses (spec: "MCP server"). Reads return summarised data, not raw rows, to
// save context. Writes touch only meal, analysis and goal, and each one is audited.

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Calendar day YYYY-MM-DD in Asia/Bangkok')
const MAX_RANGE_DAYS = 120

export const GOALS = {
  kcal_target: 'kcal/day',
  protein_target: 'g/day',
  steps_target: 'steps/day',
  sleep_target: 'min/night',
  weight_target: 'kg',
  weekly_run_km_target: 'km/week',
  weekly_gym_sessions_target: 'sessions/week',
} as const
type GoalKey = keyof typeof GOALS

const SUMMARY_FIELDS = [
  'steps', 'total_kcal_out', 'active_kcal', 'kcal_in', 'protein_g', 'carb_g', 'fat_g', 'sleep_min',
  'resting_hr', 'hrv_ms', 'vo2max', 'weight_kg', 'gym_volume_kg', 'run_km',
] as const
// Filled only on days the watch was worn (overnight for sleep/HRV) or a weigh-in happened.
const WATCH_FIELDS = ['sleep_min', 'hrv_ms', 'resting_hr', 'weight_kg'] as const

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] })
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true })
const round = (v: number | null | undefined, places = 1) =>
  v == null ? null : Math.round(v * 10 ** places) / 10 ** places
const pace = (sPerKm: number | null) =>
  sPerKm == null ? null : `${Math.floor(sPerKm / 60)}:${String(Math.round(sPerKm % 60)).padStart(2, '0')}/km`

function checkRange(from: string, to: string): string | null {
  if (to < from) return '`to` is before `from`'
  if (daysBetween(from, to) > MAX_RANGE_DAYS) return `range is longer than ${MAX_RANGE_DAYS} days; split it`
  return null
}

async function goals(db: Queryable): Promise<Partial<Record<GoalKey, number>>> {
  const { rows } = await db.query('SELECT key, value FROM goal')
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

async function audit(db: Queryable, tool: string, args: unknown): Promise<void> {
  await db.query('INSERT INTO mcp_audit (tool, args) VALUES ($1, $2)', [tool, JSON.stringify(args)])
}

const mealDay = `(eaten_at AT TIME ZONE 'Asia/Bangkok')::date`

async function dayTotals(db: Queryable, date: string) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS meals, coalesce(sum(kcal), 0)::int AS kcal, coalesce(sum(protein_g), 0) AS protein_g,
            coalesce(sum(carb_g), 0) AS carb_g, coalesce(sum(fat_g), 0) AS fat_g
       FROM meal WHERE ${mealDay} = $1`, [date])
  const g = await goals(db)
  const t = rows[0]
  return {
    date,
    meals: t.meals,
    kcal: t.kcal,
    protein_g: round(t.protein_g),
    carb_g: round(t.carb_g),
    fat_g: round(t.fat_g),
    kcal_remaining: g.kcal_target != null ? Math.round(g.kcal_target - t.kcal) : null,
    protein_remaining_g: g.protein_target != null ? round(g.protein_target - t.protein_g) : null,
  }
}

async function syncState(db: Queryable) {
  const { rows } = await db.query(`
    SELECT DISTINCT ON (source) id AS sync_id, source, trigger, status, rows, error, finished_at,
           round(extract(epoch FROM now() - finished_at) / 3600, 1)::float AS hours_ago
      FROM sync_log ORDER BY source, queued_at DESC`)
  return rows
}

export function registerTools(server: McpServer, db: Queryable): void {
  const read = { readOnlyHint: true, openWorldHint: false }
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }

  // --- reads -------------------------------------------------------------------------------

  server.registerTool('get_day_summary', {
    title: 'Day summary',
    description:
      "One day's totals: steps, kcal out (total and active), kcal and macros eaten (g), sleep (min asleep), " +
      'resting HR (bpm), HRV (ms), VO2 max, weight (kg, first weigh-in of the day), gym volume (kg), run distance (km). ' +
      'Also the average of the 7 days before it and progress against goals. Null means no data: the owner often ' +
      'does not wear the watch, especially overnight, so missing sleep/HRV/weight is normal, not a sync failure.',
    inputSchema: { date: Day },
    annotations: read,
  }, async ({ date }) => {
    const { rows: [day] } = await db.query('SELECT * FROM daily_summary WHERE date = $1', [date])
    const avgCols = SUMMARY_FIELDS.map((f) => `avg(${f}) AS ${f}, count(${f})::int AS ${f}_days`).join(', ')
    const { rows: [avg] } = await db.query(
      `SELECT ${avgCols} FROM daily_summary WHERE date >= $1 AND date < $2`, [addDays(date, -7), date])
    const g = await goals(db)
    const avg7 = Object.fromEntries(SUMMARY_FIELDS.map((f) => [f, avg[`${f}_days`] ? round(avg[f]) : null]))
    const v = (f: (typeof SUMMARY_FIELDS)[number]) => (day?.[f] ?? null) as number | null
    return json({
      today: today(),
      date,
      day: day ? Object.fromEntries(SUMMARY_FIELDS.map((f) => [f, v(f)])) : null,
      avg_7d_before: avg7,
      vs_goals: {
        kcal_in_vs_target: g.kcal_target != null && v('kcal_in') != null ? v('kcal_in')! - g.kcal_target : null,
        protein_vs_target_g: g.protein_target != null && v('protein_g') != null ? round(v('protein_g')! - g.protein_target) : null,
        steps_vs_target: g.steps_target != null && v('steps') != null ? v('steps')! - g.steps_target : null,
        sleep_vs_target_min: g.sleep_target != null && v('sleep_min') != null ? v('sleep_min')! - g.sleep_target : null,
        weight_vs_target_kg: g.weight_target != null && v('weight_kg') != null ? round(v('weight_kg')! - g.weight_target, 2) : null,
      },
      goals: g,
      no_watch_data: WATCH_FIELDS.filter((f) => v(f) == null),
    })
  })

  server.registerTool('get_range_summary', {
    title: 'Range summary',
    description:
      `Daily rows for a date range (at most ${MAX_RANGE_DAYS} days, both ends inclusive) plus the average of each ` +
      'metric over the days that have it and how many days had it. Same units as get_day_summary. ' +
      'Use days_with_data before judging a trend: fewer than 5 of 7 days is too thin.',
    inputSchema: { from: Day, to: Day },
    annotations: read,
  }, async ({ from, to }) => {
    const bad = checkRange(from, to)
    if (bad) return fail(bad)
    const { rows } = await db.query(
      `SELECT date, ${SUMMARY_FIELDS.join(', ')} FROM daily_summary WHERE date BETWEEN $1 AND $2 ORDER BY date`, [from, to])
    const stats = Object.fromEntries(SUMMARY_FIELDS.map((f) => {
      const values = rows.map((r) => r[f]).filter((x): x is number => x != null)
      return [f, { avg: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null, days_with_data: values.length }]
    }))
    return json({ from, to, days_in_range: daysBetween(from, to) + 1, stats, days: rows })
  })

  server.registerTool('get_runs', {
    title: 'Runs',
    description:
      'Runs in a date range (inclusive): distance (km), moving time (s), average pace (s/km and m:ss/km), ' +
      'average and max HR (bpm), minutes in each HR zone (light, moderate, vigorous, peak), kcal, elevation gain (m).',
    inputSchema: { from: Day, to: Day },
    annotations: read,
  }, async ({ from, to }) => {
    const bad = checkRange(from, to)
    if (bad) return fail(bad)
    const { rows } = await db.query(
      'SELECT * FROM run_session WHERE date BETWEEN $1 AND $2 ORDER BY start_at', [from, to])
    return json({
      from, to,
      total_km: round(rows.reduce((a, r) => a + (r.distance_m ?? 0), 0) / 1000, 2),
      runs: rows.map((r) => ({
        run_id: r.source_id,
        date: r.date,
        distance_km: r.distance_m == null ? null : round(r.distance_m / 1000, 2),
        moving_time_s: r.duration_s,
        avg_pace_s_per_km: r.avg_pace_s_per_km,
        avg_pace: pace(r.avg_pace_s_per_km),
        avg_hr: r.avg_hr,
        max_hr: r.max_hr,
        hr_zone_min: r.hr_zone_min,
        kcal: r.kcal,
        elevation_m: r.elevation_m,
      })),
    })
  })

  server.registerTool('get_run_detail', {
    title: 'Run detail',
    description:
      'One run (run_id from get_runs): its summary, per-km splits as recorded by the watch, HR over time ' +
      'downsampled to about 60 points (bpm), average HR of the first and second half (for cardiac drift), ' +
      'and the 5 runs before it for comparison.',
    inputSchema: { run_id: z.string() },
    annotations: read,
  }, async ({ run_id }) => {
    const { rows: [run] } = await db.query('SELECT * FROM run_session WHERE source_id = $1', [run_id])
    if (!run) return fail('no run with that run_id; get it from get_runs')
    const end = run.end_at ?? new Date(run.start_at.getTime() + run.duration_s * 1000)
    const { rows: hr } = await db.query(`
      SELECT min(ts) AS at, round(avg(bpm))::int AS bpm, min(half) AS half FROM (
        SELECT ts, bpm, ntile(60) OVER (ORDER BY ts) AS bucket, ntile(2) OVER (ORDER BY ts) AS half
          FROM hr_sample WHERE ts >= $1 AND ts < $2) s
      GROUP BY bucket ORDER BY bucket`, [run.start_at, end])
    const half = (h: number) => {
      const b = hr.filter((p) => p.half === h)
      return b.length ? Math.round(b.reduce((a, p) => a + p.bpm, 0) / b.length) : null
    }
    const { rows: previous } = await db.query(
      `SELECT date, distance_m, avg_pace_s_per_km, avg_hr FROM run_session
        WHERE start_at < $1 ORDER BY start_at DESC LIMIT 5`, [run.start_at])
    return json({
      run_id, date: run.date,
      distance_km: run.distance_m == null ? null : round(run.distance_m / 1000, 2),
      moving_time_s: run.duration_s, avg_pace: pace(run.avg_pace_s_per_km), avg_hr: run.avg_hr, max_hr: run.max_hr,
      hr_zone_min: run.hr_zone_min, elevation_m: run.elevation_m,
      splits: run.splits,
      hr_series: hr.map((p) => ({ min: Math.round((p.at.getTime() - run.start_at.getTime()) / 6000) / 10, bpm: p.bpm })),
      hr_first_half_avg: half(1),
      hr_second_half_avg: half(2),
      previous_runs: previous.map((p) => ({
        date: p.date, distance_km: p.distance_m == null ? null : round(p.distance_m / 1000, 2),
        avg_pace: pace(p.avg_pace_s_per_km), avg_hr: p.avg_hr,
      })),
    })
  })

  server.registerTool('get_workouts', {
    title: 'Gym workouts',
    description:
      'Gym sessions from openGym in a date range (inclusive). Per workout: routine, duration (min), volume (kg), ' +
      'PRs, and per exercise the working sets, top set and volume. For the range: working sets and volume (kg) per ' +
      'muscle, and muscles trained in the 8 weeks before the range but not in it. Warm-up sets are excluded from volume.',
    inputSchema: { from: Day, to: Day },
    annotations: read,
  }, async ({ from, to }) => {
    const bad = checkRange(from, to)
    if (bad) return fail(bad)
    const { rows: workouts } = await db.query(
      'SELECT * FROM gym_workout WHERE date BETWEEN $1 AND $2 ORDER BY date', [from, to])
    const { rows: sets } = await db.query(
      `SELECT s.* FROM gym_set s JOIN gym_workout w ON w.opengym_id = s.workout_id
        WHERE w.date BETWEEN $1 AND $2 ORDER BY s.workout_id, s.id`, [from, to])
    const { rows: byMuscle } = await db.query(
      `SELECT coalesce(s.muscle, 'unknown') AS muscle, count(*)::int AS working_sets,
              round(sum(coalesce(s.weight_kg, 0) * coalesce(s.reps, 0)))::int AS volume_kg
         FROM gym_set s JOIN gym_workout w ON w.opengym_id = s.workout_id
        WHERE w.date BETWEEN $1 AND $2 AND NOT s.is_warmup GROUP BY 1 ORDER BY 3 DESC`, [from, to])
    const { rows: missed } = await db.query(
      `SELECT DISTINCT s.muscle FROM gym_set s JOIN gym_workout w ON w.opengym_id = s.workout_id
        WHERE w.date >= $1 AND w.date < $2 AND s.muscle IS NOT NULL AND NOT s.is_warmup
       EXCEPT
       SELECT DISTINCT s.muscle FROM gym_set s JOIN gym_workout w ON w.opengym_id = s.workout_id
        WHERE w.date BETWEEN $2 AND $3`, [addDays(from, -56), from, to])
    return json({
      from, to,
      sessions: workouts.length,
      total_volume_kg: Math.round(workouts.reduce((a, w) => a + (w.total_volume_kg ?? 0), 0)),
      by_muscle: byMuscle,
      muscles_not_trained: missed.map((m) => m.muscle),
      workouts: workouts.map((w) => {
        const exercises = new Map<string, { muscle: string | null; working_sets: number; volume_kg: number; top: { w: number; r: number } | null }>()
        for (const s of sets.filter((x) => x.workout_id === w.opengym_id && !x.is_warmup)) {
          const e = exercises.get(s.exercise) ?? { muscle: s.muscle, working_sets: 0, volume_kg: 0, top: null }
          e.working_sets += 1
          e.volume_kg += (s.weight_kg ?? 0) * (s.reps ?? 0)
          if (s.weight_kg != null && s.reps != null && (!e.top || s.weight_kg > e.top.w || (s.weight_kg === e.top.w && s.reps > e.top.r))) {
            e.top = { w: s.weight_kg, r: s.reps }
          }
          exercises.set(s.exercise, e)
        }
        return {
          date: w.date,
          routine: w.routine,
          duration_min: w.duration_s == null ? null : Math.round(w.duration_s / 60),
          volume_kg: w.total_volume_kg,
          prs: (w.prs ?? []).map((p: { name: string }) => p.name),
          exercises: [...exercises].map(([name, e]) => ({
            exercise: name, muscle: e.muscle, working_sets: e.working_sets, volume_kg: Math.round(e.volume_kg),
            top_set: e.top ? `${e.top.w} kg × ${e.top.r}` : null,
          })),
        }
      }),
    })
  })

  server.registerTool('get_meals', {
    title: 'Meals of a day',
    description:
      "All meals logged for a day (Asia/Bangkok), each with kcal, protein/carb/fat (g) and confidence (0-1), " +
      'plus the day totals and what is left against the kcal and protein targets.',
    inputSchema: { date: Day },
    annotations: read,
  }, async ({ date }) => {
    const { rows } = await db.query(
      `SELECT id AS meal_id, eaten_at, name, items, kcal, protein_g, carb_g, fat_g, confidence, note,
              photo_url IS NOT NULL AS has_photo
         FROM meal WHERE ${mealDay} = $1 ORDER BY eaten_at`, [date])
    return json({ meals: rows, totals: await dayTotals(db, date) })
  })

  server.registerTool('get_goals', {
    title: 'Goals',
    description: `The owner's targets. Keys and units: ${Object.entries(GOALS).map(([k, u]) => `${k} (${u})`).join(', ')}.`,
    annotations: read,
  }, async () => {
    const { rows } = await db.query('SELECT key, value, unit, updated_at FROM goal ORDER BY key')
    return json({ goals: rows })
  })

  server.registerTool('get_latest_analysis', {
    title: 'Latest analyses',
    description:
      'The most recent saved analyses, newest first, optionally of one kind (daily, run, workout, weekly, meal). ' +
      'Use it to follow up on earlier recommendations.',
    inputSchema: {
      kind: z.enum(['daily', 'run', 'workout', 'weekly', 'meal']).optional(),
      limit: z.number().int().min(1).max(10).default(1),
    },
    annotations: read,
  }, async ({ kind, limit }) => {
    const { rows } = await db.query(
      `SELECT id AS analysis_id, date, kind, title, summary_md, scores, recommendations, created_at
         FROM analysis WHERE $1::text IS NULL OR kind = $1 ORDER BY date DESC, created_at DESC LIMIT $2`,
      [kind ?? null, limit])
    return json({ analyses: rows })
  })

  server.registerTool('get_sync_status', {
    title: 'Sync status',
    description:
      'Status of one sync job (sync_id from trigger_sync), or without sync_id the latest job per source ' +
      '(google_health, opengym) with hours since it finished. Also returns today\'s date in Asia/Bangkok.',
    inputSchema: { sync_id: z.number().int().optional() },
    annotations: read,
  }, async ({ sync_id }) => {
    if (sync_id != null) {
      const job = await getJob(db, sync_id)
      return job ? json({ today: today(), job }) : fail('no sync job with that id')
    }
    return json({ today: today(), sources: await syncState(db) })
  })

  // --- writes ------------------------------------------------------------------------------

  server.registerTool('trigger_sync', {
    title: 'Sync now',
    description:
      'Pull fresh data from Google Health and/or openGym, then wait up to wait_s seconds (default 20, max 25) for it. ' +
      'Returns each job\'s status: ok, error, or still queued/running (then check later with get_sync_status). ' +
      'A sync that succeeded under 5 minutes ago is returned instead of starting a new one. Also returns today\'s date.',
    inputSchema: {
      source: z.enum(SOURCES).optional().describe('Omit to sync both'),
      wait_s: z.number().int().min(0).max(25).default(20),
    },
    annotations: write,
  }, async ({ source, wait_s }) => {
    const sources = source ? [source] : [...SOURCES]
    const ids = await Promise.all(sources.map((s) => enqueue(db, s, 'mcp')))
    await audit(db, 'trigger_sync', { source, wait_s, sync_ids: ids })
    const until = Date.now() + wait_s * 1000
    let jobs = await Promise.all(ids.map((id) => getJob(db, id)))
    while (Date.now() < until && jobs.some((j) => j && (j.status === 'queued' || j.status === 'running'))) {
      await sleep(1000)
      jobs = await Promise.all(ids.map((id) => getJob(db, id)))
    }
    return json({
      today: today(),
      jobs: jobs.map((j) => j && { sync_id: j.id, source: j.source, status: j.status, rows: j.rows, error: j.error, finished_at: j.finished_at }),
    })
  })

  const MealFields = {
    name: z.string().min(1).max(200).describe('Dish or meal name'),
    items: z.array(z.object({
      name: z.string(),
      portion: z.string().optional().describe('e.g. "1 ทัพพี", "150 g", "1 bowl"'),
      kcal: z.number().min(0).optional(),
      protein_g: z.number().min(0).optional(),
      carb_g: z.number().min(0).optional(),
      fat_g: z.number().min(0).optional(),
    })).describe('Each food recognised, with its estimated portion'),
    kcal: z.number().min(0).max(10000).describe('Total energy, kcal'),
    protein_g: z.number().min(0).max(1000),
    carb_g: z.number().min(0).max(2000),
    fat_g: z.number().min(0).max(1000),
    confidence: z.number().min(0).max(1).describe('How sure the estimate is, 0-1. Photos of oily or saucy dishes deserve lower values.'),
    eaten_at: z.iso.datetime({ offset: true }).optional().describe('ISO 8601 with offset; default now'),
    note: z.string().max(1000).optional(),
  }

  async function refreshDays(...days: string[]) {
    await db.query('SELECT refresh_daily_summary($1::date[])', [days])
  }
  async function dayOf(mealId: number): Promise<string | null> {
    const { rows } = await db.query(`SELECT ${mealDay}::text AS day FROM meal WHERE id = $1`, [mealId])
    return rows[0]?.day ?? null
  }

  server.registerTool('log_meal', {
    title: 'Log a meal',
    description:
      'Save a meal estimated from a photo or description. Energy in kcal, macros in grams. confidence is 0-1 ' +
      '(ask one clarifying question first when it would be below 0.6). Returns meal_id and the day\'s totals with ' +
      'kcal and protein left against targets.',
    inputSchema: MealFields,
    annotations: write,
  }, async (m) => {
    if (m.eaten_at && Date.parse(m.eaten_at) > Date.now() + 3_600_000) return fail('eaten_at is in the future')
    await audit(db, 'log_meal', m)
    const { rows: [row] } = await db.query(
      `INSERT INTO meal (eaten_at, name, items, kcal, protein_g, carb_g, fat_g, confidence, note)
       VALUES (coalesce($1::timestamptz, now()), $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, ${mealDay}::text AS day`,
      [m.eaten_at ?? null, m.name, JSON.stringify(m.items), Math.round(m.kcal), m.protein_g, m.carb_g, m.fat_g, m.confidence, m.note ?? null])
    await refreshDays(row.day)
    return json({ meal_id: row.id, day_totals: await dayTotals(db, row.day) })
  })

  server.registerTool('update_meal', {
    title: 'Correct a meal',
    description: 'Change fields of a logged meal (e.g. a wrong estimate, or it was not finished). Only pass the fields that change.',
    inputSchema: { meal_id: z.number().int(), ...Object.fromEntries(Object.entries(MealFields).map(([k, v]) => [k, v.optional()])) } as
      { meal_id: z.ZodNumber } & { [K in keyof typeof MealFields]: z.ZodOptional<(typeof MealFields)[K]> },
    annotations: write,
  }, async ({ meal_id, ...fields }) => {
    const before = await dayOf(meal_id)
    if (!before) return fail('no meal with that meal_id')
    const sets: string[] = []
    const values: unknown[] = []
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue
      values.push(key === 'items' ? JSON.stringify(value) : key === 'kcal' ? Math.round(value as number) : value)
      sets.push(`${key} = $${values.length + 1}`)
    }
    if (!sets.length) return fail('nothing to change')
    await audit(db, 'update_meal', { meal_id, ...fields })
    await db.query(`UPDATE meal SET ${sets.join(', ')} WHERE id = $1`, [meal_id, ...values])
    const after = (await dayOf(meal_id))!
    await refreshDays(before, after)
    return json({ meal_id, day_totals: await dayTotals(db, after) })
  })

  server.registerTool('delete_meal', {
    title: 'Delete a meal',
    description: 'Remove a meal logged by mistake. Cannot be undone.',
    inputSchema: { meal_id: z.number().int() },
    annotations: { ...write, destructiveHint: true },
  }, async ({ meal_id }) => {
    const day = await dayOf(meal_id)
    if (!day) return fail('no meal with that meal_id')
    await audit(db, 'delete_meal', { meal_id })
    const { rows: [gone] } = await db.query('DELETE FROM meal WHERE id = $1 RETURNING photo_url', [meal_id])
    if (gone?.photo_url) await unlink(path.join(config.photoDir, path.basename(gone.photo_url))).catch(() => {})
    await refreshDays(day)
    return json({ deleted: meal_id, day_totals: await dayTotals(db, day) })
  })

  server.registerTool('create_photo_upload', {
    title: 'Photo upload link',
    description:
      'A one-time URL to attach the meal photo, valid 10 minutes. Upload with code execution: ' +
      '`curl -X PUT -H "Content-Type: image/jpeg" --data-binary @<file> <url>`. Images only, at most 10 MB. ' +
      'If it fails the meal is still logged, just without a photo.',
    inputSchema: { meal_id: z.number().int() },
    annotations: write,
  }, async ({ meal_id }) => {
    if (!(await dayOf(meal_id))) return fail('no meal with that meal_id')
    await audit(db, 'create_photo_upload', { meal_id })
    const token = randomBytes(32).toString('base64url')
    await db.query(
      "INSERT INTO photo_upload (hash, meal_id, expires_at) VALUES ($1, $2, now() + interval '10 minutes')",
      [createHash('sha256').update(token).digest(), meal_id])
    return json({ meal_id, upload_url: `${config.mcp.publicUrl}/upload/${token}`, method: 'PUT', expires_in_s: 600 })
  })

  server.registerTool('set_goal', {
    title: 'Set a goal',
    description: `Set one target. Keys and units: ${Object.entries(GOALS).map(([k, u]) => `${k} (${u})`).join(', ')}.`,
    inputSchema: {
      key: z.enum(Object.keys(GOALS) as [GoalKey, ...GoalKey[]]),
      value: z.number().min(0),
    },
    annotations: write,
  }, async ({ key, value }) => {
    await audit(db, 'set_goal', { key, value })
    await db.query(
      `INSERT INTO goal (key, value, unit) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit, updated_at = now()`,
      [key, value, GOALS[key]])
    return json({ key, value, unit: GOALS[key] })
  })

  server.registerTool('save_analysis', {
    title: 'Save an analysis',
    description:
      'Store an analysis for the dashboard. date is the day analysed (for weekly: the Sunday ending the week). ' +
      'summary_md is Markdown. scores are 0-100 (weekly: nutrition, training, running, recovery). ' +
      'At most 3 recommendations. Never overwrites: the dashboard shows the newest of each kind per day.',
    inputSchema: {
      date: Day,
      kind: z.enum(['daily', 'run', 'workout', 'weekly', 'meal']),
      title: z.string().min(1).max(200),
      summary_md: z.string().min(1).max(20_000),
      scores: z.record(z.string(), z.number().min(0).max(100)).optional(),
      recommendations: z.array(z.string().max(500)).max(3).optional(),
    },
    annotations: write,
  }, async (a) => {
    await audit(db, 'save_analysis', { date: a.date, kind: a.kind, title: a.title })
    const { rows: [row] } = await db.query(
      `INSERT INTO analysis (date, kind, title, summary_md, scores, recommendations)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [a.date, a.kind, a.title, a.summary_md, a.scores ? JSON.stringify(a.scores) : null,
        a.recommendations ? JSON.stringify(a.recommendations) : null])
    return json({ analysis_id: row.id })
  })
}
