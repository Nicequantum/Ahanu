/**
 * On-device sample of packed rasters / GRIB grids / chart vectors.
 * When a trip pack is loaded, the helm prefers these fields.
 */

import type { PackedBody, PackedGrid, PackedJson, PackBBox } from "./pack-fixtures";
import { parseLayerBody } from "./pack-fixtures";
import type { PackedBuoyRow, PackedTideStation } from "./noaa-live";

export interface SampleGrid {
  bbox: PackBBox;
  nx: number;
  ny: number;
  hours: number[];
  hoursCovered?: number;
  values: number[][];
  live?: boolean;
  source?: PackFieldSource;
  note?: string;
  updatedAt?: string;
  dirValues?: number[][];
  periodValues?: number[][];
}

export type PackFieldId = "sst" | "chl" | "ssh" | "depth" | "windKt" | "waveFt";

/** fixture = hashed demo bodies. r2 = production ingest bytes. */
export type PackFieldSource = "fixture" | "r2" | "noaa";

export interface EncS57Packed {
  id: string;
  official?: boolean;
  encoding?: string;
  iso8211?: boolean;
  catalog031?: boolean;
  file000?: string;
  file000Bytes?: number;
  leader?: string;
  zipBytes?: number;
  zipSha256?: string;
  zipBase64?: string;
  zipUrl?: string;
}

/** Client-side parse of packed official .000 bytes. Not stored in the pack hash. */
export interface EncS57Extract {
  official: true;
  note: string;
  cells: {
    cellId: string;
    file000?: string;
    bounds?: { west: number; south: number; east: number; north: number };
    features: GeoJSON.Feature[];
    counts: { aids: number; lights: number; soundings: number; soundingsOmitted: number };
  }[];
  features: GeoJSON.Feature[];
}

export interface EncClip {
  fixture: boolean;
  live?: boolean;
  official?: boolean;
  encoding?: string;
  source?: string;
  note: string;
  bbox?: PackBBox;
  coverage?: { harborApproach: string[]; coastalTo100fm: boolean };
  s57?: { source?: string; encoding?: string; official?: boolean; cellIds?: string[]; zipBytes?: number; files?: EncS57Packed[] };
  cells: {
    id: string;
    usage: number;
    name: string;
    west?: number;
    south?: number;
    east?: number;
    north?: number;
    zipUrl?: string;
    zipBytes?: number;
    zipSha256?: string;
    s57?: EncS57Packed;
  }[];
  tiles?: { template: string; legal?: boolean; probe?: string };
  extract?: EncS57Extract;
}

export interface PackedTideWindow {
  fixture?: boolean;
  live?: boolean;
  source?: string;
  start: string;
  hours: number;
  harbor?: string;
  stations: PackedTideStation[];
}

export interface PackedOcean {
  sst?: SampleGrid;
  chl?: SampleGrid;
  ssh?: SampleGrid;
  depth?: SampleGrid;
  windKt?: SampleGrid;
  waveFt?: SampleGrid;
  canyons?: GeoJSON.FeatureCollection;
  contours?: GeoJSON.FeatureCollection;
  hms?: GeoJSON.FeatureCollection;
  buoys?: PackedBuoyRow[];
  tides?: PackedTideWindow;
  enc?: EncClip;
  buoySource?: PackFieldSource;
  tideSource?: PackFieldSource;
  windSource?: PackFieldSource;
  waveSource?: PackFieldSource;
  sstSource?: PackFieldSource;
  chlSource?: PackFieldSource;
  sshSource?: PackFieldSource;
  hmsSource?: PackFieldSource;
  depthSource?: PackFieldSource;
  contoursSource?: PackFieldSource;
  canyonsSource?: PackFieldSource;
  encSource?: PackFieldSource;
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
    hoursCovered: g.hoursCovered,
    values: g.values,
    live: g.live,
    source: g.source === "noaa" || g.live ? "noaa" : g.source === "r2" ? "r2" : undefined,
    note: g.note,
    updatedAt: g.updatedAt,
    dirValues: g.dirValues,
    periodValues: g.periodValues,
  };
}

function payloadSource(payload: unknown, fallback: PackFieldSource): PackFieldSource {
  if (payload && typeof payload === "object") {
    const p = payload as { live?: boolean; source?: string; fixture?: boolean };
    if (
      p.source === "ndbc" ||
      p.source === "coops" ||
      p.source === "noaa-enc-catalog" ||
      p.source === "noaa-enc-s57" ||
      p.source === "noaa" ||
      p.source === "nmfs" ||
      p.live
    )
      return "noaa";
    if (p.fixture) return "fixture";
  }
  return fallback;
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

function asFeatureCollection(payload: unknown): GeoJSON.FeatureCollection | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as GeoJSON.FeatureCollection;
  if (p.type !== "FeatureCollection" || !Array.isArray(p.features)) return null;
  return p;
}

function asBuoys(payload: unknown): PackedBuoyRow[] | null {
  if (!payload || typeof payload !== "object") return null;
  const buoys = (payload as { buoys?: PackedBuoyRow[] }).buoys;
  if (!Array.isArray(buoys)) return null;
  return buoys.filter(
    (b) => b && typeof b.id === "string" && Number.isFinite(b.lat) && Number.isFinite(b.lon),
  );
}

function asTides(payload: unknown): PackedTideWindow | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as PackedTideWindow;
  if (!Array.isArray(p.stations)) return null;
  return p;
}

function asEnc(payload: unknown): EncClip | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as EncClip;
  if (!Array.isArray(p.cells)) return null;
  return p;
}

export function packedOceanFromBodies(
  bodies: Record<string, string>,
  source?: PackFieldSource,
): PackedOcean {
  const packSource = source ?? detectSource(bodies);
  const out: PackedOcean = { source: packSource };
  const takeGrid = (id: string, key: PackFieldId) => {
    const raw = bodies[id];
    if (!raw) return;
    const parsed = parseLayerBody(raw);
    if (!parsed) return;
    const g = gridFromBody(parsed);
    if (g) {
      out[key] = g;
      const src = g.source ?? (g.live ? "noaa" : undefined);
      if (key === "windKt" && src) out.windSource = src;
      if (key === "waveFt" && src) out.waveSource = src;
      if (key === "sst" && src) out.sstSource = src;
      if (key === "chl" && src) out.chlSource = src;
      if (key === "ssh" && src) out.sshSource = src;
      if (key === "depth" && src) out.depthSource = src;
    }
  };
  takeGrid("sst", "sst");
  takeGrid("chlorophyll", "chl");
  takeGrid("altimetry", "ssh");
  takeGrid("bathymetry", "depth");
  takeGrid("wind", "windKt");
  takeGrid("waves", "waveFt");

  const takeJson = (id: string, apply: (payload: unknown) => void) => {
    const raw = bodies[id];
    if (!raw) return;
    const parsed = parseLayerBody(raw);
    if (!parsed || !("payload" in parsed)) return;
    apply((parsed as PackedJson).payload);
  };
  takeJson("canyons", (payload) => {
    const fc = asFeatureCollection(payload);
    if (fc) {
      out.canyons = fc;
      out.canyonsSource = payloadSource(payload, packSource);
    }
  });
  takeJson("contours", (payload) => {
    const fc = asFeatureCollection(payload);
    if (fc) {
      out.contours = fc;
      out.contoursSource = payloadSource(payload, packSource);
    }
  });
  takeJson("hms_zones", (payload) => {
    const fc = asFeatureCollection(payload);
    if (fc) {
      out.hms = fc;
      out.hmsSource = payloadSource(payload, packSource);
    }
  });
  takeJson("buoys", (payload) => {
    const rows = asBuoys(payload);
    if (rows) {
      out.buoys = rows;
      out.buoySource = payloadSource(payload, packSource);
    }
  });
  takeJson("tides", (payload) => {
    const tides = asTides(payload);
    if (tides) {
      out.tides = tides;
      out.tideSource = payloadSource(payload, packSource);
    }
  });
  takeJson("enc", (payload) => {
    const enc = asEnc(payload);
    if (enc) {
      out.enc = enc;
      out.encSource = payloadSource(payload, packSource);
    }
  });
  return out;
}

export function packedHasChart(
  kind: "canyons" | "contours" | "hms" | "buoys" | "tides" | "enc" | "depth",
): boolean {
  if (!packed) return false;
  if (kind === "hms") return Boolean(packed.hms);
  if (kind === "depth") return Boolean(packed.depth);
  return Boolean(packed[kind]);
}

function hourIndex(grid: SampleGrid, hour: number): number | null {
  if (!grid.hours.length) return null;
  if (grid.hours.length === 1) {
    // Hour-0 live weather is only valid near that hour. A daily SST
    // composite (hoursCovered >= 24) is the field for the whole window.
    if (grid.live && (grid.hoursCovered ?? 1) < 24) {
      return Math.abs(hour - grid.hours[0]!) <= 1.5 ? 0 : null;
    }
    return 0;
  }
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < grid.hours.length; i++) {
    const d = Math.abs(grid.hours[i]! - hour);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const step = Math.abs(grid.hours[1]! - grid.hours[0]!) / 2;
  if (bestD > Math.max(1.5, step)) return null;
  return best;
}

function cellLat(bbox: PackBBox, ny: number, y: number): number {
  return ny === 1
    ? (bbox.north + bbox.south) / 2
    : bbox.north - ((bbox.north - bbox.south) * y) / (ny - 1);
}

function cellLon(bbox: PackBBox, nx: number, x: number): number {
  return nx === 1
    ? (bbox.west + bbox.east) / 2
    : bbox.west + ((bbox.east - bbox.west) * x) / (nx - 1);
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
  const hi = hourIndex(grid, hour);
  if (hi == null) return null;
  const plane = grid.values[hi];
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

function lerpAngle(a: number, b: number, t: number): number {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

function samplePlane(
  grid: SampleGrid,
  plane: number[] | undefined,
  lat: number,
  lon: number,
  hour: number,
  angle: boolean,
): number | null {
  if (!plane) return null;
  if (hourIndex(grid, hour) == null) return null;
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
  const at = (x: number, y: number) => plane[y * grid.nx + x] ?? 0;
  if (!angle) {
    return (
      at(x0, y0) * (1 - tx) * (1 - ty) +
      at(x1, y0) * tx * (1 - ty) +
      at(x0, y1) * (1 - tx) * ty +
      at(x1, y1) * tx * ty
    );
  }
  const top = lerpAngle(at(x0, y0), at(x1, y0), tx);
  const bot = lerpAngle(at(x0, y1), at(x1, y1), tx);
  return lerpAngle(top, bot, ty);
}

export function samplePackedDir(lat: number, lon: number, hour = 0): number | null {
  const g = packed?.windKt;
  if (!g) return null;
  const hi = hourIndex(g, hour);
  if (hi == null) return null;
  return samplePlane(g, g.dirValues?.[hi], lat, lon, hour, true);
}

export function samplePackedPeriod(lat: number, lon: number, hour = 0): number | null {
  const g = packed?.waveFt;
  if (!g) return null;
  const hi = hourIndex(g, hour);
  if (hi == null) return null;
  return samplePlane(g, g.periodValues?.[hi], lat, lon, hour, false);
}

export function samplePackedWaveDir(lat: number, lon: number, hour = 0): number | null {
  const g = packed?.waveFt;
  if (!g) return null;
  const hi = hourIndex(g, hour);
  if (hi == null) return null;
  return samplePlane(g, g.dirValues?.[hi], lat, lon, hour, true);
}
