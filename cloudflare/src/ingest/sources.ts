/**
 * Ingest adapters for the Ahanu data plane.
 *
 * Locked sources (Northeast canyon pack):
 *   1. NOAA ENC (S-57 / S-101) Northeast clip
 *   2. NOAA GFS-Wave / WAVEWATCH III GRIB
 *   3. NDFD oceanic
 *   4. GHRSST / NOAA CoastWatch SST
 *   5. Copernicus chlorophyll
 *   6. Altimetry / SSH anomaly
 *   7. CO-OPS tides
 *   8. NDBC buoys
 *   9. HMS closed areas (static GeoJSON)
 *
 * Each function returns metadata only — no bytes are fetched here. A later
 * cron Worker (or `wrangler` scheduled handler) will call the documented
 * endpoints, clip to a trip bbox, write objects into R2 (`ahanu-trip-packs`),
 * and record hashes in D1 (`ahanu-core`).
 *
 * Workers package bytes. They never run habitat scoring, solunar, or
 * temperature-break detection — those stay on the device (see src/lib/ahanu).
 */

export type IngestKind = "vector" | "raster" | "grib2" | "tabular" | "json" | "s57";

export type IngestCadence = "static" | "hourly" | "6-hourly" | "tidal" | "daily" | "weekly";

export interface IngestEndpoint {
  label: string;
  /** Real public URL. Comments next to each adapter explain usage. */
  url: string;
}

export interface IngestMeta {
  id: string;
  name: string;
  provider: string;
  kind: IngestKind;
  cadence: IngestCadence;
  license: string;
  layerIds: string[];
  endpoints: IngestEndpoint[];
  notes: string;
  /** Typical Northeast clip used when a captain does not pass a bbox. */
  defaultBbox: { west: number; south: number; east: number; north: number };
  stub: true;
}

const NORTHEAST = { west: -75.4, south: 36.4, east: -66.4, north: 42.6 } as const;

function meta(
  partial: Omit<IngestMeta, "stub" | "defaultBbox"> & { defaultBbox?: IngestMeta["defaultBbox"] },
): IngestMeta {
  return { stub: true, defaultBbox: NORTHEAST, ...partial };
}

/**
 * NOAA Electronic Navigational Charts (ENC) — S-57 cells today, S-101 dual
 * production as NOAA issues the same Northeast cells under the IHO S-100
 * framework. The pack is a clip, not the US catalog.
 *
 * Harbor / Approach (usage 5 / 4) around Point Judith, Newport, and Montauk,
 * plus Coastal (usage 3) out to the 100-fathom curve covering Hudson, Veatch,
 * Atlantis, and Hydrographer. Official ENC remains the legal chart; Ahanu is
 * an aid to navigation.
 *
 *   Product catalog:  https://charts.noaa.gov/ENCs/ENCProdCat.xml
 *   Cell zips (S-57): https://charts.noaa.gov/ENCs/{CELL}.zip   e.g. US5RI10M.zip
 *   Chart downloader: https://charts.noaa.gov/ENCs/ENCs.shtml
 *   Chart Locator:    https://www.charts.noaa.gov/InteractiveCatalog/nrnc.shtml
 *   ENC Online REST:  https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer
 *   S-100 / S-101:    https://marinenavigation.noaa.gov/s100.html
 *   Rescheme status:  https://distribution.charts.noaa.gov/ENC/rescheme/
 *   Raster tiles (aid only, not a substitute for ENC):
 *                     https://tileservice.charts.noaa.gov/tiles/encdirect/{z}/{x}/{y}.png
 *
 * Adapter honesty: ingest S-57 zips now. When NOAA dual-issues S-101 for the
 * same RI/NY/MA cells, store both encodings under the same layer id (`enc`)
 * and let the client pick. Do not wait on S-101 to ship a pack.
 */
export function noaaEnc(): IngestMeta {
  return meta({
    id: "noaa-enc",
    name: "NOAA Electronic Navigational Charts (S-57 / S-101)",
    provider: "NOAA Office of Coast Survey",
    kind: "s57",
    cadence: "weekly",
    license: "US Government work (public domain) — NOAA ENC",
    layerIds: ["bathymetry", "contours", "canyons"],
    endpoints: [
      { label: "ENC product catalog (XML)", url: "https://charts.noaa.gov/ENCs/ENCProdCat.xml" },
      { label: "ENC cell distribution (S-57)", url: "https://charts.noaa.gov/ENCs/" },
      { label: "Chart downloader", url: "https://charts.noaa.gov/ENCs/ENCs.shtml" },
      {
        label: "ENC Online MapServer",
        url: "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer",
      },
      { label: "S-100 / S-101 product page", url: "https://marinenavigation.noaa.gov/s100.html" },
      {
        label: "ENC rescheme / S-101 status",
        url: "https://distribution.charts.noaa.gov/ENC/rescheme/",
      },
      {
        label: "ENC Direct raster tiles",
        url: "https://tileservice.charts.noaa.gov/tiles/encdirect/{z}/{x}/{y}.png",
      },
    ],
    notes:
      "Clip to usage bands 4–5 (Approach/Harbor) around Point Judith / Montauk / Newport plus band 3 (Coastal) out to the 100-fathom curve. S-57 is the operational encoding; S-101 is ingested in parallel as NOAA dual-issues the same cells. Re-issue weekly or on NOAA NtM.",
  });
}

/**
 * NOAA WaveWatch III / GFS-Wave (gridded GRIB2).
 *
 * Atlantic regional grid is the right pack for a 72 h canyon run. Global 0p25
 * is fallback when the ATL grid is late.
 *
 *   GFS-Wave NOMADS filter:
 *     https://nomads.ncep.noaa.gov/cgi-bin/filter_gfswave.pl
 *   ATL regional 0p16:
 *     https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/gfs.{YYYYMMDD}/{CC}/wave/gridded/gfswave.t{CC}z.atlocn.0p16.f{HHH}.grib2
 *   Global 0p25:
 *     .../gfswave.t{CC}z.global.0p25.f{HHH}.grib2
 *   Model home: https://polar.ncep.noaa.gov/waves/wavewatch/
 *
 * Variables packed: HTGS (Hs), PERPW (primary period), DIRPW, WIND, WDIR, SWELL.
 */
export function waveWatchIii(): IngestMeta {
  return meta({
    id: "ncep-gfswave",
    name: "NCEP GFS-Wave / WAVEWATCH III",
    provider: "NOAA NCEP",
    kind: "grib2",
    cadence: "6-hourly",
    license: "US Government work (public domain) — NCEP",
    layerIds: ["waves", "wind"],
    endpoints: [
      {
        label: "GFS-Wave OpenDAP/filter",
        url: "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfswave.pl",
      },
      {
        label: "GFS-Wave product directory",
        url: "https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/",
      },
      {
        label: "WAVEWATCH III home",
        url: "https://polar.ncep.noaa.gov/waves/wavewatch/",
      },
    ],
    notes:
      "Subset lon 75.4W–66.4W, lat 36.4N–42.6N, forecast hours 0–72 step 3. Prefer atlocn.0p16; fall back to global.0p25. Cycle lags of >6 h mark the layer stale.",
  });
}

/**
 * National Digital Forecast Database — oceanic domain.
 *
 * CONUS NDFD dies near the beach. Hudson / Veatch / Atlantis sit on the
 * oceanic grid (`AR.oceanic`), which is the NWS official digital forecast
 * over the EEZ. Used for coastal and offshore wind, gust, vis. Not a
 * substitute for the GFS-Wave sea-state field (Hs lives there).
 *
 *   Oceanic GRIB2: https://tgftp.nws.noaa.gov/SL.us008001/ST.opnl/DF.gr2/DC.ndfd/AR.oceanic/
 *   Home:          https://www.weather.gov/mdl/ndfd_home
 *   Digital:       https://digital.weather.gov/
 *   GRIB2 filter:  https://nomads.ncep.noaa.gov/cgi-bin/filter_ndfd.pl
 *   XML/SOAP:      https://graphical.weather.gov/xml/SOAP_server/ndfdXMLclient.php
 *   NWS API:       https://api.weather.gov
 *
 * Oceanic tiles: ds.wspd.bin, ds.wgust.bin, ds.wdir.bin, ds.waveh.bin,
 * ds.vsby.bin. Wave height on NDFD oceanic is a forecast element, not WW3 Hs.
 */
export function ndfd(): IngestMeta {
  return meta({
    id: "nws-ndfd",
    name: "National Digital Forecast Database (oceanic)",
    provider: "NOAA NWS / MDL",
    kind: "grib2",
    cadence: "hourly",
    license: "US Government work (public domain) — NWS",
    layerIds: ["wind"],
    endpoints: [
      {
        label: "NDFD oceanic GRIB2 (AR.oceanic)",
        url: "https://tgftp.nws.noaa.gov/SL.us008001/ST.opnl/DF.gr2/DC.ndfd/AR.oceanic/",
      },
      { label: "NDFD home", url: "https://www.weather.gov/mdl/ndfd_home" },
      { label: "Digital forecast map", url: "https://digital.weather.gov/" },
      { label: "NOMADS NDFD filter", url: "https://nomads.ncep.noaa.gov/cgi-bin/filter_ndfd.pl" },
      {
        label: "NDFD XML client",
        url: "https://graphical.weather.gov/xml/SOAP_server/ndfdXMLclient.php",
      },
      { label: "NWS API", url: "https://api.weather.gov" },
    ],
    notes:
      "Pull the oceanic domain, not CONUS — the canyon box is offshore of the CONUS tile. Wind / gust / dir for the RI/NY/MA EEZ. Align the forecast axis with the GFS-Wave cycle so the 72 h go/no-go strip is internally consistent. NDFD wave height does not replace GFS-Wave Hs.",
  });
}

/**
 * GHRSST / NOAA CoastWatch sea-surface temperature.
 *
 * MUR L4 (1 km, nightly) is the planning composite. GOES-East L3 is the
 * same-day gap-fill when the night pass is cloudy. CoastWatch East Coast
 * ERDDAP is the operational subsetter for the canyon box.
 *
 *   MUR L4 ERDDAP:    https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41
 *   GeoPolar blend:   https://coastwatch.noaa.gov/cwn/products/noaa-geopolar-blended-sst-analysis.html
 *   GOES-16 SST:      https://coastwatch.noaa.gov/erddap/griddap/noaacwGEOHIRRSSTGoes16NRT.html
 *   East Coast CW:    https://eastcoast.coastwatch.noaa.gov/erddap/
 *   GHRSST project:   https://www.ghrsst.org/
 *   PO.DAAD MUR:      https://podaac.jpl.nasa.gov/dataset/MUR-JPL-L4-GLOB-v4.1
 *
 * Device-side scoring reads the SST grid; this adapter never computes breaks.
 */
export function ghrsstCoastwatchSst(): IngestMeta {
  return meta({
    id: "ghrsst-coastwatch-sst",
    name: "GHRSST / CoastWatch SST",
    provider: "NOAA CoastWatch / JPL PO.DAAC",
    kind: "raster",
    cadence: "daily",
    license: "GHRSST / NOAA / NASA — redistribution per dataset ToS",
    layerIds: ["sst"],
    endpoints: [
      {
        label: "MUR L4 1 km (ERDDAP)",
        url: "https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41",
      },
      {
        label: "GOES-16 SST (ERDDAP)",
        url: "https://coastwatch.noaa.gov/erddap/griddap/noaacwGEOHIRRSSTGoes16NRT.html",
      },
      {
        label: "East Coast CoastWatch ERDDAP",
        url: "https://eastcoast.coastwatch.noaa.gov/erddap/",
      },
      {
        label: "GeoPolar blended SST",
        url: "https://coastwatch.noaa.gov/cwn/products/noaa-geopolar-blended-sst-analysis.html",
      },
    ],
    notes:
      "Write a Cloud-Optimized GeoTIFF clipped to the trip bbox, plus a 1-byte quantized PNG for the plotter. Composite age >24 h is stale; >48 h is missing for Ready-for-offshore. The no-key live path that returned a Point Judith grid inside 48 h here is PFEG jplMURSST41 subsampled to ~0.05° (stride 5) — not native 1 km. CoralTemp daily last cell can sit past 48 h; GOES-16 id is a documented 404 here. Do not invent GHRSST if a probe fails.",
  });
}

/**
 * Copernicus Marine chlorophyll-a (ocean colour, L4 gap-filled) — documented
 * production target. CMEMS needs a licence and is not fetched here.
 *
 * Edges in color (not the raw µg/L field) are what canyon captains read.
 * Edge detection itself is on-device; the Worker only packs the L4 grid.
 *
 *   Product:  OCEANCOLOUR_GLO_BGC_L4_NRT_009_102
 *   Dataset:  cmems_obs-oc_glo_bgc-plankton_nrt_l4-gapfree-multi-4km_P1D
 *   Portal:   https://data.marine.copernicus.eu/product/OCEANCOLOUR_GLO_BGC_L4_NRT_009_102
 *   Live no-key path (2026-08-20): PFEG Aqua MODIS L3SMI 8-day NRT 4 km
 *     https://coastwatch.pfeg.noaa.gov/erddap/griddap/erdMH1chla8day_R2022NRT
 *   Fallbacks: noaacwNPPVIIRSchlaDaily, noaacwN20VIIRSchlaDaily, noaacwNPPVIIRSSQchlaWeekly
 *   PFEG erdVHNchla8day is North Pacific only — it does not cover Point Judith.
 */
export function copernicusChlorophyll(): IngestMeta {
  return meta({
    id: "cmems-chl",
    name: "Copernicus chlorophyll-a L4",
    provider: "Copernicus Marine Service",
    kind: "raster",
    cadence: "daily",
    license: "Copernicus Marine Service licence (attribution required)",
    layerIds: ["chlorophyll"],
    endpoints: [
      {
        label: "CMEMS ocean colour L4 NRT",
        url: "https://data.marine.copernicus.eu/product/OCEANCOLOUR_GLO_BGC_L4_NRT_009_102",
      },
      {
        label: "CMEMS catalogue",
        url: "https://data.marine.copernicus.eu/",
      },
      {
        label: "PFEG Aqua MODIS 8-day NRT 4 km (no-key live)",
        url: "https://coastwatch.pfeg.noaa.gov/erddap/griddap/erdMH1chla8day_R2022NRT",
      },
      {
        label: "CoastWatch S-NPP VIIRS NRT daily 4 km",
        url: "https://coastwatch.noaa.gov/erddap/griddap/noaacwNPPVIIRSchlaDaily",
      },
      {
        label: "CoastWatch NOAA-20 VIIRS NRT daily 4 km",
        url: "https://coastwatch.noaa.gov/erddap/griddap/noaacwN20VIIRSchlaDaily",
      },
      {
        label: "PFEG VIIRS 8-day (North Pacific only — not PJ)",
        url: "https://coastwatch.pfeg.noaa.gov/erddap/griddap/erdVHNchla8day",
      },
    ],
    notes:
      "CMEMS L4 is the licensed production target and is not fetched here. The no-key live path that returned a still-updating Point Judith grid is PFEG Aqua MODIS L3SMI 8-day NRT 4 km / 0.0417° (erdMH1chla8day_R2022NRT) — not 1 km VIIRS, not CMEMS. CoastWatch VIIRS L3 dailies stay as fallbacks. PFEG erdVHNchla8day does not cover the Northeast. Miss keeps the hashed fixture. Chlorophyll does not block Ready.",
  });
}

/**
 * Sea-surface height anomaly / altimetry (mesoscale).
 *
 * Captains use SSH to see the eddy / filament field that SST alone can hide
 * under a blank sky. L4 gridded NRT, not along-track.
 *
 *   CMEMS L4:   SEALEVEL_GLO_PHY_L4_NRT_008_046 (licensed, not fetched)
 *               https://data.marine.copernicus.eu/product/SEALEVEL_GLO_PHY_L4_NRT_008_046
 *   Live no-key path (2026-08-20): CoastWatch blended SLA daily 0.25°
 *     https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsshDaily
 *   Fallback:   https://coastwatch.pfeg.noaa.gov/erddap/griddap/nesdisSSH1day
 *   AVISO:      documented only — not fetched. Do not invent DUACS.
 *   CCAR viewer (reference, not ingest): https://ccar.colorado.edu/altimetry
 */
export function altimetry(): IngestMeta {
  return meta({
    id: "altimetry-ssh",
    name: "Sea-level anomaly (altimetry L4)",
    provider: "Copernicus Marine / NOAA NESDIS",
    kind: "raster",
    cadence: "daily",
    license: "CMEMS / NOAA — redistribution per dataset ToS",
    layerIds: ["altimetry"],
    endpoints: [
      {
        label: "CMEMS SEALEVEL L4 NRT (licensed, not fetched)",
        url: "https://data.marine.copernicus.eu/product/SEALEVEL_GLO_PHY_L4_NRT_008_046",
      },
      {
        label: "CoastWatch blended SLA daily 0.25° (no-key live)",
        url: "https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsshDaily",
      },
      {
        label: "NOAA NESDIS SSH 1-day (PFEG ERDDAP)",
        url: "https://coastwatch.pfeg.noaa.gov/erddap/griddap/nesdisSSH1day",
      },
      {
        label: "AVISO altimetry (documented only — not fetched)",
        url: "https://www.aviso.altimetry.fr/",
      },
    ],
    notes:
      "CMEMS L4 / AVISO DUACS are licensed production targets and are not fetched here. The no-key live path that returned a Point Judith grid is CoastWatch blended SLA daily 0.25° / ~25 km (noaacwBLENDEDsshDaily) — not CMEMS, not AVISO. PFEG nesdisSSH1day is the documented fallback (same RADS family; time here lagged). Miss keeps the hashed fixture. Altimetry does not block Ready. Pack SLA in cm. Do not interpolate on the Worker.",
  });
}

/**
 * NOAA CO-OPS tides and tidal currents.
 *
 * Departure and return windows at Point Judith / Newport / Montauk are
 * packed as harmonic predictions plus a 72 h residual if water-level obs
 * are available. Currents at The Race and Block Island Sound matter for
 * the steam out.
 *
 *   API:      https://api.tidesandcurrents.noaa.gov/api/prod/
 *   Getter:   https://api.tidesandcurrents.noaa.gov/api/prod/datagetter
 *   Stations: 8452660 Newport, 8452944 Quonset Point, 8510560 Montauk,
 *             8447930 Woods Hole, 8461490 New London, 8449130 Nantucket.
 *   Currents:  https://api.tidesandcurrents.noaa.gov/api/prod/ (product=currents_predictions)
 */
export function coOpsTides(): IngestMeta {
  return meta({
    id: "coops-tides",
    name: "CO-OPS tides & currents",
    provider: "NOAA CO-OPS",
    kind: "json",
    cadence: "tidal",
    license: "US Government work (public domain) — CO-OPS",
    layerIds: [],
    endpoints: [
      { label: "CO-OPS API v3", url: "https://api.tidesandcurrents.noaa.gov/api/prod/" },
      {
        label: "datagetter",
        url: "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter",
      },
      {
        label: "Newport (8452660) predictions",
        url: "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=8452660&product=predictions&datum=MLLW&units=english&time_zone=gmt&interval=hilo&format=json",
      },
      {
        label: "Montauk (8510560) predictions",
        url: "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=8510560&product=predictions&datum=MLLW&units=english&time_zone=gmt&interval=hilo&format=json",
      },
    ],
    notes:
      "Pack 72 h of hi/lo + hourly height for the departure harbor and the nearest sound station. Interval=hilo plus interval=h. Datum MLLW.",
  });
}

/**
 * NDBC real-time buoys and C-MAN stations.
 *
 * Snapshot JSON is what `/api/buoys` serves. The ingest adapter is the
 * upstream text feed the snapshot is built from.
 *
 *   Latest obs table: https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt
 *   Realtime stdmet:  https://www.ndbc.noaa.gov/data/realtime2/{STATION}.txt
 *   Specs:            https://www.ndbc.noaa.gov/faq/measdes.shtml
 *   Station page:     https://www.ndbc.noaa.gov/station_page.php?station={STATION}
 *
 * Northeast pack stations: 44097 Block Island, 44017 Montauk, 44025 Long
 * Island, 44065 NY Harbor Entrance, 44008 Nantucket, 44066 Texas Tower /
 * Hudson Canyon, 44018 SE Cape Cod, 44020 Nantucket Sound, 44009 Delaware
 * Bay, 44091 Barnegat; C-MAN BUZM3, NWPR1, MTKN6.
 */
export function ndbc(): IngestMeta {
  return meta({
    id: "ndbc",
    name: "NDBC real-time buoys",
    provider: "NOAA NDBC",
    kind: "tabular",
    cadence: "hourly",
    license: "US Government work (public domain) — NDBC",
    layerIds: ["buoys"],
    endpoints: [
      {
        label: "Latest observations",
        url: "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt",
      },
      { label: "Realtime stdmet", url: "https://www.ndbc.noaa.gov/data/realtime2/" },
      { label: "Measurement descriptions", url: "https://www.ndbc.noaa.gov/faq/measdes.shtml" },
      {
        label: "Block Island 44097",
        url: "https://www.ndbc.noaa.gov/station_page.php?station=44097",
      },
      {
        label: "Texas Tower 44066",
        url: "https://www.ndbc.noaa.gov/station_page.php?station=44066",
      },
    ],
    notes:
      "Parse latest_obs.txt, keep stations inside the trip bbox + the offshore canyon buoys even if they sit just outside a tight inshore clip. Observations older than 3 h are stale.",
  });
}

/**
 * HMS closed areas — static GeoJSON snapshot.
 *
 * Packed as a reminder overlay, not a legal determination. Recreational
 * trolling / rod-and-reel is generally not bound by commercial pelagic
 * longline (PLL) closures; the Northeast Canyons and Seamounts Marine
 * National Monument and any all-permit HMS action still apply. In-season
 * closures are not live-scraped into the pack.
 *
 * Source polygons (simplified, educational):
 *   - Canyon Unit of the NE Canyons & Seamounts Monument
 *   - Illustrative HMS PLL closed-area awareness box on the Hudson/canyon
 *     approaches (not survey-grade CFR coordinates)
 *
 *   HMS home:           https://www.fisheries.noaa.gov/topic/atlantic-highly-migratory-species
 *   Compliance guides:  https://www.fisheries.noaa.gov/atlantic-highly-migratory-species/atlantic-hms-fishery-compliance-guides
 *   Amd. 15 shapefiles: https://www.fisheries.noaa.gov/resource/map/highly-migratory-species-amendment-15-area-shapefiles-and-maps
 *   NE PLL KMZ (live):  https://www.fisheries.noaa.gov/s3/2020-04/pelagicll_ne.kmz
 *   NE PLL S3:          https://s3.amazonaws.com/media.fisheries.noaa.gov/2020-04/pelagicll_ne.kmz
 *   A15 shapefile zip:  https://s3.amazonaws.com/media.fisheries.noaa.gov/2024-05/HMS-A15-Shapefiles.zip
 *   Monument:           https://www.fisheries.noaa.gov/new-england-mid-atlantic/habitat-conservation/northeast-canyons-and-seamounts-marine-national-monument
 *   GARFO GIS:          https://www.fisheries.noaa.gov/new-england-mid-atlantic/science-data/maps-and-geographic-information-systems-data-program-new-england-mid-atlantic
 *
 * Adapter honesty: tryLive fetches the NE PLL KMZ (and A15 zip as fallback).
 * First parseable file that intersects the trip bbox paints `hms_zones` as
 * source: "noaa". A miss keeps the hashed fixture. Refresh when NMFS
 * publishes a new shapefile. An empty FeatureCollection is still a present
 * layer (Ready-for-offshore requires the object to exist, not that it
 * contain closures). Never a legal determination.
 */
export function hmsClosedAreas(): IngestMeta {
  return meta({
    id: "hms-closed-areas",
    name: "HMS closed areas (NMFS KMZ / shapefile)",
    provider: "NOAA Fisheries / HMS",
    kind: "vector",
    cadence: "static",
    license: "US Government work (public domain) — NOAA Fisheries; overlay is not legal advice",
    layerIds: ["hms_zones"],
    endpoints: [
      {
        label: "Northeastern US PLL closed area (KMZ, no-key live)",
        url: "https://www.fisheries.noaa.gov/s3/2020-04/pelagicll_ne.kmz",
      },
      {
        label: "Northeastern US PLL closed area (S3 KMZ)",
        url: "https://s3.amazonaws.com/media.fisheries.noaa.gov/2020-04/pelagicll_ne.kmz",
      },
      {
        label: "HMS Amendment 15 shapefiles (S3 zip)",
        url: "https://s3.amazonaws.com/media.fisheries.noaa.gov/2024-05/HMS-A15-Shapefiles.zip",
      },
      {
        label: "Atlantic HMS home",
        url: "https://www.fisheries.noaa.gov/topic/atlantic-highly-migratory-species",
      },
      {
        label: "HMS fishery compliance guides",
        url: "https://www.fisheries.noaa.gov/atlantic-highly-migratory-species/atlantic-hms-fishery-compliance-guides",
      },
      {
        label: "HMS Amendment 15 area shapefiles",
        url: "https://www.fisheries.noaa.gov/resource/map/highly-migratory-species-amendment-15-area-shapefiles-and-maps",
      },
      {
        label: "NE Canyons & Seamounts Monument",
        url: "https://www.fisheries.noaa.gov/new-england-mid-atlantic/habitat-conservation/northeast-canyons-and-seamounts-marine-national-monument",
      },
      {
        label: "GARFO GIS data program",
        url: "https://www.fisheries.noaa.gov/new-england-mid-atlantic/science-data/maps-and-geographic-information-systems-data-program-new-england-mid-atlantic",
      },
    ],
    notes:
      "Live no-key path that returned a Point Judith polygon is the Northeastern US pelagic-longline closed area KMZ (pelagicll_ne.kmz, 50 CFR 622.274 / same rectangle as HMS 635.21). Amendment 15 shapefiles (Mid-Atlantic shark / Charleston Bump / East Florida / DeSoto) sit south of this canyon box. Miss keeps the hashed fixture. Reminder overlay — not a legal determination. Do not treat PLL closures as recreational no-go, and do not scrape in-season HMS News into the pack. Skipper verifies current NMFS/HMS rules before leaving the dock.",
  });
}

/**
 * NOAA NCEI / GEBCO relief for canyon-wall paint.
 *
 * Production target is a clipped Cloud-Optimized GeoTIFF of the trip box.
 * The no-key live path (2026-08-20) is CoastWatch PFEG ERDDAP:
 *   ETOPO_2022_v1_15s  (NCEI DEM, 15″ native, stride 8 → ~0.033°)
 *   GEBCO_2020         (same host / stride)
 *   etopo180           (1-minute fallback)
 * Do not download a global GEBCO netCDF into the repo. Official ENC
 * remains the legal chart.
 *
 *   ETOPO 2022: https://www.ncei.noaa.gov/products/etopo-global-relief-model
 *   ERDDAP:     https://coastwatch.pfeg.noaa.gov/erddap/griddap/ETOPO_2022_v1_15s
 *   GEBCO:      https://coastwatch.pfeg.noaa.gov/erddap/griddap/GEBCO_2020
 */
export function nceiBathymetry(): IngestMeta {
  return meta({
    id: "ncei-bathymetry",
    name: "NOAA NCEI / GEBCO bathymetry",
    provider: "NOAA NCEI / GEBCO via CoastWatch ERDDAP",
    kind: "raster",
    cadence: "static",
    license: "US Government work / GEBCO — not for navigation",
    layerIds: ["bathymetry", "contours"],
    endpoints: [
      {
        label: "NCEI ETOPO 2022 15″ (PFEG ERDDAP, no-key live)",
        url: "https://coastwatch.pfeg.noaa.gov/erddap/griddap/ETOPO_2022_v1_15s",
      },
      {
        label: "GEBCO_2020 15″ (PFEG ERDDAP)",
        url: "https://coastwatch.pfeg.noaa.gov/erddap/griddap/GEBCO_2020",
      },
      {
        label: "ETOPO 1-minute (etopo180)",
        url: "https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180",
      },
      {
        label: "NCEI ETOPO product page",
        url: "https://www.ncei.noaa.gov/products/etopo-global-relief-model",
      },
    ],
    notes:
      "The no-key live path that returned a Point Judith canyon grid is NCEI ETOPO 2022 15″ subsampled to ~0.033° (stride 8) via CoastWatch PFEG ERDDAP — not native 15″, not official ENC. GEBCO_2020 and etopo180 stay in the probe list. Miss keeps the hashed fixture. Bathymetry is required for Ready (fixture still counts). Cheap 100/200-fm contours are derived from the packed grid. Do not fetch a global GEBCO netCDF.",
  });
}


/**
 * NOAA OCM / MarineCadastre named canyon heads.
 *
 * Live no-key path (2026-08-20) is the Undersea Feature Place Names
 * MapServer GeoJSON query. Heads only — GNS / ACUF names hosted by NOAA.
 * Do not invent axes. GEBCO SCUFN is incomplete for this box (Hudson plus
 * four minor lines; no Veatch / Atlantis / Hydrographer / Block / Alvin).
 *
 *   Query: https://coast.noaa.gov/arcgis/rest/services/MarineCadastre/UnderseaFeaturePlaceNames/MapServer/0/query
 *   InPort: https://www.fisheries.noaa.gov/inport/item/48929
 */
export function marineCadastreCanyons(): IngestMeta {
  return meta({
    id: "noaa-canyons",
    name: "NOAA MarineCadastre canyon heads",
    provider: "NOAA OCM / MarineCadastre (GNS / ACUF names)",
    kind: "vector",
    cadence: "static",
    license: "US Government work (public domain) — NOAA OCM; names from GNS / ACUF",
    layerIds: ["canyons"],
    endpoints: [
      {
        label: "MarineCadastre undersea feature place names (MapServer query)",
        url: "https://coast.noaa.gov/arcgis/rest/services/MarineCadastre/UnderseaFeaturePlaceNames/MapServer/0/query",
      },
      {
        label: "InPort Undersea Feature Place Names",
        url: "https://www.fisheries.noaa.gov/inport/item/48929",
      },
    ],
    notes:
      "The no-key live path that returned Point Judith named heads is MarineCadastre UnderseaFeaturePlaceNames GeoJSON (Veatch, Atlantis, Hydrographer, Block, Alvin, Hudson). Heads only — no invented axes. GEBCO SCUFN stays documented as incomplete for this box. Miss keeps the hashed fixture. Canyons do not block Ready.",
  });
}

export const ADAPTERS = {
  noaaEnc,
  nceiBathymetry,
  waveWatchIii,
  ndfd,
  ghrsstCoastwatchSst,
  copernicusChlorophyll,
  altimetry,
  coOpsTides,
  ndbc,
  hmsClosedAreas,
  marineCadastreCanyons,
} as const;

export function listIngestSources(): IngestMeta[] {
  return Object.values(ADAPTERS).map((fn) => fn());
}

/**
 * Which adapters a trip pack actually needs. Static ENC + HMS GeoJSON +
 * 72 h weather + daily ocean color. Scoring inputs (SST, chl, SSH) are
 * packed as rasters; derived habitat is not.
 */
export function ingestPlanForPack(hours = 72): IngestMeta[] {
  const all = listIngestSources();
  if (hours <= 0) return all.filter((s) => s.cadence === "static" || s.cadence === "weekly");
  return all;
}
