#!/usr/bin/env bash
# Deploy: run a backup, build images, then a health-checked rollout.
set -euo pipefail
cd "$(dirname "$0")"

command -v docker >/dev/null || { echo "docker is required"; exit 1; }

# sanity: production requires real secrets
if [ ! -f .env ]; then echo "no .env (copy .env.example)"; exit 1; fi
set -a; . ./.env; set +a
if echo "${SECRET_KEY:-}" | grep -qE "CHANGE-ME|^$|dev-secret"; then echo "set a real SECRET_KEY"; exit 1; fi
if echo "${TURN_SECRET:-}" | grep -qE "CHANGE-ME|^$"; then echo "set a real TURN_SECRET"; exit 1; fi

echo "==> backup before deploy"
docker compose run --rm --no-deps backup bash -c "backup.sh once" || echo "(backup skipped — first run has no data yet)"

echo "==> build"
docker compose build

echo "==> up"
docker compose up -d --remove-orphans

echo "==> waiting for health"
for i in $(seq 1 30); do
  if docker compose exec -T play node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    echo "play service healthy"; break
  fi
  sleep 3
  [ "$i" -eq 30 ] && { echo "play service did not become healthy"; docker compose logs --tail=40 play; exit 1; }
done
echo "deployed."
