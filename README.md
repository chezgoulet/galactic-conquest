# Galactic Conquest

A grand **land / air / space** battle, built in three.js. Two original factions
fight over a procedural planet — ground command posts, hover armor and
starfighters — while their capital ships duel in orbit, all in one seamless
scene. **Everything is generated from code**: the planets, the ships, the
soldiers, the insignia, and the orchestral score. No downloaded assets, no
samples.

It runs from `file://` or any static host. A tiny zero-dependency server adds
LAN multiplayer; an optional online service adds accounts, matchmaking and
ranked results.

## Play it

```bash
npm install            # installs the toolchain (esbuild, three, playwright)
npm start              # LAN server on http://localhost:8080  (serves + /ws signalling)
```

Open http://localhost:8080. Or, with no server at all:

```bash
npm run build          # produces dist/
# open dist/index.html from disk (file://) for single-player
```

**Controls.** `WASD` move · mouse aim · `LMB` fire · `RMB` zoom · `G`/`Q`
ability · `Shift` sprint/boost · `Space` jump · **`F` board the friendly you
aim at** · `C` commander view (select → `RMB` move, `H` hold, `1/2/3` groups) ·
`Z`/`X`/`V` squad follow / attack-move / free · `Tab` scoreboard · `Esc` pause.

### LAN multiplayer (host-authoritative, no accounts)

1. Host: open the Multiplayer menu → **Host**. You get a 4-letter room code.
2. Guests on your network: open the same address → **Join** with the code.

The host's browser runs the battle; guests send commands and see it live over
encrypted WebRTC. Signalling is a zero-dep server; the match itself is peer to
peer.

### Online (accounts + ranked)

```bash
cd deploy && cp .env.example .env   # set DOMAIN, SECRET_KEY, TURN_SECRET, …
docker compose up -d                 # Caddy + play + Postgres + coturn + backup
```

See [deploy/](deploy) and [docs/](docs) for full operations. The online service
also ships an **admin console** at `https://your-domain/admin` and an operator
CLI.

## Test

```bash
npm test                # game: core, data, campaign, sim, netcode, signalling e2e
npm run test:ui         # Playwright: renderer boots, no page errors
npm run test:online     # online service: 30 tests in-process on PGlite
```

## Repository

```
js/core     RNG, noise, math, loop, adaptive WebAudio music
js/data     factions, biomes, galaxy/campaign, units/weapons (pure data)
js/sim      deterministic World + simulation (browser-free)
js/render   three.js: planet, hulls, props, sky, fx, camera, renderer
js/net      host-authoritative netcode + WebRTC relay
js/ui       Game controller, HUD, menus, lobby, entry
server/     zero-dep LAN server (static + RFC6455 signalling)
apps/play   online service (Fastify + PGlite/Postgres) + admin console + CLI
deploy/     docker-compose: Caddy, play, Postgres, coturn, backups
tools/      esbuild bundle, static server, screenshot harness
test/       node --test (game) + Playwright smoke
```

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — how it fits together, layer by layer.
- [DECISIONS.md](DECISIONS.md) — the locked product decisions and the
  non-obvious technical trade-offs.
- [deploy/](deploy) + [docs/](docs) — deployment and operations.

## Status

The deep vertical slice is in: a full campaign across eight procedural biomes,
single-player vs. bots, LAN host-authoritative multiplayer, and the online
service (accounts, 2FA, lobbies, matchmaking, signed tickets, results + Elo,
crashes, moderation, admin console, CLI) all working end to end and covered by
tests. Content expansion (more ships/vehicles/biomes, richer AI, sensor fog)
builds on this architecture.
