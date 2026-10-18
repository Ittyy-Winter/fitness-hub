import { createRemoteJWKSet, jwtVerify } from 'jose'
import { config } from '../config.ts'

// Cloudflare Access sits in front of /authorize and passes the signed-in identity as a JWT in
// Cf-Access-Jwt-Assertion. Verifying it here means a request that somehow skipped Access
// (or a forged header) still cannot approve a client.

export type AccessVerifier = (jwt: string | undefined) => Promise<{ email: string } | null>

export function cloudflareAccess(teamDomain = config.mcp.accessTeamDomain, aud = config.mcp.accessAud): AccessVerifier {
  if (!teamDomain || !aud) {
    return async () => {
      throw new Error('CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD must be set to approve Claude')
    }
  }
  const issuer = `https://${teamDomain}`
  const keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
  return async (jwt) => {
    if (!jwt) return null
    try {
      const { payload } = await jwtVerify(jwt, keys, { issuer, audience: aud })
      return typeof payload.email === 'string' ? { email: payload.email } : null
    } catch {
      return null
    }
  }
}
