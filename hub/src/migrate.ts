import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type pg from 'pg'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations/', import.meta.url))

// Applies db/migrations/*.sql in name order, each in its own transaction, once.
// Safe to call from several processes at startup: an advisory lock serialises them.
export async function migrate(pool: pg.Pool, log = console.log): Promise<string[]> {
  const client = await pool.connect()
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('fitness-hub-migrate'))")
    await baseline(client)
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`)
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name))
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
    const applied: string[] = []
    for (const file of files) {
      if (done.has(file)) continue
      const sql = await readFile(MIGRATIONS_DIR + file, 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`migration ${file} failed: ${(err as Error).message}`)
      }
      log(`migrated ${file}`)
      applied.push(file)
    }
    return applied
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('fitness-hub-migrate'))").catch(() => {})
    client.release()
  }
}

// Week 1 created the schema through Postgres' init scripts, before this runner existed.
// Record that 001 is already in place so it is not run twice.
async function baseline(client: pg.PoolClient): Promise<void> {
  const { rows } = await client.query(`SELECT
    to_regclass('schema_migrations') IS NOT NULL AS tracked,
    to_regclass('daily_summary') IS NOT NULL AS has_001`)
  if (rows[0].tracked || !rows[0].has_001) return
  await client.query(`CREATE TABLE schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`)
  await client.query("INSERT INTO schema_migrations (name) VALUES ('001_init.sql')")
}
