import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

// Runs against a real Postgres database whose name ends in _test, which it wipes first.
//   HUB_DEV_DB=hub_test scripts/hub-dev.sh npm test
const url = process.env.DATABASE_URL ?? ''
const isTestDb = /\/\w+_test$/.test(url)

const { pool } = await import('../src/db.ts')
const { migrate } = await import('../src/migrate.ts')
const { enqueue, claimNext, finish, failAbandoned, getJob } = await import('../src/queue.ts')

before(async () => {
  if (!isTestDb) return
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
  await migrate(pool, () => {})
})
after(() => pool.end())

const opts = { skip: isTestDb ? false : 'set HUB_DEV_DB=hub_test to run database tests' }

test('migrations apply once', opts, async () => {
  assert.deepEqual(await migrate(pool, () => {}), [])
})

test('dedupes, claims, cools down', opts, async () => {
  const first = await enqueue(pool, 'opengym', 'cron')
  assert.equal(await enqueue(pool, 'opengym', 'mcp'), first, 'queued job is reused')

  const claimed = await claimNext(pool)
  assert.equal(claimed?.id, first)
  assert.equal(claimed?.status, 'running')
  assert.equal(await claimNext(pool), null)
  assert.equal(await enqueue(pool, 'opengym', 'dashboard'), first, 'running job is reused')

  await finish(pool, first, { rows: 3 })
  assert.equal(await enqueue(pool, 'opengym', 'dashboard'), first, 'cooldown returns the fresh result')

  await pool.query("UPDATE sync_log SET finished_at = now() - interval '6 minutes'")
  assert.notEqual(await enqueue(pool, 'opengym', 'dashboard'), first, 'after cooldown a new job is queued')
})

test('an error does not start the cooldown', opts, async () => {
  const id = await enqueue(pool, 'google_health', 'mcp')
  await claimNext(pool)
  await finish(pool, id, { error: 'boom' })
  assert.notEqual(await enqueue(pool, 'google_health', 'mcp'), id)
})

test('fails jobs a dead worker left running', opts, async () => {
  await pool.query("DELETE FROM sync_log")
  const id = await enqueue(pool, 'opengym', 'cron')
  await claimNext(pool)
  assert.equal(await failAbandoned(pool), 1)
  assert.equal((await getJob(pool, id))?.status, 'error')
})

test('notifies listeners when a job is queued', opts, async () => {
  await pool.query("DELETE FROM sync_log")
  const listener = await pool.connect()
  try {
    await listener.query('LISTEN sync_jobs')
    const heard = new Promise<string>((resolve) => listener.once('notification', (m) => resolve(m.payload!)))
    const id = await enqueue(pool, 'opengym', 'dashboard')
    assert.equal(await heard, String(id))
  } finally {
    listener.release()
  }
})

test('rebuilds daily_summary rows in Bangkok days', opts, async () => {
  await pool.query(`INSERT INTO gh_daily VALUES ('2026-10-17', 'steps', 8000, now())`)
  await pool.query(`INSERT INTO sleep_session VALUES
    ('s1', '2026-10-17', '2026-10-16 23:00+07', '2026-10-17 07:00+07', '{"minutesAsleep": 430}'),
    ('s2', '2026-10-17', '2026-10-17 13:00+07', '2026-10-17 13:30+07', '{}')`)
  await pool.query(`INSERT INTO meal (eaten_at, name, kcal, protein_g, carb_g, fat_g, confidence)
    VALUES ('2026-10-17 23:59+07', 'a', 600, 40, 60, 20, 0.9), ('2026-10-18 00:01+07', 'b', 300, 10, 30, 5, 0.9)`)
  assert.equal((await pool.query(`SELECT refresh_daily_summary('{2026-10-17,2026-10-18}')`)).rows[0].refresh_daily_summary, 2)
  const { rows } = await pool.query('SELECT date, steps, kcal_in, sleep_min FROM daily_summary ORDER BY date')
  assert.deepEqual(rows, [
    { date: '2026-10-17', steps: 8000, kcal_in: 600, sleep_min: 460 }, // 430 asleep + 30 min nap in bed
    { date: '2026-10-18', steps: null, kcal_in: 300, sleep_min: null },
  ])
})
