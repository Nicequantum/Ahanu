/**
 * Public NOAA ingest (no secrets): NDBC latest_obs and CO-OPS tides.
 * Writes fixture-shaped pack objects. Fetch failure returns null so the
 * caller can keep the hashed fixture. Do not use this for ENC / GHRSST / CMEMS.
 *
 * Keep this file free of `@/` aliases so the ahanu-packs Worker can import it.
 */

import { encodeLayerBody, type PackBBox, type PackedJson } from "./pack-fixtures";

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
  { id: "8452660", name: "Newport", lat: 41.49, lon: -71.327 },
  { id: "8452944", name: "Quonset Point", lat: 41.586, lon: -71.41 },
  { id: "8510560", name: "Montauk", lat: 41.048, lon: -71.959 },
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
): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export interface LiveNoaaResult {
  buoys?: PackedJson;
  tides?: PackedJson;
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

/**
 * Fetch NDBC + CO-OPS. Any failure is recorded and that layer is omitted
 * (caller keeps the fixture). Never throws.
 */
export async function tryLiveNoaa(options: {
  bbox: PackBBox;
  start: string;
  hours: number;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  skipCache?: boolean;
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

  const ndbcText = await fetchText(NDBC_LATEST_OBS_URL, fetchImpl, timeoutMs);
  if (ndbcText) {
    const buoys = parseNdbcLatestObs(ndbcText, options.bbox);
    if (buoys.length) {
      const updatedAt = buoys[0]?.updatedAt ?? new Date().toISOString();
      out.buoys = buoysToPackedJson(buoys, updatedAt);
    } else {
      errors.push("ndbc: no stations in box");
    }
  } else {
    errors.push("ndbc: fetch failed");
  }

  const begin = yyyymmdd(options.start);
  const end = yyyymmdd(addHoursIso(options.start, options.hours));
  const stations: PackedTideStation[] = [];
  for (const st of COOPS_HARBOR_STATIONS) {
    const hourlyUrl =
      `${COOPS_DATAGETTER_URL}?product=predictions&application=Ahanu` +
      `&datum=MLLW&time_zone=gmt&interval=h&units=english&format=json` +
      `&station=${st.id}&begin_date=${begin}&end_date=${end}`;
    const hiloUrl =
      `${COOPS_DATAGETTER_URL}?product=predictions&application=Ahanu` +
      `&datum=MLLW&time_zone=gmt&interval=hilo&units=english&format=json` +
      `&station=${st.id}&begin_date=${begin}&end_date=${end}`;
    const hourlyText = await fetchText(hourlyUrl, fetchImpl, timeoutMs);
    if (!hourlyText) {
      errors.push(`coops ${st.id}: hourly fetch failed`);
      continue;
    }
    let hourlyJson: unknown;
    try {
      hourlyJson = JSON.parse(hourlyText);
    } catch {
      errors.push(`coops ${st.id}: bad json`);
      continue;
    }
    const series = parseCoopsPredictions(hourlyJson);
    if (!series.length) {
      errors.push(`coops ${st.id}: empty predictions`);
      continue;
    }
    let hilo: { at: string; heightFt: number }[] = series.filter((_, i) => i % 6 === 0);
    const hiloText = await fetchText(hiloUrl, fetchImpl, timeoutMs);
    if (hiloText) {
      try {
        const parsed = parseCoopsPredictions(JSON.parse(hiloText));
        if (parsed.length) hilo = parsed;
      } catch {
        /* keep sampled hilo */
      }
    }
    stations.push({
      id: st.id,
      name: st.name,
      lat: st.lat,
      lon: st.lon,
      interval: "h",
      datum: "MLLW",
      series,
      hilo,
    });
  }
  if (stations.length) {
    out.tides = tidesToPackedJson(options.start, options.hours, stations);
  }

  liveCache.set(key, { at: Date.now(), value: out });
  return out;
}

export function encodeLiveLayer(body: PackedJson): string {
  return encodeLayerBody(body);
}
