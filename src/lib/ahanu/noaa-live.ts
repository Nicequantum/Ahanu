/**
 * Public NOAA ingest (no secrets): NDBC latest_obs, CO-OPS tides, ENC product
 * catalog, and a small GFS-Wave NOMADS subset. Writes fixture-shaped pack
 * objects. Fetch failure omits that overlay so the caller keeps the hashed
 * fixture. Do not use this for GHRSST / CMEMS / official S-57 paint.
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
  gfsWaveCycleCandidates,
  gfsWaveFilterUrl,
  isGrib2,
  type GfsWaveIngest,
} from "./noaa-gfs";

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

export type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;

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

async function fetchText(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  maxBytes = 16_000_000,
): Promise<string | null> {
  const bytes = await fetchBytes(url, fetchImpl, timeoutMs, maxBytes);
  if (!bytes) return null;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

async function fetchBytes(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > maxBytes) return null;
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export function parseCoopsWaterLevel(json: unknown): { at: string; heightFt: number } | undefined {
  const root = json as { data?: { t?: string; v?: string }[] };
  const row = root?.data?.[0];
  if (!row?.t) return undefined;
  const h = Number(row.v);
  if (!Number.isFinite(h)) return undefined;
  return { at: coopsIso(row.t), heightFt: r1(h) };
}

export function coopsStationsForBox(bbox?: PackBBox): typeof COOPS_HARBOR_STATIONS[number][] {
  return COOPS_HARBOR_STATIONS.filter((st) => st.required || inBbox(st.lat, st.lon, bbox));
}

export interface LiveNoaaResult {
  buoys?: PackedJson;
  tides?: PackedJson;
  enc?: PackedJson;
  gfsWave?: GfsWaveIngest;
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
): Promise<PackedJson | undefined> {
  const ndbcText = await fetchText(NDBC_LATEST_OBS_URL, fetchImpl, timeoutMs);
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
          fetchText(hourlyUrl, fetchImpl, timeoutMs),
          fetchText(hiloUrl, fetchImpl, timeoutMs),
          fetchText(obsUrl, fetchImpl, timeoutMs),
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

async function probeEncTiles(fetchImpl: FetchLike, timeoutMs: number): Promise<EncTileMeta> {
  const tiles: EncTileMeta = {
    template: ENC_DIRECT_TILE_TEMPLATE,
    legal: false,
    probe: "skipped",
  };
  const [tileBuf, mapText] = await Promise.all([
    fetchBytes(ENC_DIRECT_TILE_TEMPLATE.replace("{z}/{x}/{y}", "0/0/0"), fetchImpl, Math.min(timeoutMs, 2500), 64_000),
    fetchText(ENC_ONLINE_MAPSERVER_URL, fetchImpl, timeoutMs, 200_000),
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
): Promise<PackedJson | undefined> {
  const catalogTimeout = Math.max(timeoutMs, 8000);
  const [xml, tiles] = await Promise.all([
    fetchText(ENC_PROD_CAT_URL, fetchImpl, catalogTimeout, 16_000_000),
    probeEncTiles(fetchImpl, timeoutMs),
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
    const zip = await fetchBytes(probe.zipUrl, fetchImpl, timeoutMs, 200_000);
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
): Promise<GfsWaveIngest | undefined> {
  for (const cycle of gfsWaveCycleCandidates(now)) {
    const url = gfsWaveFilterUrl(cycle.ymd, cycle.cc, 0, bbox);
    const bytes = await fetchBytes(url, fetchImpl, timeoutMs, GFS_WAVE_MAX_BYTES);
    if (!bytes) continue;
    if (!isGrib2(bytes)) {
      errors.push(`gfs-wave: ${cycle.ymd}${cycle.cc} not GRIB2`);
      continue;
    }
    const hash = await sha256Hex(bytes);
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
      note: GFS_WAVE_NOTE,
    };
  }
  errors.push("gfs-wave: fetch failed");
  return undefined;
}

/**
 * Fetch public NOAA overlays. Any failure is recorded and that layer is
 * omitted (caller keeps the fixture). Never throws. Does not replace
 * 72 h wind/wave fixture grids with a single GFS-Wave hour.
 */
export async function tryLiveNoaa(options: {
  bbox: PackBBox;
  start: string;
  hours: number;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  skipCache?: boolean;
  now?: Date;
}): Promise<LiveNoaaResult> {
  const timeoutMs = options.timeoutMs ?? 4000;
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

  const [buoys, tides, enc, gfsWave] = await Promise.all([
    liveBuoys(options.bbox, fetchImpl, timeoutMs, errors),
    liveTides(options.bbox, options.start, options.hours, fetchImpl, timeoutMs, errors),
    liveEnc(options.bbox, fetchImpl, timeoutMs, errors),
    liveGfsWave(options.bbox, fetchImpl, timeoutMs, errors, options.now),
  ]);
  if (buoys) out.buoys = buoys;
  if (tides) out.tides = tides;
  if (enc) out.enc = enc;
  if (gfsWave) out.gfsWave = gfsWave;

  liveCache.set(key, { at: Date.now(), value: out });
  return out;
}

export function encodeLiveLayer(body: PackedJson): string {
  return encodeLayerBody(body);
}

export { ENC_PROD_CAT_URL, ENC_DIRECT_TILE_TEMPLATE, parseEncProductCatalog } from "./noaa-enc";
export { gfsWaveFilterUrl, gfsWaveCycleCandidates, isGrib2 } from "./noaa-gfs";
