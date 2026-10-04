# Galactic Conquest — Architecture

A grand land/air/space battle in three.js. **Everything is generated from code** —
the planets, the ships, the infantry, the insignia, and the orchestral score.
There are no downloaded assets, no samples, no external content.

The game is a web app that runs from `file://` or any static host. A small
zero-dependency server adds LAN signalling; an optional online service adds
accounts, matchmaking and ranked results.

```
galactic-conquest/
├─ index.html              # entry: loads vendor/three + the game bundle
├─ vendor/three.min.js     # vendored three.js (no runtime fetch)
├─ js/
│  ├─ core/                # RNG, noise, math, events, fixed-step loop, MUSIC (WebAudio synth)
│  ├─ data/                # PURE data: factions, biomes, galaxy/campaign, units/weapons
│  ├─ sim/                 # World + simulation (deterministic, browser-free)
│  ├─ render/              # three.js: planet, hulls, props, sky, fx, camera, renderer
│  ├─ net/                 # host-authoritative netcode + WebRTC relay
│  └─ ui/                  # Game controller, HUD, menus, lobby, entry point
├─ server/                 # zero-dep LAN server: static + RFC6455 signalling
├─ tools/                  # esbuild bundle, static server, screenshot/shot harness
├─ apps/play/              # online service (Fastify + PGlite/Postgres) + admin + CLI
├─ deploy/                 # docker-compose (Caddy/play/Postgres/coturn/backup)
└─ test/                   # node --test (game) + Playwright UI smoke
```

## The four layers

**`core/`** — no `window`, no `THREE`. `rng` (mulberry32-style, seeded), `noise`
(fBm value noise), `vec3d`/`util`, an event emitter, a fixed-timestep accumulator,
and **`music.js`**, an adaptive orchestral generator built only from WebAudio
oscillators + filters. It reads a 0..1 *intensity* signal and a *faction theme*
and moves between a deployment ostinato, a battle crescendo, and a victory
sting. No audio files exist.

**`data/`** — pure, serializable tables. `factions.js` (the two original
factions — hull grammar, palette, engine glow, weapons, insignia, doctrine,
music theme), `biomes.js` (eight worlds with a procedural palette + an
inherent challenge each), and the roster split by domain: `land.js` (infantry,
vehicles, emplacements), `air.js` (fighters), `space.js` (capital ships), each
adding its weapons to `E.WEAPONS`; `units.js` holds the shared lookups,
doctrine and order of battle.

`galaxy.js` is the campaign — the strategic layer. Fleets are pieces on a
ten-world map; each carries ships (space), a fighter wing (air) and an army
(land), and that is exactly what it brings into a battle and what comes back
out damaged. Worlds pay credits and fuel only while *supplied* (connected to
the home system and not blockaded). A turn is: redeploy, build, run covert
ops, then assault or blockade one jump beyond your territory. The whole
campaign is one plain object, so saving is `JSON.stringify`.

**`sim/`** — the World owns match state and is **pure and deterministic**: it
draws only from its own `rng` and never touches THREE or the DOM. That property
is what makes everything else possible —
* single-player bots run the sim directly;
* LAN/online guests rebuild the same world from `(biome, seed, scale)`;
* the same sim drives the headless Node tests.

`terrain.js` builds a heightfield + battle layout (five command posts, two of
them HQs) deterministically from the seed. The rules are split by domain, and
every file adds to one `E.SIM` namespace (same-file calls are bare, cross-file
calls go through `E.SIM` at call time, so load order never matters):

| file | owns |
|---|---|
| `common.js` | helpers, unit construction, the altitude bands (`ALT`), the extension registries |
| `combat.js` | weapons, projectiles, damage, sightlines |
| `ai.js` | shared perception and intent (targets, goals, squad orders) |
| `land.js` | infantry, vehicles, emplacements |
| `air.js` | fighters and bombers |
| `space.js` | capital ships, orbital strikes |
| `objectives.js` | command posts, reinforcements, victory |
| `sim.js` | setup, the per-tick step, player verbs |

One sky, three domains: ground battle at the bottom, a cloud deck, thinning
air, then space where the fleets hold station (`E.SIM.ALT`). Domains plug in
through registries rather than editing each other: `ctl[kind]` (bot + player
control and damage hooks), `verbs` (player commands), `systems` (per-tick
world systems), `modes` (e.g. boarding), `obstacles` (cover that stops shots
and sightlines) and `net` (extra state for multiplayer snapshots).
`test/golden.cjs` prints a fingerprint of scripted battles; an unchanged
fingerprint proves a refactor changed no behaviour.

**`render/` + `ui/`** — three.js. `planet.js`/`geo.js` build the surface,
`hulls.js`/`props.js` build capital ships and ground structures from genomes,
`sky.js` the skybox, `fx.js` particles, `camera.js` the four view modes
(fps / vehicle / fighter / capital / commander), `scene.js` the quality
governor, and `renderer.js` the per-frame sync. `ui/game.js` is the controller:
input → `World` verbs, the deploy→play→dead state machine, audio routing, and
the camera. `ui/hud.js` is the DOM overlay; `ui/main.js` boots; `ui/menus.js`
the menus; `ui/lobby.js` LAN host/join.

The renderer interpolates unit positions on the client, so the sim's fixed 30 Hz
steps look smooth at display refresh rates.

## One scene, three layers (surface → air → space)

The battle spans a large procedural planet, an air band, and orbital space —
all in **one** three.js scene. `planet.js` renders the surface heightfield and
its sky shell; capitals and fighters live at the orbital altitude; the camera
moves continuously between ground, air and space with no cut. The biome's sky,
atmosphere and weather are all procedural (`sky.js`, `fx.js`).

## Combat model

Two factions fight over five command posts while their capital ships duel
overhead. A side has a pool of **reinforcement tickets**; every death spends
one, and holding more posts than the enemy *bleeds* the opponent. Destroying the
enemy flagship costs them a large amount at once. A side loses when its tickets
hit zero or it is **wiped** (holds no posts and has no soldiers left). The player
is a *pilot/operator in the world*: press `F` to board the friendly you aim at
(infanty FPS, vehicle, fighter dogfight, or the capital's bridge) or `C` for a
commander view to select and order your forces (move / hold / follow / free).

## Netcode (host-authoritative)

The host runs the only `World`. Guests send the same commands `Game.cmd()` builds
locally (`input / possess / release / deploy / order`); the host routes them
onto the World under a per-guest pid. Because the sim is deterministic, a guest
rebuilds planet/terrain/cps from the host's `(biome, seed, scale)` and needs only
the **dynamic** state streamed back: units, post ownership, team tickets,
players, and a short event ring (for FX/sound). Snapshots are compact arrays —
the first is full, the rest are deltas (moved / spawned / died), and a guest that
falls ≥3 snapshots behind gets a full resync (so packet loss and rejoin heal
themselves without a reconnect).

Transport is **WebRTC DataChannel**, encrypted end to end (DTLS): directly on a
LAN, through a TURN relay online. Signalling is a zero-dep RFC 6455 server
(`server/signal.cjs`) that brokers offers/answers/ICE and nothing else — it never
sees game traffic, and a match survives the signalling server leaving.
`js/net/relay.js` is the transport (hello handshake, ICE restart); `js/net/net.js`
is the session (pack/apply/route + `RemoteWorld`).

## Online service (`apps/play`)

Modeled on a "introduces players and vouches for them; it never carries a match"
service. Fastify + a thin DB interface over **Postgres** (prod) or **PGlite**
(dev/test, in-process). It is *not* a game server:

- **Auth**: scrypt passwords, opaque sessions, TOTP 2FA + recovery codes,
  email verify/reset, and a game *hand-off* (client registers a verifier →
  browser approves → client claims a game token).
- **Lobbies & matchmaking**: a WebSocket signalling hub (the same WebRTC dance)
  with 5-letter room codes, host/join/lobbies/kick, SDP/ICE relay, and a
  quick-match queue keyed by mode.
- **Signed match tickets**: Ed25519 keyring (private keys encrypted at rest with
  AES-256-GCM under `SECRET_KEY`). A ticket vouches for the match roster; the
  client verifies it so a peer can't grant itself a seat or a longer match.
- **Results + Elo**: players each post a claim after the match; agreement →
  *confirmed*, disagreement → *disputed* (operator resolves). Settlement applies
  a capped Elo delta (K=24) once and bumps lifetime stats.
- **Crashes/bugs** (fingerprinted into issues), **perf** runs, **player
  reports + sanctions**, **announcements**, **live config**, **audit log**.
- **Admin console** (vanilla JS, role-gated) and an **operator CLI** (talks to
  the DB directly: `create-owner`, `promote`, `grant`, `keys:rotate`,
  `secrets:rewrap`, `migrate`).
- **TURN** REST credentials are minted per connection from `TURN_SECRET`.

Membership (a paid tier) is present but **off by default**.

## Deploy

`deploy/docker-compose.yml` runs Caddy (TLS + static + reverse proxy), the play
service, Postgres, coturn (TURN, host network, relay-only), and a backup job
(`pg_dump -Fc` → verify → age-encrypt → rclone, with a heartbeat the service
alerts on if stale). See `deploy/` and `docs/` for operations.

## Testing

`npm test` runs the game's headless Node tests (core, data, campaign, sim,
netcode, and the real LAN signalling server over real masked WebSockets) plus a
bundle sanity check. `npm run test:ui` is a Playwright smoke test (renderer
boots, terrain + units present, no page errors). `npm run test:online` runs the
service's suite (30 tests) in-process on PGlite, including a real WebSocket
round-trip through the hub.
