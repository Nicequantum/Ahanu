# Status

Honest inventory. Nothing here is a badge.

## This pass (leftover community freeze, 2026-08-21)

Helm Log said **Frozen reports packed with the trip** and the plotter painted leftover invented community dots (Mike / Relentless, etc.). Community is not a pack layer. GET /api/community is 404. Those rows are leftover demo — not packed, not live radio. Same class as leftover AIS demo fleet. Helm now paints an empty overlay and lists no leftover reports. Demo file stays marked DEMO for tests only. Does not invent community. NOAA ACSPO last cell is still 2026-08-20T12:00Z — do not invent SST. 8455083 packed. AIS leftover honest. ahanu.dev only. No AIS ingest edit. No Flutter. PR #1 not merged.

## This pass (onboarding ENC copy, 2026-08-21)

Helm first-run still said **Charts are an aid, not ENC** after official S-57 (20 cells) landed. Honest line is aid / not ECDIS, not no ENC. Relabeled: official S-57 extract is an aid, not ECDIS, not a paper-chart substitute. Does not claim full ENC coverage or leftover cells US4RI1EB etc. Brief key bumped to ahanu-briefed-v2 so skippers who already dismissed see it. DATA_PACKS inventory no longer lists SST as MUR L4 + COG — live is ACSPO L3S-LEO NRT JSON grid and ETOPO JSON, not a COG. STATUS is inventory, not helm. No AIS ingest edit. No Flutter. PR #1 not merged.

## This pass (PWA shell precache, 2026-08-21)

SW cached pack GETs (network-first on api.ahanu.dev) but did not precache the helm document or versioned assets. Airplane after dock Download still had IndexedDB + last pack GET; a reload could blank the app. Install now precaches `/`, helm assets parsed from that document, and `/sw-ahanu.js` (already versioned). Same-origin documents are network-first with cache fallback; hashed assets are cache-first. Production pack APIs stay network-first — not cache-first. Does not invent NOAA. No AIS ingest edit. No Flutter. PR #1 not merged.

## This pass (production Download keeps Worker liveErrors, 2026-08-21)

Production Download with Live NOAA off dropped helm `liveErrors` until IDB restore. API still had the SST age keep-line and AIS miss — skipper lost the honest cues after marina-Wi-Fi Download. Production Download already hits the live Worker (`tryLive`; `?live=1` is preview-only). Helm now keeps Worker `liveErrors` the same way restore does. Does not invent errors. Does not auto-flip Accept stale. NOAA ACSPO last cell is still 2026-08-20T12:00Z — do not invent SST. 8455083 packed. AIS leftover honest. ahanu.dev only. No AIS ingest edit. No Flutter. PR #1 not merged.

## This pass (helm wall clock + SST-age Ready badge, 2026-08-21)

Helm `clockMs` was still the leftover demo stamp `2026-08-20T21:40Z`. Packed 8455083 next high/low and the tide now-marker were vs that clock, not wall time — skipper-facing lie. Clock now follows `Date.now()` (local TZ display is fine). Tests that freeze time inject `setHelmNowMs`. tickSim no longer warps 12× from the leftover stamp. Do not invent NOAA tide data.

Compact Ready badge said generic **Not ready** when the only hash-ok block was SST age. Packs already names the age; badge now says **SST N h** / **Not ready · SST N h**. Does not auto-flip Accept stale. NOAA ACSPO last cell is still 2026-08-20T12:00Z — do not invent SST. 8455083 packed. AIS leftover honest. ahanu.dev only. No AIS ingest edit. No Flutter. PR #1 not merged.

## This pass (leftover COG bathy + canyon axes labels, 2026-08-21)

Live GET /api/packs on api.ahanu.dev labeled bathymetry **Bathymetry (COG)** after a live NCEI ETOPO 2022 JSON grid landed (121×64, ~0.033°, sources[] already named that product) and canyons **Canyon axes & heads** after a live MarineCadastre heads-only GeoJSON landed (14 named Point heads, no axes). COG is not packed; live canyons invent no axes — leftover fixture/catalog copy, same class as leftover WW3 on GFS-Wave. Generation now names fixture **ETOPO bathymetry (fixture)** / live **ETOPO bathymetry**, and live **Canyon heads** (fixture still **Canyon axes & heads** because the hashed fixture still has synthetic axes). Persist / serving R2 GET/HEAD rewrite leftover COG and axes labels — no NOAA. Helm Packs remaps the stored leftover. Do not invent a newer SST. NOAA ACSPO last cell is still 2026-08-20T12:00Z. 8455083 packed. AIS leftover honest. ahanu.dev only. No AIS ingest edit. No Flutter. PR #1 not merged.

## This pass (leftover WW3 wave label, 2026-08-21)

Live GET /api/packs on api.ahanu.dev labeled waves **GFS-Wave / WW3 GRIB** after a live GFS-Wave 72 h series landed. WW3 GRIB is not packed — leftover fixture/catalog copy, same class as leftover NDFD on GFS-Wave wind. Generation now names fixture **GFS-Wave waves (fixture)** and live **GFS-Wave waves**. Persist / serving R2 GET/HEAD rewrite leftover WW3 labels — no NOAA. Helm Packs remaps the stored leftover. NOAA ACSPO last cell is still 2026-08-20T12:00Z — do not invent SST. 8455083 packed. AIS leftover honest. ahanu.dev only. No AIS ingest edit. No Flutter. PR #1 not merged.

## This pass (ownship GPS, 2026-08-21)

NOAA CoastWatch ACSPO L3S-LEO NRT daily last cell is still **2026-08-20T12:00Z** (~28 h at probe). Kelvin + Celsius NRT same stamp. RAN last 2026-06-16. MUR 2026-08-20T09:00Z. GeoPolar / CoralTemp 2026-08-19T12:00Z. Do not invent SST. skipCache not landed.

Helm GPS mode only froze the last simulated ownship (Veatch). No `navigator.geolocation` path. GPS now watches this device (Permissions-Policy already `geolocation=(self)`). A real fix moves the mark; denied / unavailable / timeout keeps the last position — no invented Galilee. Unknown SOG is 0, not leftover trolling knots. Last GPS-on is persisted (`ahanu-nav-gps`); first visit stays trolling. Trolling / steaming stay simulated. NMEA gateway stays future hardware. 8455083 packed. AIS leftover honest. ahanu.dev only. No AIS ingest edit. No Flutter. PR #1 not merged.

## This pass (leftover L4 chlorophyll label, 2026-08-21)

Live GET /api/packs on api.ahanu.dev labeled chlorophyll **Chlorophyll-a L4** after a live NASA Aqua MODIS L3SMI 8-day NRT 4 km grid landed (sources[] already named that product, analysis 2026-08-09). CMEMS L4 is not fetched — leftover fixture/catalog copy, same class as leftover NDFD on GFS-Wave. Generation now names fixture **Aqua MODIS chlorophyll (fixture)** and live **Aqua MODIS chlorophyll** (VIIRS L3 fallback names **VIIRS chlorophyll**). Persist / serving R2 GET/HEAD rewrite leftover L4 labels — no NOAA. Helm Packs remaps the stored leftover. Do not invent a newer chlorophyll scene. NOAA ACSPO last cell is still 2026-08-20T12:00Z — do not invent SST. 8455083 packed. AIS leftover honest. ahanu.dev only. No AIS ingest edit. No Flutter. PR #1 not merged.

## This pass (leftover NDFD wind label, 2026-08-21)

Live GET /api/packs on api.ahanu.dev labeled wind **NDFD oceanic + GFS-Wave wind GRIB** after a live GFS-Wave 72 h series landed. NDFD is not fetched — leftover fixture/catalog copy, same class as leftover MUR on ACSPO. Generation now names fixture **GFS-Wave wind (fixture)** and live **GFS-Wave wind**. Persist / serving R2 GET/HEAD rewrite leftover NDFD labels — no NOAA. Helm Packs remaps the stored leftover. NOAA ACSPO last cell is still 2026-08-20T12:00Z — do not invent SST. 8455083 packed. AIS leftover honest. ahanu.dev only (personal + Galilee friends); leftover lists no longer treat ahanu.app as required. No AIS ingest edit. No Flutter. PR #1 not merged.

## This pass (honest pack sources[] leftover, 2026-08-21)

Pack `sources[]` still prepended **Hashed fixture objects (not live GRIB/SST/CMEMS)** when SST/wind/waves/bathy were live NOAA. AIS miss may still be the only fixture. Helm ignores `sources[]`; the API lie is leftover. Generation now names leftover fixture ids only (AIS miss stays fixture/miss) and does not label live NOAA grids as fixture. Serving R2 GET/HEAD persist writes that cleanup — no NOAA. README / DATA_PACKS no longer claim hashed SST/wind/wave fixtures or "R2/cron not provisioned" while production cron + R2 + live NOAA are on. CMEMS / NDFD / 1 km MUR stay not ingested. No AIS ingest edit. No Flutter. PR #1 not merged.

## This pass (honest Packs download copy, 2026-08-21)

Helm Packs still said **Default download is hashed fixtures** and treated Live NOAA as the live path. Production Download 72h already hits api.ahanu.dev with tryLive (Live NOAA off; `?live=1` is preview-only). Relabeled: marina-Wi-Fi Download is live NOAA/ENC/tides; a missed layer (AIS) is a miss, not a fixture pack. Onboarding already honest. STATUS is inventory, not helm. No AIS ingest edit. No Flutter. PR #1 not merged.

## This pass (idempotent SST live-refresh liveErrors, 2026-08-21)

Live GET /api/packs on api.ahanu.dev listed **sst: live refresh still 27 h … kept ACSPO** twice. NOAA ACSPO last cell is still 2026-08-20T12:00Z — do not invent SST. Root cause: stale-SST GET prepended `sstRefreshKeptLine` on every R2 hit, and leftover notes persist wrote that prepend back. Same-kind sst/enc/tides keep-lines now replace; exact dups drop. Serving R2 GET/HEAD persist writes the collapsed list — no NOAA. 8455083 packed. AIS leftover honest. No AIS edit. No Flutter. PR #1 not merged.

## This pass (SW network-first production packs, 2026-08-21)

SW allowlisted api.ahanu.dev / workers.dev but treated GETs without `live=1` as fixture cache-first. Helm Download talks to the live Worker with Live NOAA off (`?live=1` is preview-only; skipCache is Retry only), so a second dock Download could serve the last SW cache after cron / Retry / notes cleanup. Production pack origins are now network-first (30 s stamp is a hint, not forever). Same-origin fixture stays cache-first. Airplane after dock download still uses IndexedDB + last successful SW cache. Does not invent NOAA. No AIS edit. No Flutter. PR #1 not merged.

## This pass (persist leftover 02° MUR notes, 2026-08-21)

Live GET /api/packs notes on api.ahanu.dev grew leftover **02° — not 1 km MUR** after ENC. SST label was already ACSPO. Root cause: `landedPackNotes` stripped `Landed this pack:` at the first period, and ACSPO names contain `0.02°`. Every persist / HEAD / workerManifest rewrite prepended the landed line and left the MUR fragment. `landedPackNotes` is now idempotent (boilerplate anchors, not first-period). Serving R2 GET/HEAD persist writes the cleaned notes when that leftover is present — no NOAA. Honest `0.02° — not 1 km MUR` in the ACSPO name stays. SST last cell still 2026-08-20T12:00Z. AIS leftover honest. 8455083 packed. No Flutter. PR #1 not merged.

## This pass (Retry when SST > 24 h, Live NOAA off, 2026-08-21)

Live PJ pack on api.ahanu.dev: ACSPO `2026-08-20T12:00Z` (~27 h). NOAA has not published a newer scene — do not invent SST. Ready correctly needs Accept stale. Helm Download talks to the live Worker even when **Live NOAA** is off (`?live=1` is preview-only), but Retry was gated on that switch, so skipCache stayed disabled after a dock download. `canRetryLiveOverlays` now exposes Retry when SST is stale or Ready is false, including live-off; downloading still hides it. Fixture + live-off with no age still stays off. Accept-stale persist, ACSPO label, 20 ENC cells, 8455083, Frame harbor unchanged. No AIS. No Flutter. PR #1 not merged.

## This pass (AIS WS read + no demo fleet, 2026-08-21)

Live 22 s snapshot packed 0 features with `ais: no positions in snapshot — live miss` after a successful key + websocket. Two real receive bugs: (1) AISStream `{error}` frames were parsed as non-positions and swallowed; (2) Cloudflare Workers outbound WS (compat 2026-08-01) needs fetch+Upgrade+`accept()` after listeners — or `new WebSocket()` + message events that actually decode Blob/ArrayBuffer frames. Connect-without-read looks like "ok, 0 positions". Error text now rides `liveErrors`. Still fail-closed; never invent tracks. Helm never calls `aisTargets()` — no pack / miss paints nothing and labels **AIS**, not "AIS demo — not live traffic". Demo file stays as a marked DEMO fixture for tests only. No Flutter. PR #1 not merged.

## This pass (AIS Class B + 22 s snapshot, 2026-08-21)

Bbox was already AISStream `[[[lat, lon], [lat, lon]]]` = `[[[39.4, -72.8], [41.5, -68.8]]]` — not the miss. Parser already kept PositionReport + Class B, but subscribe `FilterMessageTypes` dropped `ExtendedClassBPositionReport`, and the window was 10 s. Class B around PJ (pleasure / fishing) often reports every 10–30 s. Subscribe now asks for PositionReport + Standard/Extended Class B. Snapshot is 22 s. Zero positions still an honest miss — never the demo fleet. Does not block Ready. No Flutter.

## This pass (production AIS from AISStream, 2026-08-21)

Optional pack layer `ais`. Worker ingest opens `wss://stream.aisstream.io/v0/stream` with secret `AISSTREAM_API_KEY` (not a `[vars]` value, not `VITE_`). Subscribe JSON uses AISStream `[[lat,lon],[lat,lon]]` corners for the trip bbox (PJ: west -72.8, south 39.4, east -68.8, north 41.5). 22 s PositionReport + Class B snapshot, unique MMSI last-known. Missing key / WS error / zero positions: miss + liveError. Never the 14 invented demo tracks. Helm paints packed live GeoJSON only; pack miss stays missing. Label `AIS · AISStream` only when live bytes exist. Does not block Ready. No MarineTraffic. No Flutter.

## This pass (dock-to-canyon steam ENC, 2026-08-21)

ENCProdCat 2026-08-21T04:55:06Z: still 237 usage 3–5 cells in the Point Judith box (~20.7 MB). The packed 16 already had PJ harbor/pond, Block Island inlets, Narragansett approaches, and coastal over Veatch / Atlantis / Hydrographer. **No usage-4/5 cell covers those canyon heads** — cannot invent one. Leftover official in-bbox: **US5RI1CE** (Block Island Sound, 29 KB, 12k, `-71.55..-71.475, 41.175..41.25`) sits on the PJ–BI steam; **US5PVDAB** / **US5PVDAA** (23–24 KB) are the harbor-scale gap between packed US5PVDBB and Block Island / Great Salt Pond; **US4NY1BY** (42 KB + `.001`) is the usage-4 gap 40.8–41.1 south of Block Island toward packed US4CN22M. **US4RI1EB** (359 KB) is Newport-east / Sakonnet — not the canyon steam. Leftover coastal **US3MA1BD** / **US3NY1AG** / **US3CT1AA** are real and in-bbox but either miss the loop or duplicate packed US3NY01M at the same 350k scale. Picker now ranks those four steam cells (cap **20** / 400 KB each / 3.2 MB; catalog zip ~2.31 MB). +4 Worker zip subrequests vs 16; paid Workers allow 10k — 237-cell box is still too many. Did not invent cells. Not an ECDIS. Helm cell list is pack `s57.cellIds` — PWA not redeployed. Frame harbor, tide 8455083, PWA manifest, Flutter, merlinus-* unchanged. No Worker scoring.

## This pass (Frame harbor = official PJ union only, 2026-08-21)

Live Frame harbor on ahanu.dev jumped to upper Narragansett / Providence (~41.5–41.8N; US5PVDCB / US5PVDCD / US3RI1AA labels). Tide-harbor picker is Newport / Quonset / Montauk / New London — no Point Judith. **Click path is not the tide store:** ChartMap calls applyFrameHarbor(map, getPackedOcean()?.enc) and fitBounds the framed bbox. Live pack extract/catalog for US5PVDCB and US5PVDBB are the official boxes (-71.55..-71.475, 41.4..41.475 and 41.325..41.4). The camera box is now **always** that official union (-71.55..-71.475, 41.325..41.475) so Galilee 41.3615 stays in and Newport 41.49 stays out. Huge extract hulls, US5PVDCD, US3RI1AA, US5PVDDD, and tideHarbor are ignored. One plotter. Not ECDIS. No invented GPS. No Worker scoring. No Flutter.

## This pass (Frame harbor = harbor + inlet, 2026-08-21)

Frame harbor preferred **US5PVDCB** only (`-71.55..-71.475, 41.4..41.475`). Galilee / Point Judith Harbor dock (~-71.51, 41.3615) is south of that box; the inlet is off the south edge. Default is now the union of packed official **US5PVDCB + US5PVDBB** (`-71.55..-71.475, 41.325..41.475`). **US5PVDDD** (Narragansett Bay East Pass, north 41.55 / east -71.325) is omitted — the union is not z12–14 harbor-scale. Fallback stays the documented US5PVDBB / PJ box (`41.325..41.4`). Framing still drops Follow; camera persist stays `moveend` → `ahanu-camera`. One plotter. Not ECDIS. No invented GPS. No Worker scoring. No Flutter.

## This pass (Frame harbor, 2026-08-21)

Frame pack still fits the whole trip bbox, so harbor ENC is a speck in the NW. Helm now has **Frame harbor** next to Frame pack (plotter + Packs). It fits packed official harbor-scale cells: prefer **US5PVDCB** Point Judith Harbor extract/pack footprint (`-71.55..-71.475, 41.4..41.475` from the official `.000`), else the union of US5PVDCB+US5PVDBB+US5PVDDD, else the documented US5PVDBB / PJ harbor box (`-71.55..-71.475, 41.325..41.4` — ENCProdCat 2026-08-21 / extract, not invented). Framing drops Follow the same way a skipper pan does. Camera persist stays `moveend` → `ahanu-camera`. `maxZoom` 14 so shoreline is readable (z12–14), not the canyon. One plotter. Not ECDIS. No invented GPS. No Worker scoring. No Flutter.

## This pass (Frame pack, 2026-08-21)

Keyboard pan from Veatch to Point Judith Harbor is slow. Helm now has a compact **Frame pack** control (plotter next to Follow, and Packs) that fits the existing plotter to the downloaded pack bbox (`west`/`south`/`east`/`north`) or `POINT_JUDITH_CANYON_BBOX` when no pack is loaded. Framing drops Follow the same way a skipper pan does. The framed view is written to `ahanu-camera` on `moveend` (existing persist). One plotter. Not ECDIS. No invented GPS. No Worker scoring. No Flutter.

## This pass (persist Follow, 2026-08-21)

Follow on/off is kept on this device (`ahanu-follow`) the same way night-bridge and Accept stale SST are — written on the Follow tap or a skipper pan/zoom drop, read at store init and again after persist rehydrate. First visit stays ON. A dropped Follow stays off after reload so harbor ENC is not yanked back to Veatch. Exiting replay restores the persisted value and does not force ON. Replay still owns the camera while it is on. First paint is still Veatch until a gesture (camera center is not persisted). No invented GPS. No Worker scoring. No Flutter.

## This pass (Follow drops on skipper pan, 2026-08-21)

Follow was a latch: every ownship tick and Download-driven re-render called `easeTo` on Veatch while `followShip` stayed true, so a skipper could not pan to Point Judith Harbor / ENC cells without turning Follow off first. Follow now tracks until a user pan, drag, pinch, or zoom, then drops. Tap Follow to re-arm and center. Ownship marker still updates. No invented GPS. Replay still owns the camera while it is on. No Worker scoring. No Flutter.

## This pass (persist landed SST/ENC labels, 2026-08-21)

Leftover after pack `sources[]` named the landed SST: stored R2 `layer.label` could stay **SST composite (MUR / CoastWatch)** after an ACSPO body landed, and old ENC `sources[]` could omit cell/update counts. Persist (full build, SST refresh, ENC refresh) now rewrites `layer.label` / `sources[]` from the landed body so R2 cannot keep a MUR label on an ACSPO object. Official ENC persist includes cellIds + updateCount. Serving R2 one-shots the same rewrite when the SST body is already ACSPO and the label still says MUR — no NOAA. Does not invent products. No Worker scoring. No Flutter.

## This pass (pack sources[] name what landed, 2026-08-21)

Worker GET `/api/packs` `sources[]` was `listIngestSources()` — a static ingest catalog. SST could be ACSPO while sources still said GHRSST / CoastWatch (MUR-first leftover). GFS cycle lived only on the layer note. `sources[]` and additive `landedSources` now come from the pack: SST dataset id (ACSPO/MUR/GeoPolar/CoralTemp when that grid landed), GFS cycle+hours, ENC official + cell count/updates. Catalog adapters stay on GET `/api/sources`. Helm still ignores `sources[]`; `sstHelmLine` / pack row already remap leftover MUR catalog copy. Does not invent products. No Worker scoring. No Flutter.

## This pass (refresh short R2 ENC on Download, 2026-08-21)

Helm Download without skipCache served last R2 after the SST-only refresh, including the old 8-cell official ENC (~3.4 MB, original cellIds). skipCache=1 already packed 16. GET `/api/packs` (skipCache off) now refetches official ENC on the same liveEnc path when packed `s57.cellIds.length` is below the current picker cap (16) or the body is missing harbor/approach ids the current picker would include for this bbox, persists ENC + manifest, and keeps other R2 layer hashes. Fixture / catalog-only is not rebuilt here. Does not invent cells. Does not take a skipCache slot. PWA / helm unchanged — cell list is still pack `s57.cellIds`. No Worker scoring. No Flutter.

## This pass (ACSPO ≤24 h SST + new-cell ENC updates, 2026-08-21)

Re-probed public ERDDAP for POINT_JUDITH_CANYON_BBOX at ~2026-08-21T06:00Z. **ACSPO L3S-LEO NRT daily** `noaacwLEOACSPOSSTL3SnrtKDaily` last cell **2026-08-20T12:00Z (~18 h)** — HTTP 200, 867 KB PJ CSV, 93% fill, native 0.02° / ~2 km, Kelvin→°C. That is ≤24 h and fetchable, so Ready does not need Accept stale SST. Not 1 km MUR / GHRSST L4. **GOES-16 still 404** (`noaacwGEOHIRRSSTGoes16NRT` and Daily unknown datasetID). Other last cells: GeoPolar DN / CoralTemp **2026-08-19T12:00Z (~42 h)**; JPL MUR **2026-08-19T09:00Z (~45 h)** — not newer than the previous MUR stamp. MUR stride 1 still exceeds 2 MB; stride 2 stays the L4 fallback.

New packed cells probed from charts.noaa.gov (HTTP 200, application/zip). Extract already applies ISO 8211 `.00n` in order (same RUIN path as US5PVDCB.001). **Updates present:** US5RI1BD `.001` 6506 B edition 3 UPDN 1; US5PVDCC `.001` 14339 B edition 4 UPDN 1; US5PVDCD `.001` 14026 B edition 3 UPDN 1; US4CN22M `.001` 27098 B edition 20 UPDN 1; US4NY1CY `.001` 41324 / `.002` 2983 / `.003` 3686 / `.004` 2991 B edition 3 UPDN 1–4; US4RI1EA `.001` 2467 / `.002` 6825 / `.003` 15957 B edition 1 UPDN 1–3. **Base .000 only (no cell .00n):** US5RI1CD (398380 B, edition 4); US5RI1BE (122946 B, edition 3). CATALOG.031 is the exchange catalog, not an update. Did not invent updates. Not an ECDIS. GFS complete-cycle, R2, rate limits, security headers, 16-cell picker, UWTROC paint, ingest lock unchanged. No Worker scoring. No Flutter.

## This pass (dock-to-canyon ENC picker, 2026-08-21)

ENCProdCat 2026-08-21: 237 usage 3–5 cells in the Point Judith box (~20.7 MB). The 8-cell clip already had PJ harbor + pond (**US5PVDBB** / **US5PVDCB**), Montauk, Newport, and the four coastal cells that cover Veatch / Atlantis / Hydrographer. No usage-4/5 cell covers those canyon heads. Missing were Block Island harbor-scale cells and Narragansett approach cells. Picker now ranks official inlets (Great Salt Pond **US5RI1CD**, Old Harbor **US5RI1BD**, Block Island SE **US5RI1BE**, West Pass **US5PVDCC**, East Passage **US5PVDCD**) then usage-4 approaches (**US4CN22M**, **US4NY1CY**, **US4RI1EA**). Cap 16 cells / 400 KB each / 3.2 MB catalog (~2.19 MB zip for this set). Did not pull all 237. Did not invent cells. Not an ECDIS. Official zips only from NOAA. UWTROC paint, updates, GFS, R2, rate limits unchanged. Helm cell list is pack `s57.cellIds` — PWA not redeployed. No Worker scoring. No Flutter.

## This pass (leftover S-57 skipper classes, 2026-08-21)

Re-counted leftover classes on real NOAA bytes: harbor **US5PVDCB** `.000` + applied `.001`, neighbor **US5PVDBB** base `.000` only (no `.00n` in that zip). Leftover names were wrong for three present classes: the 28 “TS_PRH” are **UWTROC** (objl 153, covers-and-uncovers rocks); the 12 “SBDARE” are **SEAARE** named coves; the 5 “ROADWY” are **RIVERS**. Real **SBDARE** is objl 121 (19 harbor / 50 approach). **TS_PRH** and **ROADWY** are absent. Extract now paints reconstructable skipper geometry only: **UWTROC** as obstructions (28 / 162), **SBDARE** points+areas (19 / 50), **LAKARE** lake polygons (16 / 18), **SLOTOP** cliff lines CATSLO 6 (14 / 12), **LNDRGN** area land/marsh only (56 of 57 / 64 of 65 — the one point is a place name, no fake polygon). Still skipped: **BUISGL** buildings (47 / 246), **SEAARE** named water (would cover depth), **RIVERS**, **ROADWY** (absent), **TS_PRH** (absent; no harmonic series the helm can show). LIGHTS/WRECKS still absent in harbor, already painted on US5PVDBB. Did not invent S-57. Not an ECDIS. MapLibre worker, ENC update apply, security headers unchanged. No Worker scoring. No Flutter.

## This pass (PWA GET/HEAD /health, 2026-08-21)

PWA Worker had no `/health` — GET and HEAD were 404 HTML (SPA miss) so ahanu.dev uptime checks failed. GET/HEAD `/health` now return 200 JSON `{ ok: true, service: "ahanu" }` (HEAD empty body) with the same PWA security headers as other documents. SPA `/` and `/login` unchanged. Packs HEAD /health, NDBC probe cache, skipCache limit, catch bind, ENC, GFS, security header values unchanged. No Worker scoring. No Flutter.

## This pass (HEAD /health for load balancers, 2026-08-21)

`GET /health` and `GET /` were 200 with `Cache-Control: no-store` + `X-Ahanu-Ndbc` + packs security headers. `HEAD` of the same paths was 404 because the router only matched GET. HEAD now returns 200 with those same headers (empty body). PWA `HEAD /` was already 200. NDBC probe cache, skipCache limit, catch bind, ENC, GFS, security header values unchanged. No Worker scoring. No Flutter.

## This pass (HTTP security headers on both Workers, 2026-08-21)

PWA Worker now sends production-sane headers on documents: CSP (MapLibre `worker-src 'self' blob:`, packs `connect-src` to api.ahanu.dev + workers.dev, `frame-ancestors 'none'` on prod hosts), nosniff, Referrer-Policy, X-Frame-Options DENY on prod, HSTS on ahanu.dev / www, Permissions-Policy, COOP same-origin-allow-popups. Grok preview hosts skip XFO / frame-ancestors so the iframe still embeds. Packs CORS is reflected helm origin (ahanu.dev / www / ahanu workers.dev aliases) — no `*`. nosniff + HSTS on api.ahanu.dev. skipCache Cache-Control, SW cache, NDBC probe cache, skipCache limit, catch bind, ENC, GFS, ingest lock unchanged. No Worker scoring. No Flutter.

## This pass (limit skipCache live rebuilds per IP, 2026-08-21)

Public `GET /api/packs?skipCache=1` still forces a full NOAA+ENC rebuild (~11s). That path is now fail-closed at **3 live rebuilds / 60s / CF-Connecting-IP** (missing IP or limiter error → 429 + Retry-After). R2/manifest hits do not take a slot, so helm restore stays cheap. Objects rebuild-on-total-miss uses the same gate; isolate/R2 hits do not. Cron and POST /api/ingest stay in-process and are not limited. Helm Retry (`skipCache=1`) still works, just not unbounded. Catch bind, ENC updates, GFS cycle pick, ingest lock unchanged. No Worker scoring. No Flutter.

## This pass (bind catch rows to the creating device, 2026-08-21)

`POST /api/catches` still opens on any non-empty device bearer (not `INGEST_TOKEN`). Each D1 row now stores `device_hash` = SHA-256 of that bearer. Same token updates (201 insert / 200 update). A different token on the same id is 403 and does not overwrite. Empty bearer stays 401. `GET /api/catches` stays 404 — no list of other devices. Existing four probe rows were kept; NULL `device_hash` is unbound-once (first successful same-id write binds) so a skipper is not locked out of their own log. Safer than treating unknown owners as permanently unwritable. Ingest stay fail-closed. ENC update extract and GFS cycle pick unchanged. Helm catch-sync unchanged (no PWA deploy). No Worker scoring. No Flutter.

## This pass (ENC updates in packed zips, 2026-08-21)

Probed charts.noaa.gov zips for the eight packed cells (HTTP 200, application/zip). **ISO 8211 updates present:** US5PVDCB `.001` 4767 B (leader `017903LE1`, edition 3 UPDN 1); US5NY2GL `.001` 9277 / `.002` 3625 / `.003` 2108 / `.004` 7168 B (edition 4 UPDN 1–4); US5PVDDD `.001` 3471 / `.002` 2430 / `.003` 11876 B (edition 5 UPDN 1–3); US3RI1AA `.001` 14775 B (edition 1 UPDN 1). **Base .000 only (no cell .00n):** US5PVDBB, US3NY01M, US3MA1AD, US3MA1AC — CATALOG.031 is the exchange catalog, not an update. Helm extract now applies RUIN insert/delete/modify (plus FSPC/VRPC/SGCC pointer-control) from those ISO 8211 files in order. Pack JSON lists edition + update file names/sizes. Copy says **includes ENC updates** only after extract applied them; base-only cells say **base .000 only — no update files in this exchange set**. Not an ECDIS. Did not invent S-57. GFS complete-cycle, R2 persist, ingest lock, MapLibre worker, domains unchanged. No Worker scoring. No Flutter.

## This pass (GET /api/packs serves last R2 manifest, 2026-08-21)

GET `/api/packs` without skipCache now serves `packs/{packId}/manifest.json` when it is present and the request is the same 6 h packId window or an explicit packId. That path does not rebuild NOAA. skipCache=1 or a miss is the current live build + persistBuiltPack. Objects GET stays R2-first on a cold isolate; hashes match the served manifest. Helm Download 72h no longer forces skipCache (Retry live overlays still does). No ENC/S-57 invented. Ingest stay fail-closed. GFS 72 h, SST stride-2, domains unchanged. No Worker scoring. No Flutter.

## This pass (R2 source of truth for every packed layer, 2026-08-21)

GET `/api/packs` and cron already called `persistBuiltPack` for all 12 advertised layers (hash key + `packs/{packId}/{layer}` + manifest). Official ENC is ~3.4 MB and first in persist order — a thrown put aborted SST/GRIB/the rest, so a cold isolate after 02/08/14/20 UTC rebuilt NOAA. Persist now writes UTF-8 bytes, keeps going after one layer throw, and splits only above 8 MiB (official ENC stays one object). Objects GET write-through the served layer when the isolate, not R2, had it. Objects serve R2 without rebuilding NOAA. No ENC/S-57 invented. Ingest stay fail-closed. GFS 72 h, SST stride-2, MapLibre worker, maxZoom 16 unchanged. No Worker scoring. No Flutter.

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
- GHRSST 1 km MUR / CMEMS (keys / licence). NDFD not fetched. Production R2 + cron are on.
- Preview `/api/packs` without `live=1`.
- AISStream snapshot when `AISSTREAM_API_KEY` lands; miss otherwise — never the invented demo fleet. Flutter helm. Custom domains live on ahanu.dev / www.ahanu.dev (PWA) and api.ahanu.dev (packs); workers.dev stays as fallback. ahanu.dev only — personal + Galilee friends, not a commercial product. R2 is the persist target for every advertised layer (official ENC dock-to-canyon subset under ~6–8 MB, SST, wind/waves GRIB, buoys). A cold isolate should serve last-good objects from those keys.

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

Workers package bytes. AIS is AISStream or a miss — never invented tracks. No helm toast jokes. No invented S-57 or R2 NOAA bytes. Ahanu is an aid to navigation and fishing.

See ARCHITECTURE.md and DATA_PACKS.md.
