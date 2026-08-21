/**
 * Public no-key bathymetry ingest via NOAA CoastWatch / PFEG ERDDAP
 * (NCEI ETOPO, GEBCO). Probe a few documented endpoints for a small
 * Point Judith bbox. First parseable grid wins. Fetch or parse failure
 * keeps the fixture. Do not download a global GEBCO / ETOPO netCDF.
 * Elevation (positive up) is stored as depth meters (positive down).
 * Helm already converts meters → fathoms. Not official ENC.
 * Keep free of `@/` aliases so the Worker can import it.
 */

import { sha256Hex, type PackBBox, type PackedGrid, type PackedJson } from "./pack-fixtures";
import { fetchNoaaText, NOAA_GRID_TIMEOUT_MS, type FetchLike } from "./noaa-http";

export const BATHY_MAX_BYTES = 2_000_000;

export const BATHY_AID_NOTE =
  "Public relief grid for canyon-wall paint — not official ENC and not a substitute for the legal chart. Official NOAA ENC remains the chart of record.";

export type { FetchLike };

export interface BathyEndpoint {
  id: string;
  name: string;
  /** ERDDAP griddap base without extension. */
  base: string;
  variable: string;
  nativeDeg: number;
  nativeLabel: string;
  /** Lat/lon stride. >1 is a subsample — report effective resolution. */
  stride: number;
  /** elevation = positive up (GEBCO / ETOPO). depth = positive down. */
  convention: "elevation" | "depth";
}

/**
 * Probe order. NCEI ETOPO 2022 15″ (stride 8 → ~0.033°) is the path
 * that returned a usable Point Judith canyon grid from this network
 * (2026-08-20). GEBCO_2020 is the same host, same stride. etopo180 is
 * the native 1-minute fallback. Not a navigation chart.
 */
export const BATHY_ENDPOINTS: readonly BathyEndpoint[] = [
  {
    id: "ETOPO_2022_v1_15s",
    name: "NOAA NCEI ETOPO 2022",
    base: "https://coastwatch.pfeg.noaa.gov/erddap/griddap/ETOPO_2022_v1_15s",
    variable: "z",
    nativeDeg: 0.004166666666666667,
    nativeLabel: "15 arc-second",
    stride: 8,
    convention: "elevation",
  },
  {
    id: "GEBCO_2020",
    name: "GEBCO_2020 (CoastWatch ERDDAP)",
    base: "https://coastwatch.pfeg.noaa.gov/erddap/griddap/GEBCO_2020",
    variable: "elevation",
    nativeDeg: 0.004166666666666667,
    nativeLabel: "15 arc-second",
    stride: 8,
    convention: "elevation",
  },
  {
    id: "etopo180",
    name: "NOAA ETOPO 1-minute (etopo180)",
    base: "https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180",
    variable: "altitude",
    nativeDeg: 1 / 60,
    nativeLabel: "1 arc-minute",
    stride: 1,
    convention: "elevation",
  },
];

export interface BathyIngest {
  live: true;
  source: "noaa";
  dataset: string;
  url: string;
  bytes: number;
  sha256: string;
  nativeLabel: string;
  effectiveDeg: number;
  note: string;
  grid: PackedGrid;
  contours?: PackedJson;
}

export function effectiveBathyDeg(ep: BathyEndpoint): number {
  return ep.nativeDeg * Math.max(1, ep.stride);
}

export function bathyResolutionNote(ep: BathyEndpoint): string {
  const eff = effectiveBathyDeg(ep);
  const deg = eff.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  if (ep.stride > 1) {
    return `${ep.name} subsampled to ~${deg}° (stride ${ep.stride}) — not native ${ep.nativeLabel}. ${BATHY_AID_NOTE}`;
  }
  return `${ep.name} ${ep.nativeLabel} (~${deg}°). ${BATHY_AID_NOTE}`;
}

export function erddapBathyCsvUrl(ep: BathyEndpoint, bbox: PackBBox): string {
  const stride = Math.max(1, Math.round(ep.stride));
  const lat = `[(${bbox.south}):${stride}:(${bbox.north})]`;
  const lon = `[(${bbox.west}):${stride}:(${bbox.east})]`;
  return `${ep.base}.csv?${ep.variable}${lat}${lon}`;
}

function num(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const t = raw.trim();
  if (!t || t === "NaN" || t === "NA" || t === "--" || t === "MM") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

function r4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function uniqSorted(values: number[], desc = false): number[] {
  const u = [...new Set(values.map((v) => r4(v)))];
  u.sort((a, b) => (desc ? b - a : a - b));
  return u;
}

export interface ErddapBathyTable {
  lats: number[];
  lons: number[];
  values: number[];
  missing: boolean[];
  units?: string;
}

/** Parse ERDDAP griddap CSV (header, units row, then lat/lon/value). */
export function parseErddapBathyCsv(text: string): ErddapBathyTable | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 3) return null;
  if (/^<!DOCTYPE|^<html|error/i.test(lines[0]!)) return null;
  const header = lines[0]!.split(",").map((c) => c.trim().replace(/^"|"$/g, "").toLowerCase());
  const units = lines[1]!.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const iLat = header.findIndex((c) => c === "latitude" || c === "lat");
  const iLon = header.findIndex((c) => c === "longitude" || c === "lon");
  const iVal = header.findIndex(
    (c) =>
      c === "elevation" ||
      c === "altitude" ||
      c === "z" ||
      c === "depth" ||
      c === "bathy" ||
      c.includes("elev"),
  );
  if (iLat < 0 || iLon < 0 || iVal < 0) return null;
  const lats: number[] = [];
  const lons: number[] = [];
  const values: number[] = [];
  const missing: boolean[] = [];
  for (const line of lines.slice(2)) {
    const cols = line.split(",");
    const lat = num(cols[iLat]);
    const lon = num(cols[iLon]);
    if (lat == null || lon == null) continue;
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
  return { lats, lons, values, missing, units: units[iVal] };
}

function toDepthM(raw: number, convention: BathyEndpoint["convention"]): number {
  return convention === "elevation" ? -raw : raw;
}

export function bathyTableToPacked(
  table: ErddapBathyTable,
  ep: BathyEndpoint,
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
    const y = latIndex.get(r4(table.lats[i]!));
    const x = lonIndex.get(r4(table.lons[i]!));
    if (y == null || x == null) continue;
    plane[y * nx + x] = r1(toDepthM(table.values[i]!, ep.convention));
    seen[y * nx + x] = true;
  }
  const filled = seen.filter(Boolean).length;
  if (filled < nx * ny * 0.5) return null;
  const finite = plane.filter((v) => Number.isFinite(v));
  if (!finite.length) return null;
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  // Need a real canyon/slope field, not a flat or SST-shaped plane.
  if (hi - lo < 40 && finite.length > 8) return null;
  if (hi < 180) return null;
  if (hi > 12000 || lo < -9000) return null;
  const bbox: PackBBox = {
    west: lonAxis[0]!,
    east: lonAxis[lonAxis.length - 1]!,
    south: latAxis[latAxis.length - 1]!,
    north: latAxis[0]!,
  };
  void requested;
  return {
    kind: "grid",
    layer: "bathymetry",
    bbox,
    nx,
    ny,
    hours: [0],
    hoursCovered: 0,
    unit: "m",
    values: [plane.map((v) => (Number.isFinite(v) ? v : 0))],
    live: true,
    source: "noaa",
    fixture: false,
    note: bathyResolutionNote(ep),
  };
}

function cellLat(bbox: PackBBox, ny: number, y: number): number {
  return ny === 1 ? (bbox.north + bbox.south) / 2 : bbox.north - ((bbox.north - bbox.south) * y) / (ny - 1);
}

function cellLon(bbox: PackBBox, nx: number, x: number): number {
  return nx === 1 ? (bbox.west + bbox.east) / 2 : bbox.west + ((bbox.east - bbox.west) * x) / (nx - 1);
}

const CONTOUR_LEVELS: { depthM: number; label: string }[] = [
  { depthM: 183, label: "100 fm" },
  { depthM: 366, label: "200 fm" },
];

/** Cheap marching-squares on the packed depth plane. */
export function contoursFromDepthGrid(grid: PackedGrid): PackedJson | undefined {
  const plane = grid.values[0];
  if (!plane || grid.nx < 2 || grid.ny < 2) return undefined;
  const features: GeoJSON.Feature[] = [];
  const lonAt = (x: number) => cellLon(grid.bbox, grid.nx, x);
  const latAt = (y: number) => cellLat(grid.bbox, grid.ny, y);
  for (const { depthM, label } of CONTOUR_LEVELS) {
    for (let y = 0; y < grid.ny - 1; y++) {
      for (let x = 0; x < grid.nx - 1; x++) {
        const v00 = plane[y * grid.nx + x];
        const v10 = plane[y * grid.nx + x + 1];
        const v01 = plane[(y + 1) * grid.nx + x];
        if (v00 == null || v10 == null || v01 == null) continue;
        const crossings: [number, number][] = [];
        const edge = (a: number, b: number, la: number, lo: number, lb: number, lbo: number) => {
          if ((a - depthM) * (b - depthM) > 0) return;
          const t = (depthM - a) / (b - a || 1e-6);
          crossings.push([lo + (lbo - lo) * t, la + (lb - la) * t]);
        };
        edge(v00, v10, latAt(y), lonAt(x), latAt(y), lonAt(x + 1));
        edge(v10, v01, latAt(y), lonAt(x + 1), latAt(y + 1), lonAt(x));
        edge(v00, v01, latAt(y), lonAt(x), latAt(y + 1), lonAt(x));
        if (crossings.length >= 2) {
          features.push({
            type: "Feature",
            properties: { depthM, depth: depthM, label },
            geometry: { type: "LineString", coordinates: crossings.slice(0, 2) },
          });
        }
      }
    }
  }
  if (!features.length) return undefined;
  return {
    kind: "geojson",
    layer: "contours",
    payload: {
      type: "FeatureCollection",
      source: "noaa",
      live: true,
      fixture: false,
      note: BATHY_AID_NOTE,
      features,
    },
  };
}

/**
 * Probe public bathymetry endpoints. Never throws. Returns undefined when
 * every path fails so the caller keeps the hashed fixture. Bathymetry is
 * required for Ready — the fixture body still counts if live ingest misses.
 */
export async function fetchLiveBathy(options: {
  bbox: PackBBox;
  fetchImpl: FetchLike;
  timeoutMs?: number;
  endpoints?: readonly BathyEndpoint[];
  errors?: string[];
  sleep?: (ms: number) => Promise<void>;
}): Promise<BathyIngest | undefined> {
  const timeoutMs = options.timeoutMs ?? NOAA_GRID_TIMEOUT_MS;
  const errors = options.errors;
  const endpoints = options.endpoints ?? BATHY_ENDPOINTS;
  for (const ep of endpoints) {
    const url = erddapBathyCsvUrl(ep, options.bbox);
    const text = await fetchNoaaText({
      url,
      fetchImpl: options.fetchImpl,
      timeoutMs,
      maxBytes: BATHY_MAX_BYTES,
      sleep: options.sleep,
    });
    if (!text) {
      errors?.push(`bathy ${ep.id}: fetch failed`);
      continue;
    }
    const table = parseErddapBathyCsv(text);
    if (!table) {
      errors?.push(`bathy ${ep.id}: parse failed`);
      continue;
    }
    const grid = bathyTableToPacked(table, ep, options.bbox);
    if (!grid) {
      errors?.push(`bathy ${ep.id}: empty or unusable grid`);
      continue;
    }
    const bytes = new TextEncoder().encode(text);
    const hash = await sha256Hex(bytes);
    const note = `${bathyResolutionNote(ep)} ${grid.nx}×${grid.ny}.`;
    grid.note = note;
    return {
      live: true,
      source: "noaa",
      dataset: ep.id,
      url,
      bytes: bytes.byteLength,
      sha256: hash,
      nativeLabel: ep.nativeLabel,
      effectiveDeg: effectiveBathyDeg(ep),
      note,
      grid,
      contours: contoursFromDepthGrid(grid),
    };
  }
  errors?.push("bathy: all public paths failed — fixture kept");
  return undefined;
}

export function sampleBathyCsvForTests(): string {
  const rows = ["latitude,longitude,z", "degrees_north,degrees_east,m"];
  const lats = [41.2, 40.6, 40.0, 39.4];
  const lons = [-72.8, -71.6, -70.4, -69.2];
  for (const lat of lats) {
    for (const lon of lons) {
      // Elevation (positive up). Shelf north/west, canyon south/east.
      const elev = 10 - (41.2 - lat) * 900 - (lon + 72.8) * 180;
      rows.push(`${lat},${lon},${elev.toFixed(1)}`);
    }
  }
  return rows.join("\n") + "\n";
}
