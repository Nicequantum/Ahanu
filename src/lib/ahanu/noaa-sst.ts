/**
 * Public no-key SST ingest via NOAA CoastWatch / ERDDAP.
 * Probe a few documented endpoints for a small Point Judith bbox.
 * First parseable grid wins. Fetch or parse failure keeps the fixture.
 * Do not claim 1 km MUR / GHRSST unless that native grid actually arrives.
 * Keep free of `@/` aliases so the Worker can import it.
 */

import { sha256Hex, type PackBBox, type PackedGrid } from "./pack-fixtures";

export const SST_MAX_BYTES = 2_000_000;

export type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface SstEndpoint {
  id: string;
  name: string;
  /** ERDDAP griddap base without extension. */
  base: string;
  variable: string;
  nativeDeg: number;
  nativeLabel: string;
  /** Lat/lon stride. >1 is a subsample — report effective resolution. */
  stride: number;
}

/**
 * Probe order. CoralTemp 5 km is the path that returned bytes from this
 * network (2026-08-20). MUR / GOES-16 are documented fallbacks.
 */
export const SST_ENDPOINTS: readonly SstEndpoint[] = [
  {
    id: "noaacrwsstDaily",
    name: "NOAA Coral Reef Watch CoralTemp daily",
    base: "https://coastwatch.noaa.gov/erddap/griddap/noaacrwsstDaily",
    variable: "analysed_sst",
    nativeDeg: 0.05,
    nativeLabel: "5 km / 0.05°",
    stride: 1,
  },
  {
    id: "jplMURSST41",
    name: "JPL MUR L4 (ERDDAP)",
    base: "https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41",
    variable: "analysed_sst",
    nativeDeg: 0.01,
    nativeLabel: "1 km / 0.01°",
    stride: 5,
  },
  {
    id: "noaacwGEOHIRRSSTGoes16NRT",
    name: "GOES-16 SST (ERDDAP)",
    base: "https://coastwatch.noaa.gov/erddap/griddap/noaacwGEOHIRRSSTGoes16NRT",
    variable: "analysed_sst",
    nativeDeg: 0.02,
    nativeLabel: "GOES-16 L3",
    stride: 4,
  },
];

export interface SstIngest {
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

export function effectiveSstDeg(ep: SstEndpoint): number {
  return ep.nativeDeg * Math.max(1, ep.stride);
}

export function sstResolutionNote(ep: SstEndpoint): string {
  const eff = effectiveSstDeg(ep);
  if (ep.stride > 1) {
    return `${ep.name} subsampled to ~${eff}° (stride ${ep.stride}) — not native ${ep.nativeLabel}.`;
  }
  return `${ep.name} ${ep.nativeLabel} — not 1 km MUR / GHRSST L4.`;
}

export function erddapSstCsvUrl(ep: SstEndpoint, bbox: PackBBox, time = "last"): string {
  const stride = Math.max(1, Math.round(ep.stride));
  const lat = `[(${bbox.south}):${stride}:(${bbox.north})]`;
  const lon = `[(${bbox.west}):${stride}:(${bbox.east})]`;
  return `${ep.base}.csv?${ep.variable}[(${time})]${lat}${lon}`;
}

function num(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const t = raw.trim();
  if (!t || t === "NaN" || t === "NA" || t === "--" || t === "MM") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function uniqSorted(values: number[], desc = false): number[] {
  const u = [...new Set(values.map((v) => r2(v)))];
  u.sort((a, b) => (desc ? b - a : a - b));
  return u;
}

function looksKelvin(units: string | undefined, sample: number[]): boolean {
  if (units && /kelvin|degree_k\b|degk|deg_k/i.test(units)) return true;
  if (units && /degree_c|degc|celsius|deg_c/i.test(units)) return false;
  const finite = sample.filter((v) => Number.isFinite(v));
  if (finite.length < 3) return false;
  const mid = [...finite].sort((a, b) => a - b)[Math.floor(finite.length / 2)]!;
  return mid > 200;
}

export interface ErddapSstTable {
  time: string;
  lats: number[];
  lons: number[];
  values: number[];
  missing: boolean[];
  units?: string;
}

/** Parse ERDDAP griddap CSV (header, units row, then time/lat/lon/value). */
export function parseErddapSstCsv(text: string): ErddapSstTable | null {
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
    (c) => c.includes("sst") || c === "temperature" || c === "analysed_sst",
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
  const finite = values.filter((_, i) => !missing[i]);
  if (looksKelvin(units[iVal], finite)) {
    for (let i = 0; i < values.length; i++) {
      if (!missing[i]) values[i] = values[i]! - 273.15;
    }
  }
  return { time, lats, lons, values, missing, units: units[iVal] };
}

export function sstTableToPacked(
  table: ErddapSstTable,
  ep: SstEndpoint,
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
    plane[y * nx + x] = r2(table.values[i]!);
    seen[y * nx + x] = true;
  }
  const filled = seen.filter(Boolean).length;
  if (filled < nx * ny * 0.5) return null;
  const finite = plane.filter((v) => Number.isFinite(v));
  if (!finite.length) return null;
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  if (hi - lo < 0.05 && finite.length > 8) return null;
  if (lo < -5 || hi > 40) return null;
  const analysedAt = normalizeSstTime(table.time);
  const bbox: PackBBox = {
    west: lonAxis[0]!,
    east: lonAxis[lonAxis.length - 1]!,
    south: latAxis[latAxis.length - 1]!,
    north: latAxis[0]!,
  };
  void requested;
  const note = sstResolutionNote(ep);
  return {
    kind: "grid",
    layer: "sst",
    bbox,
    nx,
    ny,
    hours: [0],
    hoursCovered: 24,
    unit: "degC",
    values: [plane.map((v) => (Number.isFinite(v) ? v : 0))],
    live: true,
    source: "noaa",
    fixture: false,
    updatedAt: analysedAt,
    note,
  };
}

export function normalizeSstTime(raw: string): string {
  if (!raw) return "";
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) {
    const d = new Date(t.endsWith("Z") ? t : `${t}Z`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

async function fetchText(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  maxBytes: number,
): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > maxBytes) return null;
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Probe public SST endpoints. Never throws. Returns undefined when every
 * path fails so the caller keeps the hashed fixture.
 */
export async function fetchLiveSst(options: {
  bbox: PackBBox;
  fetchImpl: FetchLike;
  timeoutMs?: number;
  endpoints?: readonly SstEndpoint[];
  errors?: string[];
}): Promise<SstIngest | undefined> {
  const timeoutMs = options.timeoutMs ?? 4000;
  const errors = options.errors;
  const endpoints = options.endpoints ?? SST_ENDPOINTS;
  for (const ep of endpoints) {
    const url = erddapSstCsvUrl(ep, options.bbox);
    const text = await fetchText(url, options.fetchImpl, timeoutMs, SST_MAX_BYTES);
    if (!text) {
      errors?.push(`sst ${ep.id}: fetch failed`);
      continue;
    }
    const table = parseErddapSstCsv(text);
    if (!table) {
      errors?.push(`sst ${ep.id}: parse failed`);
      continue;
    }
    const grid = sstTableToPacked(table, ep, options.bbox);
    if (!grid || !grid.updatedAt) {
      errors?.push(`sst ${ep.id}: empty or unusable grid`);
      continue;
    }
    const bytes = new TextEncoder().encode(text);
    const hash = await sha256Hex(bytes);
    const note = `${sstResolutionNote(ep)} ${grid.nx}×${grid.ny} at ${grid.updatedAt}.`;
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
      effectiveDeg: effectiveSstDeg(ep),
      note,
      grid,
    };
  }
  errors?.push("sst: all public paths failed — fixture kept");
  return undefined;
}

export function sampleCsvForTests(): string {
  const rows = ["time,latitude,longitude,analysed_sst", "UTC,degrees_north,degrees_east,degree_C"];
  const lats = [39.4, 40.0, 40.6, 41.2];
  const lons = [-72.8, -71.6, -70.4, -69.2];
  for (const lat of lats) {
    for (const lon of lons) {
      const t = 22.4 - (lat - 39.6) * 0.8 + (lon + 70.6) * 0.1;
      rows.push(`2026-08-18T12:00:00Z,${lat},${lon},${t.toFixed(2)}`);
    }
  }
  return rows.join("\n") + "\n";
}
