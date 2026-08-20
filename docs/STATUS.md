# Status

Honest inventory. Nothing here is a badge.

## This pass (hour-0 NCEP wind/wave paint, 2026-08-20)

Worker `buildTripPack({ tryLive })` and preview `GET /api/packs?live=1` now fetch public NOAA bytes when the network allows. Preview without `live=1` stays deterministic fixtures. Packs panel **Live NOAA** (default off) requests that flag; layer rows show fixture vs noaa from the manifest. Flutter was not started. Worker scoring was not added. AIS stays the demo gateway. Humor stayed out of helm toasts.

### Now live (no keys; fetch failure keeps the hashed fixture)

- NDBC `latest_obs` → pack `buoys`, `source: "noaa"`.
- CO-OPS predictions (hourly + hi/lo) plus latest `water_level` for departure harbors in/near the box (Newport, Quonset, Montauk, plus Woods Hole / New London when they sit in the bbox).
- NOAA ENC **product catalog** (`ENCProdCat.xml`) clipped to the trip box → pack `enc` as a cell list with zip URLs/sizes. Optional hash of one small harbor zip when it is under 80 KB. **Not official S-57.** Helm does not paint a legal chart.
- ENC Direct tile **template URL** plus ENC Online MapServer metadata. `tileservice.charts.noaa.gov` TLS failed from this host on 2026-08-20; recorded as probe, not as a chart.
- GFS-Wave NOMADS `filter_gfswave.pl` Atlantic `atlocn.0p16` **f000** subset for the Point Judith box (~3 KB). When those bytes parse (simple-packed lat/lon, confirmed on the live 3014 B file: WIND, WDIR, HTSGW, PERPW, DIRPW), hour-0 wind (kt) and wave (ft) replace the fixture planes and the layer source is `noaa`. Hours covered is **1**. A 1 h live field does **not** stamp 72 h weather ready. Parse or network failure keeps the 72 h fixture and does not mark the layer live. A paced 72 h / 3 h series helper exists and is **off by default** (NOMADS ~10 s between files; do not run in CI).

### Still fixture / not done

- SST / chlorophyll / altimetry / bathymetry / contours / canyons / HMS grids and vectors.
- 72 h wind and wave **grids** (hour 0 may be live; hours 3–72 stay fixture or empty. NDFD not fetched. Full series not downloaded).
- Official S-57 cell zips are not stored in the repo or claimed as the legal chart. Full-box zip set is tens of MB; catalog excerpt only.
- GHRSST / CMEMS (keys / licence). Production R2 objects.
- Preview `/api/packs` without `live=1`.
- AIS demo gateway. Flutter helm. Commented-out cron until R2 `ahanu-trip-packs` and D1 `ahanu-core` exist. wrangler.toml TODO D1 ids and reserved `api.ahanu.app`.

## What works now (finish-pack-loop)

- Point Judith canyon bbox and 72 h window.
- GET `/api/packs` and GET `/api/objects`. SHA-256 of the object body. IndexedDB store.
- Ready-for-offshore is evaluated on the device after download and hash verify. Worker `readyForOffshore` is a hint. Failed live ingest does not stamp ready — that layer stays the fixture or missing.
- Helm paints packed SST / chl / SSH / wind / wave / bathymetry / contours / canyons / HMS / buoys / tides when those bodies exist. Missing stays missing.
- Packed paint does not fall back to local seed models. Tides prefer a packed series.
- Layer switcher reports packed / fixture / missing / synthetic / derived / local.
- Public NOAA ingest path above. Worker always `tryLive`. Preview needs `live=1`.
- Catch log stays local if POST `/api/catches` fails.
- Habitat score and go/no-go run on-device against packed grids. The Worker does not score.

## Constraints that do not move

Workers package bytes. AIS demo only. No helm toast jokes. No invented S-57 or R2 NOAA bytes. Ahanu is an aid to navigation and fishing.

See ARCHITECTURE.md and DATA_PACKS.md.
