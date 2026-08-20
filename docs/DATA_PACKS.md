# Trip packs

A trip pack is everything the helm needs for a named box and a named window, downloaded while the boat is still tied up. After that, cell can die at the 30-fathom curve and the plotter does not care.

This is the operational contract for `GET /api/packs` and the R2 bucket `ahanu-trip-packs`. Scoring is not in the pack. The pack is bytes.

---

## A departure from Point Judith

Point Judith, Rhode Island (`41.3615 N, 71.4814 W`). Typical canyon run: steam south-southeast toward Veatch or Atlantis, 80–110 nmi depending on the wall, overnight or 36–48 h out-and-back. The skipper is on marina Wi-Fi or a phone hotspot at the fuel dock.

1. Open Packs. Confirm vessel limits (wind, sea, fuel, reserve) — those are local, not downloaded.
2. Set the box. A working default for this run:

   ```
   west  -72.8
   south  39.4
   east  -68.8
   north  41.5
   ```

   That covers the harbor, Block Island Sound, the steam, Veatch, Atlantis, and a margin around Hydrographer if the day goes east. MarineCadastre heads for those names (plus Alvin) sit inside this box; a tighter east=-70.8 clip drops them. It is smaller than the full Northeast operating box (`-75.4, 36.4, -66.4, 42.6`) and therefore a smaller download.

3. Set the window: `start` = planned departure (ISO UTC), `hours` = **72**. Seventy-two hours is the product default. It covers a weather-hold morning, the steam, a night, and the steam home with a cushion. Do not pack 24 h and hope.
4. Download. Verify hashes. Wait for **Ready for offshore**.
5. Leave the dock. From here the pack is IndexedDB (PWA) or SQLite (Flutter, later).

A Montauk or Newport start uses the same flow; only the bbox origin changes. Hudson-only runs shift the box west; a long trip that includes the full shelf should use the Northeast default and accept the extra ENC and GRIB weight.

---

## What is in a pack

Layers match the Worker manifest (`TripPackLayer` + `hash` + `r2Key`). Source adapters and real NOAA/CMEMS URLs are in `cloudflare/src/ingest/sources.ts`.

| Layer               | Bytes                                                         | Window                   | Why it is in the pack                                        |
| ------------------- | ------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------ |
| NOAA ENC clip       | S-57 cells, Harbor/Approach/Coastal                           | static, weekly refresh   | Legal-adjacent chart. Aid only — see Safety.                 |
| Bathymetry COG      | raster (live: NCEI ETOPO 2022 ~0.033° via ERDDAP)             | static                   | Canyon walls, 100-fathom curve, heads. Not official ENC.     |
| Depth contours      | vector (live: cheap 100/200 fm from the packed grid)          | static                   | Fast drawing, night-readable.                                |
| Canyon axes & heads | GeoJSON (live: MarineCadastre named heads)                    | static                   | Live: named heads only. Fixture still has synthetic axes.    |
| SST composite       | MUR L4 + GOES-East gap-fill, COG                              | last 24 h                | Water mass. Input to on-device breaks.                       |
| Chlorophyll-a L4    | CMEMS (licensed, not fetched) / PFEG Aqua MODIS 8-day 4 km    | last 8-day composite     | Color. Input to on-device edges. Does not block Ready.       |
| SSH anomaly         | CoastWatch blended SLA 0.25° (CMEMS L4 licensed, not fetched) | last 24 h                | Eddy / filament field under blank SST. Does not block Ready. |
| Wind GRIB           | NDFD + GFS-Wave                                               | **72 h**, 3 h step       | Go/no-go against `BoatLimits.maxWindKt`.                     |
| Wave GRIB           | GFS-Wave ATL 0p16 (WW3)                                       | **72 h**, 3 h step       | Go/no-go against `BoatLimits.maxWaveFt`.                     |
| NDBC snapshot       | JSON                                                          | ~hourly, stale after 3 h | Ground truth vs model.                                       |
| CO-OPS tides        | JSON hi/lo + hourly                                           | **72 h**                 | Harbor windows, The Race, Block Island Sound.                |
| HMS closed areas    | GeoJSON                                                       | static / as published    | Overlay, not a legal determination.                          |

**Not in the pack:** habitat score, temperature-break polylines, chlorophyll edges, solunar, marks, tracks, catch history, AIS. The first four are derived on the device from SST/chl/SSH + clock. The rest is user data.

Identity of an object:

```
r2://ahanu-trip-packs/packs/{packId}/{layerId}/{hash12}.{ext}
```

`packId` is derived from bbox + forecast cycle + hours. Until ingest writes real bodies, hashes are identity hashes of those same inputs. Production ingest replaces them with SHA-256 of the object bytes; the client already verifies whatever hash the manifest carries.

---

## 72-hour GRIB

The weather axis is 72 hours because canyon weather is a two-night problem. A fair Thursday morning is not a fair Friday night on the wall.

- **Waves:** NCEP GFS-Wave / WAVEWATCH III, Atlantic regional `atlocn.0p16`, fields Hs, primary period, primary direction, swell. Global 0p25 only as fallback.
- **Wind:** NDFD over the coastal half of the box, GFS-Wave wind over the offshore half, one GRIB the client already knows how to parse.
- **Cycle:** 6-hourly. A layer whose cycle is more than 6 h old is **stale**. Stale weather is not Ready for offshore.
- **Step:** 3 h. Enough for a go/no-go strip, small enough to keep the file in the low tens of megabytes for a canyon bbox.

The Worker does not decide go/no-go. The device compares each forecast hour to the skipper’s limits and paints green / caution / no-go locally.

### Enabling the live 72 h / 3 h series (off by default)

Hour-0 (f000) may paint when tryLive is on. The full series is a separate path.
It stays off so CI and GET /api/packs never pull about 25 NOMADS files.

| How                                                           | What happens                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------- |
| buildTripPack({ tryLive: true, gfsWaveSeries: true })         | Fetch f000-f072, about 10 s between files (GFS_WAVE_PACE_MS). |
| gfsWaveSeries: { enabled: true, hours: [0, 3, 6], paceMs: 0 } | Tests and short clips. Fake fetchImpl.                        |
| env AHANU_GFS_WAVE_SERIES=1 or GFS_WAVE_SERIES=1              | Read by Worker cron ingestFixturePack only.                   |
| Worker [vars] GFS_WAVE_SERIES                                 | Same cron flag. Do not enable on GET /api/packs.              |

NOMADS pacing: about 10 seconds between subset files, about 4 minutes for 25 hours.
A failed or missing step must not claim 72 h. hoursCovered is the contiguous prefix from hour 0 (hour 0 alone is 1 h).
Fixture wind/wave stay when the series is off or empty.

Cron (15 2,8,14,20 * * *) remains commented in cloudflare/wrangler.toml until R2 ahanu-trip-packs and D1 ahanu-core exist.
Uncommenting the trigger without the env flag still leaves the series off.

---

## SST composites

Captains read temperature the way they read a canyon wall: not the number, the **break**.

- Nightly **MUR L4 (1 km)** is the planning field. It is complete, slightly smooth, and honest about yesterday.
- **GOES-East L3** fills “today, this afternoon” when the sky is clear enough. Cloudy days stay on MUR.
- Packed as a clipped Cloud-Optimized GeoTIFF plus a quantized display PNG. The plotter paints the PNG; scoring reads the COG.
- Composite **age > 24 h → stale**. **> 48 h → missing** for the Ready-for-offshore test. Helm **Accept stale SST** (default off) can pass a present, hash-ok file in either band with a visible warning. No body still fails.
- Break detection (gradient, threshold in °C/nmi) is on-device. If two skippers disagree on a 0.5 °C cutoff, that is their argument, not a server flag.

Chlorophyll and altimetry follow the same rule: pack the field, derive the edge at the helm.

---

## Bathymetry (not the legal chart)

Canyon walls need a depth field the helm can paint. Official ENC remains the chart of record.

- **No-key live path (2026-08-20):** NOAA NCEI ETOPO 2022 15″ via CoastWatch PFEG ERDDAP, **stride 8 → ~0.033°**. That is not native 15″ and not a COG in the pack — it is a hashed PackedGrid in meters. Helm already shows fathoms.
- **Fallbacks:** GEBCO_2020 (same host/stride) and etopo180 (1-minute). Do not download a global GEBCO netCDF.
- **Contours:** 100 fm (183 m) and 200 fm (366 m) marching-squares on the packed plane when that plane is live. Cheap. Fixture contours stay if the grid misses.
- A miss keeps the hashed fixture. Bathymetry is required for Ready; the fixture body still counts.

---

## What “Ready for offshore” means

A boolean on the manifest (`readyForOffshore`) and a stronger check the client must repeat after download and hash verify.

All of the following must be true:

1. **ENC clip present** for the bbox, including Harbor/Approach coverage of the departure (Point Judith, Montauk, or Newport) and Coastal coverage out to the 100-fathom curve in the box.
2. **Bathymetry** present (COG readable).
3. **SST composite** present and not stale (< 24 h). The helm **Accept stale SST** switch (default off, persisted) lets a present, hash-ok composite older than 24 h — including a ~48 h CoralTemp file — pass Ready with a visible warning. When SST age is the only Ready failure, Packs highlights that switch (caution) and names the age; it does not flip the switch. Missing SST (no body) still fails. The Worker manifest does not auto-pass.
4. **Wind GRIB** and **wave GRIB** present, covering `start` … `start+hours`, cycle age ≤ 6 h.
5. **CO-OPS window** present for the departure harbor over the same 72 h.
6. **HMS closed areas** present (even if empty geometry — the layer file exists).
7. **Every required object’s hash verifies** against the manifest.
8. **Hours ≥ 72** unless the skipper is explicitly packing a day-trip inshore box (client UX, not the Worker).

Chlorophyll, altimetry, buoys, and canyon labels make a pack _better_. They do not block Ready. A skipper may still leave without them; the UI should say so in one line, not a modal essay.

A pack that is Ready is still an aid. Official ENC, a lookout, and a float plan are not in R2.

---

## Size and radio reality

For the Point Judith canyon box above, expect roughly:

- ENC clip ~ 20–40 MB
- Bathy + contours ~ 15–25 MB
- SST + chl + SSH ~ 10–20 MB
- 72 h GRIB (wind + wave) ~ 8–15 MB
- JSON (buoys, tides, HMS, canyons) < 1 MB

Total commonly **60–100 MB**. That is a marina-Wi-Fi download, not a sat-phone download. Do it at the dock. The whole design assumes you did.

---

## Failure modes the client must handle

| Symptom             | Meaning                    | Helm behavior                                                           |
| ------------------- | -------------------------- | ----------------------------------------------------------------------- |
| Layer `missing`     | Ingest never wrote the key | Pack cannot be Ready if required                                        |
| Layer `stale`       | Cycle/composite too old    | Weather: not Ready. SST: not Ready unless the skipper accepts stale SST |
| Hash mismatch       | Bytes ≠ manifest           | Delete object, retry once, then fail the pack                           |
| 401 on catch POST   | No bearer token            | Keep the catch local, `synced: false`                                   |
| No network mid-trip | Expected                   | Freeze last buoy snapshot, keep scoring on packed rasters               |

Never block logging a catch on the network. The logbook is user data; it belongs on the boat first.

---

## Production ingest ops (not claimed done)

Public no-key ingest that **does** run when the network allows: NDBC `latest_obs`, CO-OPS predictions + latest water level, NOAA ENC product catalog (cell list, not official S-57), a NOMADS GFS-Wave `atlocn.0p16` f000 subset, a CoastWatch / ERDDAP SST probe, a CoastWatch / ERDDAP chlorophyll probe, a CoastWatch / ERDDAP SSH / SLA probe, an NMFS/NOAA HMS closed-area KMZ / shapefile probe, and a NOAA OCM / MarineCadastre undersea-names canyon-head probe. Hour-0 wind/wave is painted only when the subset parses; that is not a 72 h grid and does not satisfy Ready-for-offshore weather coverage. The paced f000-f072 / 3 h series is implemented and off by default (see above). SST is painted `source: "noaa"` only when a public ERDDAP CSV parses. The path that returned a Point Judith grid inside 48 h here is PFEG `jplMURSST41` subsampled to ~0.05° (stride 5) — not native 1 km MUR / GHRSST. CoralTemp daily last cell can sit past 48 h; the picker skips a parseable grid older than 48 h when a later public grid is in-window. Chlorophyll is painted `source: "noaa"` only when a public ERDDAP CSV parses. The path that returned a Point Judith grid here is CoastWatch S-NPP VIIRS NRT L3 daily 4 km / 0.0375° (`noaacwNPPVIIRSchlaDaily`) — not 1 km VIIRS, not CMEMS L4. `erdVHNchla8day` is North Pacific only and does not cover this box. Chlorophyll does not block Ready. SSH / SLA is painted `source: "noaa"` only when a public ERDDAP CSV parses. The path that returned a Point Judith grid here is CoastWatch blended SLA daily 0.25° / ~25 km (`noaacwBLENDEDsshDaily`) — not CMEMS L4, not AVISO DUACS. PFEG `nesdisSSH1day` is the documented fallback. Altimetry does not block Ready. HMS is painted `source: "noaa"` only when a public NMFS/NOAA closed-area KMZ or shapefile parses and intersects the box. The path that returned a Point Judith polygon here is the Northeastern US pelagic-longline closed area KMZ (`pelagicll_ne.kmz`) — a commercial PLL rectangle, not the monument, not Amendment 15, and not a legal determination. Amendment 15 shapefiles stay documented probes and sit south of this canyon box. HMS Ready only requires the layer file to exist. Canyons are painted `source: "noaa"` only when the MarineCadastre undersea-names GeoJSON parses named heads that intersect the box. The path that returned Point Judith heads here is NOAA OCM `UnderseaFeaturePlaceNames` (Veatch, Atlantis, Hydrographer, Block, Alvin, Hudson). That is heads only — no axes, none invented. GEBCO SCUFN (Hudson + four minor lines; missing the working RI heads) is not a first-success fallback. Canyons do not block Ready. MUR / GOES-16 / extra chl / extra SSH / extra HMS / extra canyon paths stay documented probes; a miss keeps the hashed fixture. Failure falls back to hashed fixtures. Preview `/api/packs` stays deterministic fixtures unless `?live=1`. Worker `buildTripPack({ tryLive: true })` overlays live layers as `source: "noaa"`; it does not enable the series. CMEMS / NDFD / production R2 still do not exist here. `/api/packs` and `/api/objects` serve hashed bodies so the client loop (download → SHA-256 verify → IndexedDB → on-device Ready-for-offshore → paint/score/go-no-go) is real.

Until a scheduled Worker writes R2:

1. Enable the cron in `cloudflare/wrangler.toml` (`15 2,8,14,20 * * *`) after R2 `ahanu-trip-packs` and D1 `ahanu-core` exist.
2. `cloudflare/src/ingest/run.ts` should fetch the URLs in `sources.ts`, clip to the trip bbox, SHA-256 the bytes, `put` to `packs/{packId}/{layerId}/{hash12}.{ext}`.
3. Replace fixture hashes with those body hashes. Do not leave identity hashes in production.
4. The client already verifies whatever digest the manifest carries and **does not trust** `readyForOffshore` on the Worker.

Do not assume those R2 objects exist today.
