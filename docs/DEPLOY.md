# Deployment

Everything runs in Docker Compose: **Caddy** (TLS + static game + reverse
proxy), the **play** service (API + WS + admin), **Postgres**, **coturn**
(TURN relay), and a **backup** job. TLS is auto-provisioned by Caddy from
`DOMAIN`.

## Prerequisites

- Docker + Docker Compose v2
- A domain (and subdomains) that resolve to the host: `DOMAIN`,
  `play.DOMAIN`, `turn.DOMAIN`
- Ports 80/443 (TCP+UDP) for Caddy; coturn runs on host networking
  (3478/5349 + 49160–49400/UDP)

## One-time setup

```bash
cd deploy
cp .env.example .env
# edit .env:
#   DOMAIN          your apex domain
#   SECRET_KEY      openssl rand -hex 32     (play service master secret)
#   POSTGRES_PASSWORD  a strong value
#   TURN_SECRET     openssl rand -hex 24     (coturn static auth secret)
#   AGE_RECIPIENT   age-keygen -o key.txt    (backups; see below)
#   RCLONE_DEST     s3:bucket/path           (remote backup target)
```

> **Backups.** Create an age recipient (`age-keygen`), keep the private key
> somewhere safe (offline if possible), and put the public `age1…` recipient in
> `.env`. Set up an `rclone` remote so `RCLONE_DEST` works. Backups are
> `pg_dump -Fc` → verified → age-encrypted → kept locally (8) + synced to the
> remote (pruned to 90 days).

## Deploy

```bash
./deploy.sh          # backup → build → up → health-check
```

`deploy.sh` refuses to run if `SECRET_KEY`/`TURN_SECRET` are still placeholders,
runs a backup first (so a bad deploy is always restorable), builds the images,
brings the stack up, and polls `/healthz` until the play service is healthy.

## Verify

```bash
docker compose ps                          # all services healthy
curl -s https://play.$DOMAIN/healthz       # {"ok":true,…}
curl -s https://play.$DOMAIN/api/config    # ticket keys published
open  https://$DOMAIN/admin                # admin console (log in as staff)
open  https://$DOMAIN                      # the game
```

The coturn service reads the `turn.DOMAIN` cert from Caddy's data volume. If
you change the TURN cert, the `turn.sh` note in OPERATIONS explains reloading.

## Updates

Code changes to `apps/play` are picked up by a rebuild:

```bash
cd deploy && docker compose build play && docker compose up -d play
```

`deploy.sh` does this with the health gate. Schema changes are applied
automatically at boot (SQL migrations in
`apps/play/src/db/migrations/`).

## First run

The first deploy creates the Postgres data, applies migrations, and (via the
CLI) you should create an owner before opening the admin console:

```bash
docker compose exec play node apps/play/src/cli.js create-owner you@DOMAIN adminpassword
docker compose exec play node apps/play/src/cli.js promote you@DOMAIN admin
open https://$DOMAIN/admin
```

## Rollback

Each deploy ran a backup first. To roll back:

```bash
cd deploy
# code
git -C .. checkout <known-good-ref> && docker compose build play && docker compose up -d play
# data (if needed) — see OPERATIONS.md "Restore"
```
