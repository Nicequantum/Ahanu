# Ahanu

**ah-HAH-noo** — Algonquin for *He Laughs*.

Ahanu is an offline-first marine operating system for captains who run the Northeast canyons. Point Judith, Montauk, the steam to Veatch and Atlantis, a night on the wall, and home on a falling weather window. The plotter is an aid. The lookout is not optional. The name is allowed to smile; the helm is not a toy.

This repository is the product: a web PWA you can run now, a Cloudflare data plane for trip packs, and the TypeScript domain a future Flutter helm will share. Production bytes (chart clips, GRIB, SST) move through Cloudflare Workers, Pages, R2, D1, and Durable Objects — zero egress on R2. Vercel hosts only this Grok preview web client.

---

## Vision

Build the operating system you actually want on the boat.

- Download the ocean **at the dock**, over marina Wi-Fi.
- Steam with **no cell**. Scoring, solunar, and go/no-go run on the device, against packed rasters and the skipper’s own vessel limits.
- Read water the way a canyon captain already does: temperature breaks, color edges, SSH filaments, the 100-fathom curve, a buoy that disagrees with the model.
- Keep a log, a float plan, and a night-bridge display that does not blind you at 02:00.

Ahanu does not replace NOAA ENC, NMFS/HMS regulations, or seamanship. It packages bytes honestly and then gets out of the way.

---

## Features

- **Chart plotter** — MapLibre, Northeast shelf default, canyon heads labeled (Hudson, Veatch, Atlantis, Hydrographer).
- **ENC-derived bathymetry and contours** — official ENC remains the legal chart; Ahanu is an aid.
- **Ocean layers** — SST (GHRSST / CoastWatch), chlorophyll (Copernicus), altimetry (SSH anomaly).
- **On-device intel** — habitat score, temperature breaks, color edges. Never computed on a Worker.
- **72-hour GRIB** — GFS-Wave / WAVEWATCH III seas, NDFD + model wind, go/no-go against `BoatLimits`.
- **NDBC buoys and CO-OPS tides** — snapshot in the pack, not a live dependency offshore.
- **HMS closed-area overlay** — a reminder, not a legal determination.
- **Trip packs** — bbox + window + hashed R2 objects. **Ready for offshore** is a real checklist ([docs/DATA_PACKS.md](docs/DATA_PACKS.md)).
- **Catch log and community reports** — species contract: bigeye, yellowfin, bluefin, mahi, white marlin, blue marlin, swordfish, albacore.
- **Solunar, float plan, safety panel** — including the unfashionable parts (contacts, radios, souls on board).
- **Display modes** — night bridge, high contrast, pure black, daylight.
- **AIS (demo gateway)** — simulated contacts on the canyon walls and TSS; the adapter is `src/lib/data/ais.ts` so a real NMEA/Wi-Fi feed can replace it.
- **NMEA 0183 gateway** — encoded RMC/GGA/VTG/DBT/MWV/HDT on the instrument rail; same checksum the Dart package uses.
- **72h playback and track replay** — animate the GRIB, scrub the trolling track against marked fish.
- **Tricks of the Trade** — offline canyon tactics, weather windows, float-plan/EPIRB, HMS caution.

---

## Stack

| Layer | What |
| --- | --- |
| Web client (this repo) | React, MapLibre GL JS, TypeScript domain in `src/lib/ahanu` |
| Preview host | Vercel — Grok web client only, not production delivery |
| Production app shell | Cloudflare Workers (`ahanu`, root `wrangler.jsonc`) |
| Production data | Worker `ahanu-packs`, R2 `ahanu-trip-packs`, D1 `ahanu-core`, Durable Object `CommunityHub` |
| Ingest (adapters, then cron) | NOAA ENC, GFS-Wave/WW3, NDFD, GHRSST/CoastWatch SST, Copernicus chl-a, altimetry, CO-OPS, NDBC |
| Native helm | Flutter + MapLibre GL native — **planned**, domain package in [`flutter/`](flutter/README.md), see [docs/FLUTTER_ROADMAP.md](docs/FLUTTER_ROADMAP.md). |

Domain types (`CatchRecord`, `TripPackLayer`, `Buoy`, `LayerId`, `SpeciesId`, …) are the contract between PWA, Worker, and the future Dart port. Additive changes only.

---

## Offline-first

1. At Point Judith (or Montauk, or Newport), set a bbox and a 72 h window.
2. `GET /api/packs` returns a manifest: layers, sizes, hashes, R2 keys.
3. The client stores objects in IndexedDB (PWA) or SQLite (Flutter, later).
4. Hashes verify. Required layers present and fresh → **Ready for offshore**.
5. At sea, habitat and go/no-go run locally. Catch logs stay local if the radio path is down.

Workers package bytes. They do not score fish. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DATA_PACKS.md](docs/DATA_PACKS.md).

---

## How to run the web client

```bash
npm run dev
```

Requires Node 22. The Vite app binds `0.0.0.0:8080`. This is the PWA preview — packs in the preview may be generated manifests without real R2 bodies; the shape is the production shape.

### Trip-pack Worker (`ahanu-packs`)

```bash
cd cloudflare
npx wrangler deploy
```

Endpoints: `GET /health`, `GET /api/packs?west=&south=&east=&north=&hours=72`, `GET /api/sources`, `GET /api/buoys`, `POST /api/catches`.

### Production helm (Worker `ahanu`)

Root [`wrangler.jsonc`](wrangler.jsonc) is the app shell.

Cloudflare's setup wizard defaults to `npx wrangler deploy`. **Leave that on the dashboard** — Workers Builds injects `CLOUDFLARE_API_TOKEN` and `WORKERS_CI`, so Vite takes the Worker path by itself. From a laptop, use:

```bash
npm run deploy:cf
```

Same upload, plus `AHANU_CF=1`. Do not let Wrangler rewrite the `preview` script; that port is the Grok live helm.

MapLibre stays in the browser. Habitat scoring stays on-device.

---

## Safety

Ahanu charts, SST, and habitat are an **aid to navigation and fishing**. They are not a substitute for current official ENC, a competent lookout, a float plan left ashore, or the decision to stay in. HMS overlays are not legal advice. Go/no-go is a briefing against *your* vessel limits, not permission.

---

## Repository

[Nicequantum/Ahanu](https://github.com/Nicequantum/Ahanu)

Named for a laugh. Built for the steam south of Block.
