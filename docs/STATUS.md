# Status

Honest inventory. Nothing here is a badge.

## This pass (ERDDAP timeout + retry, 2026-08-20)

Live NOAA ERDDAP grids (SST / chl / SSH / bathy), HMS, and hour-0 GFS now share an 18 s fetch with one retry on timeout / 429 / 5xx (1.5 s backoff). 404 is not retried. Two failures still keep the fixture. 72 h GFS series stays off. Tests mock fetch and sleep. No Worker scoring. No Flutter.

## This pass (preview live overlays, 2026-08-20)

Preview `GET /api/packs?live=1` and matching `/api/objects` already called `buildTripPack({ tryLive })`, but the pack-http test only mocked NDBC so only buoys looked live. Tests now mock SST, ETOPO bathymetry + contours, chlorophyll, SSH, HMS, and hour-0 GFS-Wave and mark those layers `source: "noaa"`. A failed fetch keeps that layer fixture. No live=1 stays fixture. 72 h series stays off. No Worker scoring. No Flutter.

## This pass (NCEI / GEBCO bathymetry probe, 2026-08-20)

`tryLiveNoaa` / `buildTripPack({ tryLive })` probe public no-key CoastWatch/PFEG ERDDAP relief for the Point Judith box. First parseable grid paints pack layer `bathymetry` as `source: "noaa"`. The path that returned a usable canyon grid from this network is **NOAA NCEI ETOPO 2022** 15″ (`ETOPO_2022_v1_15s`) **subsampled to ~0.033° / stride 8** (121×64, depths to ~2867 m, Veatch ~449 m). That is not native 15″ and not official ENC. GEBCO_2020 (same host/stride) and etopo180 (1-minute) stay in the probe list. Cheap 100/200-fm contours are derived from the packed plane when it paints. A 429 / 403 / parse miss keeps the hashed fixture. Bathymetry is required for Ready — the fixture body still counts. Official ENC remains the legal chart. Tests mock fetch; one live probe skips if blocked. No Worker scoring. No Flutter. AIS stays demo.

## This pass (NMFS HMS closed-area probe, 2026-08-20)

`tryLiveNoaa` / `buildTripPack({ tryLive })` probe public no-key NMFS/NOAA HMS closed-area files for the Point Judith box. First parseable FeatureCollection that intersects the box paints pack layer `hms_zones` as `source: "noaa"`. The path that returned a usable polygon from this network is the **Northeastern US pelagic-longline closed area KMZ** (`https://www.fisheries.noaa.gov/s3/2020-04/pelagicll_ne.kmz`, same bytes on S3). That is a commercial PLL rectangle (39–40 N, 68–74 W), not the Canyon Unit monument and not Amendment 15. A15 shapefiles stay in the probe list; they sit south of this canyon box so a miss there is expected. A 429 / 403 / parse / no-intersection miss keeps the hashed fixture. File must exist for Ready (empty geometry still counts). Reminder overlay — not a legal determination. Tests mock fetch; one live probe skips if blocked. No Worker scoring. No Flutter. AIS stays demo.

## This pass (display mode persist, 2026-08-20)

displayMode (night / high-contrast / pure-black / day) is kept on this device; reload restores the last helm and applies data-mode before first paint. First visit stays night-bridge. No Flutter.

## This pass (float plan export, 2026-08-20)

Plan and Safety panels export a dry shore-side float plan from store state (no network): vessel, departure harbor, pack bbox and canyon heads in that box, pack window, souls on board, skipper-entered emergency contacts and radios, Ready / stale-SST caution when that override is on, and the aid-not-official-ENC one-liner. Copy and Download .txt; print-friendly HTML is optional. Empty fields stay empty or “not set”. Contacts are never invented. Formatter tests are offline. No Worker scoring. No Flutter.

## This pass (CoastWatch SSH / SLA probe, 2026-08-20)

`tryLiveNoaa` / `buildTripPack({ tryLive })` probe public no-key ERDDAP SSH / SLA for the Point Judith box. First parseable grid paints pack layer `altimetry` as `source: "noaa"`. The path that returned a usable grid from this network is NOAA CoastWatch blended SLA daily **0.25° / ~25 km** (`noaacwBLENDEDsshDaily`, analysis 2026-08-19). That is not CMEMS L4 and not AVISO DUACS. PFEG `nesdisSSH1day` stays in the probe list (same RADS family; last time here was 2026-03-25). A 429 / 403 / parse miss keeps the hashed fixture. Altimetry does not block Ready-for-offshore. Tests mock fetch; one live probe skips if blocked. No Worker scoring. No Flutter. AIS stays demo.

## This pass (CoastWatch chlorophyll probe, 2026-08-20)

`tryLiveNoaa` / `buildTripPack({ tryLive })` probe public no-key ERDDAP chlorophyll for the Point Judith box. First parseable grid paints pack layer `chlorophyll` as `source: "noaa"`. The path that returned a usable grid from this network is NOAA CoastWatch S-NPP VIIRS NRT L3 daily **4 km / 0.0375°** (`noaacwNPPVIIRSchlaDaily`). That is not 1 km VIIRS and not CMEMS L4. NOAA-20 daily and S-NPP weekly SQ stay in the probe list; PFEG `erdVHNchla8day` is North Pacific only and does not cover this box. A 429 / 403 / parse miss keeps the hashed fixture. Chlorophyll does not block Ready-for-offshore. Tests mock fetch; one live probe skips if blocked. No Worker scoring. No Flutter. AIS stays demo.

## This pass (stale SST skipper override, 2026-08-20)

Live CoralTemp can sit near 48 h, so Ready-for-offshore was failing SST even when the layer file was present and hash-ok. Helm **Accept stale SST** (`sstStaleOverride`, default off, persisted) lets `evaluateReadyForOffshore` pass that case with a visible warning. The SST row stays stale (`fresh` stays false). Missing SST (no body) and hash mismatch still fail. Header and Packs Ready badges switch to caution when override is what made the pack Ready. Worker `readyForOffshore` still does not auto-pass. No Worker scoring. No Flutter.

## This pass (CoastWatch SST probe, 2026-08-20)

`tryLiveNoaa` / `buildTripPack({ tryLive })` probe public no-key ERDDAP SST for the Point Judith box. First parseable grid paints pack layer `sst` as `source: "noaa"`. The path that returned bytes from this network is NOAA CoastWatch CoralTemp daily **5 km / 0.05°** (`noaacrwsstDaily`). That is not 1 km MUR. MUR (PFEG) and GOES-16 stay in the probe list; a 429 / 403 / parse miss keeps the hashed fixture and does not invent GHRSST. SST `updatedAt` is the analysis time so Ready-for-offshore 24 h / 48 h age rules still apply. A daily composite is used for the whole window (not hour-0-only). Tests mock fetch; one live probe skips if blocked. No Worker scoring. No Flutter. AIS stays demo.

## This pass (service-worker pack cache, 2026-08-20)

`public/sw-ahanu.js` now actually caches same-origin GET `/api/packs` and GET `/api/objects` so a dock download survives reload and airplane mode. Fixture responses are cache-first after the first success (deterministic hashed bodies, `Cache-Control: max-age=86400`). `?live=1` is network-first with a 30 s freshness stamp only — live NOAA is not treated as fresh forever, and a failed or offline fetch may serve the last successful live response as fallback. IndexedDB remains the source of truth for a pack already written (`restorePackedSession` on helm boot); the worker is the HTTP fallback when those same-origin URLs are fetched again. No Worker scoring. No Flutter.

## This pass (paced GFS-Wave 72 h series, off by default, 2026-08-20)

`fetchGfsWaveSeries` / `assembleGfsWaveSeries` pull NOMADS atlocn.0p16 f000 through f072.
About 25 files, 10 s apart. Stacks wind/wave PackedGrids. Off unless enabled.
Hour-0 live paint is unchanged and does not start the series.

Enable: buildTripPack({ tryLive: true, gfsWaveSeries: true }) or { enabled: true, hours, paceMs }.
Also tryLiveNoaa({ gfsWaveSeries: { enabled: true } }).
Env AHANU_GFS_WAVE_SERIES=1 or GFS_WAVE_SERIES=1 is read only by ingestFixturePack (cron), not GET /api/packs.

Complete series can set source noaa and hours 72.
A failed step keeps hoursCovered as the prefix from hour 0.
Partial series is never marked as a full 72-hour grid. Tests use mocked fetch. Cron stays commented until R2 exists. No Flutter. No Worker scoring.

## This pass (hour-0 NCEP wind/wave paint, 2026-08-20)

Worker `buildTripPack({ tryLive })` and preview `GET /api/packs?live=1` now fetch public NOAA bytes when the network allows. Preview without `live=1` stays deterministic fixtures. Packs panel **Live NOAA** (default off) requests that flag; layer rows show fixture vs noaa from the manifest. Flutter was not started. Worker scoring was not added. AIS stays the demo gateway. Humor stayed out of helm toasts.

### Now live (no keys; fetch failure keeps the hashed fixture)

- NDBC `latest_obs` → pack `buoys`, `source: "noaa"`.
- CO-OPS predictions (hourly + hi/lo) plus latest `water_level` for departure harbors in/near the box (Newport, Quonset, Montauk, plus Woods Hole / New London when they sit in the bbox).
- NOAA ENC **product catalog** (`ENCProdCat.xml`) clipped to the trip box → pack `enc` as a cell list with zip URLs/sizes. Optional hash of one small harbor zip when it is under 80 KB. **Not official S-57.** Helm does not paint a legal chart.
- ENC Direct tile **template URL** plus ENC Online MapServer metadata. `tileservice.charts.noaa.gov` TLS failed from this host on 2026-08-20; recorded as probe, not as a chart.
- GFS-Wave NOMADS `filter_gfswave.pl` Atlantic `atlocn.0p16` **f000** subset for the Point Judith box (~3 KB). When those bytes parse (simple-packed lat/lon, confirmed on the live 3014 B file: WIND, WDIR, HTSGW, PERPW, DIRPW), hour-0 wind (kt) and wave (ft) replace the fixture planes and the layer source is `noaa`. Hours covered is **1**. A 1 h live field does **not** stamp 72 h weather ready. Parse or network failure keeps the 72 h fixture and does not mark the layer live. A paced 72 h / 3 h series helper exists and is **off by default** (NOMADS ~10 s between files; do not run in CI).
- CoastWatch ERDDAP SST (CoralTemp daily 5 km) for the Point Judith box when that URL returns CSV. Layer `sst` is `source: "noaa"` only then. Resolution is 5 km / 0.05° — not 1 km MUR. Analysis time drives SST age. Fetch/parse miss keeps the fixture.
- CoastWatch ERDDAP chlorophyll (S-NPP VIIRS NRT L3 daily 4 km) for the Point Judith box when that URL returns CSV. Layer `chlorophyll` is `source: "noaa"` only then. Resolution is 4 km / 0.0375° — not 1 km VIIRS, not CMEMS L4. Fetch/parse miss keeps the fixture. Chlorophyll does not block Ready.
- CoastWatch ERDDAP SSH / SLA (blended daily 0.25°) for the Point Judith box when that URL returns CSV. Layer `altimetry` is `source: "noaa"` only then. Resolution is 0.25° / ~25 km — not CMEMS L4, not AVISO DUACS. Values stored in cm. Fetch/parse miss keeps the fixture. Altimetry does not block Ready.
- NMFS/NOAA HMS closed-area KMZ (Northeastern US pelagic longline closed area) for the Point Judith box when that URL returns a parseable polygon that intersects the box. Layer `hms_zones` is `source: "noaa"` only then. Reminder overlay — not a legal determination. Amendment 15 shapefiles stay in the probe list (south of this box). Fetch/parse/no-intersection miss keeps the fixture. The HMS file must exist for Ready even if empty.
- CoastWatch PFEG ERDDAP bathymetry (NCEI ETOPO 2022 15″, stride 8 → ~0.033°) for the Point Judith box when that URL returns CSV. Layer `bathymetry` is `source: "noaa"` only then. Resolution is ~0.033° — not native 15″, not official ENC. Cheap 100/200-fm contours replace the fixture when the grid paints. Fetch/parse miss keeps the fixture. Bathymetry is required for Ready (fixture still counts).

### Still fixture / not done

- SST is fixture unless the CoastWatch ERDDAP probe parsed a grid (CoralTemp 5 km, not 1 km MUR). Chlorophyll is fixture unless the CoastWatch ERDDAP probe parsed a grid (S-NPP VIIRS L3 daily 4 km, not 1 km VIIRS / CMEMS). Altimetry is fixture unless the CoastWatch ERDDAP probe parsed a grid (blended SLA daily 0.25°, not CMEMS / AVISO). Bathymetry is fixture unless the CoastWatch PFEG ERDDAP probe parsed a relief grid (NCEI ETOPO 2022 15″ subsampled to ~0.033° here — not native 15″, not official ENC). Contours follow that grid when it paints; otherwise they stay fixture. Canyons stay fixture. HMS is fixture unless the NMFS/NOAA closed-area probe parsed a polygon that intersects the box (NE PLL KMZ here — reminder only, not a legal determination).
- 72 h wind and wave **grids** unless the paced series is explicitly enabled and every f000-f072 step decodes (hour 0 may be live; hours 3-72 stay fixture or empty otherwise. NDFD not fetched. Full series is not downloaded in CI).
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
