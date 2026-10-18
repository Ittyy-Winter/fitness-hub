import { serve } from '@hono/node-server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Hono } from 'hono'
import { config } from './config.ts'
import { pool, type Queryable } from './db.ts'
import { migrate } from './migrate.ts'
import { cloudflareAccess, type AccessVerifier } from './mcp/access.ts'
import { oauthRoutes, unauthorized, verifyBearer } from './mcp/oauth.ts'
import { registerTools } from './mcp/tools.ts'
import { uploadRoutes } from './mcp/upload.ts'

// Remote MCP server at mcp.<domain> (spec: "MCP server"): Streamable HTTP, stateless, behind
// its own OAuth. Claude never reaches Google Health or openGym, only these tools.

const INSTRUCTIONS = `Fitness Hub holds one person's watch, gym and meal data. Days are calendar days in
Asia/Bangkok (UTC+7); trigger_sync and get_sync_status return today's date. Energy is kcal, macros
grams, pace seconds per km. The owner often does not wear the watch, especially to sleep, so null
sleep, HRV, resting HR or weight usually means "not recorded", not a sync failure: say so briefly
and judge only what is there.`

export function buildApp(db: Queryable, access: AccessVerifier): Hono {
  const app = new Hono()
  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: 'internal error' }, 500)
  })
  app.get('/health', async (c) => {
    await db.query('SELECT 1')
    return c.json({ ok: true })
  })

  oauthRoutes(app, db, access)
  uploadRoutes(app, db)

  app.all('/mcp', async (c) => {
    if (!(await verifyBearer(db, c.req.header('authorization')))) return unauthorized(c)
    // Stateless: a fresh server per request, so nothing is held between calls.
    const server = new McpServer({ name: 'fitness-hub', version: '1.0.0' }, { instructions: INSTRUCTIONS })
    registerTools(server, db)
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    return transport.handleRequest(c.req.raw)
  })
  return app
}

if (import.meta.main) {
  await migrate(pool)
  serve({ fetch: buildApp(pool, cloudflareAccess()).fetch, port: config.mcp.port, hostname: '0.0.0.0' }, (info) => {
    console.log(`hub-mcp on :${info.port} as ${config.mcp.publicUrl}`)
  })
}
