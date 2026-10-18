#!/usr/bin/env bash
# Hub operator commands, run inside the running worker container.
#   scripts/hub-cli.sh opengym-pair <CODE>   pair with openGym (Settings → Pair the mobile app)
#   scripts/hub-cli.sh sync [source]         queue a sync and wait for it
#   scripts/hub-cli.sh status                last job per source
set -euo pipefail
cd "$(dirname "$0")/.."
exec docker compose exec -T hub-worker node src/cli.ts "$@"
