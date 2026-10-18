import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

// End to end against the real app and a Postgres database whose name ends in _test:
//   HUB_DEV_DB=hub_test scripts/hub-dev.sh npm test
const isTestDb = /\/\w+_test$/.test(process.env.DATABASE_URL ?? '')
const photoDir = mkdtempSync(path.join(tmpdir(), 'photos-'))
process.env.PHOTO_DIR = photoDir
process.env.MCP_PUBLIC_URL = 'https://mcp.test'
process.env.HUB_ENCRYPTION_KEY ??= randomBytes(32).toString('hex')

const { pool } = await import('../src/db.ts')
const { migrate } = await import('../src/migrate.ts')
const { buildApp } = await import('../src/mcp.ts')
const { pkceChallenge } = await import('../src/mcp/oauth.ts')
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')

const OWNER_JWT = 'valid-access-jwt'
const app = buildApp(pool, async (jwt) => (jwt === OWNER_JWT ? { email: 'owner@example.com' } : null))
const call = (pathname: string, init?: RequestInit) => app.fetch(new Request(`https://mcp.test${pathname}`, init))
const form = (data: Record<string, string>) => ({
  method: 'POST', body: new URLSearchParams(data),
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'cf-access-jwt-assertion': OWNER_JWT },
})
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'

const opts = { skip: isTestDb ? false : 'set HUB_DEV_DB=hub_test to run database tests' }

before(async () => {
  if (!isTestDb) return
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
  await migrate(pool, () => {})
})
after(() => pool.end())

async function register(redirect = CALLBACK) {
  const res = await call('/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirect] }),
  })
  return { status: res.status, body: await res.json() as { client_id: string } }
}

/** Run the whole authorization code flow and return the token response. */
async function authorize(clientId: string, verifier = 'v'.repeat(50)) {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: CALLBACK, response_type: 'code', state: 'xyz',
    code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256', resource: 'https://mcp.test/mcp',
  })
  const page = await call(`/authorize?${q}`, { headers: { 'cf-access-jwt-assertion': OWNER_JWT } })
  assert.equal(page.status, 200)
  const fields = Object.fromEntries([...(await page.text()).matchAll(/name="(\w+)" value="([^"]*)"/g)].map((m) => [m[1]!, m[2]!.replaceAll('&amp;', '&')]))
  const approved = await call('/authorize', form({ ...fields, decision: 'allow' }))
  assert.equal(approved.status, 302)
  const target = new URL(approved.headers.get('location')!)
  return { target, fields }
}

async function tokenFor(clientId: string, code: string, verifier = 'v'.repeat(50)) {
  const res = await call('/token', form({
    grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: CALLBACK,
  }))
  return { status: res.status, body: await res.json() as { access_token: string; refresh_token: string; error?: string } }
}

describe('OAuth', opts, () => {
  test('advertises metadata and challenges unauthenticated calls', async () => {
    const meta = await (await call('/.well-known/oauth-authorization-server')).json() as Record<string, unknown>
    assert.equal(meta.registration_endpoint, 'https://mcp.test/register')
    assert.deepEqual(meta.code_challenge_methods_supported, ['S256'])
    const prm = await (await call('/.well-known/oauth-protected-resource/mcp')).json() as Record<string, unknown>
    assert.equal(prm.resource, 'https://mcp.test/mcp')
    const res = await call('/mcp', { method: 'POST' })
    assert.equal(res.status, 401)
    assert.match(res.headers.get('www-authenticate')!, /resource_metadata="https:\/\/mcp\.test\/\.well-known\/oauth-protected-resource\/mcp"/)
  })

  test('registers only Claude callbacks', async () => {
    assert.equal((await register('https://evil.example/callback')).status, 400)
    assert.equal((await register('http://localhost:33418/callback')).status, 201)
    assert.equal((await register()).status, 201)
  })

  test('requires the owner signed in through Access', async () => {
    const { body } = await register()
    const q = new URLSearchParams({ client_id: body.client_id, redirect_uri: CALLBACK, response_type: 'code', code_challenge: 'x', code_challenge_method: 'S256' })
    assert.equal((await call(`/authorize?${q}`)).status, 403)
    assert.equal((await call(`/authorize?${q}`, { headers: { 'cf-access-jwt-assertion': 'forged' } })).status, 403)
  })

  test('refuses an unregistered redirect without redirecting', async () => {
    const { body } = await register()
    const q = new URLSearchParams({ client_id: body.client_id, redirect_uri: 'https://evil.example/cb', response_type: 'code', code_challenge: 'x', code_challenge_method: 'S256' })
    const res = await call(`/authorize?${q}`, { headers: { 'cf-access-jwt-assertion': OWNER_JWT } })
    assert.equal(res.status, 400)
    assert.equal(res.headers.get('location'), null)
  })

  test('rejects a tampered consent form', async () => {
    const { body } = await register()
    const { fields } = await authorize(body.client_id)
    const res = await call('/authorize', form({ ...fields, redirect_uri: 'http://localhost:1/steal', decision: 'allow' }))
    assert.equal(res.status, 400)
  })

  test('code flow with PKCE, single-use codes, rotating refresh tokens', async () => {
    const { body } = await register()
    const { target } = await authorize(body.client_id)
    assert.equal(target.origin + target.pathname, CALLBACK)
    assert.equal(target.searchParams.get('state'), 'xyz')
    assert.equal(target.searchParams.get('iss'), 'https://mcp.test')
    const code = target.searchParams.get('code')!

    assert.equal((await tokenFor(body.client_id, code, 'w'.repeat(50))).status, 400, 'wrong verifier')
    // The failed attempt spent the code: codes are single-use even when the exchange fails.
    assert.equal((await tokenFor(body.client_id, code)).status, 400)

    const second = (await authorize(body.client_id)).target.searchParams.get('code')!
    const tokens = await tokenFor(body.client_id, second)
    assert.equal(tokens.status, 200)
    assert.equal((await call('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${tokens.body.access_token}` } })).status !== 401, true)

    const refreshed = await call('/token', form({ grant_type: 'refresh_token', client_id: body.client_id, refresh_token: tokens.body.refresh_token }))
    assert.equal(refreshed.status, 200)
    const reused = await call('/token', form({ grant_type: 'refresh_token', client_id: body.client_id, refresh_token: tokens.body.refresh_token }))
    assert.equal(reused.status, 400, 'a spent refresh token is refused')
  })
})

describe('tools', opts, () => {
  let client: InstanceType<typeof Client>
  const tool = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args }) as { content: { text: string }[]; isError?: boolean }
    if (res.isError) throw new Error(res.content[0]!.text)
    return JSON.parse(res.content[0]!.text)
  }

  before(async () => {
    const { body } = await register()
    const code = (await authorize(body.client_id)).target.searchParams.get('code')!
    const { body: tokens } = await tokenFor(body.client_id, code)
    client = new Client({ name: 'test', version: '1' })
    await client.connect(new StreamableHTTPClientTransport(new URL('https://mcp.test/mcp'), {
      fetch: async (url, init) => app.fetch(new Request(url, init)),
      requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    }))
  })

  test('lists every tool in the spec', async () => {
    const { tools } = await client.listTools()
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      'create_photo_upload', 'delete_meal', 'get_day_summary', 'get_goals', 'get_latest_analysis', 'get_meals',
      'get_range_summary', 'get_run_detail', 'get_runs', 'get_sync_status', 'get_workouts', 'log_meal',
      'save_analysis', 'set_goal', 'trigger_sync', 'update_meal',
    ])
  })

  test('meals update the day and its summary', async () => {
    await tool('set_goal', { key: 'kcal_target', value: 2200 })
    await tool('set_goal', { key: 'protein_target', value: 150 })
    const logged = await tool('log_meal', {
      name: 'ข้าวกะเพราไก่ไข่ดาว', items: [{ name: 'rice', portion: '1 plate' }], kcal: 650, protein_g: 32,
      carb_g: 75, fat_g: 24, confidence: 0.7, eaten_at: '2026-10-18T12:30:00+07:00',
    })
    assert.deepEqual(
      { kcal: logged.day_totals.kcal, left: logged.day_totals.kcal_remaining, protein_left: logged.day_totals.protein_remaining_g },
      { kcal: 650, left: 1550, protein_left: 118 })
    await tool('update_meal', { meal_id: logged.meal_id, kcal: 500 })
    const day = await tool('get_day_summary', { date: '2026-10-18' })
    assert.equal(day.day.kcal_in, 500)
    assert.equal(day.vs_goals.kcal_in_vs_target, -1700)
    assert.ok(day.no_watch_data.includes('sleep_min'))
    const meals = await tool('get_meals', { date: '2026-10-18' })
    assert.equal(meals.meals.length, 1)
    await tool('delete_meal', { meal_id: logged.meal_id })
    assert.equal((await tool('get_meals', { date: '2026-10-18' })).meals.length, 0)
  })

  test('validates input', async () => {
    await assert.rejects(tool('log_meal', { name: 'x', items: [], kcal: 1, protein_g: 1, carb_g: 1, fat_g: 1, confidence: 1.5 }))
    await assert.rejects(tool('get_range_summary', { from: '2026-01-01', to: '2026-12-31' }), /120 days/)
    await assert.rejects(tool('set_goal', { key: 'bench_press_target', value: 100 }))
  })

  test('photo links are single-use and accept only images', async () => {
    const { meal_id } = await tool('log_meal', { name: 'toast', items: [], kcal: 200, protein_g: 6, carb_g: 30, fat_g: 6, confidence: 0.9 })
    const { upload_url } = await tool('create_photo_upload', { meal_id })
    const pathname = new URL(upload_url).pathname
    assert.equal((await call(pathname, { method: 'PUT', body: 'not an image' })).status, 415)
    const second = new URL((await tool('create_photo_upload', { meal_id })).upload_url).pathname
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(1)])
    assert.equal((await call(second, { method: 'PUT', body: jpeg })).status, 200)
    assert.equal((await call(second, { method: 'PUT', body: jpeg })).status, 403, 'used once')
    assert.equal(readdirSync(photoDir).length, 1)
    const { rows: [m] } = await pool.query('SELECT photo_url FROM meal WHERE id = $1', [meal_id])
    assert.match(m.photo_url, new RegExp(`^/photos/${meal_id}-[0-9a-f]+\\.jpg$`))
  })

  test('workouts roll up by muscle and spot untrained muscles', async () => {
    await pool.query(`INSERT INTO gym_workout (opengym_id, date, routine, duration_s, total_volume_kg, prs) VALUES
      ('old', '2026-09-20', 'Legs', 3000, 4000, '[]'), ('new', '2026-10-16', 'Push', 3600, 960, '[{"id":"0025","name":"Barbell bench press"}]')`)
    await pool.query(`INSERT INTO gym_set (id, workout_id, exercise, muscle, set_no, weight_kg, reps, is_warmup) VALUES
      ('o1', 'old', 'Squat', 'quads', 1, 100, 5, false),
      ('n1', 'new', 'Barbell bench press', 'pectorals', 1, 40, 10, true),
      ('n2', 'new', 'Barbell bench press', 'pectorals', 2, 60, 8, false),
      ('n3', 'new', 'Barbell bench press', 'pectorals', 3, 60, 8, false)`)
    const w = await tool('get_workouts', { from: '2026-10-12', to: '2026-10-18' })
    assert.equal(w.sessions, 1)
    assert.deepEqual(w.by_muscle, [{ muscle: 'pectorals', working_sets: 2, volume_kg: 960 }])
    assert.deepEqual(w.muscles_not_trained, ['quads'])
    assert.deepEqual(w.workouts[0].exercises[0], {
      exercise: 'Barbell bench press', muscle: 'pectorals', working_sets: 2, volume_kg: 960, top_set: '60 kg × 8',
    })
    assert.deepEqual(w.workouts[0].prs, ['Barbell bench press'])
  })

  test('analyses, sync and audit', async () => {
    const { analysis_id } = await tool('save_analysis', {
      date: '2026-10-17', kind: 'daily', title: 'Steady day', summary_md: '**ok**', scores: { nutrition: 70 }, recommendations: ['walk'],
    })
    const latest = await tool('get_latest_analysis', { kind: 'daily' })
    assert.equal(latest.analyses[0].analysis_id, analysis_id)
    const sync = await tool('trigger_sync', { source: 'opengym', wait_s: 0 })
    assert.equal(sync.jobs[0].status, 'queued')
    assert.match(sync.today, /^\d{4}-\d{2}-\d{2}$/)
    const { rows } = await pool.query('SELECT DISTINCT tool FROM mcp_audit ORDER BY tool')
    assert.deepEqual(rows.map((r) => r.tool), [
      'create_photo_upload', 'delete_meal', 'log_meal', 'save_analysis', 'set_goal', 'trigger_sync', 'update_meal',
    ])
  })
})
