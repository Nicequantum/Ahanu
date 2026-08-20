# Ahanu build status

## Summary (finish-pack-loop, helm packed layers, 2026-08-20)

Branch: finish-pack-loop (working tree only, not committed).

What now works: Point Judith canyon bbox (-72.8, 39.4, -68.8, 41.5) and 72h window; GET /api/packs; GET /api/objects; SHA-256 verify; IndexedDB store; honest client Ready-for-offshore (does not trust Worker boolean); on-device habitat/breaks/go-no-go from packed grids; catch log stays local (synced:false) if POST /api/catches fails or 401.

Helm paint: after a pack is downloaded (or restored from IDB), SST / chlorophyll / SSH / wind / wave draw from packed grids on the MapLibre chart, clipped to the pack bbox. Missing pack layers stay missing — the plotter does not invent ENC or GRIB bytes. With no pack, those layers still use the synthetic demo field and say so. Layer switcher (LayerId) shows packed / fixture / missing / synthetic / derived / local.

Still needs production cron/ops: live NOAA/CMEMS ingest and R2 objects do not exist. Cron is commented in cloudflare/wrangler.toml. Today's packs are hashed fixtures; the helm labels them **fixture**, not live SST/GRIB. See docs/DATA_PACKS.md.

Tests: 101 passed, typecheck clean (Node 22).

### Files changed this pass

- `src/lib/ahanu/packed-fields.ts` — source (fixture|r2), bbox helpers, packedGridFeatures
- `src/lib/ahanu/layer-status.ts` — honest LayerId provenance
- `src/lib/ahanu/rasters.ts` — fieldImage / buildPackedRaster over pack bbox
- `src/lib/ahanu/grib.ts` — packed wind and wave applied independently
- `src/lib/ahanu/wind-field.ts` — barbs/waves from packed cells; empty if missing
- `src/lib/ahanu/pack-client.ts` — pass manifest source into packed ocean
- `src/components/chartplotter/ChartMap.tsx` — paint packed rasters + derived breaks
- `src/components/panels/LayersPanel.tsx` — status badges
- `tests/layer-paint.test.ts`

---

## Gap list (investigated 2026-08-20)

Real before: domain types, on-device scoring/go-no-go, worker health/packs/buoys/catches (401), ingest URL stubs, synthetic chart, AIS demo gateway.

Gaps closed: identity hashes, no object GET, fake Ready-for-offshore, no IDB/SW, scoring ignored pack, catch never POSTed, preview had no pack API, no loop tests, layer-id drift, helm always painted synthetic ocean.

Still fake / not done:

- Live NOAA ENC / GFS-Wave / NDFD / GHRSST / CMEMS / CO-OPS / NDBC ingest and R2 bodies. `/api/packs` serves hashed fixtures.
- ENC is a fixture cell list, not S-57. The helm does not paint ENC.
- Bathymetry, contours, canyons, HMS, buoys on the chart are still the local models / seed data, not packed GeoJSON.
- AIS is the demo gateway.
- Habitat / breaks / edges are derived on-device (correct) from packed or synthetic fields.
- No Worker scoring. No Flutter.

Constraints: no scoring on Worker; AIS demo only; no helm toast jokes; Cloudflare data plane; fixtures not live ENC/GRIB/SST.
