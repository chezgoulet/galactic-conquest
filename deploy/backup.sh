#!/usr/bin/env bash
# Backup job: pg_dump -Fc -> verify -> age-encrypt -> keep local -> rclone.
# 'once' does one pass; default loops every BACKUP_INTERVAL (default 6h).
set -euo pipefail

DATABASE_URL="${DATABASE_URL:?DATABASE_URL required}"
AGE_RECIPIENT="${AGE_RECIPIENT:-}"
DEST="${RCLONE_DEST:-}"
INTERVAL_H="${BACKUP_INTERVAL_H:-6}"
KEEP="${BACKUP_KEEP:-8}"
KEEP_REMOTE_DAYS="${BACKUP_KEEP_REMOTE_DAYS:-90}"
OUT=/backups
mkdir -p "$OUT"

one_backup() {
  local ts; ts="$(date -u +%Y%m%dT%H%M%SZ)"
  local raw="$OUT/gc_${ts}.pgdump"
  echo "[$ts] dumping"
  pg_dump "$DATABASE_URL" --format=custom --file="$raw"
  pg_restore --list "$raw" >/dev/null   # verify the archive is valid
  local size; size="$(du -h "$raw" | cut -f1)"

  local target="$raw"
  if [ -n "$AGE_RECIPIENT" ]; then
    age -r "$AGE_RECIPIENT" -o "$raw.age" "$raw"
    sha256sum "$raw.age" > "$raw.age.sha256"
    rm -f "$raw"
    target="$raw.age"
  fi
  echo "[$ts] done ${size} -> ${target}"

  # prune local to KEEP
  ls -1t "$OUT"/*.age 2>/dev/null | tail -n +"$((KEEP+1))" | xargs -r rm -f
  ls -1t "$OUT"/*.age.sha256 2>/dev/null | tail -n +"$((KEEP+1))" | xargs -r rm -f

  # rclone: push newest, prune remote older than KEEP_REMOTE_DAYS
  if [ -n "$DEST" ]; then
    local newest; newest="$(basename "$(ls -1t "$OUT"/*.age 2>/dev/null | head -1)")"
    if [ -n "$newest" ]; then
      rclone copyto "$OUT/$newest" "$DEST/" "$newest"
      rclone copyto "$OUT/$newest.sha256" "$DEST/" "$newest.sha256" 2>/dev/null || true
    fi
    rclone delete "$DEST" --min-age "${KEEP_REMOTE_DAYS}d" 2>/dev/null || true
    echo "[$ts] synced to $DEST"
  fi
  echo "[$ts] backup complete"
}

if [ "${1:-}" = "once" ]; then one_backup; exit 0; fi

echo "backup loop every ${INTERVAL_H}h ('backup.sh once' for a single pass)"
while true; do
  one_backup
  # sleep in 60s chunks so a stop signal is quick to take
  for _ in $(seq 1 $((INTERVAL_H * 60))); do sleep 1; done
done
