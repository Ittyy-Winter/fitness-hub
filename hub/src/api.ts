import { randomBytes } from 'node:crypto'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { config } from './config.ts'
import { pool } from './db.ts'
import { migrate } from './migrate.ts'
import { enqueue, getJob, SOURCES, type Source } from './queue.ts'
import { completeConsent, consentUrl, CONSENT_PATH } from './sources/google.ts'

// Hub API. Week 2: sync control and the Google consent flow. The dashboard routes join it in
// Week 3. Never runs a sync itself (spec: "Sync job"), it only queues them.

export const app = new Hono()

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: err.message }, 500)
})

app.get('/health', async (c) => {
  await pool.query('SELECT 1')
  return c.json({ ok: true })
})

// Sync now. Answers at once with the job ids to poll (spec: POST /api/sync within 500 ms).
app.post('/api/sync', async (c) => {
  const body = await c.req.json<{ source?: Source }>().catch(() => ({}) as { source?: Source })
  if (body.source && !SOURCES.includes(body.source)) return c.json({ error: 'unknown source' }, 400)
  const sources = body.source ? [body.source] : [...SOURCES]
  const jobs = await Promise.all(sources.map(async (source) => ({ source, sync_id: await enqueue(pool, source, 'dashboard') })))
  return c.json({ jobs }, 202)
})

app.get('/api/sync/:id{[0-9]+}', async (c) => {
  const job = await getJob(pool, Number(c.req.param('id')))
  return job ? c.json(job) : c.json({ error: 'not found' }, 404)
})

// Latest job per source, for the dashboard's sync status line.
app.get('/api/sync', async (c) => {
  const { rows } = await pool.query(
    'SELECT DISTINCT ON (source) * FROM sync_log ORDER BY source, queued_at DESC')
  return c.json({ sources: rows })
})

// --- Google consent (spec: /auth/google for (re-)consent) ----------------------------------

const pendingStates = new Map<string, number>() // state → expiry (ms)

app.get(CONSENT_PATH, (c) => {
  const state = randomBytes(16).toString('hex')
  pendingStates.set(state, Date.now() + 10 * 60_000)
  return c.redirect(consentUrl(state))
})

app.get(`${CONSENT_PATH}/callback`, async (c) => {
  const { state, code, error } = c.req.query()
  const expiry = state ? pendingStates.get(state) : undefined
  if (state) pendingStates.delete(state)
  if (!expiry || expiry < Date.now()) return c.text('This sign-in link expired. Start again from /auth/google.', 400)
  if (error || !code) return c.text(`Google did not grant access: ${error ?? 'no code'}`, 400)
  try {
    await completeConsent(pool, code)
  } catch (err) {
    return c.text(`Could not finish connecting Google Health: ${(err as Error).message}`, 502)
  }
  const syncId = await enqueue(pool, 'google_health', 'dashboard')
  return c.html(`<!doctype html><meta charset="utf-8"><title>Connected</title>
    <body style="font-family:system-ui;max-width:32rem;margin:3rem auto;line-height:1.5">
    <h1>Google Health connected</h1>
    <p>The first sync (last 14 days) is running as job #${syncId}. Older history fills in a little every night.</p>
    <p>You can close this tab.</p></body>`)
})

if (import.meta.main) {
  await migrate(pool)
  serve({ fetch: app.fetch, port: config.apiPort, hostname: '0.0.0.0' }, (info) => {
    console.log(`hub-api on :${info.port}`)
  })
}
