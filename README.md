# Fitness Hub

Design: [Fitness Hub — Spec Sheet.md](./Fitness%20Hub%20—%20Spec%20Sheet.md). Runs on this laptop with Docker Compose.

| Path | What |
| --- | --- |
| `compose.yaml` | All services: openGym, Postgres, cloudflared, hub worker + API |
| `.env` | Secrets and hostnames (gitignored, template in `.env.example`) |
| `db/migrations/` | Postgres schema, applied in order by the hub on startup |
| `hub/` | TypeScript sync worker, Hub API and remote MCP server (Node 24, Hono, pg, MCP SDK) |
| `prompts/` | Instructions for the claude.ai Project and the daily/weekly scheduled tasks |
| `scripts/backup.sh` | Nightly backup, run by cron at 03:00 → `backups/` |
| `scripts/hub-cli.sh` | Hub commands: pair openGym, sync now, sync status |
| `scripts/hub-dev.sh` | Run hub tooling (tests, typecheck) in the Node 24 image |
| `data/opengym/` | openGym's data (accounts, passkeys, workouts). Back this up |

## Week 1 setup

1. **Cloudflare tunnel.** In Cloudflare Zero Trust → Networks → Tunnels, create a tunnel
   (type Cloudflared). Copy the token from the install command into `CLOUDFLARE_TUNNEL_TOKEN`
   in `.env` and uncomment `COMPOSE_PROFILES=tunnel`.
2. **Public hostname.** On the tunnel, add `gym.<domain>` → `http://opengym-web:80`.
3. **Set `GYM_HOST=gym.<domain>`** in `.env`, then `docker compose up -d`.
   Check: `docker compose logs opengym-api | grep 'gym-api on'` shows the new host.
4. **Register your profile** at `https://gym.<domain>` on the Pixel 9 and Add to Home Screen.
   Register only after step 3: passkeys are bound to the hostname, so a passkey made under
   any other host stops working when it changes.
5. **Close signup:** set `OPENGYM_INVITE_ONLY=1`, then `docker compose up -d`.
6. **Off-machine backup:** install rclone, `rclone config` a remote (Google Drive or R2), and
   set `BACKUP_RCLONE_REMOTE`. Until then backups stay on this laptop only.

## Week 2 setup: sync

1. **openGym:** in openGym, Settings → Pair the mobile app, then within 5 minutes:
   `scripts/hub-cli.sh opengym-pair <CODE>`.
2. **Google Health:** in Google Cloud Console, enable the Google Health API, set the OAuth
   app to *In production* (Testing mode expires the refresh token every 7 days), add the four
   `googlehealth.*.readonly` scopes and create a Web client with redirect URI
   `http://localhost:8081/auth/google/callback`. Put its id and secret in `.env`,
   `docker compose up -d`, then open http://localhost:8081/auth/google on this laptop.
3. Check: `scripts/hub-cli.sh sync`, then `scripts/hub-cli.sh status`.

The worker queues both syncs at 21:00 every night (and catches up if the laptop was off).
Google's nightly run also backfills history 90 days at a time, up to two years.

## Week 3 setup: Claude

`hub-mcp` serves `https://mcp.<domain>/mcp` through the tunnel. It is its own OAuth 2.1
server: claude.ai registers itself, and the approval page (`/authorize`) is behind a Cloudflare
Access app that only lets the owner's email in. Only Claude's callback URLs can register.

1. claude.ai → Settings → Connectors → Add custom connector. Name `Fitness Hub`, URL
   `https://mcp.<domain>/mcp`, no advanced settings. Connect, enter the Access email code, Allow.
2. Create a Project "Fitness Hub", paste `prompts/meal.md` into its instructions and enable the
   connector in it.
3. Scheduled tasks: `prompts/daily.md` every day at 09:00 and `prompts/weekly.md` on Mondays at
   09:30, both with the connector enabled.
4. For meal photos: in the Project settings → Environment, add a cloud environment whose Allowed
   domains include `mcp.<domain>`. Without it meals still log, just without the photo.

Writes are audited in `mcp_audit`. Revoke Claude's access by removing the connector, or with
`DELETE FROM oauth_client` in Postgres.

## Hub development

```bash
scripts/hub-dev.sh npm run typecheck
HUB_DEV_DB=hub_test scripts/hub-dev.sh npm test   # wipes and uses the hub_test database
docker compose up -d --build hub-worker hub-api    # deploy a change
```

## Day to day

```bash
docker compose ps                 # status
docker compose logs -f opengym-api
scripts/hub-cli.sh status         # last sync per source
./scripts/backup.sh               # backup now
```

Updating openGym: bump `OPENGYM_VERSION` in `.env`, then `docker compose pull && docker compose up -d`.
Read its release notes first, since API changes can break the gym sync, and rebuild the exercise
names (`hub/scripts/build-opengym-catalogue.ts`).
`docker compose restart` does not re-read `.env`; use `docker compose up -d`.
