#!/usr/bin/env bash
# Run a command in the hub's Node image with the repo mounted, on the compose network so it
# can reach Postgres and openGym. Ubuntu's own node is built without TypeScript support.
#   scripts/hub-dev.sh npm test
#   scripts/hub-dev.sh npm run typecheck
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
tty=(); [[ -t 0 && -t 1 ]] && tty=(-it)
exec docker run --rm "${tty[@]}" \
  --user "$(id -u):$(id -g)" \
  -v "$PWD:/app" -w /app/hub \
  --network fitness-hub_default \
  -e DATABASE_URL="postgres://hub:${POSTGRES_PASSWORD}@db:5432/${HUB_DEV_DB:-hub}" \
  -e HUB_ENCRYPTION_KEY -e GOOGLE_CLIENT_ID -e GOOGLE_CLIENT_SECRET \
  -e npm_config_cache=/tmp/.npm \
  node:24.22.0-alpine "$@"
