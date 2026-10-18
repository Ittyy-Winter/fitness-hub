import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Context, Hono } from 'hono'
import { html } from 'hono/html'
import { config } from '../config.ts'
import type { Queryable } from '../db.ts'
import type { AccessVerifier } from './access.ts'

// A minimal OAuth 2.1 authorization server for exactly one owner and one kind of client:
// Claude. claude.ai registers itself (RFC 7591), sends the owner to /authorize, and swaps the
// code for tokens with PKCE. Spec: MCP authorization (RFC 9728 + RFC 8414).

const ACCESS_TTL_S = 3600
const REFRESH_TTL_S = 90 * 86400
const CODE_TTL_S = 300
const SCOPE = 'fitness'
const MAX_CLIENTS = 50

// Claude's hosted apps use one fixed callback; Claude Code uses a loopback port of its choice.
const HOSTED_CALLBACKS = new Set([
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
])
const isLoopback = (u: URL) => u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')

export function allowedRedirect(uri: string): boolean {
  if (HOSTED_CALLBACKS.has(uri)) return true
  try {
    return isLoopback(new URL(uri))
  } catch {
    return false
  }
}

// Loopback redirects match whatever port the client picked (RFC 8252 §7.3); others exactly.
export function redirectMatches(registered: string[], requested: string): boolean {
  if (registered.includes(requested)) return true
  let req: URL
  try { req = new URL(requested) } catch { return false }
  if (!isLoopback(req)) return false
  return registered.some((r) => {
    try {
      const reg = new URL(r)
      return isLoopback(reg) && reg.hostname === req.hostname && reg.pathname === req.pathname
    } catch {
      return false
    }
  })
}

const sha256 = (s: string) => createHash('sha256').update(s).digest()
const newSecret = () => randomBytes(32).toString('base64url')
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')

export const urls = () => {
  const base = config.mcp.publicUrl
  return {
    issuer: base,
    resource: `${base}/mcp`,
    resourceMetadata: `${base}/.well-known/oauth-protected-resource/mcp`,
  }
}

// The consent form posts the authorization request back; this MAC proves it is the one we
// rendered for this owner, so another site cannot post a forged approval through the owner's
// Access session.
function formMac(params: Record<string, string>, expires: number): string {
  const key = createHmac('sha256', config.encryptionKey()).update('mcp-consent').digest()
  const body = JSON.stringify([Object.entries(params).sort(), expires])
  return createHmac('sha256', key).update(body).digest('base64url')
}

function oauthError(c: Context, error: string, description: string, status: 400 | 401 = 400) {
  return c.json({ error, error_description: description }, status, { 'Cache-Control': 'no-store' })
}

async function issueTokens(db: Queryable, clientId: string) {
  const access = newSecret()
  const refresh = newSecret()
  await db.query(
    `INSERT INTO oauth_credential (hash, kind, client_id, expires_at) VALUES
       ($1, 'access', $3, now() + make_interval(secs => $4)),
       ($2, 'refresh', $3, now() + make_interval(secs => $5))`,
    [sha256(access), sha256(refresh), clientId, ACCESS_TTL_S, REFRESH_TTL_S])
  await db.query('UPDATE oauth_client SET last_used_at = now() WHERE client_id = $1', [clientId])
  await db.query('DELETE FROM oauth_credential WHERE expires_at < now()')
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: SCOPE }
}

/** Resolve a bearer token to its client, or null. */
export async function verifyBearer(db: Queryable, header: string | undefined): Promise<string | null> {
  const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) return null
  const { rows } = await db.query(
    "SELECT client_id FROM oauth_credential WHERE hash = $1 AND kind = 'access' AND expires_at > now()", [sha256(token)])
  return rows[0]?.client_id ?? null
}

export function unauthorized(c: Context) {
  return c.json({ error: 'invalid_token', error_description: 'Sign in again through the Fitness Hub connector' }, 401, {
    'WWW-Authenticate': `Bearer resource_metadata="${urls().resourceMetadata}", scope="${SCOPE}"`,
  })
}

export function oauthRoutes(app: Hono, db: Queryable, access: AccessVerifier): void {
  const protectedResource = (c: Context) => {
    const u = urls()
    return c.json({
      resource: u.resource,
      authorization_servers: [u.issuer],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ['header'],
      resource_name: 'Fitness Hub',
    })
  }
  app.get('/.well-known/oauth-protected-resource', protectedResource)
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResource)

  app.get('/.well-known/oauth-authorization-server', (c) => {
    const { issuer } = urls()
    return c.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      scopes_supported: [SCOPE],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      authorization_response_iss_parameter_supported: true,
    })
  })

  // Dynamic Client Registration. Open by design (claude.ai calls it unauthenticated), but only
  // Claude's callbacks are accepted, so a registered stranger has nowhere to receive a code.
  app.post('/register', async (c) => {
    const body = await c.req.json().catch(() => null) as { redirect_uris?: unknown; client_name?: unknown } | null
    const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === 'string') : []
    if (!uris.length) return oauthError(c, 'invalid_redirect_uri', 'redirect_uris is required')
    const refused = uris.filter((u) => !allowedRedirect(u))
    if (refused.length) return oauthError(c, 'invalid_redirect_uri', `not a Claude callback: ${refused.join(', ')}`)

    await db.query(`DELETE FROM oauth_client WHERE last_used_at IS NULL AND created_at < now() - interval '1 day'`)
    const { rows: [{ n }] } = await db.query('SELECT count(*)::int AS n FROM oauth_client')
    if (n >= MAX_CLIENTS) return oauthError(c, 'temporarily_unavailable', 'too many registered clients')

    const clientId = randomUUID()
    const name = typeof body?.client_name === 'string' ? body.client_name.slice(0, 100) : null
    await db.query('INSERT INTO oauth_client (client_id, client_name, redirect_uris) VALUES ($1, $2, $3)', [clientId, name, uris])
    return c.json({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name ?? undefined,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }, 201)
  })

  // Authorization request → consent page. Cloudflare Access guards this path; we check its JWT too.
  const AUTH_PARAMS = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'] as const

  async function checkRequest(c: Context, p: Record<string, string>) {
    const { rows: [client] } = await db.query('SELECT * FROM oauth_client WHERE client_id = $1', [p.client_id ?? ''])
    // Without a known client and redirect we must not redirect anywhere (RFC 6749 §4.1.2.1).
    if (!client) return { stop: c.text('Unknown client. Remove the connector in Claude and add it again.', 400) }
    if (!p.redirect_uri || !redirectMatches(client.redirect_uris, p.redirect_uri)) {
      return { stop: c.text('This redirect address is not registered for the client.', 400) }
    }
    const back = (error: string, description: string) => {
      const u = new URL(p.redirect_uri!)
      u.searchParams.set('error', error)
      u.searchParams.set('error_description', description)
      if (p.state) u.searchParams.set('state', p.state)
      u.searchParams.set('iss', urls().issuer)
      return { stop: c.redirect(u.toString()) }
    }
    if (p.response_type !== 'code') return back('unsupported_response_type', 'only code is supported')
    if (!p.code_challenge || p.code_challenge_method !== 'S256') return back('invalid_request', 'PKCE with S256 is required')
    if (p.resource && p.resource !== urls().resource) return back('invalid_target', `resource must be ${urls().resource}`)

    const owner = await access(c.req.header('cf-access-jwt-assertion'))
    if (!owner) return { stop: c.text('Sign in through Cloudflare Access first.', 403) }
    return { client, owner }
  }

  const pick = (source: Record<string, string | undefined>) =>
    Object.fromEntries(AUTH_PARAMS.filter((k) => source[k] != null).map((k) => [k, String(source[k])])) as Record<string, string>

  app.get('/authorize', async (c) => {
    const p = pick(c.req.query())
    const checked = await checkRequest(c, p)
    if ('stop' in checked) return checked.stop
    const expires = Date.now() + 10 * 60_000
    const callbackHost = new URL(p.redirect_uri!).host
    return c.html(html`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Allow access · Fitness Hub</title>
<body style="font-family:system-ui;max-width:30rem;margin:3rem auto;padding:0 1rem;line-height:1.5">
<h1 style="font-size:1.4rem">Allow ${checked.client.client_name ?? 'Claude'} to use Fitness Hub?</h1>
<p>It will be able to read your health, gym and meal data, log and edit meals, set goals and save analyses.
It cannot change or delete synced watch or gym data.</p>
<p style="color:#666;font-size:.9rem">Signed in as ${checked.owner.email}. Access is sent back to <b>${callbackHost}</b>.</p>
<form method="post" action="/authorize">
${Object.entries(p).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
<input type="hidden" name="expires" value="${String(expires)}">
<input type="hidden" name="mac" value="${formMac(p, expires)}">
<button name="decision" value="allow" style="font-size:1rem;padding:.6rem 1.2rem">Allow</button>
<button name="decision" value="deny" style="font-size:1rem;padding:.6rem 1.2rem">Deny</button>
</form></body></html>`, 200, { 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' })
  })

  app.post('/authorize', async (c) => {
    const form = (await c.req.parseBody()) as Record<string, string>
    const p = pick(form)
    const expires = Number(form.expires)
    const mac = Buffer.from(String(form.mac ?? ''))
    const want = Buffer.from(formMac(p, expires))
    if (!(expires > Date.now()) || mac.length !== want.length || !timingSafeEqual(mac, want)) {
      return c.text('This approval page expired. Start the connection again from Claude.', 400)
    }
    const checked = await checkRequest(c, p)
    if ('stop' in checked) return checked.stop

    const target = new URL(p.redirect_uri!)
    if (p.state) target.searchParams.set('state', p.state)
    target.searchParams.set('iss', urls().issuer)
    if (form.decision !== 'allow') {
      target.searchParams.set('error', 'access_denied')
      return c.redirect(target.toString())
    }
    const code = newSecret()
    await db.query(
      `INSERT INTO oauth_credential (hash, kind, client_id, expires_at, redirect_uri, code_challenge, resource)
       VALUES ($1, 'code', $2, now() + make_interval(secs => $3), $4, $5, $6)`,
      [sha256(code), p.client_id, CODE_TTL_S, p.redirect_uri, p.code_challenge, p.resource ?? null])
    target.searchParams.set('code', code)
    return c.redirect(target.toString())
  })

  app.post('/token', async (c) => {
    const f = (await c.req.parseBody()) as Record<string, string>
    const clientId = String(f.client_id ?? '')

    if (f.grant_type === 'authorization_code') {
      // One use only: the code row is deleted as it is read.
      const { rows: [grant] } = await db.query(
        `DELETE FROM oauth_credential WHERE hash = $1 AND kind = 'code' RETURNING *, expires_at > now() AS live`,
        [sha256(String(f.code ?? ''))])
      if (!grant || !grant.live || grant.client_id !== clientId) return oauthError(c, 'invalid_grant', 'code is invalid or expired')
      if (grant.redirect_uri !== f.redirect_uri) return oauthError(c, 'invalid_grant', 'redirect_uri does not match')
      if (!f.code_verifier || pkceChallenge(String(f.code_verifier)) !== grant.code_challenge) {
        return oauthError(c, 'invalid_grant', 'PKCE verification failed')
      }
      if (f.resource && grant.resource && f.resource !== grant.resource) return oauthError(c, 'invalid_target', 'resource does not match')
      return c.json(await issueTokens(db, clientId), 200, { 'Cache-Control': 'no-store' })
    }

    if (f.grant_type === 'refresh_token') {
      // Rotation: the presented refresh token is spent and a new pair is issued.
      const { rows: [old] } = await db.query(
        `DELETE FROM oauth_credential WHERE hash = $1 AND kind = 'refresh' RETURNING client_id, expires_at > now() AS live`,
        [sha256(String(f.refresh_token ?? ''))])
      if (!old || !old.live || (clientId && old.client_id !== clientId)) {
        return oauthError(c, 'invalid_grant', 'refresh token is invalid or expired')
      }
      return c.json(await issueTokens(db, old.client_id), 200, { 'Cache-Control': 'no-store' })
    }

    return oauthError(c, 'unsupported_grant_type', 'use authorization_code or refresh_token')
  })
}
