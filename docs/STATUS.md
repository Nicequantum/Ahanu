# Status

Honest inventory. Nothing here is a badge.

## This pass (leftover API auth holes, 2026-08-21)

ahanu-packs HTTP inventory: public by design are OPTIONS, GET `/` `/health`, GET `/api/packs`, GET `/api/objects`, GET `/api/sources`, GET `/api/buoys`. Gated: POST `/api/ingest` (INGEST_TOKEN fail-closed), POST `/api/catches` (skipper device bearer — any non-empty; do not require ingest secret). Closed this pass: `/api/community` GET/POST is 404 (unused; helm paints `src/lib/data/community.ts`). GET `/api/catches` is 404 (no list of other devices). PWA Worker: `/` `/login` public; `/api/auth/*` Better Auth. CF without `BETTER_AUTH_SECRET` now fails closed (no hardcoded preview string). `askSkipper` requires a session before spending `XAI_API_KEY`. Helm download and catch-sync unchanged. No INGEST_TOKEN in VITE_. No Worker scoring. No Flutter.

## This pass (deeper S-57 extract, 2026-08-21)

Client extract now reconstructs connected-node / edge geometry from packed official `.000` bytes (VRPT is 9-byte NAME+ORNT+USAG+TOPI+MASK). Harbor cell **US5PVDCB** (Point Judith Harbor, 417929-byte ISO 8211 `.000`, charts.noaa.gov 2026-08-21): COALNE 141, DEPARE 30, DEPCNT 31, SLCONS 407, LNDARE 15, OBSTRN 5, SOUNDG 2 (204 SG3D points), BOYSAW 16. **Absent from US5PVDCB:** LIGHTS, WRECKS, UWTROC — not painted from that file. Neighbor **US5PVDBB** (905695-byte `.000`): COALNE 135, DEPARE 147, DEPCNT 151, SLCONS 532, LNDARE 48, OBSTRN 67, WRECKS 7, LIGHTS 10, SOUNDG 11, BCNLAT 4. Paint is real SG2D/SG3D + connected-node coordinates only. Caps: harbor usage-5 no line/area cap, soundings 400/cell; approach usage-4 soundings 120 / contours 200 / depth areas 80; coastal usage-3 soundings 40 / contours 80 / depth areas 40 / coastline+shore 200. Prefer harbor fidelity. ECDIS disclaimer kept. New paint labeled S-57 extract. Packing unchanged — PWA only. No Worker scoring. No Flutter.

## This pass (custom hostnames on ahanu.dev, 2026-08-21)

Zone `ahanu.dev` (569d9e656eb67216396642b55e340017) is active on this account. Apex was already a Workers custom domain for PWA `ahanu` (200 HTML). No MX. `www` and `api` were NXDOMAIN. Did not steal apex. Attached `ahanu.dev` + `www.ahanu.dev` to `ahanu` and `api.ahanu.dev` to `ahanu-packs` via wrangler `custom_domain = true` (Cloudflare creates the proxied DNS). `ahanu.app` / `api.ahanu.app` stay unattached — that zone is not here. CF/prod helm `VITE_AHANU_PACKS_URL` defaults to `https://api.ahanu.dev`; SW allowlists that origin and keeps workers.dev as fallback. Ingest stay fail-closed. GFS 72 h, SST honesty, AIS demo, S-57 unchanged. No Worker scoring. No Flutter.

## This pass (production secrets + ingest lock, 2026-08-21)

PWA Worker `ahanu` had no secrets; Better Auth fell through to a hardcoded CF preview string. `BETTER_AUTH_SECRET` is now a Worker secret (value not in git). Packs Worker `ahanu-packs` had no secrets; HTTP `POST /api/ingest` accepted any non-empty Bearer. Ingest now fail-closes: missing/empty `INGEST_TOKEN` is 401, mismatch is 401, cron stays in-process (`scheduled` → `ingestFixturePack`) and does not HTTP. `POST /api/catches` still uses the skipper's device token only — ingest secret is not required and is not in `VITE_` public env. Zone `ahanu.app` is not on this account (owned zones: `ahanu.dev`, `clarityautoapex.com`); `api.ahanu.app` stays unattached, workers.dev only. No S-57 renderer change. No Worker scoring. No Flutter.

## This pass (official S-57 clip, 2026-08-21)

NOAA OCS serves public no-key S-57 exchange-set zips at `https://charts.noaa.gov/ENCs/{CELL}.zip` (HTTP 200, `application/zip`, PK magic, `ENC_ROOT/{CELL}/{CELL}.000` leader `015823LE1`). ENCProdCat.xml 200 / 10.5 MB, `dt_valid` 2026-08-20T04:59:10Z. Point Judith canyon box: 237 active usage 3–5 cells, catalog zip sum 20.7 MB (155 under 80 KB). District/state guesses `01.zip` / `RI.zip` 404. AWS `noaa-enc-pds` 404. ENC Online MapServer HEAD 200 (JSON metadata, not S-57). ENC Direct tiles TLS fail from this host. Full 237-cell set is too many Worker subrequests for one pack GET.

Live ENC now fetches a dock-to-offshore subset (containing harbor cell + nearby Harbor-named neighbor at PJ/Montauk/Newport, then usage-3 coastal that cover those harbors or Veatch/Atlantis/Hydrographer; ≤8 cells, ≤400 KB catalog size each, ≤1.8 MB). Catalog ranking on 2026-08-20: US5PVDBB, US5PVDCB, US5NY2GL, US5PVDDD, US3NY01M, US3RI1AA, US3MA1AD, US3MA1AC (~1.25 MB zip). A zip packs only when it unzips and the `.000` is ISO 8211. Those bytes go in the `enc` JSON (`s57.files[].zipBase64`, leader, `.000` size, cell ids, `source: "noaa"`, `official: true`) and write through R2. Catalog-only stays `official: false` / `noaa-enc-catalog` when a zip misses or is not S-57. Helm says **ENC official S-57 · NOAA** with those cell ids when packed; otherwise the catalog aid line. Ahanu is not an ECDIS. Did not invent cells. GFS 72 h, SST stride-2, AIS demo unchanged. No Worker scoring. No Flutter.

## This pass (AIS still demo, 2026-08-21)

No public no-key live AIS feed served the Point Judith canyon box. MarineCadastre / PMEL ERDDAP are historical (2025 nationwide daily CSVs; AIS2024 last on PMEL; no AIS2025/2026 live table). AISHub needs a contributor receiver. aisstream.io needs a signup key. USCG NAIS is request-only. Did not invent tracks or scrape a ToS-hostile site. Helm now says **AIS demo — not live traffic** (layer label + Packs + Layers footnote). Layer paint is synthetic with no pack and missing once a pack is loaded — AIS is not a pack layer and does not fake Ready. Worker unchanged. No Worker scoring. No Flutter.

## This pass (honest SST spacing + helm age, 2026-08-21)

No public ERDDAP SST for the Point Judith box was <=24 h tonight. Live last cells (~2026-08-21T01:10Z): PFEG `jplMURSST41` 2026-08-19T09:00Z (~40 h); CoastWatch GeoPolar `noaacwBLENDEDsstDNDaily` 2026-08-19T12:00Z (~37 h); CoralTemp 2026-08-18T12:00Z (~61 h); GOES-16 id still 404. Do not fake freshness — Ready still needs Accept stale SST when age is 24–48 h. MUR stride dropped 5 → 2 (~0.02°, ~869 KB PJ CSV, under 2 MB). That is not native 1 km. GeoPolar 5 km is the next in-window fallback. Helm `sstHelmLine` shows source, age hours, stale band, analysis time, and the real spacing note. Packs no longer says CoralTemp 5 km as the live SST. No Worker scoring. No Flutter.

## This pass (live 72 h GFS-Wave series, 2026-08-21)

Worker GET /api/packs and cron now fetch NOMADS atlocn.0p16 f000–f072 / 3 h (pace 0, 25 s budget). NOAA served those hours here (~3 KB, ~300 ms each; 25 sequential ~8 s). The old 10 s pace was politeness, not a NOAA or Worker hard limit. HTTP has no wall-clock cap if the client stays connected; CPU default 30 s; paid subrequests 10k; simultaneous connections 6 — series stays sequential so other overlays keep slots. A complete series stamps 72 h noaa. A short prefix paints those hours and keeps a fixture tail; liveErrors name the hours. Ready still does not fail on a live hour-0 / fixture tail. Helm gfsHelmLine shows the real note and does not claim 72 h live unless it is. Preview stays series-off unless ?gfsSeries=1. Set GFS_WAVE_SERIES=0 to force hour-0 only. No ENC/S-57 invented. No Worker scoring. No Flutter.

## This pass (persist Accept stale SST + hashed verify, 2026-08-20)

`sstStaleOverride` now uses a dedicated localStorage key (`ahanu-sst-stale-override`) the same way night-bridge and tide harbor do — written on Accept, read at store init and again after persist rehydrate, then passed into `restorePackedSession`. A 24–48 h SST pack stays Ready · stale SST after reload only if the skipper already accepted. The switch is not auto-flipped. Hashed numerator stays SHA-256 verify: stale SST and hour-0 GFS cover < 72 h count when hash-ok and are marked stale separately. A real hash miss stays N/12 and Packs names the layer id. Live cached PJ pack (2026-08-21): all 12 NOAA objects SHA-256 match the manifest. Helm 11/12 after a skipCache live download is kept honest — Packs now names the unverified id rather than inventing 12/12. Likely optional `buoys` (NDBC snapshot can change between manifest build and object GET). Stale SST and hour-0 GFS cover < 72 h are not that miss. No ENC/S-57 invented. No Worker scoring. No Flutter.

## This pass (offline pack chip + hashed count, 2026-08-20)

`restorePackedSession` now rebuilds `packLayers` + on-device Ready from IndexedDB (`ahanu-packs` meta.current + objects). Helm hydrate runs persist first, then IDB, so the compact chip matches the stored pack after offline reload and does not invent a pack when IDB is empty. Hashed numerator is SHA-256 verify (`verified` / hashOk), not Ready freshness — stale SST still counts as hashed and is marked stale separately. A real hash miss stays 11/12. No ENC/S-57 invented. No Worker scoring. No Flutter.

## This pass (SW caches CF packs origin, 2026-08-20)

`public/sw-ahanu.js` now allowlists pack GETs from the helm origin (local Vite) and `https://ahanu-packs.hombre3536.workers.dev` — the live `VITE_AHANU_PACKS_URL`. Paths stay `/api/packs`, `/api/objects`, `/api/objects/*`. Arbitrary cross-origin is not cached. Cross-origin fetch is CORS, not no-cors; a CORS failure does not invent a cached body. Helm also postMessages the packs origin on SW register. Fixture cache-first / `?live=1` network-first unchanged. Cache name remains `ahanu-packs-v2`. A real airplane-mode browser pass still needs a later sea trial. No ENC/S-57 invented. No Worker scoring. No Flutter.

## This pass (prefer in-window public SST, 2026-08-20)

`fetchLiveSst` still uses ERDDAP `last`. CoralTemp `noaacrwsstDaily` last cell here is 2026-08-18T12:00:00Z (~60 h). PFEG `jplMURSST41` last cell is 2026-08-19T09:00:00Z (~39 h), inside the 48 h Ready window. Probe order now tries MUR first. A parseable grid older than 48 h is skipped when a later public grid is in-window; timestamps stay honest. MUR was subsampled stride 5 to ~0.05° on that pass — later dropped to stride 2. GOES-16 dataset id 404s here. Helm **Accept stale SST** remains the path if every public grid is older than 48 h. No Worker scoring. No Flutter.

## This pass (helm to live Worker, 2026-08-20)

cloudflare deploy is wrangler deploy --config wrangler.toml so Wrangler 4 does not find-up parent wrangler.jsonc and run the PWA Vite build.
Helm VITE_AHANU_PACKS_URL already existed; CF/prod PWA builds now default it to the live ahanu-packs workers.dev URL. Local Vite stays same-origin. api.ahanu.app is not provisioned. No NOAA bytes invented. No Worker scoring. No Flutter.

## This pass (R2 + D1 live, cron on, workers.dev only, 2026-08-20)

R2 bucket `ahanu-trip-packs` and D1 `ahanu-core` (`ed2706b8-7537-400f-88f6-933ac03120dc`) exist in ENAM. wrangler.toml now uses that D1 id (preview same until a separate preview DB exists), turns on the ingest cron (`15 2,8,14,20 * * *`), and keeps `[[routes]]` for `api.ahanu.app` commented — zone is not provisioned, so deploy stays `*.workers.dev`. GFS-Wave 72 h series stays off. Worker `buildManifest` / `layerBody` live timeout is 18 s (`NOAA_GRID_TIMEOUT_MS`) so NOAA overlays can land. R2 does not yet hold live ENC/GRIB/SST. Existing Worker `ahanu` (PWA) was not touched. No wrangler deploy (no CLI auth). No Worker scoring. No Flutter.

## This pass (SW sea-trial offline fallback, 2026-08-20)

`public/sw-ahanu.js` already caches same-origin GET `/api/packs` and GET `/api/objects` (fixture cache-first; `?live=1` network-first). Sea-trial tests now prove a successful fixture pack GET is served from that cache after the network is gone, and a later `?live=1` fetch may return the last success as a stale fallback (the 30 s stamp is not forever). `skipCache` stays network-first even when that stamp is fresh; a non-ok live response does not overwrite the last success. No NOAA bytes invented. No Worker scoring. No Flutter.

## This pass (SSR pack cache bust, 2026-08-20)

Vite `ssrLoadModule` kept a stale pack.ts after disk edits; changing `pack*.ts` / `noaa-*.ts` now hard-invalidates that SSR graph so the next GET /api/packs loads `builder.rev` from disk without a process restart. No Worker scoring. No Flutter.

## This pass (live canyon-head paint, 2026-08-20)

Plotter already paints packed NOAA named heads (Veatch / Atlantis / Hydrographer, kind:head) plus labels from `canyonsForChart` / `canyonHeadsForLabels`; fixture axes still paint when present; missing or empty live heads invent nothing. Helm marks the layer packed via `canyonsSource`. No Worker scoring. No Flutter.

## This pass (stale SST Ready cue, 2026-08-20)

Live SST composites can sit near 36 h, so Ready-for-offshore fails on age even when the layer is present and hash-ok. Packs already has **Accept stale SST** (`sstStaleOverride`, default off). When that age check is the only Ready failure (optional-layer warnings allowed), the switch row uses caution tone and one line: `SST is 36 h old — Accept stale SST to pass Ready`. The switch is not flipped and Ready is not auto-passed. Missing SST, hash mismatch, and weather-hour failures keep today's copy. No Worker scoring. No Flutter.

## This pass (tide harbor persist, 2026-08-20)

Safety / HUD harbor pick (Newport / Quonset / Montauk) is kept on this device (`ahanu-tide-harbor`); reload restores it if that station is still packed, else Newport. Missing pack does not invent water levels. No Worker scoring. No Flutter.

## This pass (canyon-head clip vs default box, 2026-08-20)

Did not widen `POINT_JUDITH_CANYON_BBOX` / default pack bbox (`west -72.8, south 39.4, east -68.8, north 41.5`). MarineCadastre Undersea Feature Place Names (same MapServer, 2026-08-20) puts the skipper landmarks **inside** that product box: Veatch (−69.60, 39.87), Atlantis (−70.20, 39.87), Hydrographer (−69.05, 40.20), Alvin (−70.50, 39.87). Hudson (−72.20, 39.45) also clips in. A tighter live pack query (`west=-72.2 south=39.6 east=-70.8 north=41.5`) is not the default — its east edge sits 0.3–1.75° west of those four heads, so live paint there is McMaster / Ryan / Block / Uchupi only. Fixture labels Veatch / Atlantis / Hydrographer are east of that tighter clip, not east of the product box. NOAA coordinates were not moved; no axes invented.

## This pass (MarineCadastre canyon heads, 2026-08-20)

`tryLiveNoaa` / `buildTripPack({ tryLive })` probe public no-key NOAA OCM / MarineCadastre undersea feature place names for the Point Judith box. First parseable FeatureCollection of named canyon heads that intersects the box paints pack layer `canyons` as `source: "noaa"`. The path that returned named heads from this network is **MarineCadastre Undersea Feature Place Names** (`https://coast.noaa.gov/arcgis/rest/services/MarineCadastre/UnderseaFeaturePlaceNames/MapServer/0/query`, GeoJSON). Heads in this box include Veatch, Atlantis, Hydrographer, Block, Alvin, and Hudson (GNS / ACUF names hosted by NOAA OCM). That is **heads only** — no axes, and none were invented. GEBCO SCUFN on NCEI (Hudson + McMaster / Uchupi / Emery / Ryan lines; no Veatch / Atlantis / Hydrographer / Block / Alvin) is documented as incomplete, not a first-success fallback. Lautenberg coral polygons are closed areas, not axes. Marine Regions / ACUF JSON is not NOAA-hosted so it is not `source: "noaa"`. A 429 / 403 / parse / no-intersection miss keeps the hashed fixture (which still has synthetic axes). Canyons do not block Ready. Tests mock fetch; one live probe skips if blocked. `PACK_BUILDER_REV` is `canyons-live-heads-2026-08-20` because live overlay IDs now include `canyons`. No Worker scoring. No Flutter. 72 h series stays off.

## This pass (PFEG MODIS 8-day chlorophyll, 2026-08-20)

`tryLiveNoaa` / `buildTripPack({ tryLive })` still probe public no-key ERDDAP chlorophyll for the Point Judith box. First parseable grid paints pack layer `chlorophyll` as `source: "noaa"`. The path that returned a usable, still-updating grid from this network is PFEG **Aqua MODIS L3SMI 8-day NRT 4 km / 0.0417°** (`erdMH1chla8day_R2022NRT`, analysis 2026-08-09). That is not 1 km VIIRS and not CMEMS L4. CoastWatch S-NPP / NOAA-20 L3 dailies and S-NPP SQ weekly stay as fallbacks (they cover this box; last times here were 2026-07-09 / 2026-06-20). NOAA-21 US-sector daily also covers the box (2026-08-15) but is not first. PFEG `erdVHNchla8day` is North Pacific only. `oc_3p0_chla` is not on CoastWatch / PFEG / PolarWatch. A 429 / 403 / parse miss keeps the hashed fixture. Chlorophyll does not block Ready-for-offshore. Tests mock fetch. No Worker scoring. No Flutter. 72 h series stays off.

## This pass (pack builder revision, 2026-08-20)

Every trip-pack manifest stamps `builder.rev` from a hand-bumped constant (`canyons-live-heads-2026-08-20`) so Helm / preview can tell which pack.ts produced the bytes; Packs shows it under the hashed count. Not a live git hash. No Worker scoring. No Flutter. 72 h series stays off.

## This pass (hour-0 GFS merge, 2026-08-20)

Live GFS-Wave f000 no longer replaces the 72 h fixture wind/wave stack. Hour 0 is painted from the live subset; hours 3–72 stay fixture so Ready does not fail `1 h < 72 h`. Manifest notes / liveErrors say `gfs: hour-0 live; hours 3–72 fixture (series off)` and do not claim a live 72 h NOAA series. A complete paced series still stamps 72 h noaa. Series stays off by default. SST age is unchanged. No Worker scoring. No Flutter.

## This pass (packed tide curve, 2026-08-20)

Safety and a compact plotter HUD paint the packed CO-OPS hourly series for Newport (default; Quonset / Montauk selectable). Next high/low come from packed hi/lo. Empty or missing pack shows "no packed tides" — no invented water levels. Fixture and live NOAA bodies use the same renderer. Tests cover hourly + hi/lo and the empty path. No Worker scoring. No Flutter. 72 h GFS series stays off.

## This pass (helm live skipCache, 2026-08-20)

Helm Live NOAA Download always sends skipCache; a cached live result without errors cannot hide a failed SST. Same-download /api/objects still reuse the cache with liveErrors. No Worker scoring. No Flutter.

## This pass (live ingest errors on Packs, 2026-08-20)

Live NOAA misses already kept the hashed fixture, but Packs only showed "fixture". `LiveNoaaResult.errors` now ride the pack as `liveErrors` (capped at 8; empty when live is off or every overlay landed). Helm lists those lines under the NOAA/fixture count and offers Retry live overlays (same download path, skipCache). Tests mock a failed SST fetch. No Worker scoring. No Flutter. 72 h series stays off.

## This pass (ENC catalog aid boxes, 2026-08-20)

Live packed ENC cells keep catalog west/south/east/north so Helm can paint the aid overlay boxes — catalog coverage, not official S-57.

## This pass (ERDDAP timeout + retry, 2026-08-20)

Live NOAA ERDDAP grids (SST / chl / SSH / bathy), HMS, canyon heads, and hour-0 GFS now share an 18 s fetch with one retry on timeout / 429 / 5xx (1.5 s backoff). 404 is not retried. Two failures still keep the fixture. 72 h GFS series stays off. Tests mock fetch and sleep. No Worker scoring. No Flutter.

## This pass (preview live overlays, 2026-08-20)

Preview `GET /api/packs?live=1` and matching `/api/objects` already called `buildTripPack({ tryLive })`, but the pack-http test only mocked NDBC so only buoys looked live. Tests now mock SST, ETOPO bathymetry + contours, chlorophyll, SSH, HMS, canyon heads, and hour-0 GFS-Wave and mark those layers `source: "noaa"`. A failed fetch keeps that layer fixture. No live=1 stays fixture. 72 h series stays off. No Worker scoring. No Flutter.

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
Partial series is never marked as a full 72-hour grid. Tests use mocked fetch. Cron is on (R2 + D1 exist). No Flutter. No Worker scoring.

## This pass (hour-0 NCEP wind/wave paint, 2026-08-20)

Worker `buildTripPack({ tryLive })` and preview `GET /api/packs?live=1` now fetch public NOAA bytes when the network allows. Preview without `live=1` stays deterministic fixtures. Packs panel **Live NOAA** (default off) requests that flag; layer rows show fixture vs noaa from the manifest. Flutter was not started. Worker scoring was not added. AIS stays the demo gateway. Humor stayed out of helm toasts.

### Now live (no keys; fetch failure keeps the hashed fixture)

- NDBC `latest_obs` → pack `buoys`, `source: "noaa"`.
- CO-OPS predictions (hourly + hi/lo) plus latest `water_level` for departure harbors in/near the box (Newport, Quonset, Montauk, plus Woods Hole / New London when they sit in the bbox).
- NOAA ENC **product catalog** (`ENCProdCat.xml`) clipped to the trip box → pack `enc` as a cell list with zip URLs/sizes. Optional hash of one small harbor zip when it is under 80 KB. **Not official S-57.** Helm does not paint a legal chart.
- ENC Direct tile **template URL** plus ENC Online MapServer metadata. `tileservice.charts.noaa.gov` TLS failed from this host on 2026-08-20; recorded as probe, not as a chart.
- GFS-Wave NOMADS `filter_gfswave.pl` Atlantic `atlocn.0p16` **f000** subset for the Point Judith box (~3 KB). When those bytes parse (simple-packed lat/lon, confirmed on the live 3014 B file: WIND, WDIR, HTSGW, PERPW, DIRPW), hour-0 wind (kt) and wave (ft) paint onto the fixture planes and the layer source is `noaa`. Hours covered stays **72** (fixture remainder). That is not a live 72 h NOAA series. A 1 h live field alone is **not** used as the packed body. Parse or network failure keeps the 72 h fixture and does not mark the layer live. A paced 72 h / 3 h series helper exists and is **off by default** (NOMADS ~10 s between files; do not run in CI).
- CoastWatch ERDDAP SST (CoralTemp daily 5 km) for the Point Judith box when that URL returns CSV. Layer `sst` is `source: "noaa"` only then. Resolution is 5 km / 0.05° — not 1 km MUR. Analysis time drives SST age. Fetch/parse miss keeps the fixture.
- PFEG ERDDAP chlorophyll (Aqua MODIS L3SMI 8-day NRT 4 km) for the Point Judith box when that URL returns CSV. Layer `chlorophyll` is `source: "noaa"` only then. Resolution is 4 km / 0.0417° — not 1 km VIIRS, not CMEMS L4. CoastWatch VIIRS L3 dailies stay as fallbacks. Fetch/parse miss keeps the fixture. Chlorophyll does not block Ready.
- CoastWatch ERDDAP SSH / SLA (blended daily 0.25°) for the Point Judith box when that URL returns CSV. Layer `altimetry` is `source: "noaa"` only then. Resolution is 0.25° / ~25 km — not CMEMS L4, not AVISO DUACS. Values stored in cm. Fetch/parse miss keeps the fixture. Altimetry does not block Ready.
- NMFS/NOAA HMS closed-area KMZ (Northeastern US pelagic longline closed area) for the Point Judith box when that URL returns a parseable polygon that intersects the box. Layer `hms_zones` is `source: "noaa"` only then. Reminder overlay — not a legal determination. Amendment 15 shapefiles stay in the probe list (south of this box). Fetch/parse/no-intersection miss keeps the fixture. The HMS file must exist for Ready even if empty.
- CoastWatch PFEG ERDDAP bathymetry (NCEI ETOPO 2022 15″, stride 8 → ~0.033°) for the Point Judith box when that URL returns CSV. Layer `bathymetry` is `source: "noaa"` only then. Resolution is ~0.033° — not native 15″, not official ENC. Cheap 100/200-fm contours replace the fixture when the grid paints. Fetch/parse miss keeps the fixture. Bathymetry is required for Ready (fixture still counts).
- NOAA OCM / MarineCadastre undersea feature place names (GeoJSON query) for the Point Judith box when that URL returns named canyon heads. Layer `canyons` is `source: "noaa"` only then. Heads only (Veatch, Atlantis, Hydrographer, Block, Alvin, Hudson here) — no axes, none invented. GEBCO SCUFN stays documented as incomplete for this box. Fetch/parse/no-intersection miss keeps the fixture. Canyons do not block Ready.

### Still fixture / not done

- SST is fixture unless the CoastWatch ERDDAP probe parsed a grid (CoralTemp 5 km, not 1 km MUR). Chlorophyll is fixture unless the PFEG ERDDAP probe parsed a grid (Aqua MODIS L3SMI 8-day NRT 4 km, not 1 km VIIRS / CMEMS). Altimetry is fixture unless the CoastWatch ERDDAP probe parsed a grid (blended SLA daily 0.25°, not CMEMS / AVISO). Bathymetry is fixture unless the CoastWatch PFEG ERDDAP probe parsed a relief grid (NCEI ETOPO 2022 15″ subsampled to ~0.033° here — not native 15″, not official ENC). Contours follow that grid when it paints; otherwise they stay fixture. Canyons are fixture unless the MarineCadastre undersea-names probe parsed named heads that intersect the box (heads only — no invented axes). HMS is fixture unless the NMFS/NOAA closed-area probe parsed a polygon that intersects the box (NE PLL KMZ here — reminder only, not a legal determination).
- 72 h wind and wave **grids** unless the paced series is explicitly enabled and every f000-f072 step decodes (hour 0 may be live; hours 3-72 stay fixture or empty otherwise. NDFD not fetched. Full series is not downloaded in CI).
- Official S-57 cell zips are not stored in the repo or claimed as the legal chart. Full-box zip set is tens of MB; catalog excerpt only.
- GHRSST / CMEMS (keys / licence). Production R2 objects.
- Preview `/api/packs` without `live=1`.
- AIS demo gateway. Flutter helm. Custom domains live on ahanu.dev / www.ahanu.dev (PWA) and api.ahanu.dev (packs); workers.dev stays as fallback. `ahanu.app` is not on this account. R2 exists but does not yet hold live ENC/GRIB/SST for every layer.

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
