#!/usr/bin/env bash
# Nightly backup: Postgres dump + openGym data dir, kept BACKUP_KEEP_DAYS days,
# optionally copied off the machine with rclone (spec: Non-functional → Backup).
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; source .env; set +a

keep_days="${BACKUP_KEEP_DAYS:-14}"
stamp="$(date +%F_%H%M)"
out="backups/$stamp"
mkdir -p "$out"

# Read through the containers so file ownership inside the volumes never matters.
docker compose exec -T db pg_dump -U hub -d hub --format=custom > "$out/hub.dump"
docker compose exec -T opengym-api tar czf - -C /data . > "$out/opengym-data.tar.gz"

# Fail loudly on an empty artifact rather than keep a useless backup.
for f in "$out"/*; do
  [[ -s "$f" ]] || { echo "backup: $f is empty" >&2; exit 1; }
done

find backups -mindepth 1 -maxdepth 1 -type d -mtime +"$keep_days" -exec rm -rf {} +

if [[ -n "${BACKUP_RCLONE_REMOTE:-}" ]]; then
  rclone copy "$out" "$BACKUP_RCLONE_REMOTE/$stamp"
  rclone delete --min-age "${keep_days}d" --rmdirs "$BACKUP_RCLONE_REMOTE"
fi

echo "backup: $out ($(du -sh "$out" | cut -f1))"
