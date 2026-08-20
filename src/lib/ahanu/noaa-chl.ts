/**
 * Public no-key chlorophyll ingest via NOAA CoastWatch / ERDDAP.
 * Probe a few documented endpoints for a small Point Judith bbox.
 * First parseable grid wins. Fetch or parse failure keeps the fixture.
 * Do not claim VIIRS 1 km or CMEMS L4 unless that native grid actually arrives.
 * Keep free of `@/` aliases so the Worker can import it.
 */

import { sha256Hex, type PackBBox, type PackedGrid } from "./pack-fixtures";
import { fetchNoaaText, NOAA_GRID_TIMEOUT_MS, type FetchLike } from "./noaa-http";

export const CHL_MAX_BYTES = 2_000_000;

export type { FetchLike };

export interface ChlEndpoint {
  id: string;
  name: string;
  /** ERDDAP griddap base without extension. */
  base: string;
  variable: string;
  nativeDeg: number;
  nativeLabel: string;
  /** Lat/lon stride. >1 is a subsample — report effective resolution. */
  stride: number;
  /** Extra axis after time (CoastWatch L3 uses altitude 0). */
  zSlice?: string;
}

/**
 * Probe order. S-NPP VIIRS NRT daily 4 km is the path that returned a
 * usable Point Judith grid from this network (2026-08-20). NOAA-20 daily
 * and S-NPP weekly SQ are documented fallbacks. PFEG erdVHNchla8day is
 * North Pacific only and does not cover this box.
 */
export const CHL_ENDPOINTS: readonly ChlEndpoint[] = [
  {
    id: "noaacwNPPVIIRSchlaDaily",
    name: "NOAA S-NPP VIIRS NRT L3 daily",
    base: "https://coastwatch.noaa.gov/erddap/griddap/noaacwNPPVIIRSchlaDaily",
    variable: "chlor_a",
    nativeDeg: 0.0375,
    nativeLabel: "4 km / 0.0375°",
    stride: 1,
    zSlice: "0.0",
  },
  {
    id: "noaacwN20VIIRSchlaDaily",
    name: "NOAA-20 VIIRS NRT L3 daily",
    base: "https://coastwatch.noaa.gov/erddap/griddap/noaacwN20VIIRSchlaDaily",
    variable: "chlor_a",
    nativeDeg: 0.0375,
    nativeLabel: "4 km / 0.0375°",
    stride: 1,
    zSlice: "0.0",
  },
  {
    id: "noaacwNPPVIIRSSQchlaWeekly",
    name: "NOAA S-NPP VIIRS SQ L3 weekly",
    base: "https://coastwatch.noaa.gov/erddap/griddap/noaacwNPPVIIRSSQchlaWeekly",
    variable: "chlor_a",
    nativeDeg: 0.0375,
    nativeLabel: "4 km / 0.0375°",
    stride: 1,
    zSlice: "0.0",
  },
];

export interface ChlIngest {
  live: true;
  source: "noaa";
  dataset: string;
  url: string;
  bytes: number;
  sha256: string;
  analysedAt: string;
  nativeLabel: string;
  effectiveDeg: number;
  note: string;
  grid: PackedGrid;
}

export function effectiveChlDeg(ep: ChlEndpoint): number {
  return ep.nativeDeg * Math.max(1, ep.stride);
}

export function chlResolutionNote(ep: ChlEndpoint): string {
  const eff = effectiveChlDeg(ep);
  if (ep.stride > 1) {
    return `${ep.name} subsampled to ~${eff}° (stride ${ep.stride}) — not native ${ep.nativeLabel}, not 1 km VIIRS, not CMEMS L4.`;
  }
  return `${ep.name} ${ep.nativeLabel} — not 1 km VIIRS, not CMEMS L4.`;
}

export function erddapChlCsvUrl(ep: ChlEndpoint, bbox: PackBBox, time = "last"): string {
  const stride = Math.max(1, Math.round(ep.stride));
  const lat = `[(${bbox.south}):${stride}:(${bbox.north})]`;
  const lon = `[(${bbox.west}):${stride}:(${bbox.east})]`;
  const z = ep.zSlice != null ? `[(${ep.zSlice})]` : "";
  return `${ep.base}.csv?${ep.variable}[(${time})]${z}${lat}${lon}`;
}

function num(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const t = raw.trim();
  if (!t || t === "NaN" || t === "NA" || t === "--" || t === "MM") return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  if (n <= -900) return undefined;
  return n;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function uniqSorted(values: number[], desc = false): number[] {
  const u = [...new Set(values.map((v) => r2(v)))];
  u.sort((a, b) => (desc ? b - a : a - b));
  return u;
}

export interface ErddapChlTable {
  time: string;
  lats: number[];
  lons: number[];
  values: number[];
  missing: boolean[];
  units?: string;
}

/** Parse ERDDAP griddap CSV (header, units row, then time[/z]/lat/lon/value). */
export function parseErddapChlCsv(text: string): ErddapChlTable | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 3) return null;
  if (/^<!DOCTYPE|^<html|error/i.test(lines[0]!)) return null;
  const header = lines[0]!.split(",").map((c) => c.trim().replace(/^"|"$/g, "").toLowerCase());
  const units = lines[1]!.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const iTime = header.findIndex((c) => c === "time");
  const iLat = header.findIndex((c) => c === "latitude" || c === "lat");
  const iLon = header.findIndex((c) => c === "longitude" || c === "lon");
  const iVal = header.findIndex(
    (c) => c === "chlor_a" || c === "chla" || c === "chlorophyll" || c.includes("chlor"),
  );
  if (iLat < 0 || iLon < 0 || iVal < 0) return null;
  const lats: number[] = [];
  const lons: number[] = [];
  const values: number[] = [];
  const missing: boolean[] = [];
  let time = "";
  for (const line of lines.slice(2)) {
    const cols = line.split(",");
    const lat = num(cols[iLat]);
    const lon = num(cols[iLon]);
    if (lat == null || lon == null) continue;
    if (iTime >= 0 && !time && cols[iTime]) time = cols[iTime]!.trim().replace(/^"|"$/g, "");
    const v = num(cols[iVal]);
    lats.push(lat);
    lons.push(lon);
    if (v == null) {
      values.push(NaN);
      missing.push(true);
    } else {
      values.push(v);
      missing.push(false);
    }
  }
  if (!lats.length || missing.every(Boolean)) return null;
  return { time, lats, lons, values, missing, units: units[iVal] };
}

export function chlTableToPacked(
  table: ErddapChlTable,
  ep: ChlEndpoint,
  requested?: PackBBox,
): PackedGrid | null {
  const latAxis = uniqSorted(table.lats, true);
  const lonAxis = uniqSorted(table.lons, false);
  if (latAxis.length < 2 || lonAxis.length < 2) return null;
  const ny = latAxis.length;
  const nx = lonAxis.length;
  const latIndex = new Map(latAxis.map((v, i) => [v, i]));
  const lonIndex = new Map(lonAxis.map((v, i) => [v, i]));
  const plane = new Array<number>(nx * ny).fill(Number.NaN);
  const seen = new Array<boolean>(nx * ny).fill(false);
  for (let i = 0; i < table.lats.length; i++) {
    if (table.missing[i]) continue;
    const y = latIndex.get(r2(table.lats[i]!));
    const x = lonIndex.get(r2(table.lons[i]!));
    if (y == null || x == null) continue;
    const v = table.values[i]!;
    if (v < 0 || v > 200) continue;
    plane[y * nx + x] = r3(v);
    seen[y * nx + x] = true;
  }
  const filled = seen.filter(Boolean).length;
  if (filled < nx * ny * 0.5) return null;
  const finite = plane.filter((v) => Number.isFinite(v));
  if (!finite.length) return null;
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  if (hi - lo < 0.02 && finite.length > 8) return null;
  if (lo < 0 || hi > 200) return null;
  const analysedAt = normalizeChlTime(table.time);
  const bbox: PackBBox = {
    west: lonAxis[0]!,
    east: lonAxis[lonAxis.length - 1]!,
    south: latAxis[latAxis.length - 1]!,
    north: latAxis[0]!,
  };
  void requested;
  const note = chlResolutionNote(ep);
  return {
    kind: "grid",
    layer: "chlorophyll",
    bbox,
    nx,
    ny,
    hours: [0],
    hoursCovered: 24,
    unit: "mg_m3",
    values: [plane.map((v) => (Number.isFinite(v) ? v : 0))],
    live: true,
    source: "noaa",
    fixture: false,
    updatedAt: analysedAt,
    note,
  };
}

export function normalizeChlTime(raw: string): string {
  if (!raw) return "";
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) {
    const d = new Date(t.endsWith("Z") ? t : `${t}Z`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/**
 * Probe public chlorophyll endpoints. Never throws. Returns undefined when
 * every path fails so the caller keeps the hashed fixture. Chlorophyll does
 * not block Ready-for-offshore.
 */
export async function fetchLiveChl(options: {
  bbox: PackBBox;
  fetchImpl: FetchLike;
  timeoutMs?: number;
  endpoints?: readonly ChlEndpoint[];
  errors?: string[];
  sleep?: (ms: number) => Promise<void>;
}): Promise<ChlIngest | undefined> {
  const timeoutMs = options.timeoutMs ?? NOAA_GRID_TIMEOUT_MS;
  const errors = options.errors;
  const endpoints = options.endpoints ?? CHL_ENDPOINTS;
  for (const ep of endpoints) {
    const url = erddapChlCsvUrl(ep, options.bbox);
    const text = await fetchNoaaText({
      url,
      fetchImpl: options.fetchImpl,
      timeoutMs,
      maxBytes: CHL_MAX_BYTES,
      sleep: options.sleep,
    });
    if (!text) {
      errors?.push(`chl ${ep.id}: fetch failed`);
      continue;
    }
    const table = parseErddapChlCsv(text);
    if (!table) {
      errors?.push(`chl ${ep.id}: parse failed`);
      continue;
    }
    const grid = chlTableToPacked(table, ep, options.bbox);
    if (!grid || !grid.updatedAt) {
      errors?.push(`chl ${ep.id}: empty or unusable grid`);
      continue;
    }
    const bytes = new TextEncoder().encode(text);
    const hash = await sha256Hex(bytes);
    const note = `${chlResolutionNote(ep)} ${grid.nx}×${grid.ny} at ${grid.updatedAt}.`;
    grid.note = note;
    return {
      live: true,
      source: "noaa",
      dataset: ep.id,
      url,
      bytes: bytes.byteLength,
      sha256: hash,
      analysedAt: grid.updatedAt,
      nativeLabel: ep.nativeLabel,
      effectiveDeg: effectiveChlDeg(ep),
      note,
      grid,
    };
  }
  errors?.push("chl: all public paths failed — fixture kept");
  return undefined;
}

export function sampleChlCsvForTests(): string {
  const rows = [
    "time,altitude,latitude,longitude,chlor_a",
    "UTC,m,degrees_north,degrees_east,mg m^-3",
  ];
  const lats = [39.4, 40.0, 40.6, 41.2];
  const lons = [-72.8, -71.6, -70.4, -69.2];
  for (const lat of lats) {
    for (const lon of lons) {
      const t = 0.18 + (41.2 - lat) * 0.35 + Math.max(0, -70.4 - lon) * 0.08;
      rows.push(`2026-07-09T12:00:00Z,0.0,${lat},${lon},${t.toFixed(3)}`);
    }
  }
  return rows.join("\n") + "\n";
}
