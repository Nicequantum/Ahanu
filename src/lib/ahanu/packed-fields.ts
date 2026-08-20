/**
 * On-device sample of packed rasters / GRIB grids.
 * When a trip pack is loaded, ocean.ts and grib.ts prefer these fields.
 */

import type { PackedBody, PackedGrid, PackBBox } from "./pack-fixtures";
import { parseLayerBody } from "./pack-fixtures";

export interface SampleGrid {
  bbox: PackBBox;
  nx: number;
  ny: number;
  hours: number[];
  values: number[][];
}

export interface PackedOcean {
  sst?: SampleGrid;
  chl?: SampleGrid;
  ssh?: SampleGrid;
  depth?: SampleGrid;
  windKt?: SampleGrid;
  waveFt?: SampleGrid;
}

let packed: PackedOcean | null = null;
let epoch = 0;

export function getPackedOcean(): PackedOcean | null {
  return packed;
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

export function packedOceanFromBodies(bodies: Record<string, string>): PackedOcean {
  const out: PackedOcean = {};
  const take = (id: string, key: keyof PackedOcean) => {
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
  kind: "sst" | "chl" | "ssh" | "depth" | "windKt" | "waveFt",
  lat: number,
  lon: number,
  hour = 0,
): number | null {
  const g = packed?.[kind];
  if (!g) return null;
  return samplePacked(g, lat, lon, hour);
}
