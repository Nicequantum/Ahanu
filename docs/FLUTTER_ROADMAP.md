# Flutter roadmap

There is **a Dart domain package** at [`flutter/`](../flutter/README.md) (`ahanu_domain`) that mirrors `src/lib/ahanu` types, geo, NMEA checksum, and habitat weights. It is not a running helm. The runnable client is the web PWA. Native remains an intention: the same marine OS, on the helm, with MapLibre GL native and a local NMEA gateway.

The constraint that makes the port feasible is the domain in `src/lib/ahanu`. Freeze it. Port it. Do not grow a second ocean.

---

## Goal

A Flutter application that:

- Renders the same layers, with the same `LayerId`s, on MapLibre GL native.
- Scores habitat, breaks, edges, solunar, and go/no-go **on device**, identically to the PWA.
- Reads trip packs written by the same Cloudflare Worker into SQLite + files.
- Talks to a future NMEA 2000 / Wi-Fi gateway for `VesselState`.
- Does not call Vercel for data. Production bytes still come from Cloudflare R2 (zero egress) via `ahanu-packs`.

Feature parity with the PWA is the exit criterion for “1.0 helm.” App Store / Play come after parity, not instead of it.

---

## Shared brain: Dart port vs WASM

Two honest options. Pick one before writing widgets.

### Option A — Dart port of `src/lib/ahanu`

Hand-port `types.ts`, `constants.ts`, `geo.ts`, and (when they exist) scoring + solunar into a `ahanu_domain` Dart package.

- Pros: native, no WASM toolchain on iOS, easy to debug on the plotter.
- Cons: two implementations. Requires a fixture suite (bbox, haversine, species SST windows, known habitat cells) that both TS and Dart must pass.
- Rule: TypeScript remains the spec. Dart is the port. Failures are Dart bugs.

### Option B — compile the TypeScript domain to WASM

Bundle scoring/solunar/geo as a WASM package the Flutter app loads once at start.

- Pros: one implementation. The PWA and the helm cannot drift.
- Cons: iOS/Android WASM bring-up, numeric edge cases, larger binary, harder hot-reload.

**Recommendation:** Option A for `geo` + types + constants (small, stable, nautical-math heavy), Option B only if scoring grows into a grid kernel that nobody wants to transcribe. Do not WASM the UI. Do not Dart-port MapLibre.

Whichever option is chosen, the fixture pack lives in-repo (`tests/domain/` or similar) and is run in CI on both sides the day the Dart package is born.

---

## Phases

### Phase 0 — Contract freeze (web, now)

Already in motion.

- `src/lib/ahanu/types.ts` is the published shape: `CatchRecord`, `TripPackLayer`, `Buoy`, `CommunityReport`, `SpeciesId`, `LayerId`, `BoatLimits`, `VesselState`, `ForecastHour`.
- Worker copies those types; it does not extend them with scoring fields.
- Docs in this folder describe packs and the data plane.
- **Exit:** additive-only changes to the domain. No silent unit changes.

### Phase 1 — Domain package, no UI

New repo or `packages/ahanu_domain` (Dart) **when the port starts**. Not before.

- Port `LatLon`, haversine, bearing, destination, formatters.
- Port `REGION`, Point Judith / canyon heads, species order, layer meta.
- Golden tests against TypeScript fixtures (distances in nautical miles to 1e-6 relative).
- **Exit:** `dart test` matches `geo.ts` on a checked-in set of points including Veatch head and Point Judith.

### Phase 2 — Flutter shell + MapLibre GL native

Empty helm. Night-bridge theme. No fishing features.

- MapLibre GL native, Northeast default center/zoom from constants.
- Display modes: night, high-contrast, pure-black, day — same names as the PWA.
- Layer switcher wired to `LayerId` with empty sources.
- **Exit:** a captain can pan the canyon box at 60 fps on a mid-range iPad in night mode. No stores, no scoring.

### Phase 3 — Trip packs on SQLite

Talk to the same Worker the PWA uses.

- `GET /api/packs` → persist manifest.
- Download R2 objects, verify hash, store files, index in SQLite.
- Ready-for-offshore check copied from [DATA_PACKS.md](./DATA_PACKS.md) — same rules, not a friendlier native version.
- Paint ENC-derived raster/vector, SST, GRIB wind/wave, buoys.
- **Exit:** download a Point Judith 72 h pack on Wi-Fi, enable airplane mode, paint SST and waves.

### Phase 4 — Scoring and solunar on device

Only after packs paint.

- Habitat grid from SST + chl + SSH + species windows.
- Temperature breaks and color edges as overlays.
- Solunar clock.
- Go/no-go strip from GRIB × `BoatLimits`.
- **Exit:** fixture cells agree with the PWA within a documented tolerance (grid phase, not pixel-perfect GPU).

### Phase 5 — User data and radio

- Catch log, marks, routes, float plan — same records as the PWA.
- `POST /api/catches` when a path exists; otherwise `synced: false`.
- Community bbox query.
- NMEA gateway client (`VesselState`). Gateway firmware is a separate project.
- **Exit:** log a yellowfin with no network; it syncs at the dock. Heading comes from the gateway when present.

### Phase 6 — Store and policy

- Offline ENC policy: Ahanu is an aid; official ENC still required. Legal copy in the app and on the listing.
- HMS overlay disclaimer.
- Background download of packs on Wi-Fi only by default.
- **Exit:** TestFlight / internal Play track with a real skipper, not a demo script.

---

## What not to do

- Do not start a Flutter project “to see MapLibre” before Phase 0 is actually frozen.
- Do not re-encode species as display strings in Dart (`"Yellowfin tuna"` as an id).
- Do not point the helm at Vercel, a hobby API, or a sidecar Node server. Cloudflare is the data plane.
- Do not run scoring in a cloud function “just for native.” Native is the reason scoring is local.
- Do not claim, in README or store text, that Flutter already exists.

---

## Mapping of subsystems

| Web today | Flutter later |
| --- | --- |
| MapLibre GL JS | MapLibre GL native |
| IndexedDB / Cache | SQLite + documents directory |
| `src/lib/ahanu/*.ts` | `ahanu_domain` Dart and/or WASM |
| Service worker / PWA install | OS install, Wi-Fi-only pack fetch |
| Bearer stub on catch POST | Same header, device-issued JWT |
| Simulated `VesselState` | NMEA gateway when present |

The Worker does not change between clients. That is the point.
