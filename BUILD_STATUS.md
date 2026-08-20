# Ahanu build status

## Summary (finish-pack-loop, 2026-08-20)

Branch: finish-pack-loop (working tree only, not committed).

What now works: Point Judith canyon bbox (-72.8, 39.4, -68.8, 41.5) and 72h window; GET /api/packs; GET /api/objects; SHA-256 verify; IndexedDB store; honest client Ready-for-offshore (does not trust Worker boolean); on-device habitat/breaks/go-no-go from packed grids; catch log stays local (synced:false) if POST /api/catches fails or 401.

Still needs production cron/ops: live NOAA/CMEMS ingest and R2 objects do not exist. Cron is commented in cloudflare/wrangler.toml. See docs/DATA_PACKS.md.

Tests: 89 passed, typecheck clean.

### Files changed

New pack modules under src/lib/ahanu, cloudflare ingest fixtures/run, SW, Nitro middleware, pack tests.

Updated worker, pack assembler, wrangler.toml, domain types/constants/ocean/grib/store, Packs/Log/AppShell/ChartMap, vite.config, DATA_PACKS, package.json.

---

## Gap list (investigated 2026-08-20)

Real before: domain types, on-device scoring/go-no-go, worker health/packs/buoys/catches (401), ingest URL stubs, synthetic chart, AIS demo gateway.

Gaps closed: identity hashes, no object GET, fake Ready-for-offshore, no IDB/SW, scoring ignored pack, catch never POSTed, preview had no pack API, no loop tests, layer-id drift.

Still ops: live NOAA/CMEMS cron and real R2 bodies. Do not pretend they exist.

Constraints: no scoring on Worker; AIS demo only; no helm toast jokes; Cloudflare data plane; fixtures not live ENC/GRIB/SST.
