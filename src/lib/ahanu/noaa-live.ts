/**
 * Public NOAA ingest (no secrets): NDBC latest_obs, CO-OPS tides, ENC product
 * catalog, a small GFS-Wave NOMADS subset, a public CoastWatch/ERDDAP
 * SST probe, a public CoastWatch/ERDDAP chlorophyll probe, a public
 * CoastWatch/ERDDAP SSH / SLA probe, a public NMFS/NOAA HMS closed-area
 * KMZ / shapefile probe, and a public CoastWatch/ERDDAP bathymetry
 * (NCEI ETOPO / GEBCO) probe. Writes fixture-shaped pack objects.
 * Fetch failure omits that overlay so the caller keeps the hashed fixture.
 * Do not invent 1 km MUR / GHRSST, 1 km VIIRS / CMEMS L4, or AVISO DUACS
 * if a coarser public grid is what arrived. Bathymetry is the public
 * relief grid that parsed (ETOPO 2022 subsampled here) — not official ENC.
 * Not CMEMS. Not official S-57.
 *
 * Keep this file free of `@/` aliases so the ahanu-packs Worker can import it.
 */

import { encodeLayerBody, sha256Hex, type PackBBox, type PackedJson } from "./pack-fixtures";
import {
  ENC_DIRECT_TILE_TEMPLATE,
  ENC_ONLINE_MAPSERVER_URL,
  ENC_PROD_CAT_URL,
  encCatalogDateValid,
  encToPackedJson,
  parseEncProductCatalog,
  pickSmallEncZip,
  type EncTileMeta,
} from "./noaa-enc";
import {
  GFS_WAVE_MAX_BYTES,
  GFS_WAVE_NOTE,
  GFS_WAVE_PACE_MS,
  assembleGfsWaveSeries,
  fetchGfsWaveSeries,
  gfsWaveCycleCandidates,
  gfsWaveFilterUrl,
  gfsWaveSeriesEnabled,
  gfsWaveSeriesHours,
  isGrib2,
  type GfsWaveIngest,
  type GfsWaveSeriesGrids,
} from "./noaa-gfs";
import { ncepToPacked, parseNcep } from "./grid-io";
import { fetchLiveSst, type SstIngest } from "./noaa-sst";
import { fetchLiveChl, type ChlIngest } from "./noaa-chl";
import { fetchLiveSsh, type SshIngest } from "./noaa-ssh";
import { fetchLiveHms, type HmsIngest } from "./noaa-hms";
import { fetchLiveBathy, type BathyIngest } from "./noaa-bathy";
import {
  fetchNoaaBytes,
  fetchNoaaText,
  NOAA_GRID_TIMEOUT_MS,
  type FetchLike,
} from "./noaa-http";

export const NDBC_LATEST_OBS_URL = "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt";
export const COOPS_DATAGETTER_URL = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

export const NORTHEAST_NDBC_IDS = [
  "44097",
  "44017",
  "44025",
  "44065",
  "44008",
  "44066",
  "44018",
  "44020",
  "44009",
  "44091",
  "BUZM3",
  "NWPR1",
  "MTKN6",
] as const;

export const COOPS_HARBOR_STATIONS = [
  { id: "8452660", name: "Newport", lat: 41.49, lon: -71.327, required: true },
  { id: "8452944", name: "Quonset Point", lat: 41.586, lon: -71.41, required: true },
  { id: "8510560", name: "Montauk", lat: 41.048, lon: -71.959, required: true },
  { id: "8447930", name: "Woods Hole", lat: 41.5236, lon: -70.6731, required: false },
  { id: "8461490", name: "New London", lat: 41.355, lon: -72.09, required: false },
] as const;

const NDBC_NAMES: Record<string, string> = {
  "44097": "Block Island",
  "44017": "Montauk Point",
  "44025": "Long Island",
  "44065": "NY Harbor Entrance",
  "44008": "Nantucket",
  "44066": "Texas Tower",
  "44018": "SE Cape Cod",
  "44020": "Nantucket Sound",
  "44009": "Delaware Bay",
  "44091": "Barnegat",
  BUZM3: "Buzzards Bay C-MAN",
  NWPR1: "Newport C-MAN",
  MTKN6: "Montauk C-MAN",
};

const MS_TO_KT = 1.943844;
const M_TO_FT = 3.28084;

export type { FetchLike };

export interface PackedBuoyRow {
  id: string;
  name: string;
  lat: number;
  lon: number;
  windKt?: number;
  windDir?: number;
  gustKt?: number;
  waveFt?: number;
  periodS?: number;
  sstC?: number;
  pressureMb?: number;
  updatedAt?: string;
}

export interface PackedTideStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  interval: string;
  datum: string;
  series: { at: string; heightFt: number }[];
  hilo: { at: string; heightFt: number }[];
  observed?: { at: string; heightFt: number };
}

function num(raw: string | undefined): number | undefined {
  if (!raw || raw === "MM" || raw === "NaN") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

function inBbox(lat: number, lon: number, bbox?: PackBBox): boolean {
  if (!bbox) return true;
  return lat >= bbox.south && lat <= bbox.north && lon >= bbox.west && lon <= bbox.east;
}

function keepNdbc(id: string, lat: number, lon: number, bbox?: PackBBox): boolean {
  if ((NORTHEAST_NDBC_IDS as readonly string[]).includes(id)) return true;
  return inBbox(lat, lon, bbox);
}

function yymmddToIso(yy: string, mo: string, dd: string, hh: string, mm: string): string {
  const year = Number(yy) < 70 ? 2000 + Number(yy) : 1900 + Number(yy);
  const pad = (s: string) => s.padStart(2, "0");
  return `${year}-${pad(mo)}-${pad(dd)}T${pad(hh)}:${pad(mm)}:00.000Z`;
}

/** Parse NDBC latest_obs.txt into fixture-shaped buoy rows. */
export function parseNdbcLatestObs(text: string, bbox?: PackBBox): PackedBuoyRow[] {
  const rows: PackedBuoyRow[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const p = line.trim().split(/\s+/);
    if (p.length < 8) continue;
    const id = p[0]!;
    const lat = num(p[1]);
    const lon = num(p[2]);
    if (lat == null || lon == null) continue;
    if (!keepNdbc(id, lat, lon, bbox)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const wspd = num(p[9]);
    const gst = num(p[10]);
    const wvht = num(p[11]);
    const dpd = num(p[12]);
    const pres = num(p[15]);
    const wtmp = num(p[18]);
    const wdir = num(p[8]);
    rows.push({
      id,
      name: NDBC_NAMES[id] ?? id,
      lat,
      lon,
      windKt: wspd != null ? r1(wspd * MS_TO_KT) : undefined,
      windDir: wdir != null ? Math.round(wdir) : undefined,
      gustKt: gst != null ? r1(gst * MS_TO_KT) : undefined,
      waveFt: wvht != null ? r1(wvht * M_TO_FT) : undefined,
      periodS: dpd != null ? r1(dpd) : undefined,
      sstC: wtmp != null ? r1(wtmp) : undefined,
      pressureMb: pres != null ? r1(pres) : undefined,
      updatedAt: yymmddToIso(p[3]!, p[4]!, p[5]!, p[6]!, p[7]!),
    });
  }
  return rows;
}

export function buoysToPackedJson(buoys: PackedBuoyRow[], updatedAt: string): PackedJson {
  return {
    kind: "json",
    layer: "buoys",
    payload: {
      fixture: false,
      live: true,
      source: "ndbc",
      updatedAt,
      staleAfterH: 3,
      buoys,
    },
  };
}

interface CoopsPrediction {
  t: string;
  v: string;
  type?: string;
}

function coopsIso(t: string): string {
  const m = t.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  if (!m) return new Date(t).toISOString();
  return `${m[1]}T${m[2]}:00.000Z`;
}

export function parseCoopsPredictions(json: unknown): { at: string; heightFt: number }[] {
  const root = json as { predictions?: CoopsPrediction[]; error?: unknown };
  if (!root?.predictions || !Array.isArray(root.predictions)) return [];
  const out: { at: string; heightFt: number }[] = [];
  for (const row of root.predictions) {
    const h = Number(row.v);
    if (!Number.isFinite(h) || !row.t) continue;
    out.push({ at: coopsIso(row.t), heightFt: r1(h) });
  }
  return out;
}

export function tidesToPackedJson(
  start: string,
  hours: number,
  stations: PackedTideStation[],
): PackedJson {
  return {
    kind: "json",
    layer: "tides",
    payload: {
      fixture: false,
      live: true,
      source: "coops",
      start,
      hours,
      harbor: "Point Judith / Newport / Montauk",
      stations,
    },
  };
}

function yyyymmdd(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function addHoursIso(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
}

function noaaGet(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  maxBytes: number,
  sleep?: (ms: number) => Promise<void>,
  retries?: number,
) {
  return { url, fetchImpl, timeoutMs, maxBytes, sleep, retries };
}

export function parseCoopsWaterLevel(json: unknown): { at: string; heightFt: number } | undefined {
  const root = json as { data?: { t?: string; v?: string }[] };
  const row = root?.data?.[0];
  if (!row?.t) return undefined;
  const h = Number(row.v);
  if (!Number.isFinite(h)) return undefined;
  return { at: coopsIso(row.t), heightFt: r1(h) };
}

export function coopsStationsForBox(bbox?: PackBBox): (typeof COOPS_HARBOR_STATIONS)[number][] {
  return COOPS_HARBOR_STATIONS.filter((st) => st.required || inBbox(st.lat, st.lon, bbox));
}

export type GfsWaveSeriesFlag =
  | boolean
  | {
      enabled?: boolean;
      hours?: number[];
      paceMs?: number;
      sleep?: (ms: number) => Promise<void>;
      ymd?: string;
      cc?: string;
    };

export interface LiveNoaaResult {
  buoys?: PackedJson;
  tides?: PackedJson;
  enc?: PackedJson;
  gfsWave?: GfsWaveIngest;
  gfsWaveSeries?: GfsWaveSeriesGrids;
  sst?: SstIngest;
  chlorophyll?: ChlIngest;
  altimetry?: SshIngest;
  hms?: HmsIngest;
  bathymetry?: BathyIngest;
  errors: string[];
}

const liveCache = new Map<string, { at: number; value: LiveNoaaResult }>();
const LIVE_TTL_MS = 10 * 60 * 1000;

export function liveCacheKey(bbox: PackBBox, start: string, hours: number): string {
  return `${bbox.west.toFixed(3)}_${bbox.south.toFixed(3)}_${bbox.east.toFixed(3)}_${bbox.north.toFixed(3)}|${start}|${hours}`;
}

export function resetLiveNoaaCache(): void {
  liveCache.clear();
}

async function liveBuoys(
  bbox: PackBBox,
  fetchImpl: FetchLike,
  timeoutMs: number,
  errors: string[],
  sleep?: (ms: number) => Promise<void>,
): Promise<PackedJson | undefined> {
  const ndbcText = await fetchNoaaText(
    noaaGet(NDBC_LATEST_OBS_URL, fetchImpl, timeoutMs, 16_000_000, sleep),
  );
  if (!ndbcText) {
    errors.push("ndbc: fetch failed");
    return undefined;
  }
  const buoys = parseNdbcLatestObs(ndbcText, bbox);
  if (!buoys.length) {
    errors.push("ndbc: no stations in box");
    return undefined;
  }
  const updatedAt = buoys[0]?.updatedAt ?? new Date().toISOString();
  return buoysToPackedJson(buoys, updatedAt);
}

async function liveTides(
  bbox: PackBBox,
  start: string,
  hours: number,
  fetchImpl: FetchLike,
  timeoutMs: number,
  errors: string[],
  sleep?: (ms: number) => Promise<void>,
): Promise<PackedJson | undefined> {
  const begin = yyyymmdd(start);
  const end = yyyymmdd(addHoursIso(start, hours));
  const wanted = coopsStationsForBox(bbox);
  const stations = (
    await Promise.all(
      wanted.map(async (st) => {
        const hourlyUrl =
          `${COOPS_DATAGETTER_URL}?product=predictions&application=Ahanu` +
          `&datum=MLLW&time_zone=gmt&interval=h&units=english&format=json` +
          `&station=${st.id}&begin_date=${begin}&end_date=${end}`;
        const hiloUrl =
          `${COOPS_DATAGETTER_URL}?product=predictions&application=Ahanu` +
          `&datum=MLLW&time_zone=gmt&interval=hilo&units=english&format=json` +
          `&station=${st.id}&begin_date=${begin}&end_date=${end}`;
        const obsUrl =
          `${COOPS_DATAGETTER_URL}?product=water_level&application=Ahanu` +
          `&datum=MLLW&time_zone=gmt&units=english&format=json` +
          `&station=${st.id}&date=latest`;
        const [hourlyText, hiloText, obsText] = await Promise.all([
          fetchNoaaText(noaaGet(hourlyUrl, fetchImpl, timeoutMs, 16_000_000, sleep)),
          fetchNoaaText(noaaGet(hiloUrl, fetchImpl, timeoutMs, 16_000_000, sleep)),
          fetchNoaaText(noaaGet(obsUrl, fetchImpl, timeoutMs, 16_000_000, sleep)),
        ]);
        if (!hourlyText) {
          errors.push(`coops ${st.id}: hourly fetch failed`);
          return null;
        }
        let hourlyJson: unknown;
        try {
          hourlyJson = JSON.parse(hourlyText);
        } catch {
          errors.push(`coops ${st.id}: bad json`);
          return null;
        }
        const series = parseCoopsPredictions(hourlyJson);
        if (!series.length) {
          errors.push(`coops ${st.id}: empty predictions`);
          return null;
        }
        let hilo: { at: string; heightFt: number }[] = series.filter((_, i) => i % 6 === 0);
        if (hiloText) {
          try {
            const parsed = parseCoopsPredictions(JSON.parse(hiloText));
            if (parsed.length) hilo = parsed;
          } catch {
            /* keep sampled hilo */
          }
        }
        let observed: { at: string; heightFt: number } | undefined;
        if (obsText) {
          try {
            observed = parseCoopsWaterLevel(JSON.parse(obsText));
          } catch {
            /* skip obs */
          }
        }
        const row: PackedTideStation = {
          id: st.id,
          name: st.name,
          lat: st.lat,
          lon: st.lon,
          interval: "h",
          datum: "MLLW",
          series,
          hilo,
          observed,
        };
        return row;
      }),
    )
  ).filter((s): s is PackedTideStation => s != null);
  if (!stations.length) return undefined;
  return tidesToPackedJson(start, hours, stations);
}

async function probeEncTiles(
  fetchImpl: FetchLike,
  timeoutMs: number,
  sleep?: (ms: number) => Promise<void>,
): Promise<EncTileMeta> {
  const tiles: EncTileMeta = {
    template: ENC_DIRECT_TILE_TEMPLATE,
    legal: false,
    probe: "skipped",
  };
  const [tileBuf, mapText] = await Promise.all([
    fetchNoaaBytes(
      noaaGet(
        ENC_DIRECT_TILE_TEMPLATE.replace("{z}/{x}/{y}", "0/0/0"),
        fetchImpl,
        Math.min(timeoutMs, 2500),
        64_000,
        sleep,
        0,
      ),
    ),
    fetchNoaaText(noaaGet(ENC_ONLINE_MAPSERVER_URL, fetchImpl, timeoutMs, 200_000, sleep)),
  ]);
  if (tileBuf && tileBuf.byteLength > 8) tiles.probe = "ok";
  else tiles.probe = "tls-failed";
  if (mapText) {
    try {
      const js = JSON.parse(mapText) as { mapName?: string };
      tiles.mapServer = { url: ENC_ONLINE_MAPSERVER_URL, fetched: true, mapName: js.mapName };
    } catch {
      tiles.mapServer = { url: ENC_ONLINE_MAPSERVER_URL, fetched: false };
    }
  } else {
    tiles.mapServer = { url: ENC_ONLINE_MAPSERVER_URL, fetched: false };
  }
  return tiles;
}

async function liveEnc(
  bbox: PackBBox,
  fetchImpl: FetchLike,
  timeoutMs: number,
  errors: string[],
  sleep?: (ms: number) => Promise<void>,
): Promise<PackedJson | undefined> {
  const catalogTimeout = Math.max(timeoutMs, 8000);
  const [xml, tiles] = await Promise.all([
    fetchNoaaText(noaaGet(ENC_PROD_CAT_URL, fetchImpl, catalogTimeout, 16_000_000, sleep)),
    probeEncTiles(fetchImpl, timeoutMs, sleep),
  ]);
  if (!xml) {
    errors.push("enc: catalog fetch failed");
    return undefined;
  }
  const cells = parseEncProductCatalog(xml, bbox);
  if (!cells.length) {
    errors.push("enc: no active cells in box");
    return undefined;
  }
  const probe = pickSmallEncZip(cells);
  if (probe?.zipUrl && (probe.zipBytes ?? 0) <= 80_000) {
    const zip = await fetchNoaaBytes(noaaGet(probe.zipUrl, fetchImpl, timeoutMs, 200_000, sleep));
    if (zip && zip.byteLength > 4) {
      probe.zipSha256 = await sha256Hex(zip);
      probe.zipBytes = zip.byteLength;
    } else {
      errors.push(`enc: ${probe.id} zip probe failed`);
    }
  }
  return encToPackedJson(bbox, cells, {
    catalogUrl: ENC_PROD_CAT_URL,
    catalogDate: encCatalogDateValid(xml),
    tiles,
  });
}

async function liveGfsWave(
  bbox: PackBBox,
  fetchImpl: FetchLike,
  timeoutMs: number,
  errors: string[],
  now = new Date(),
  sleep?: (ms: number) => Promise<void>,
): Promise<GfsWaveIngest | undefined> {
  for (const cycle of gfsWaveCycleCandidates(now)) {
    const url = gfsWaveFilterUrl(cycle.ymd, cycle.cc, 0, bbox);
    const bytes = await fetchNoaaBytes(
      noaaGet(url, fetchImpl, Math.max(timeoutMs, NOAA_GRID_TIMEOUT_MS), GFS_WAVE_MAX_BYTES, sleep),
    );
    if (!bytes) continue;
    if (!isGrib2(bytes)) {
      errors.push(`gfs-wave: ${cycle.ymd}${cycle.cc} not GRIB2`);
      continue;
    }
    const hash = await sha256Hex(bytes);
    const parsed = parseNcep(bytes);
    const packed = ncepToPacked(parsed);
    const hasField = Boolean(packed.windKt || packed.waveFt);
    return {
      live: true,
      source: "nomads-gfswave",
      grid: "atlocn.0p16",
      forecastHour: 0,
      cycle: `${cycle.ymd}${cycle.cc}`,
      url,
      bytes: bytes.byteLength,
      sha256: hash,
      contentType: "application/wmo-grib",
      note: hasField
        ? "NCEP Atlantic 0p16 f000 parsed — hour-0 wind/wave only, not a 72 h grid."
        : GFS_WAVE_NOTE,
      parsed: hasField ? packed : undefined,
      parseError: hasField ? undefined : (parsed.error ?? "no wind/wave fields"),
    };
  }
  errors.push("gfs-wave: fetch failed");
  return undefined;
}

function seriesFlag(raw: GfsWaveSeriesFlag | undefined): {
  enabled: boolean;
  hours?: number[];
  paceMs?: number;
  sleep?: (ms: number) => Promise<void>;
  ymd?: string;
  cc?: string;
} {
  if (raw === true) return { enabled: true };
  if (raw === false || raw == null) return { enabled: false };
  return {
    enabled: gfsWaveSeriesEnabled(raw.enabled),
    hours: raw.hours,
    paceMs: raw.paceMs,
    sleep: raw.sleep,
    ymd: raw.ymd,
    cc: raw.cc,
  };
}

async function liveGfsWaveSeries(
  bbox: PackBBox,
  fetchImpl: FetchLike,
  timeoutMs: number,
  errors: string[],
  series: ReturnType<typeof seriesFlag>,
  now = new Date(),
): Promise<{ ingest?: GfsWaveIngest; series?: GfsWaveSeriesGrids }> {
  const hours = series.hours ?? gfsWaveSeriesHours();
  const cycles =
    series.ymd && series.cc ? [{ ymd: series.ymd, cc: series.cc }] : gfsWaveCycleCandidates(now);
  const pacedFetch: FetchLike = async (input, init) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetchImpl(input, { signal: init?.signal ?? ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  };
  for (const cycle of cycles) {
    const files = await fetchGfsWaveSeries({
      bbox,
      ymd: cycle.ymd,
      cc: cycle.cc,
      hours,
      fetchImpl: pacedFetch,
      paceMs: series.paceMs ?? GFS_WAVE_PACE_MS,
      enabled: true,
      sleep: series.sleep,
    });
    if (!files.length) continue;
    const assembled = assembleGfsWaveSeries(files, hours);
    const f000 = files.find((f) => f.hour === 0) ?? files[0];
    let ingest: GfsWaveIngest | undefined;
    if (f000) {
      const hash = await sha256Hex(f000.bytes);
      const painted = Boolean(assembled.windKt || assembled.waveFt);
      ingest = {
        live: true,
        source: "nomads-gfswave",
        grid: "atlocn.0p16",
        forecastHour: f000.hour,
        cycle: `${cycle.ymd}${cycle.cc}`,
        url: f000.url,
        bytes: files.reduce((n, f) => n + f.bytes.byteLength, 0),
        sha256: hash,
        contentType: "application/wmo-grib",
        note:
          assembled.complete && assembled.hoursCovered >= 72
            ? "NCEP Atlantic 0p16 f000–f072 / 3 h parsed."
            : `NCEP Atlantic 0p16 series hours ${assembled.fetchedHours.join(",")} — hoursCovered ${assembled.hoursCovered}, not 72 h ready.`,
        parsed: painted ? { windKt: assembled.windKt, waveFt: assembled.waveFt } : undefined,
        parseError: painted ? undefined : "no wind/wave fields",
      };
    }
    return { ingest, series: assembled };
  }
  errors.push("gfs-wave-series: fetch failed");
  return {};
}

/**
 * Fetch public NOAA overlays. Any failure is recorded and that layer is
 * omitted (caller keeps the fixture). Never throws. Does not replace
 * 72 h wind/wave fixture grids with a single hour unless that hour parses.
 */
export async function tryLiveNoaa(options: {
  bbox: PackBBox;
  start: string;
  hours: number;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  skipCache?: boolean;
  now?: Date;
  gfsWaveSeries?: GfsWaveSeriesFlag;
  sleep?: (ms: number) => Promise<void>;
}): Promise<LiveNoaaResult> {
  const timeoutMs = options.timeoutMs ?? NOAA_GRID_TIMEOUT_MS;
  const sleep = options.sleep;
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  const key = liveCacheKey(options.bbox, options.start, options.hours);
  if (!options.skipCache) {
    const hit = liveCache.get(key);
    if (hit && Date.now() - hit.at < LIVE_TTL_MS) return hit.value;
  }
  const errors: string[] = [];
  const out: LiveNoaaResult = { errors };
  if (typeof fetchImpl !== "function") {
    errors.push("fetch unavailable");
    liveCache.set(key, { at: Date.now(), value: out });
    return out;
  }

  const series = seriesFlag(options.gfsWaveSeries);
  const gridTimeout = Math.max(timeoutMs, NOAA_GRID_TIMEOUT_MS);
  const gfsJob = series.enabled
    ? liveGfsWaveSeries(
        options.bbox,
        fetchImpl,
        Math.max(timeoutMs, 8000),
        errors,
        series,
        options.now,
      )
    : liveGfsWave(options.bbox, fetchImpl, gridTimeout, errors, options.now, sleep).then(
        (ingest) => ({
          ingest,
        }),
      );
  const [buoys, tides, enc, gfs, sst, chl, ssh, hms, bathy] = await Promise.all([
    liveBuoys(options.bbox, fetchImpl, timeoutMs, errors, sleep),
    liveTides(options.bbox, options.start, options.hours, fetchImpl, timeoutMs, errors, sleep),
    liveEnc(options.bbox, fetchImpl, timeoutMs, errors, sleep),
    gfsJob,
    fetchLiveSst({
      bbox: options.bbox,
      fetchImpl,
      timeoutMs: gridTimeout,
      errors,
      sleep,
    }),
    fetchLiveChl({
      bbox: options.bbox,
      fetchImpl,
      timeoutMs: gridTimeout,
      errors,
      sleep,
    }),
    fetchLiveSsh({
      bbox: options.bbox,
      fetchImpl,
      timeoutMs: gridTimeout,
      errors,
      sleep,
    }),
    fetchLiveHms({
      bbox: options.bbox,
      fetchImpl,
      timeoutMs: gridTimeout,
      errors,
      sleep,
    }),
    fetchLiveBathy({
      bbox: options.bbox,
      fetchImpl,
      timeoutMs: gridTimeout,
      errors,
      sleep,
    }),
  ]);
  if (buoys) out.buoys = buoys;
  if (tides) out.tides = tides;
  if (enc) out.enc = enc;
  if (sst) out.sst = sst;
  if (chl) out.chlorophyll = chl;
  if (ssh) out.altimetry = ssh;
  if (hms) out.hms = hms;
  if (bathy) out.bathymetry = bathy;
  if ("series" in gfs && gfs.series && gfs.series.fetchedHours.length) {
    out.gfsWaveSeries = gfs.series;
    if (gfs.ingest) out.gfsWave = gfs.ingest;
  } else if (gfs.ingest) {
    out.gfsWave = gfs.ingest;
  } else if (series.enabled) {
    const hour0 = await liveGfsWave(
      options.bbox,
      fetchImpl,
      gridTimeout,
      errors,
      options.now,
      sleep,
    );
    if (hour0) out.gfsWave = hour0;
  }

  liveCache.set(key, { at: Date.now(), value: out });
  return out;
}

export function encodeLiveLayer(body: PackedJson): string {
  return encodeLayerBody(body);
}

export {
  fetchNoaaBytes,
  fetchNoaaText,
  NOAA_GRID_TIMEOUT_MS,
  NOAA_QUICK_TIMEOUT_MS,
  NOAA_RETRY_BACKOFF_MS,
  noaaStatusRetryable,
  isNoaaAbortError,
} from "./noaa-http";
export { ENC_PROD_CAT_URL, ENC_DIRECT_TILE_TEMPLATE, parseEncProductCatalog } from "./noaa-enc";
export {
  gfsWaveFilterUrl,
  gfsWaveCycleCandidates,
  isGrib2,
  fetchGfsWaveSeries,
  assembleGfsWaveSeries,
  gfsWaveSeriesEnabled,
  gfsWaveSeriesHours,
} from "./noaa-gfs";
export {
  SST_ENDPOINTS,
  erddapSstCsvUrl,
  parseErddapSstCsv,
  sstTableToPacked,
  fetchLiveSst,
  sampleCsvForTests,
} from "./noaa-sst";
export {
  CHL_ENDPOINTS,
  erddapChlCsvUrl,
  parseErddapChlCsv,
  chlTableToPacked,
  fetchLiveChl,
  sampleChlCsvForTests,
} from "./noaa-chl";
export {
  SSH_ENDPOINTS,
  erddapSshCsvUrl,
  parseErddapSshCsv,
  sshTableToPacked,
  fetchLiveSsh,
  sampleSshCsvForTests,
} from "./noaa-ssh";
export {
  HMS_ENDPOINTS,
  HMS_REMINDER_NOTE,
  parseKmlPolygons,
  clipHmsFeatures,
  featureIntersectsBbox,
  featuresFromZip,
  hmsToPackedJson,
  fetchLiveHms,
  sampleHmsKmlForTests,
  sampleHmsKmzForTests,
} from "./noaa-hms";
export {
  BATHY_ENDPOINTS,
  BATHY_AID_NOTE,
  erddapBathyCsvUrl,
  parseErddapBathyCsv,
  bathyTableToPacked,
  contoursFromDepthGrid,
  fetchLiveBathy,
  sampleBathyCsvForTests,
} from "./noaa-bathy";
