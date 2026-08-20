# Status

Honest inventory. Nothing here is a badge.

## This pass (leftover preview/template cleanup, 2026-08-20)

Product behavior did not grow. Flutter was not started. Worker scoring was not added. AIS stays the demo gateway. No live ENC/GRIB was invented. The used helm UI components were not rewritten.

### Removed

- Unused shadcn/template packages that nothing imported: leftover Radix primitives (accordion through tooltip except slot/slider/switch), plus cmdk, vaul, date-fns, tw-animate-css, react-day-picker, react-hook-form, @hookform/resolvers, react-resizable-panels, @tanstack/react-table.
- src/lib/multiplayer/ — unused app-builder P2P leftover. Nothing imported it.
- Leftover product copy: Intel panel Ask Grok is now Ask the skipper.
- Leftover names: DEFAULT_APP_NAME is Ahanu. Vite plugin ids app-builder:* are ahanu:*.
- Vercel comments that read like a second production path (README, ARCHITECTURE, vite.config, pack middleware).
- cloudflare/wrangler.toml comments: reserved api.ahanu.app route and zero D1 ids now read as TODOs, not live facts.

### Kept (required for Vite/TanStack preview host or the PWA)
- Repo-root boot script stays; the preview host uses it to start the Vite server on 8080.
- PWA plugin and shared install/manifest helpers stay wired in vite config.
- public __grok assets and root-route manifest/icon links stay; they are the PWA chrome.
- preview-host-bridge stays; it noops unless framed by the allowlisted embedder.
- preview thumbnail, browser-smoke, browser-guard, and brand-check stay as preview-host capture/smoke tooling.
- Nitro vercel preset and server middleware stay for the preview build only. Production is AHANU_CF=1.
- Auth popup plugin and auth broker stay for live-preview OAuth.
- Used UI components in src/components/ui stay, with slot, slider, and switch Radix packages.

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
- wrangler.toml still has TODO placeholder D1 ids and a reserved (not live) api.ahanu.app route.

## Constraints that do not move

Workers package bytes. AIS demo only. No helm toast jokes. No invented S-57 or R2 NOAA bytes. Ahanu is an aid to navigation and fishing.

See ARCHITECTURE.md and DATA_PACKS.md.
