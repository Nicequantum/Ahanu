/**
 * On-device sample of packed rasters / GRIB grids.
 * When a trip pack is loaded, ocean.ts, grib.ts, and the helm prefer these fields.
 */

import type { PackedBody, PackedGrid, PackedJson, PackBBox } from "./pack-fixtures";
import { parseLayerBody } from "./pack-fixtures";

export interface SampleGrid {
  bbox: PackBBox;
  nx: number;
  ny: number;
  hours: number[];
  values: number[][];
}

export type PackFieldId = "sst" | "chl" | "ssh" | "depth" | "windKt" | "waveFt";

/** fixture = hashed demo bodies. r2 = production ingest bytes. */
export type PackFieldSource = "fixture" | "r2";

export interface PackedOcean {
  sst?: SampleGrid;
  chl?: SampleGrid;
  ssh?: SampleGrid;
  depth?: SampleGrid;
  windKt?: SampleGrid;
  waveFt?: SampleGrid;
  source: PackFieldSource;
}

let packed: PackedOcean | null = null;
let epoch = 0;

export function getPackedOcean(): PackedOcean | null {
  return packed;
}

export function hasPackedSession(): boolean {
  return packed != null;
}

export function packedSource(): PackFieldSource | null {
  return packed?.source ?? null;
}

export function packedEpoch(): number {
  return epoch;
}

export function setPackedOcean(next: PackedOcean | null): void {
  packed = next;
  epoch += 1;
}

export function clearPackedOcean(): void {
  packed = null;
  epoch += 1;
}

export function packedHas(kind: PackFieldId): boolean {
  return Boolean(packed?.[kind]);
}

/** Bbox of a packed field, or the first grid in the session. */
export function packedBBox(kind?: PackFieldId): PackBBox | null {
  if (!packed) return null;
  if (kind) return packed[kind]?.bbox ?? null;
  return (
    packed.sst?.bbox ??
    packed.chl?.bbox ??
    packed.ssh?.bbox ??
    packed.depth?.bbox ??
    packed.windKt?.bbox ??
    packed.waveFt?.bbox ??
    null
  );
}

export function gridFromBody(body: PackedBody): SampleGrid | null {
  if (body.kind !== "grid") return null;
  const g = body as PackedGrid;
  if (!g.nx || !g.ny || !g.values?.length) return null;
  return {
    bbox: g.bbox,
    nx: g.nx,
    ny: g.ny,
    hours: g.hours,
    values: g.values,
  };
}

function detectSource(bodies: Record<string, string>): PackFieldSource {
  for (const raw of Object.values(bodies)) {
    const parsed = parseLayerBody(raw);
    if (!parsed || !("payload" in parsed)) continue;
    const payload = (parsed as PackedJson).payload;
    if (payload && typeof payload === "object" && (payload as { fixture?: boolean }).fixture) {
      return "fixture";
    }
  }
  // Untagged grids in this repo are still fixtures until live ingest writes R2.
  return "fixture";
}

export function packedOceanFromBodies(
  bodies: Record<string, string>,
  source?: PackFieldSource,
): PackedOcean {
  const out: PackedOcean = { source: source ?? detectSource(bodies) };
  const take = (id: string, key: PackFieldId) => {
    const raw = bodies[id];
    if (!raw) return;
    const parsed = parseLayerBody(raw);
    if (!parsed) return;
    const g = gridFromBody(parsed);
    if (g) out[key] = g;
  };
  take("sst", "sst");
  take("chlorophyll", "chl");
  take("altimetry", "ssh");
  take("bathymetry", "depth");
  take("wind", "windKt");
  take("waves", "waveFt");
  return out;
}

function hourIndex(grid: SampleGrid, hour: number): number {
  if (grid.hours.length === 1) return 0;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < grid.hours.length; i++) {
    const d = Math.abs(grid.hours[i]! - hour);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function cellLat(bbox: PackBBox, ny: number, y: number): number {
  return ny === 1 ? (bbox.north + bbox.south) / 2 : bbox.north - ((bbox.north - bbox.south) * y) / (ny - 1);
}

function cellLon(bbox: PackBBox, nx: number, x: number): number {
  return nx === 1 ? (bbox.west + bbox.east) / 2 : bbox.west + ((bbox.east - bbox.west) * x) / (nx - 1);
}

/** Bilinear sample. Returns null outside the packed bbox. */
export function samplePacked(grid: SampleGrid, lat: number, lon: number, hour = 0): number | null {
  const { west, east, south, north } = grid.bbox;
  if (lat < south || lat > north || lon < west || lon > east) return null;
  const fx = grid.nx === 1 ? 0 : ((lon - west) / (east - west)) * (grid.nx - 1);
  const fy = grid.ny === 1 ? 0 : ((north - lat) / (north - south)) * (grid.ny - 1);
  const x0 = Math.max(0, Math.min(grid.nx - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(grid.ny - 1, Math.floor(fy)));
  const x1 = Math.max(0, Math.min(grid.nx - 1, x0 + 1));
  const y1 = Math.max(0, Math.min(grid.ny - 1, y0 + 1));
  const tx = fx - x0;
  const ty = fy - y0;
  const plane = grid.values[hourIndex(grid, hour)];
  if (!plane) return null;
  const at = (x: number, y: number) => plane[y * grid.nx + x] ?? 0;
  const v =
    at(x0, y0) * (1 - tx) * (1 - ty) +
    at(x1, y0) * tx * (1 - ty) +
    at(x0, y1) * (1 - tx) * ty +
    at(x1, y1) * tx * ty;
  return v;
}

export function samplePackedKind(
  kind: PackFieldId,
  lat: number,
  lon: number,
  hour = 0,
): number | null {
  const g = packed?.[kind];
  if (!g) return null;
  return samplePacked(g, lat, lon, hour);
}

/** One GeoJSON point per packed cell. Does not invent values outside the grid. */
export function packedGridFeatures(
  grid: SampleGrid,
  hour: number,
  props: (value: number, lat: number, lon: number) => Record<string, number | string> | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (let y = 0; y < grid.ny; y++) {
    const lat = cellLat(grid.bbox, grid.ny, y);
    for (let x = 0; x < grid.nx; x++) {
      const lon = cellLon(grid.bbox, grid.nx, x);
      const v = samplePacked(grid, lat, lon, hour);
      if (v == null) continue;
      const p = props(v, lat, lon);
      if (!p) continue;
      features.push({
        type: "Feature",
        properties: p,
        geometry: { type: "Point", coordinates: [lon, lat] },
      });
    }
  }
  return { type: "FeatureCollection", features };
}
