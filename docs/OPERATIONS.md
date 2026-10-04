# Operations

Day-2 runbook for the online service.

## Health & monitoring

- `GET /healthz` — DB reachable. (The compose healthcheck hits this.)
- `GET /healthz` on the service reports `db` up; a DB outage fails the health
  check and Caddy stops routing.
- `GET /metrics` — Prometheus counters (users, matches, open issues, uptime),
  gated by `METRICS_TOKEN`.
- The **admin → Operations** page shows the ticket keyring, backup
  heartbeats and active alerts.

### Backup heartbeat

The `backup` container runs `pg_dump` → verify → age-encrypt → rclone every
`BACKUP_INTERVAL_H` (default 6h). A stale heartbeat (no backup in ~13h) is an
alert the service can surface. If you lose alerting, the dead-man's-switch is
the absence of fresh files in your `RCLONE_DEST`.

## Key rotation (match tickets)

Match tickets are signed by an Ed25519 key; the private key is encrypted at
rest with AES-256-GCM under a key derived from `SECRET_KEY`.

- **Rotate the signing key** (old tickets keep verifying for a grace period):
  ```bash
  docker compose exec play node apps/play/src/cli.js keys:rotate
  ```
  Or POST `/api/admin/keys/rotate`. The newest key signs; any unretired key
  verifies, so in-flight matches are unaffected.

## SECRET_KEY rotation

`SECRET_KEY` protects (a) the encrypted-at-rest ticket private keys and (b)
TOTP secrets. Rotating it is a two-step, and you must re-wrap before the old
key is gone:

1. Set the new `SECRET_KEY` in `.env` and restart `play`.
2. Immediately re-wrap the at-rest secrets with the new key:
   ```bash
   docker compose exec play node apps/play/src/cli.js secrets:rewrap
   ```

## Postgres

- Migrations run automatically at boot (files in
  `apps/play/src/db/migrations`, applied in order, tracked in
  `schema_migrations`). Never hand-edit the schema in a running service.
- `docker compose exec db psql -U gc -d gc` for ad-hoc queries.

### Restore

```bash
cd deploy
# local backup
docker run --rm -v gc-backups:/b -v $(pwd)/restore:/r alpine sh -c \
  "age -d -i /root/key.txt -o /r/dump.pgdump /b/gc_<ts>.pgdump.age && \
   pg_restore --list /r/dump.pgdump >/dev/null"
# then, into a clean DB:
docker compose exec -i db psql -U gc -d gc -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
docker run --rm -v $(pwd)/restore:/r -e PGPASSWORD="$POSTGRES_PASSWORD" \
  -p 5432:5432 postgres:17-alpine sh -c 'apk add --no-cache postgresql17-client >/dev/null; \
   pg_restore --clean --if-exists --no-owner --dbname=gc -h 127.0.0.1 -U gc /r/dump.pgdump'
```
(Re-create the owner/roles via the CLI after a bare schema restore.)

## TURN

coturn runs on the host network in `use-auth-secret` mode. The play service
mints per-connection REST credentials (username = expiry, credential =
HMAC-SHA1) from `TURN_SECRET` and hands them to clients. **No STUN-only
fallback** — every online match relays, by design (uniform NAT behaviour, no
direct-IP exposure).

- If the cert at `turn.DOMAIN` renews, ensure coturn can still read it from the
  Caddy data volume (it mounts `caddy_data` read-only). Restart the `turn`
  service after a cert rotation.
- Private ranges are denied as relay peers (can't be used to reach a LAN).

## CLI

```bash
docker compose exec play node apps/play/src/cli.js <command>
```

| command | what |
|---|---|
| `migrate` | apply pending migrations (also runs at boot) |
| `create-owner <email> <pw>` | pre-verified owner account |
| `promote <email\|name> <role>` | player→support/moderator/admin/owner |
| `grant <email\|name> <days>` | membership grant (no-op while membership is off) |
| `keys:rotate` | rotate the match-ticket signing key |
| `secrets:rewrap` | re-encrypt at-rest secrets after a SECRET_KEY rotation |

Every CLI mutation is written to the audit log.

## Roles

`player < support < moderator < admin < owner`. The admin console gates each
section by the viewer's role. Sanctions: `warn/mute/rename/suspend`
(moderator+), `ban/reset_mfa` (admin+).

## Incident checklist

1. **Service down** → `docker compose logs play`; check `/healthz` (DB?).
2. **DB down** → `docker compose up -d db`; the service reconnects.
3. **Bad deploy** → rollback (see DEPLOY.md) + restore a backup if the schema
   moved.
4. **Suspected cheater** → admin → Player reports; suspend/ban; the disputed
   matches stay in the ledger for review.
5. **Ticket keys** → if you suspect key exposure, `keys:rotate` (old still
   verifies briefly), and if `SECRET_KEY` is exposed, rotate + `secrets:rewrap`.
