import { setTimeout as sleep } from 'node:timers/promises'
import { config } from './config.ts'
import { pool, type Queryable } from './db.ts'
import { migrate } from './migrate.ts'
import { claimNext, failAbandoned, finish, SOURCES, type Source, type SyncJob } from './queue.ts'
import { syncGoogleHealth } from './sources/google.ts'
import { syncOpengym, type SyncResult } from './sources/opengym.ts'

// The only process that runs syncs (spec: "Sync job"). Everyone else, including this
// process's own nightly schedule, only queues jobs in sync_log.

const POLL_MS = 30_000
const SYNCERS: Record<Source, (db: Queryable, job: SyncJob) => Promise<SyncResult>> = {
  google_health: syncGoogleHealth,
  opengym: syncOpengym,
}

const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args)

async function runJob(job: SyncJob): Promise<void> {
  const started = Date.now()
  try {
    const result = await SYNCERS[job.source](pool, job)
    // Rebuild the summary before reporting ok, so whoever waited on this job reads fresh numbers.
    if (result.dates.length) {
      await pool.query('SELECT refresh_daily_summary($1::date[])', [result.dates])
    }
    await finish(pool, job.id, { rows: result.rows })
    log(`sync #${job.id} ${job.source} ok: ${result.rows} rows, ${result.dates.length} days, ${Date.now() - started} ms`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await finish(pool, job.id, { error: message })
    log(`sync #${job.id} ${job.source} failed: ${message}`)
  }
}

async function drain(): Promise<void> {
  for (let job = await claimNext(pool); job; job = await claimNext(pool)) await runJob(job)
}

// Queue the nightly sync once the scheduled time has passed today and it has not been queued
// yet. Catches up after the laptop was off at that time.
async function queueNightly(): Promise<void> {
  for (const source of SOURCES) {
    const { rows } = await pool.query(
      `WITH due AS (
         SELECT ((now() AT TIME ZONE $1)::date + $2::time) AT TIME ZONE $1 AS at
       )
       SELECT now() >= due.at AS due,
              EXISTS (SELECT 1 FROM sync_log WHERE source = $3 AND trigger = 'cron' AND queued_at >= due.at) AS queued
         FROM due`,
      [config.timeZone, config.nightlySyncAt, source],
    )
    if (rows[0].due && !rows[0].queued) {
      // Inserted directly rather than through enqueue_sync(): the nightly run skips the
      // cooldown. If a job for this source is already active the insert does nothing and the
      // next pass tries again once it has finished.
      await pool.query("INSERT INTO sync_log (source, trigger) VALUES ($1, 'cron') ON CONFLICT DO NOTHING", [source])
    }
  }
}

let stopping = false
let wake: () => void = () => {}

async function main(): Promise<void> {
  await migrate(pool, log)
  const abandoned = await failAbandoned(pool)
  if (abandoned) log(`marked ${abandoned} interrupted job(s) as failed`)

  const listener = await pool.connect()
  await listener.query('LISTEN sync_jobs')
  listener.on('notification', () => wake())
  log(`worker ready (nightly sync at ${config.nightlySyncAt} ${config.timeZone})`)

  while (!stopping) {
    await queueNightly().catch((err) => log('nightly scheduling failed:', err.message))
    await drain().catch((err) => log('queue error:', err.message))
    await new Promise<void>((resolve) => {
      wake = resolve
      sleep(POLL_MS).then(resolve)
    })
  }
  listener.release()
  await pool.end()
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    stopping = true
    wake()
  })
}

await main()
