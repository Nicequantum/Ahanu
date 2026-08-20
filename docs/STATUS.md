# Status

Honest inventory. Nothing here is a badge.

## This pass (repo quality, 2026-08-20)

Files added or rewritten this pass are listed first. Product behavior did not grow.

- README.md: how to run, test, deploy:cf; fixture vs live; safety.
- docs/STATUS.md: this file. Root BUILD_STATUS.md removed.
- LICENSE (MIT), CONTRIBUTING.md, .editorconfig, .prettierignore, .nvmrc.
- .gitignore: local Node toolchains, .pr-body.md, env files, Cloudflare local state.
- package.json: name ahanu, engines.node >= 22, format:check script.
- eslint.config.mjs: drop app-builder-template comment; ignore generated output.
- Automated checks: Node 22 test and typecheck on push and PR.

Flutter was not started. Worker scoring was not added. AIS stays the demo gateway.

## What works now (finish-pack-loop)

- Point Judith canyon bbox and 72 h window.
- GET /api/packs and GET /api/objects. SHA-256 of the object body. IndexedDB store.
- Ready-for-offshore is evaluated on the device after download and hash verify. Worker readyForOffshore is a hint.
- Helm paints packed SST / chl / SSH / wind / wave / bathymetry / contours / canyons / HMS / buoys / tides when those bodies exist. Missing stays missing.
- Packed paint does not fall back to local seed models. Tides prefer a packed series.
- Layer switcher reports packed / fixture / missing / synthetic / derived / local.
- Public NOAA ingest (no keys): NDBC latest_obs and CO-OPS datagetter write fixture-shaped buoy / tide objects. Fetch failure degrades to fixtures.
- ENC in the pack is a hashed fixture cell list, not official S-57. The helm does not paint a legal chart.
- Catch log stays local if POST /api/catches fails.
- Habitat score and go/no-go run on-device against packed grids. The Worker does not score.

## Still fixture / not done

- Live ENC / GFS-Wave / NDFD / GHRSST / CMEMS and production R2 objects do not exist here.
- SST / wind / wave / bathy grids remain hashed fixtures.
- Preview GET /api/packs stays deterministic fixtures.
- Live NDBC / CO-OPS is Worker ingest plus GET /api/buoys plus buildTripPack({ tryLive }).
- AIS is the demo gateway (src/lib/data/ais.ts).
- Flutter helm is not started. flutter/ is a Dart domain stub only.
- Cloudflare ahanu-packs cron is commented out until R2 ahanu-trip-packs and D1 ahanu-core exist.
- wrangler.toml still has placeholder D1 ids and a reserved api.ahanu.app route.

## Constraints that do not move

Workers package bytes. AIS demo only. No helm toast jokes. No invented S-57 or R2 NOAA bytes. Ahanu is an aid to navigation and fishing.

See ARCHITECTURE.md and DATA_PACKS.md.
