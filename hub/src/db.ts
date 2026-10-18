import pg from 'pg'
import { config } from './config.ts'

// Postgres returns bigint and numeric as strings by default; every value we store fits a JS number.
pg.types.setTypeParser(pg.types.builtins.INT8, Number)
pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number)
// Keep `date` columns as 'YYYY-MM-DD' strings: they are calendar days in Bangkok, not instants.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v)

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5 })

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export type Queryable = Pick<pg.PoolClient, 'query'>
