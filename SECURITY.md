# Security policy

## Reporting a vulnerability

Please do **not** open a public issue for a security problem. Report it privately
through GitHub's [Security Advisories](https://github.com/chezgoulet/galactic-conquest/security/advisories/new)
for this repository. Include the affected component, a description, and a
reproduction if you can. We will acknowledge and triage as quickly as possible.

## Scope and trust model

Galactic Conquest is a static, client-side game plus two optional servers. The
relevant security surface is the **online service** (`apps/play`) and the **LAN
signalling server** (`server/`).

- The LAN signalling server brokers WebRTC offers/answers/ICE only. It never
  sees gameplay traffic. A match survives the server leaving.
- Online matches are peer-to-peer (WebRTC/DTLS). The service "introduces and
  vouches, never carries": it holds identity, issues signed match tickets, and
  reconciles results. It does not run the simulation.
- The simulation is host-authoritative and the host is a player, not a trusted
  referee. Ranked integrity rests on signed tickets, roster-bound claims, and
  settlement rules enforced by the service — not on trusting a peer's client.

Secrets (the Ed25519 keyring, TURN secret, session secret, database URL) live in
the environment, never in the repository. `deploy/.env.example` documents the
variables with placeholder values only.
