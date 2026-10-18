import { randomBytes } from 'node:crypto'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { config } from './config.ts'
import { dashboardRoutes } from './dashboard.ts'
import { pool, type Queryable } from './db.ts'
import { migrate } from './migrate.ts'
import { cloudflareAccess, type AccessVerifier } from './mcp/access.ts'
import { enqueue, getJob, SOURCES, type Source } from './queue.ts'
import { completeConsent, consentUrl, CONSENT_PATH } from './sources/google.ts'

// Hub API: sync control, the Google consent flow, and the dashboard PWA with its read-only
// routes. Never runs a sync itself (spec: "Sync job"), it only queues them.
//
// Public at fit.<domain> through the tunnel, behind Cloudflare Access. Requests addressed to
// localhost (the Google consent redirect, healthchecks) come from this machine and skip the check.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

export function buildApp(db: Queryable, access: AccessVerifier): Hono {
  const app = new Hono()

  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: err.message }, 500)
  })

  app.use(async (c, next) => {
    const host = new URL(c.req.url).hostname
    if (LOCAL_HOSTS.has(host)) return next()
    if (await access(c.req.header('cf-access-jwt-assertion'))) return next()
    return c.json({ error: 'sign in through Cloudflare Access' }, 401)
  })

  app.get('/health', async (c) => {
    await db.query('SELECT 1')
    return c.json({ ok: true })
  })

  dashboardRoutes(app, db)
  syncRoutes(app, db)
  consentRoutes(app, db)
  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404))
  app.all('/photos/*', (c) => c.notFound())
  staticRoutes(app)
  return app
}

function syncRoutes(app: Hono, db: Queryable): void {
  // Sync now. Answers at once with the job ids to poll (spec: POST /api/sync within 500 ms).
  app.post('/api/sync', async (c) => {
    const body = await c.req.json<{ source?: Source }>().catch(() => ({}) as { source?: Source })
    if (body.source && !SOURCES.includes(body.source)) return c.json({ error: 'unknown source' }, 400)
    const sources = body.source ? [body.source] : [...SOURCES]
    const jobs = await Promise.all(sources.map(async (source) => ({ source, sync_id: await enqueue(db, source, 'dashboard') })))
    return c.json({ jobs }, 202)
  })

  app.get('/api/sync/:id{[0-9]+}', async (c) => {
    const job = await getJob(db, Number(c.req.param('id')))
    return job ? c.json(job) : c.json({ error: 'not found' }, 404)
  })

  // Latest job per source, for the dashboard's sync status line.
  app.get('/api/sync', async (c) => {
    const { rows } = await db.query(
      'SELECT DISTINCT ON (source) * FROM sync_log ORDER BY source, queued_at DESC')
    return c.json({ sources: rows })
  })
}

// --- Google consent (spec: /auth/google for (re-)consent) ----------------------------------

const pendingStates = new Map<string, number>() // state → expiry (ms)

function consentRoutes(app: Hono, db: Queryable): void {
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
      await completeConsent(db, code)
    } catch (err) {
      return c.text(`Could not finish connecting Google Health: ${(err as Error).message}`, 502)
    }
    const syncId = await enqueue(db, 'google_health', 'dashboard')
    return c.html(`<!doctype html><meta charset="utf-8"><title>Connected</title>
      <body style="font-family:system-ui;max-width:32rem;margin:3rem auto;line-height:1.5">
      <h1>Google Health connected</h1>
      <p>The first sync (last 14 days) is running as job #${syncId}. Older history fills in a little every night.</p>
      <p>You can close this tab.</p></body>`)
  })
}

// --- Dashboard PWA -------------------------------------------------------------------------

function staticRoutes(app: Hono): void {
  const root = config.dashboard.publicDir
  // Vite fingerprints everything under assets/, so it can be cached for good. The shell and
  // the service worker must be revalidated, or an update never reaches the phone.
  app.use('/assets/*', async (c, next) => {
    await next()
    if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable')
  })
  app.use('/*', serveStatic({
    root,
    onFound: (p, c) => {
      if (!p.includes('/assets/')) c.header('Cache-Control', 'no-cache')
    },
  }))
  // Client-side routes (/training, /running, ...) all load the same shell.
  app.get('*', serveStatic({ root, path: 'index.html', onFound: (_p, c) => { c.header('Cache-Control', 'no-cache') } }))
}

if (import.meta.main) {
  await migrate(pool)
  const access = cloudflareAccess(config.mcp.accessTeamDomain, config.dashboard.accessAud)
  serve({ fetch: buildApp(pool, access).fetch, port: config.apiPort, hostname: '0.0.0.0' }, (info) => {
    console.log(`hub-api on :${info.port}`)
  })
}
