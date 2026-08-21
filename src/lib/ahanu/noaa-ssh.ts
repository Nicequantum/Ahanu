/**
 * Public no-key SSH / SLA ingest via NOAA CoastWatch / ERDDAP.
 * Probe a few documented endpoints for a small Point Judith bbox.
 * First parseable grid wins. Fetch or parse failure keeps the fixture.
 * Do not claim CMEMS L4 or AVISO DUACS unless that native grid actually arrives.
 * Keep free of `@/` aliases so the Worker can import it.
 */

import { sha256Hex, type PackBBox, type PackedGrid } from "./pack-fixtures";
import { fetchNoaaText, NOAA_GRID_TIMEOUT_MS, type FetchLike } from "./noaa-http";

export const SSH_MAX_BYTES = 2_000_000;

export type { FetchLike };

export interface SshEndpoint {
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
 * Probe order. CoastWatch blended daily 0.25° is the path that returned a
 * current Point Judith grid from this network (2026-08-20, analysis 2026-08-19).
 * PFEG nesdisSSH1day is the same RADS family on a second host (last time
 * here was 2026-03-25). CMEMS / AVISO are not fetched.
 */
export const SSH_ENDPOINTS: readonly SshEndpoint[] = [
  {
    id: "noaacwBLENDEDsshDaily",
    name: "NOAA CoastWatch blended SLA daily",
    base: "https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsshDaily",
    variable: "sla",
    nativeDeg: 0.25,
    nativeLabel: "0.25° / ~25 km",
    stride: 1,
  },
  {
    id: "nesdisSSH1day",
    name: "NOAA NESDIS RADS SSH 1-day (PFEG)",
    base: "https://coastwatch.pfeg.noaa.gov/erddap/griddap/nesdisSSH1day",
    variable: "sla",
    nativeDeg: 0.25,
    nativeLabel: "0.25° / ~25 km",
    stride: 1,
  },
];

export interface SshIngest {
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

export function effectiveSshDeg(ep: SshEndpoint): number {
  return ep.nativeDeg * Math.max(1, ep.stride);
}

export function sshResolutionNote(ep: SshEndpoint): string {
  const eff = effectiveSshDeg(ep);
  if (ep.stride > 1) {
    return `${ep.name} subsampled to ~${eff}° (stride ${ep.stride}) — not native ${ep.nativeLabel}, not CMEMS L4, not AVISO DUACS.`;
  }
  return `${ep.name} ${ep.nativeLabel} — not CMEMS L4, not AVISO DUACS.`;
}

export function erddapSshCsvUrl(ep: SshEndpoint, bbox: PackBBox, time = "last"): string {
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
  if (!Number.isFinite(n)) return undefined;
  // CoastWatch blended SLA fill is -3.2767 m.
  if (Math.abs(n - -3.2767) < 1e-4) return undefined;
  if (n <= -900) return undefined;
  return n;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function uniqSorted(values: number[], desc = false): number[] {
  const u = [...new Set(values.map((v) => r2(v)))];
  u.sort((a, b) => (desc ? b - a : a - b));
  return u;
}

function looksMeters(units: string | undefined, sample: number[]): boolean {
  if (units && /\bcm\b|centimet/i.test(units)) return false;
  if (units && /(?:^|[^a-z])m(?:$|[^a-z])/i.test(units) && !/mm\b/i.test(units)) return true;
  const finite = sample.filter((v) => Number.isFinite(v));
  if (finite.length < 3) return false;
  const mid = [...finite].sort((a, b) => a - b)[Math.floor(finite.length / 2)]!;
  return Math.abs(mid) < 3;
}

export interface ErddapSshTable {
  time: string;
  lats: number[];
  lons: number[];
  values: number[];
  missing: boolean[];
  units?: string;
}

/** Parse ERDDAP griddap CSV (header, units row, then time/lat/lon/value). Values in cm. */
export function parseErddapSshCsv(text: string): ErddapSshTable | null {
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
    (c) => c === "sla" || c === "ssh" || c === "adt" || c.includes("sla") || c.includes("ssh"),
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
  if (looksMeters(units[iVal], finite)) {
    for (let i = 0; i < values.length; i++) {
      if (!missing[i]) values[i] = values[i]! * 100;
    }
  }
  return { time, lats, lons, values, missing, units: units[iVal] };
}

export function sshTableToPacked(
  table: ErddapSshTable,
  ep: SshEndpoint,
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
    if (v < -250 || v > 250) continue;
    plane[y * nx + x] = r2(v);
    seen[y * nx + x] = true;
  }
  const filled = seen.filter(Boolean).length;
  if (filled < nx * ny * 0.5) return null;
  const finite = plane.filter((v) => Number.isFinite(v));
  if (!finite.length) return null;
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  if (hi - lo < 0.5 && finite.length > 4) return null;
  if (lo < -250 || hi > 250) return null;
  const analysedAt = normalizeSshTime(table.time);
  const bbox: PackBBox = {
    west: lonAxis[0]!,
    east: lonAxis[lonAxis.length - 1]!,
    south: latAxis[latAxis.length - 1]!,
    north: latAxis[0]!,
  };
  void requested;
  const note = sshResolutionNote(ep);
  return {
    kind: "grid",
    layer: "altimetry",
    bbox,
    nx,
    ny,
    hours: [0],
    hoursCovered: 24,
    unit: "cm",
    values: [plane.map((v) => (Number.isFinite(v) ? v : 0))],
    live: true,
    source: "noaa",
    fixture: false,
    updatedAt: analysedAt,
    note,
  };
}

export function normalizeSshTime(raw: string): string {
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
 * Probe public SSH / SLA endpoints. Never throws. Returns undefined when
 * every path fails so the caller keeps the hashed fixture. Altimetry does
 * not block Ready-for-offshore.
 */
export async function fetchLiveSsh(options: {
  bbox: PackBBox;
  fetchImpl: FetchLike;
  timeoutMs?: number;
  endpoints?: readonly SshEndpoint[];
  errors?: string[];
  sleep?: (ms: number) => Promise<void>;
}): Promise<SshIngest | undefined> {
  const timeoutMs = options.timeoutMs ?? NOAA_GRID_TIMEOUT_MS;
  const errors = options.errors;
  const endpoints = options.endpoints ?? SSH_ENDPOINTS;
  for (const ep of endpoints) {
    const url = erddapSshCsvUrl(ep, options.bbox);
    const text = await fetchNoaaText({
      url,
      fetchImpl: options.fetchImpl,
      timeoutMs,
      maxBytes: SSH_MAX_BYTES,
      sleep: options.sleep,
    });
    if (!text) {
      errors?.push(`ssh ${ep.id}: fetch failed`);
      continue;
    }
    const table = parseErddapSshCsv(text);
    if (!table) {
      errors?.push(`ssh ${ep.id}: parse failed`);
      continue;
    }
    const grid = sshTableToPacked(table, ep, options.bbox);
    if (!grid || !grid.updatedAt) {
      errors?.push(`ssh ${ep.id}: empty or unusable grid`);
      continue;
    }
    const bytes = new TextEncoder().encode(text);
    const hash = await sha256Hex(bytes);
    const note = `${sshResolutionNote(ep)} ${grid.nx}×${grid.ny} at ${grid.updatedAt}.`;
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
      effectiveDeg: effectiveSshDeg(ep),
      note,
      grid,
    };
  }
  errors?.push("ssh: all public paths failed — fixture kept");
  return undefined;
}

export function sampleSshCsvForTests(): string {
  const rows = ["time,latitude,longitude,sla", "UTC,degrees_north,degrees_east,m"];
  const lats = [39.375, 40.125, 40.625, 41.375];
  const lons = [-72.875, -71.625, -70.375, -69.125];
  for (const lat of lats) {
    for (const lon of lons) {
      const t = 0.06 + (40.6 - lat) * 0.08 + Math.max(0, -70.4 - lon) * 0.04;
      rows.push(`2026-08-19T00:00:00Z,${lat},${lon},${t.toFixed(4)}`);
    }
  }
  return rows.join("\n") + "\n";
}
