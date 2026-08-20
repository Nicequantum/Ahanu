# Ahanu

**ah-HAH-noo** — Algonquin for _He Laughs_.

Offline-first marine OS for Northeast canyon runs (Point Judith, Montauk, the steam to Veatch and Atlantis). The plotter is an aid. The lookout is not optional.

This repo is the product: a web PWA, a Cloudflare data plane for trip packs, and the TypeScript domain a future Flutter helm will share. Production bytes move through Cloudflare Workers, R2, D1, and Durable Objects. The Grok preview web client may still build through Nitro/Vercel; that path is not production.

## Safety

Ahanu charts, SST, and habitat are an **aid to navigation and fishing**. They are not a substitute for current official ENC, a competent lookout, a float plan left ashore, or the decision to stay in. HMS overlays are not legal advice. Go/no-go is a briefing against _your_ vessel limits, not permission.

## What is real vs fixture

| Piece                                                                              | State                                                                |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Pack loop (manifest, object GET, SHA-256, IndexedDB, on-device Ready-for-offshore) | Real                                                                 |
| Helm paint of packed SST / wind / wave / bathy / buoys / tides when bodies exist   | Real                                                                 |
| Habitat score and go/no-go                                                         | On-device only. Worker does not score.                               |
| Preview GET /api/packs                                                             | Deterministic hashed fixtures                                        |
| SST / wind / wave / bathy grids                                                    | Hashed fixtures. Live GHRSST / GFS-Wave / NDFD / CMEMS not ingested. |
| ENC                                                                                | Fixture cell list, not official S-57. Not a legal chart.             |
| NDBC buoys and CO-OPS tides                                                        | Public fetch when the network allows; failure degrades to fixtures   |
| AIS                                                                                | Demo gateway in src/lib/data/ais.ts                                  |
| Production R2 objects / ingest cron                                                | Not provisioned here                                                 |
| Flutter helm                                                                       | Not started. flutter/ is a Dart domain stub                          |

Missing stays missing. Packed paint does not silently fall back to a seed model.

## Requirements

Node 22. The test runner uses Node 22 type stripping. `.nvmrc` pins 22.

## Run

```bash
npm install
npm run dev
```

Vite binds `0.0.0.0:8080`. Preview packs may be generated manifests; the shape is the production shape.

## Test

```bash
npm test
```

```bash
npm run typecheck
```

Lint and format scripts live in package.json.

## Deploy (Cloudflare)

Root wrangler.jsonc is the app shell (Worker ahanu). Do not run bare wrangler deploy; it skips Vite. The dashboard command must be:

```bash
npm run deploy:cf
```

That builds with AHANU_CF=1 (writes the virtual server entry) then uploads. MapLibre stays in the browser.

Trip-pack Worker (ahanu-packs):

```bash
cd cloudflare
npx wrangler deploy --config wrangler.toml
```

`--config wrangler.toml` is required. Wrangler 4 find-up would otherwise pick the parent `wrangler.jsonc` (PWA) and run `AHANU_CF=1 npx vite build`.
`api.ahanu.app` is not provisioned; this deploys to https://ahanu-packs.hombre3536.workers.dev.

Helm Packs download uses `VITE_AHANU_PACKS_URL` (`packsApiBase()` in `src/lib/ahanu/pack-client.ts`):

- Local Vite: unset env, same-origin packs route.
- CF/prod PWA: defaults to live ahanu-packs workers.dev. Override with VITE_AHANU_PACKS_URL.
- Grok/Nitro preview stays same-origin fixture packs. Not the ship path.

Endpoints: GET /health, GET /api/packs, GET /api/objects, GET /api/sources, GET /api/buoys, POST /api/catches.

R2 ahanu-trip-packs and D1 ahanu-core exist in ENAM. Live PJ pack on workers.dev is 12 NOAA / 0 fixture. Preview packs without live=1 stay fixtures.

## Pack loop

1. At the dock, set a bbox and a 72 h window.
2. GET /api/packs returns a manifest: layers, sizes, hashes, keys.
3. Client stores objects in IndexedDB (PWA) or SQLite (Flutter, later).
4. Hashes verify. Required layers present and fresh -> Ready for offshore.
5. At sea, habitat and go/no-go run locally. Catch logs stay local if POST fails.

Workers package bytes. They do not score fish.

## Stack

| Layer                | What                                                                                |
| -------------------- | ----------------------------------------------------------------------------------- |
| Web client           | React, MapLibre GL JS, TypeScript domain in src/lib/ahanu                           |
| Preview host         | Nitro/Vercel — Grok web client only, not production                                                       |
| Production app shell | Cloudflare Worker ahanu (root wrangler.jsonc)                                       |
| Production data      | Worker ahanu-packs, R2 ahanu-trip-packs, D1 ahanu-core, Durable Object CommunityHub |
| Ingest               | Public NDBC / CO-OPS now. ENC, GFS-Wave, NDFD, GHRSST, CMEMS later                  |
| Native helm          | Planned. Domain stub in flutter/. See docs/FLUTTER_ROADMAP.md                       |

Domain types (CatchRecord, TripPackLayer, Buoy, LayerId, SpeciesId) are the contract. Additive changes only.

## Docs

- docs/ARCHITECTURE.md — separations, data plane, what the Worker may not do
- docs/DATA_PACKS.md — pack contents, Ready-for-offshore, ingest ops
- docs/STATUS.md — what works vs fixture, this-pass file list
- docs/FLUTTER_ROADMAP.md — native helm is not started
- CONTRIBUTING.md — tests and the pack-loop contract

## License

MIT. See LICENSE.
