# Contributing

Thanks for your interest in Galactic Conquest. This is a browser game whose
world, ships, soldiers and music are all generated from code — no downloaded
assets, ever.

## Setup

```bash
npm install                 # toolchain: esbuild, three, playwright
npm start                   # LAN server on http://localhost:8080
# or, with no server:
npm run build               # produces dist/; open dist/index.html from disk
```

Node 20+ is recommended (the online service requires it; the game itself runs on
18+).

## Test

```bash
npm test                    # game: core, data, campaign, sim, netcode, signalling
npm run test:online         # online service (in-process PGlite)
npm run test:ui             # Playwright: renderer smoke, UI flow, audio levels
npm run test:balance        # AI-vs-AI balance harnesses (thresholds)
node test/golden.cjs        # determinism fingerprint (asserts fixtures)
npm run perf -- --w 2560 --h 1440 --quality ultra   # real-GPU frame time
```

## Ground rules

- **The simulation is deterministic and browser-free.** `js/sim/**` may draw
  randomness only from the world's own `w.rng` and must never touch `THREE` or
  the DOM. Iterate arrays in a stable order. Never use `Math.random`/`Date` in
  the sim. `test/golden.cjs` is the tripwire; if you change sim behaviour on
  purpose, update its fixtures in the same commit.
- **Everything procedural.** No binary assets, fonts, images or samples.
- **`js/game.bundle.js` is generated and committed.** The page loads it directly
  (it is what makes `file://` work). Run `npm run build` and commit the result
  with your source changes; CI fails if the committed bundle is stale.
- **Materials** are built only through the `E.Mat` factory in `js/render/mat.js`;
  custom shading is TSL, never GLSL.
- **One change per PR.** Keep refactors separate from behaviour changes.

## Pull requests

- Branch from `master`, open a PR, and keep the diff focused.
- CI (`.github/workflows/ci.yml`) must be green: `fast` (tests, bundle
  freshness, determinism), `balance`, and `ui` are required.
- PRs are **squash-merged** once approved and green.
- Write imperative commit messages (e.g. "Fix net snapshot framing").

## Reporting security issues

See [SECURITY.md](SECURITY.md). Do not open a public issue for a vulnerability.
