# Ahanu architecture

Ahanu is an **offline-first marine operating system** for captains who run the Northeast canyons — Point Judith, Montauk, and the shelf from Hudson to Hydrographer. This document is the contract between the web PWA shipping in this repo, the Cloudflare data plane, and the Flutter client that does not exist yet.

Production data delivery is Cloudflare: **Workers + Pages + R2 + D1 + Durable Objects**. Chart packs, GRIB, and SST leave R2 at zero egress. The Grok preview web client may still build through Nitro/Vercel. That path is not production and must not serve a single marine byte.

On-device scoring never runs on a Worker. Workers package bytes. The helm thinks.

---

## Why a web PWA now, Flutter later

The runnable client in this repository is a progressive web app. That is a deliberate first ship, not a compromise that gets thrown away.

- A captain can install the PWA on a plotter-adjacent laptop or a phone at the dock, download a trip pack over marina Wi-Fi, and steam with no cell.
- The domain lives in TypeScript at `src/lib/ahanu` (`types.ts`, `constants.ts`, `geo.ts`). Catch records, trip-pack layers, species, buoys, community reports, vessel limits, and the Northeast operating box are defined once.
- Flutter is the native helm client (MapLibre GL native, SQLite, NMEA). It will consume the **same contracts**, ported to Dart or compiled to WASM. It will not invent a second species list or a second bbox.

Until Flutter exists, treat `src/lib/ahanu` as frozen API: additive changes only, no silent unit changes (meters stay meters, nautical miles stay nautical miles, SST stays °C).

```
┌─────────────────────────────────────────────────────────────┐
│  Device (PWA today · Flutter later)                         │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐             │
│  │ Map engine │  │  Scoring   │  │ User data  │             │
│  │ MapLibre   │  │ habitat    │  │ catches    │             │
│  │ layers     │  │ solunar    │  │ marks      │             │
│  │ ENC/bathy  │  │ go/no-go   │  │ float plan │             │
│  └─────▲──────┘  └─────▲──────┘  └─────▲──────┘             │
│        │ rasters       │ grids         │ sync                │
│        └───────────────┴───────────────┘                    │
│                        IndexedDB / SQLite  ← trip pack       │
└────────────────────────────▲────────────────────────────────┘
                             │ HTTPS at the dock, then offline
┌────────────────────────────┴────────────────────────────────┐
│  Cloudflare data plane                                      │
│  Pages (app shell) · Worker ahanu-packs · R2 · D1 · DO      │
└────────────────────────────▲────────────────────────────────┘
                             │ ingest (cron, not request path)
           NOAA ENC · GFS-Wave · NDFD · GHRSST · CMEMS · CO-OPS · NDBC
```

---

## Offline-first: trip packs → IndexedDB / SQLite

A trip pack is a **bbox + time window + content-addressed layers**. The captain downloads it before leaving the harbor. After that, the plotter does not need the network.

| Store                                     | Web PWA                                 | Flutter (planned)   |
| ----------------------------------------- | --------------------------------------- | ------------------- |
| Pack bytes (GRIB, COG, ENC clip, GeoJSON) | IndexedDB (`Cache` + IDB for manifests) | SQLite + filesystem |
| User marks, routes, catch log             | IndexedDB / PGLite                      | SQLite              |
| Session (vessel, display mode)            | memory + localStorage                   | secure prefs        |

The Worker endpoint `GET /api/packs?bbox=w,s,e,n&start=ISO&hours=72` returns a manifest (`TripPackLayer` plus `hash` and `r2Key`). The client then GETs each R2 object. Hashes are verified on write. A pack whose required layers are present and fresh is **Ready for offshore** — see [DATA_PACKS.md](./DATA_PACKS.md).

Nothing in the scoring pipeline is allowed to become a network round-trip. If SST is in the pack, habitat can be painted. If it is not, the layer is missing, not “computed in the cloud.”

---

## Four separations that must not collapse

### 1. Map engine

MapLibre GL JS (web) / MapLibre GL native (Flutter). Responsible for camera, style, picking, night/high-contrast/pure-black/day paint, and layer opacity. It does not know what a bigeye prefers.

### 2. Data layers

Rasters and vectors that arrived in the pack: ENC-derived bathy and contours, canyon axes, SST, chlorophyll, altimetry, wind/wave GRIB, NDBC snapshots, CO-OPS tides, HMS closed areas. Identifiers are the `LayerId` union in `src/lib/ahanu/types.ts`.

### 3. Scoring (on-device only)

Habitat score, temperature-break isolines, chlorophyll edges, solunar, and go/no-go against `BoatLimits` run next to the map, on the same machine that is pitching. Inputs are packed rasters plus vessel state. Outputs are overlay GeoJSON / grid textures. **The Worker has no scoring code and must not grow any.**

### 4. User data

Waypoints, routes, tracks, catch records, float plan, emergency contacts. Owned by the skipper. Catch upserts may sync through `POST /api/catches` when a radio/Wi-Fi path exists; they remain valid if they never do (`synced?: boolean`).

Mixing these — for example baking a habitat GeoTIFF on the Worker — would couple a scientific opinion to a download and make the offline client a renderer of someone else’s score. Ahanu does not do that.

---

## Cloudflare data plane

| Piece           | Name               | Role                                                                                                |
| --------------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| Worker          | `ahanu-packs`      | CORS, health, pack manifests, buoy snapshot, catch upsert. Community HTTP is 404 (unused).          |
| Pages           | (app shell)        | Hosts the production PWA; not the Grok/Nitro preview                                                   |
| R2              | `ahanu-trip-packs` | Content-addressed layer objects. Zero egress to the client.                                         |
| D1              | `ahanu-core`       | Catch log, community metadata, pack index, device keys                                              |
| Durable Objects | `CommunityHub`     | Bbox-scoped live reports; later, pack-build leases so two ingest crons do not write the same prefix |

Ingest adapters live in `cloudflare/src/ingest/sources.ts`. They are stubs that return metadata and **real NOAA / CMEMS URLs**. A scheduled Worker will clip, hash, and put. Until that job exists, `/api/packs` still returns a coherent Northeast manifest so the client can be built against a stable shape.

HTTP `POST /api/ingest` requires Worker secret `INGEST_TOKEN` and fails closed if it is missing. Cron is in-process and does not present a bearer. `POST /api/catches` keeps device-token identity (`Authorization: Bearer <device-token>`); each row is bound to SHA-256 of that bearer. Same token updates; a different token is 403. The header shape will not change when those become short-lived device JWTs.

### What the Worker is allowed to do

- Clip, transcode, hash, and list bytes.
- Serve NDBC snapshots and CO-OPS windows that were already ingested.
- Accept a catch upsert (`POST /api/catches`, device bearer). Community HTTP is unused (404).

### What the Worker is forbidden to do

- Habitat / species preference scoring.
- Isoline generation that the helm could compute from SST.
- Storing a go/no-go decision. Vessel limits live on the boat.

---

## NMEA 2000 / Wi-Fi gateway (future)

Ahanu does not talk to the backbone itself. A small gateway on the boat (Wi-Fi access point + NMEA 2000 or 0183 bridge) will publish:

- position, COG, SOG, heading
- depth
- wind (if the vessel has it)
- later: engine / fuel, AIS targets (`LayerId` `"ais"` is reserved)

The PWA and the Flutter client both consume a local WebSocket / UDP JSON feed. When the gateway is absent, the client simulates or freezes last-known `VesselState`. Gateway code is not in this repository.

---

## Safety

Charts, SST, and habitat in Ahanu are **an aid to navigation and fishing**. They are not a substitute for:

1. Official NOAA ENC (or paper) of the appropriate usage band, kept up to date.
2. A lookout. The plotter does not see lobster gear, a raft of weed, or a recreational at night.
3. A float plan left ashore, working radios (VHF + an offshore path), and the judgment to stay in when the 72 h strip is red.

HMS closed areas in the pack are a reminder overlay, not a legal determination. The skipper is responsible for current NMFS/HMS regulations.

Go/no-go is computed from the skipper’s own `BoatLimits` (wind, sea, fuel, reserve) against packed GRIB. It is a briefing, not permission.

---

## Ahanu spirit in the UX

**Ahanu** (ah-HAH-noo) is Algonquin for _He Laughs_. The boat in the domain defaults is _Laughing One_. The product should feel like a competent, slightly dry skipper who is glad to be out — not a gamified fishing app and not a military clone.

- Night bridge first. Chrome stays dim; the water stays bright enough to read.
- Sparse language. Depth in fathoms when it helps, meters in the contract, no marketing sentences on the helm.
- Humor lives in the name and in the logbook, not in toast messages while you are lining up a canyon wall at 02:00.
- Trust the water: show the break, the color edge, the buoy, and then get out of the way.

When those are in tension with a feature request, the helm wins.

## Current status

What is implemented vs fixture lives in [STATUS.md](./STATUS.md). This document is the contract; STATUS is the inventory.
