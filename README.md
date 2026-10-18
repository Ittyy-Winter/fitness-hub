# Fitness Hub

Design: [Fitness Hub — Spec Sheet.md](./Fitness%20Hub%20—%20Spec%20Sheet.md). Runs on this laptop with Docker Compose.

| Path | What |
| --- | --- |
| `compose.yaml` | All services. Week 1: openGym, Postgres, cloudflared |
| `.env` | Secrets and hostnames (gitignored, template in `.env.example`) |
| `db/migrations/` | Postgres schema. `001_init.sql` runs automatically on an empty volume |
| `scripts/backup.sh` | Nightly backup, run by cron at 03:00 → `backups/` |
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

## Day to day

```bash
docker compose ps                 # status
docker compose logs -f opengym-api
./scripts/backup.sh               # backup now
```

Updating openGym: bump `OPENGYM_VERSION` in `.env`, then `docker compose pull && docker compose up -d`.
Read its release notes first, since API changes can break the gym sync.
`docker compose restart` does not re-read `.env`; use `docker compose up -d`.
