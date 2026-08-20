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

export type IngestCadence =
  | "static"
  | "hourly"
  | "6-hourly"
  | "tidal"
  | "daily"
  | "weekly";

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

function meta(partial: Omit<IngestMeta, "stub" | "defaultBbox"> & { defaultBbox?: IngestMeta["defaultBbox"] }): IngestMeta {
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
      { label: "ENC Online MapServer", url: "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer" },
      { label: "S-100 / S-101 product page", url: "https://marinenavigation.noaa.gov/s100.html" },
      { label: "ENC rescheme / S-101 status", url: "https://distribution.charts.noaa.gov/ENC/rescheme/" },
      { label: "ENC Direct raster tiles", url: "https://tileservice.charts.noaa.gov/tiles/encdirect/{z}/{x}/{y}.png" },
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
      "Write a Cloud-Optimized GeoTIFF clipped to the trip bbox, plus a 1-byte quantized PNG for the plotter. Composite age >24 h is stale; >48 h is missing for Ready-for-offshore. The no-key live path that returned bytes from this network is CoastWatch CoralTemp daily 5 km (noaacrwsstDaily), not 1 km MUR. MUR / GOES-16 stay documented probes; do not invent GHRSST if they fail.",
  });
}

/**
 * Copernicus Marine chlorophyll-a (ocean colour, L4 gap-filled).
 *
 * Edges in color (not the raw µg/L field) are what canyon captains read.
 * Edge detection itself is on-device; the Worker only packs the L4 grid.
 *
 *   Product:  OCEANCOLOUR_GLO_BGC_L4_NRT_009_102
 *   Dataset:  cmems_obs-oc_glo_bgc-plankton_nrt_l4-gapfree-multi-4km_P1D
 *   Portal:   https://data.marine.copernicus.eu/product/OCEANCOLOUR_GLO_BGC_L4_NRT_009_102
 *   Fallback NOAA VIIRS: https://coastwatch.pfeg.noaa.gov/erddap/griddap/erdVHNchla8day
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
        label: "NOAA VIIRS chl-a 8-day (fallback)",
        url: "https://coastwatch.pfeg.noaa.gov/erddap/griddap/erdVHNchla8day",
      },
    ],
    notes:
      "4 km L4 is enough for a canyon-scale color edge. Clip, COG, and keep the last 8 days so the device can fade stale colour.",
  });
}

/**
 * Sea-surface height anomaly / altimetry (mesoscale).
 *
 * Captains use SSH to see the eddy / filament field that SST alone can hide
 * under a blank sky. L4 gridded NRT, not along-track.
 *
 *   CMEMS L4:   SEALEVEL_GLO_PHY_L4_NRT_008_046
 *               https://data.marine.copernicus.eu/product/SEALEVEL_GLO_PHY_L4_NRT_008_046
 *   NOAA SSH:   https://coastwatch.pfeg.noaa.gov/erddap/griddap/nesdisSSH1day
 *   AVISO:      https://www.aviso.altimetry.fr/
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
        label: "CMEMS SEALEVEL L4 NRT",
        url: "https://data.marine.copernicus.eu/product/SEALEVEL_GLO_PHY_L4_NRT_008_046",
      },
      {
        label: "NOAA NESDIS SSH 1-day (ERDDAP)",
        url: "https://coastwatch.pfeg.noaa.gov/erddap/griddap/nesdisSSH1day",
      },
      { label: "AVISO altimetry", url: "https://www.aviso.altimetry.fr/" },
    ],
    notes:
      "Pack SLA + geostrophic UV if present. 0.25° is acceptable; do not interpolate on the Worker — the device renderer handles it.",
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
      { label: "Latest observations", url: "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt" },
      { label: "Realtime stdmet", url: "https://www.ndbc.noaa.gov/data/realtime2/" },
      { label: "Measurement descriptions", url: "https://www.ndbc.noaa.gov/faq/measdes.shtml" },
      { label: "Block Island 44097", url: "https://www.ndbc.noaa.gov/station_page.php?station=44097" },
      { label: "Texas Tower 44066", url: "https://www.ndbc.noaa.gov/station_page.php?station=44066" },
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
 *   Monument:           https://www.fisheries.noaa.gov/new-england-mid-atlantic/habitat-conservation/northeast-canyons-and-seamounts-marine-national-monument
 *   GARFO GIS:          https://www.fisheries.noaa.gov/new-england-mid-atlantic/science-data/maps-and-geographic-information-systems-data-program-new-england-mid-atlantic
 *
 * Adapter honesty: store a static GeoJSON in R2 (`static/hms_zones/northeast.geojson`)
 * and copy it into each pack. Refresh when NMFS publishes a new shapefile.
 * An empty FeatureCollection is still a present layer (Ready-for-offshore
 * requires the object to exist, not that it contain closures).
 */
export function hmsClosedAreas(): IngestMeta {
  return meta({
    id: "hms-closed-areas",
    name: "HMS closed areas (static GeoJSON)",
    provider: "NOAA Fisheries / HMS",
    kind: "vector",
    cadence: "static",
    license: "US Government work (public domain) — NOAA Fisheries; overlay is not legal advice",
    layerIds: ["hms_zones"],
    endpoints: [
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
      "Static GeoJSON. Do not treat PLL closures as recreational no-go, and do not scrape in-season HMS News into the pack. Skipper verifies current NMFS/HMS rules before leaving the dock. Refresh on NMFS shapefile publish, not on a cron.",
  });
}

export const ADAPTERS = {
  noaaEnc,
  waveWatchIii,
  ndfd,
  ghrsstCoastwatchSst,
  copernicusChlorophyll,
  altimetry,
  coOpsTides,
  ndbc,
  hmsClosedAreas,
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
