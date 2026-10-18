import { setTimeout as sleep } from 'node:timers/promises'
import { pool } from './db.ts'
import { migrate } from './migrate.ts'
import { enqueue, getJob, SOURCES, type Source } from './queue.ts'
import { pair } from './sources/opengym.ts'

// Operator commands, run inside the worker container through scripts/hub-cli.sh.

const [command, ...args] = process.argv.slice(2)

async function waitFor(id: number, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs
  for (;;) {
    const job = await getJob(pool, id)
    if (!job || job.status === 'ok' || job.status === 'error' || Date.now() > until) return job
    await sleep(1000)
  }
}

try {
  await migrate(pool, () => {})
  switch (command) {
    case 'opengym-pair': {
      if (!args[0]) throw new Error('usage: opengym-pair <CODE from openGym Settings → Pair the mobile app>')
      console.log(`paired with openGym profile "${await pair(pool, args[0])}"`)
      break
    }
    case 'sync': {
      const sources = args.length ? (args as Source[]) : [...SOURCES]
      for (const source of sources) {
        if (!SOURCES.includes(source)) throw new Error(`unknown source ${source}; use one of ${SOURCES.join(', ')}`)
        const id = await enqueue(pool, source, 'dashboard')
        const job = await waitFor(id)
        console.log(`${source}: #${id} ${job?.status}${job?.rows != null ? `, ${job.rows} rows` : ''}${job?.error ? ` — ${job.error}` : ''}`)
      }
      break
    }
    case 'status': {
      const { rows } = await pool.query(`SELECT DISTINCT ON (source) id, source, trigger, status, finished_at, rows, error
        FROM sync_log ORDER BY source, queued_at DESC`)
      console.table(rows)
      break
    }
    default:
      console.log('commands: opengym-pair <CODE> | sync [google_health|opengym] | status')
      process.exitCode = command ? 1 : 0
  }
} catch (err) {
  console.error((err as Error).message)
  process.exitCode = 1
} finally {
  await pool.end()
}
