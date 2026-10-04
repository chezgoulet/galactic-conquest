# Galactic Conquest — Decisions

Locked design decisions and the reasoning behind the non-obvious technical
choices. (The "locked" items are the product decisions; the rest are
architecture decisions that shaped the code.)

## Locked product decisions

1. **Deep vertical slice first.** Full architecture plus one fully-realized
   campaign demonstrating every mechanic, before expanding planet/vehicle/ship/
   biome content. The slice proves the whole loop end to end.
2. **Action-first with light command.** The player is a *unit in the world*
   (pilot/operator), not a god-view RTS player. From any mode they can board a
   unit (FPS / vehicle / fighter / capital bridge) and command a small allied
   force (select → move / hold / follow / target / commandeer). **No RTS
   economy, build menus, or mass production** — only a reinforcement-ticket
   pressure that gates how much you can hold on the field.
3. **Local multiplayer = LAN host-authoritative P2P.** A zero-dep Node
   signalling server + join codes. No accounts, no internet.
4. **Online = full services infra, free to play.** Membership code present but
   **off by default**. No paywall on playing.
5. **Battle scale = 2–4 capital ships + up to ~200 units.** 60 fps desktop
   target, met with LOD + a quality governor.

## Architectural decisions

### D1. Deterministic sim, browser-free.
The World draws only from its own seeded RNG and never touches THREE/DOM.
*Consequence:* SP bots, LAN/online replicas, and the Node test harness all run
the *same* code. This is the single most load-bearing property in the project —
it is what lets a guest rebuild the world from a seed and makes the netcode a
thin state-diff instead of a full replication engine.

### D2. Everything procedural (no assets).
Hulls, fighters, vehicles, infantry, terrain, structures, insignia, skybox,
particles and the orchestral score are all generated from code (genomes +
WebAudio synthesis). *Consequence:* the repo ships zero binary assets; the whole
game runs from `file://` or a static host; and there is nothing to license,
version, or fail to download.

### D3. One three.js scene for surface → air → space.
No cut between ground and orbit. The surface heightfield, the air band and the
orbital shell coexist in a single scene; the camera moves continuously. *Cost:*
a wider dynamic range (LOD + the quality governor handle the scale), *benefit:*
the seamless transitions the design calls for.

### D4. Host-authoritative netcode with deterministic rebuild.
The host runs the only sim. Guests rebuild static geometry from
`(biome, seed, scale)` and receive only **dynamic** state (units, post
ownership, tickets, players, event ring) as compact full-then-delta snapshots,
with lag-based full resync for rejoin/packet-loss. *Rejected:* lockstep (fragile
to input jitter, breaks the 2–200 scale) and full state replication (huge
bandwidth, drift). *Trade-off:* the host is the authority, so its machine bounds
the sim; acceptable for the LAN/2–4 player slice.

### D5. WebRTC for the transport; a signalling server that never sees traffic.
The match runs peer to peer over an encrypted (DTLS) DataChannel — directly on a
LAN, via TURN online. The signalling server only brokers SDP/ICE. *Consequence:*
a match survives the signalling server leaving, and the server can't observe or
tamper with gameplay. This is the same trust posture the online service keeps.

### D6. The online service "introduces and vouches, never carries."
Fastify + Postgres (PGlite for dev/tests). Lobbies/matchmaking run over a
WebSocket hub that relays WebRTC signalling; the match itself is P2P. The
service's irreplaceable jobs are identity, a signed match ticket (Ed25519), and
**result reconciliation** — every player posts a claim, agreement confirms,
disagreement escalates to a human, and only then is Elo applied. *Rejected:*
the service hosting the sim (it would become a bottleneck and a single point of
tamper). The signature-on-a-ticket + multi-claim settlement is what makes P2P
matches rank-safe.

### D7. Results are reconciled from all claims, not host authority.
A match settles when every roster member's claim agrees (→ confirmed) or
disagrees (→ disputed, operator resolves). *Why:* in a P2P match the host is a
player, not a trusted referee; requiring all claims to agree is the cheap,
auditable anti-cheat. Elo (K=24) is applied once, capped, and the full claim
history is stored for review.

### D8. Zero-dependency game server; zero native deps in the service.
The LAN server is plain `node:http` + a hand-rolled RFC 6455 (it had to be: no
`ws` dependency was allowed, and the same code is reusable as the WS server in
the online service). The online service avoids native modules (scrypt from
`node:crypto` instead of `@node-rs/argon2`) so it builds and runs anywhere,
including CI.

### D9. PGlite for dev/test, Postgres for prod, behind one interface.
A 4-method DB shim (`query / queryOne / exec / health`) + SQL-file migrations
auto-applied at boot. *Consequence:* the entire service, including every test,
runs with no external Postgres; production just sets `DATABASE_URL`.

### D10. Relay every online match through TURN.
No STUN-only fallback. *Why:* uniform NAT behaviour, one failure mode to debug,
and no direct-IP exposure of players' machines. Cost: relayed bandwidth; a
non-issue at the 2–4 player scale.

### D11. Single shared game instance in the lobby.
Host/join reuses the one `Game` (one renderer on the one canvas) instead of
spawning a second. The lobby hides the menu, starts the game in `host`/`guest`
role, and wires the `NetSession`. *Avoids:* two renderers fighting over one
WebGL context.

## Open / deferred

- **Sensor fog** for guests is stubbed in the contract (guests currently see the
  full board). Full occlusion-based fog is a follow-up.
- **Delta compression** is currently per-unit spawn/die + moved-position
  arrays; a proper CRDT-free diff with run-length or delta-of-deltas would cut
  bandwidth further.
- **Online quick-match rating gap widening** is a simple two-player pair; the
  gap-widening schedule is a follow-up.
- The **campaign** is a single strip of ten systems; the graph is richer than a
  line and the AI turn is heuristic — balance tuning is ongoing.
