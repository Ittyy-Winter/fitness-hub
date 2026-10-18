import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

// The dashboard routes against the real app and a Postgres database whose name ends in _test:
//   HUB_DEV_DB=hub_test scripts/hub-dev.sh npm test
const isTestDb = /\/\w+_test$/.test(process.env.DATABASE_URL ?? '')
const photoDir = mkdtempSync(path.join(tmpdir(), 'photos-'))
const publicDir = mkdtempSync(path.join(tmpdir(), 'public-'))
writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>Fitness Hub</title>')
process.env.PHOTO_DIR = photoDir
process.env.DASHBOARD_DIR = publicDir
process.env.HUB_ENCRYPTION_KEY ??= randomBytes(32).toString('hex')

const { pool } = await import('../src/db.ts')
const { migrate } = await import('../src/migrate.ts')
const { buildApp } = await import('../src/api.ts')
const { weekStart } = await import('../src/dashboard.ts')
const { addDays, today } = await import('../src/dates.ts')

const OWNER_JWT = 'valid-access-jwt'
const app = buildApp(pool, async (jwt) => (jwt === OWNER_JWT ? { email: 'owner@example.com' } : null))
const remote = (pathname: string, jwt?: string) =>
  app.fetch(new Request(`https://fit.test${pathname}`, { headers: jwt ? { 'cf-access-jwt-assertion': jwt } : {} }))
const get = async <T = Record<string, any>>(pathname: string) => {
  const res = await remote(pathname, OWNER_JWT)
  assert.equal(res.status, 200, `${pathname} → ${res.status}`)
  return res.json() as Promise<T>
}

const opts = { skip: isTestDb ? false : 'set HUB_DEV_DB=hub_test to run database tests' }

test('weekStart is the Monday of the week', () => {
  assert.equal(weekStart('2026-10-18'), '2026-10-12') // Sunday
  assert.equal(weekStart('2026-10-12'), '2026-10-12') // Monday
  assert.equal(weekStart('2026-10-14'), '2026-10-12')
})

describe('dashboard routes', opts, () => {
  const day = today()

  before(async () => {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await migrate(pool, () => {})
    await pool.query(`INSERT INTO goal (key, value, unit) VALUES ('kcal_target', 2500, 'kcal/day'), ('protein_target', 150, 'g/day')`)
    await pool.query(
      `INSERT INTO meal (eaten_at, name, kcal, protein_g, carb_g, fat_g, confidence, photo_url)
       VALUES (($1::date + time '08:00') AT TIME ZONE 'Asia/Bangkok', 'Rice and eggs', 600, 30, 70, 20, 0.8, '/photos/1-abc123.jpg'),
              (($1::date + time '12:30') AT TIME ZONE 'Asia/Bangkok', 'Noodle soup', 500, 25.5, 60, 15, 0.7, NULL),
              (($2::date + time '19:00') AT TIME ZONE 'Asia/Bangkok', 'Yesterday dinner', 900, 40, 90, 35, 0.7, NULL)`,
      [day, addDays(day, -1)])
    await pool.query(
      `INSERT INTO daily_summary (date, steps, resting_hr) VALUES ($1, 8000, NULL), ($2, 9000, 58), ($3, 7000, 60)`,
      [day, addDays(day, -1), addDays(day, -3)])
    await pool.query(
      `INSERT INTO gym_workout (opengym_id, date, routine, duration_s, total_volume_kg, prs)
       VALUES ('w1', $1, 'Legs', 3600, 5200, '[{"name":"Squat"}]')`, [day])
    await pool.query(
      `INSERT INTO gym_set (id, workout_id, exercise, muscle, set_no, weight_kg, reps, is_warmup)
       VALUES ('s1', 'w1', 'Squat', 'quads', 1, 60, 8, true), ('s2', 'w1', 'Squat', 'quads', 2, 100, 5, false)`)
    await pool.query(
      `INSERT INTO run_session (source_id, date, start_at, duration_s, distance_m, avg_pace_s_per_km, hr_zone_min)
       VALUES ('r1', $1, now() - interval '1 day', 1800, 5000, 360, '{"light":2,"moderate":10,"vigorous":15,"peak":3}')`,
      [addDays(day, -1)])
    await pool.query(
      `INSERT INTO analysis (date, kind, title, summary_md) VALUES ($1, 'daily', 'old', 'x'), ($2, 'daily', 'new', 'y'),
              ($2, 'run', 'run note', 'z')`, [addDays(day, -2), addDays(day, -1)])
    writeFileSync(path.join(photoDir, '1-abc123.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
  })
  after(() => pool.end())

  test('requests from outside need the Cloudflare Access JWT', async () => {
    assert.equal((await remote('/api/today')).status, 401)
    assert.equal((await remote('/api/today', 'forged')).status, 401)
    assert.equal((await remote('/', 'forged')).status, 401)
    assert.equal((await remote('/photos/1-abc123.jpg')).status, 401)
  })

  test('requests addressed to localhost skip Access', async () => {
    const res = await app.fetch(new Request('http://localhost:8081/health'))
    assert.equal(res.status, 200)
  })

  test('today: meals, totals, recovery with when it was last recorded, latest daily analysis', async () => {
    const t = await get(`/api/today?date=${day}`)
    assert.deepEqual(t.meals.map((m: { name: string }) => m.name), ['Rice and eggs', 'Noodle soup'])
    assert.deepEqual(t.totals, { kcal: 1100, protein_g: 55.5, carb_g: 130, fat_g: 35 })
    assert.equal(t.goals.kcal_target, 2500)
    assert.equal(t.recovery.resting_hr.value, null)
    assert.equal(t.recovery.resting_hr.avg_7d, 59)
    assert.equal(t.recovery.resting_hr.last_recorded, addDays(day, -1))
    assert.equal(t.recovery.sleep_min.last_recorded, null)
    assert.equal(t.analysis.title, 'new')
    assert.equal(t.week.gym_sessions, 1)
    assert.equal(t.week.start, weekStart(day))
  })

  test('training: latest workout with its sets, working sets per muscle', async () => {
    const t = await get(`/api/training?date=${day}`)
    assert.equal(t.latest.routine, 'Legs')
    assert.equal(t.latest.sets.length, 2)
    assert.deepEqual(t.muscles, [{ muscle: 'quads', sets_this_week: 1, sets_avg_4w: 0 }])
  })

  test('running: latest run, weekly km and its analysis', async () => {
    const r = await get(`/api/running?date=${day}`)
    assert.equal(r.latest.id, 'r1')
    assert.equal(r.weeks.reduce((a: number, w: { km: number }) => a + w.km, 0), 5)
    assert.equal(r.analysis.title, 'run note')
  })

  test('body: 90 days of energy with averages over days that have data', async () => {
    const b = await get(`/api/body?date=${day}`)
    assert.equal(b.energy.length, 90)
    assert.equal(b.energy.at(-1).date, day)
  })

  test('insights: newest first, filtered by kind, paged by date', async () => {
    const all = await get('/api/insights')
    assert.deepEqual(all.analyses.map((a: { title: string }) => a.title).sort(), ['new', 'old', 'run note'])
    const daily = await get('/api/insights?kind=daily')
    assert.deepEqual(daily.analyses.map((a: { title: string }) => a.title), ['new', 'old'])
    const older = await get(`/api/insights?kind=daily&before=${addDays(day, -1)}`)
    assert.deepEqual(older.analyses.map((a: { title: string }) => a.title), ['old'])
    assert.equal((await remote('/api/insights?kind=bogus', OWNER_JWT)).status, 400)
  })

  test('photos: generated names only, with the right type', async () => {
    const ok = await remote('/photos/1-abc123.jpg', OWNER_JWT)
    assert.equal(ok.status, 200)
    assert.equal(ok.headers.get('content-type'), 'image/jpeg')
    assert.equal((await remote('/photos/..%2F..%2Fetc%2Fpasswd', OWNER_JWT)).status, 404)
    assert.equal((await remote('/photos/2-ffff.jpg', OWNER_JWT)).status, 404)
  })

  test('unknown API paths are JSON 404s; other paths load the app shell', async () => {
    const api = await remote('/api/nope', OWNER_JWT)
    assert.equal(api.status, 404)
    assert.match(api.headers.get('content-type') ?? '', /json/)
    const page = await remote('/training', OWNER_JWT)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /Fitness Hub/)
  })
})
