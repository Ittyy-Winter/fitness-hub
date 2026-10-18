import type { Queryable } from './db.ts'

export const SOURCES = ['google_health', 'opengym'] as const
export type Source = (typeof SOURCES)[number]
export type Trigger = 'cron' | 'dashboard' | 'mcp'

export type SyncJob = {
  id: number
  source: Source
  trigger: Trigger
  status: 'queued' | 'running' | 'ok' | 'error'
  queued_at: Date
  started_at: Date | null
  finished_at: Date | null
  rows: number | null
  error: string | null
}

// Dedupe and cooldown rules live in the SQL function (db/migrations/002_sync_queue.sql).
export async function enqueue(db: Queryable, source: Source, trigger: Trigger): Promise<number> {
  const { rows } = await db.query('SELECT enqueue_sync($1, $2) AS id', [source, trigger])
  return rows[0].id
}

export async function getJob(db: Queryable, id: number): Promise<SyncJob | null> {
  const { rows } = await db.query('SELECT * FROM sync_log WHERE id = $1', [id])
  return rows[0] ?? null
}

export async function claimNext(db: Queryable): Promise<SyncJob | null> {
  const { rows } = await db.query(`
    UPDATE sync_log SET status = 'running', started_at = now()
     WHERE id = (SELECT id FROM sync_log WHERE status = 'queued'
                  ORDER BY queued_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING *`)
  return rows[0] ?? null
}

export async function finish(db: Queryable, id: number, result: { rows: number } | { error: string }): Promise<void> {
  if ('error' in result) {
    await db.query(
      "UPDATE sync_log SET status = 'error', finished_at = now(), error = $2 WHERE id = $1",
      [id, result.error.slice(0, 2000)],
    )
  } else {
    await db.query(
      "UPDATE sync_log SET status = 'ok', finished_at = now(), rows = $2, error = NULL WHERE id = $1",
      [id, result.rows],
    )
  }
}

// A job left 'running' by a worker that died never finishes on its own, and it blocks its
// source's queue through the one-active-job index. Fail it so the next request can queue.
export async function failAbandoned(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    "UPDATE sync_log SET status = 'error', finished_at = now(), error = 'worker restarted mid-sync' WHERE status = 'running'",
  )
  return rowCount ?? 0
}
