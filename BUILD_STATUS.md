# Ahanu build status

## Summary (finish-pack-loop, remaining chart layers + NOAA ingest, 2026-08-20)

Branch: finish-pack-loop (working tree only, not committed).
What now works: Point Judith canyon bbox and 72h window; GET /api/packs; GET /api/objects; SHA-256 verify; IndexedDB; honest client Ready-for-offshore; on-device habitat from packed grids; catch log stays local if POST fails.

Helm paint: packed bodies drive SST/chl/SSH/wind/wave and bathymetry/contours/canyons/HMS/buoys after download. Missing stays missing. No pack uses local/seed models. Tides prefer packed series. Layer switcher shows packed/fixture/missing/synthetic/derived/local.

Public NOAA ingest (no secrets): NDBC latest_obs and CO-OPS datagetter write fixture-shaped buoy/tide objects. Fetch failure degrades to fixtures. ENC is a hashed fixture cell list, not official S-57.


Still needs production cron/ops: live ENC / GFS-Wave / NDFD / GHRSST / CMEMS and R2 objects do not exist. SST/wind/wave/bathy grids remain fixtures.
Tests: 114 passed, typecheck clean (Node 22).

### Files changed this pass

- src/lib/ahanu/packed-fields.ts — parse canyons/contours/HMS/buoys/tides/ENC; PackFieldSource includes noaa
- src/lib/ahanu/packed-chart.ts — prefer packed vectors; missing stays empty; ENC aid disclaimer
- src/lib/ahanu/noaa-live.ts — public NDBC latest_obs + CO-OPS; never throws
- src/lib/ahanu/pack.ts — overlays + buildTripPack({ tryLive })
- src/lib/ahanu/layer-status.ts rasters.ts bathymetry.ts tides.ts — packed when present
- ChartMap LayersPanel PacksPanel WeatherPanel — paint packed chart layers; ENC cell list
- cloudflare Worker + ingest/run.ts — trip pack may overlay live NOAA; GET /api/buoys tries NDBC
- tests/layer-paint.test.ts tests/noaa-live.test.ts tests/tides.test.ts docs/DATA_PACKS.md

---

## Gap list (investigated 2026-08-20)

Gaps closed this pass: remaining Ready-for-offshore chart layers (bathy/contours/canyons/HMS/buoys/tides/ENC cell list) join the pack loop; helm prefers packed; missing stays missing; public NDBC/CO-OPS ingest writes fixture-shaped objects and degrades when blocked.

Still fake / not done:
- Live ENC / GFS-Wave / NDFD / GHRSST / CMEMS and R2 production objects. SST/wind/wave/bathy grids remain hashed fixtures.
- ENC is a fixture cell list, not S-57. Helm does not paint a legal chart.
- Preview GET /api/packs stays deterministic fixtures. Live NDBC/CO-OPS is Worker ingest + GET /api/buoys + buildTripPack({ tryLive }).
- AIS is the demo gateway.
- No Worker scoring. No Flutter.

Constraints: Workers package bytes only; AIS demo only; no helm toast jokes; no invented S-57 or R2 NOAA bytes.
