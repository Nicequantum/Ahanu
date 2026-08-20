import { CANYONS } from "@/lib/data/canyons";
import { GRID_NX, GRID_NY, REGION } from "./constants";
import { haversineNm, initialBearing, toRad } from "./geo";
import type { LatLon } from "./types";

/** Mainland Atlantic shoreline, south → north. Land is west of this longitude. */
const COAST: readonly (readonly [number, number])[] = [
  [36.2, -75.88],
  [36.4, -75.92],
  [36.85, -75.98],
  [37.25, -75.86],
  [37.7, -75.54],
  [38.15, -75.18],
  [38.55, -75.05],
  [38.93, -74.96],
  [39.2, -74.66],
  [39.36, -74.42],
  [39.65, -74.18],
  [39.95, -74.07],
  [40.25, -73.99],
  [40.48, -74.02],
  [40.72, -73.98],
  [40.95, -73.65],
  [41.18, -72.9],
  [41.3, -71.92],
  [41.3615, -71.4814],
  [41.45, -71.22],
  [41.52, -70.67],
  [41.62, -70.28],
  [41.68, -69.96],
  [41.85, -69.95],
  [42.04, -70.17],
  [42.22, -70.68],
  [42.4, -70.9],
  [42.65, -70.61],
];

/** ~100-fathom (183 m) curve through the named canyon heads. */
const SHELF_BREAK: readonly (readonly [number, number])[] = [
  [36.2, -74.78],
  [36.97, -74.65], // Norfolk
  [37.43, -74.48], // Washington
  [38.15, -73.85], // Baltimore
  [38.42, -73.5], // Wilmington
  [38.9, -73.05],
  [39.2, -72.72],
  [39.55, -72.4], // Hudson
  [39.72, -71.15],
  [39.85, -70.22], // Atlantis
  [39.9, -69.62], // Veatch
  [40.15, -69.0], // Hydrographer
  [40.3, -68.14], // Oceanographer
  [40.52, -67.67], // Lydonia
  [40.85, -66.85],
  [41.2, -66.32],
  [41.6, -66.18],
  [42.2, -65.98],
  [42.7, -66.12],
];

interface Island {
  lat: number;
  lon: number;
  rLat: number;
  rLon: number;
}

const ISLANDS: readonly Island[] = [
  { lat: 40.82, lon: -72.92, rLat: 0.28, rLon: 1.15 }, // Long Island
  { lat: 41.17, lon: -71.58, rLat: 0.04, rLon: 0.055 }, // Block Island
  { lat: 41.39, lon: -70.62, rLat: 0.085, rLon: 0.22 }, // Martha's Vineyard
  { lat: 41.28, lon: -70.1, rLat: 0.075, rLon: 0.18 }, // Nantucket
  { lat: 41.46, lon: -70.94, rLat: 0.04, rLon: 0.08 }, // Elizabeth Islands
];

function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}

function interpLon(lat: number, pts: readonly (readonly [number, number])[]): number {
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (lat <= first[0]) return first[1];
  if (lat >= last[0]) return last[1];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (lat <= b[0]) {
      const span = b[0] - a[0];
      const t = span < 1e-9 ? 0 : (lat - a[0]) / span;
      return a[1] + t * (b[1] - a[1]);
    }
  }
  return last[1];
}

export function coastLon(lat: number): number {
  return interpLon(lat, COAST);
}

export function shelfBreakLon(lat: number): number {
  return interpLon(lat, SHELF_BREAK);
}

function inIsland(lat: number, lon: number): boolean {
  for (const isl of ISLANDS) {
    const e = ((lat - isl.lat) / isl.rLat) ** 2 + ((lon - isl.lon) / isl.rLon) ** 2;
    if (e <= 1) return true;
  }
  return false;
}

export function isLand(lat: number, lon: number): boolean {
  return lon <= coastLon(lat) || inIsland(lat, lon);
}

function nmEastPerDeg(lat: number): number {
  return 60 * Math.cos(toRad(lat));
}

function distToSeg(
  p: LatLon,
  a: LatLon,
  b: LatLon,
): { along: number; cross: number; segLen: number } {
  const segLen = haversineNm(a, b);
  if (segLen < 1e-4) {
    return { along: 0, cross: haversineNm(p, a), segLen: 0 };
  }
  const brg = initialBearing(a, b);
  const nm = haversineNm(a, p);
  const d = toRad(initialBearing(a, p) - brg);
  return { along: nm * Math.cos(d), cross: nm * Math.sin(d), segLen };
}

const CANYON_META = CANYONS.map((c) => {
  let lengthNm = 0;
  for (let i = 1; i < c.axis.length; i++) {
    lengthNm += haversineNm(c.axis[i - 1]!, c.axis[i]!);
  }
  return { c, lengthNm: Math.max(1, lengthNm), width0: c.id === "hudson" ? 9.2 : 5.8 };
});

function canyonDepth(lat: number, lon: number): number {
  let deepest = 0;
  const p = { lat, lon };
  for (const { c, lengthNm, width0 } of CANYON_META) {
    const axis = c.axis;
    if (axis.length < 2) continue;
    let acc = 0;
    let bestCross = 1e9;
    let bestAlong = 0;
    for (let i = 1; i < axis.length; i++) {
      const a = axis[i - 1]!;
      const b = axis[i]!;
      const { along, cross, segLen } = distToSeg(p, a, b);
      const t = clamp(along / Math.max(segLen, 1e-6), 0, 1);
      const dx = along < 0 ? -along : along > segLen ? along - segLen : 0;
      const dist = Math.hypot(cross, dx);
      if (dist < bestCross) {
        bestCross = dist;
        bestAlong = acc + t * segLen;
      }
      acc += segLen;
    }
    const t = clamp(bestAlong / lengthNm, 0, 1.15);
    const widthNm = width0 * (0.55 + 0.9 * clamp(t, 0, 1));
    const g = Math.exp(-(bestCross * bestCross) / (2 * (widthNm * 0.38) ** 2));
    if (g < 0.02) continue;
    const floor = 400;
    const ceil = Math.min(2500, Math.max(1200, c.maxDepthM * 0.72));
    const target = floor + (ceil - floor) * Math.min(1, t) ** 0.62;
    deepest = Math.max(deepest, target * g);
  }
  return deepest;
}

function georgesCap(lat: number, lon: number): number | null {
  const e =
    ((lat - 41.12) / 0.82) ** 2 + ((lon - -67.35) / 1.55) ** 2;
  if (e >= 1) return null;
  return 32 + 58 * e;
}

function nantucketShoalsCap(lat: number, lon: number): number | null {
  const e =
    ((lat - 41.08) / 0.28) ** 2 + ((lon - -69.72) / 0.55) ** 2;
  if (e >= 1) return null;
  return 16 + 36 * e;
}

function shelfDepth(lat: number, lon: number, coast: number, brk: number): number {
  const span = Math.max(0.08, brk - coast);
  const t = clamp((lon - coast) / span, 0, 1);
  const ripple =
    6 * Math.sin(lat * 17.3 + lon * 9.1) + 4 * Math.cos(lat * 6.4 - lon * 11.2);
  let d = 14 + t ** 1.38 * 164 + ripple * t;
  const gb = georgesCap(lat, lon);
  if (gb != null) d = Math.min(d, gb);
  const ns = nantucketShoalsCap(lat, lon);
  if (ns != null) d = Math.min(d, ns);
  // Mud Hole south of Long Island — slightly deeper mid-shelf pocket.
  const mh =
    ((lat - 39.72) / 0.35) ** 2 + ((lon - -72.05) / 0.55) ** 2;
  if (mh < 1) d += 28 * (1 - mh);
  return clamp(d, 8, 185);
}

function slopeAbyss(lat: number, lon: number, brk: number): number {
  const nmBeyond = (lon - brk) * nmEastPerDeg(lat);
  const t = 1 - Math.exp(-Math.max(0, nmBeyond) / 17);
  const hills =
    70 * Math.sin(lat * 4.7 + lon * 3.3) + 40 * Math.cos(lat * 8.1 - lon * 5.6);
  const latBias = (40.2 - lat) * 55;
  return 190 + t * 3180 + Math.max(0, nmBeyond) * 3.4 + hills + latBias;
}

/**
 * Synthetic but smooth bathymetry (meters). Land is −5.
 * Shelf 20–180 m seaward, canyon trenches 400–2500 m, abyss 2500–4200 m.
 */
export function depthM(lat: number, lon: number): number {
  if (isLand(lat, lon)) return -5;
  const coast = coastLon(lat);
  const brk = shelfBreakLon(lat);
  const trench = canyonDepth(lat, lon);
  let base: number;
  if (lon <= brk) {
    base = shelfDepth(lat, lon, coast, brk);
  } else {
    base = clamp(slopeAbyss(lat, lon, brk), 190, 4250);
  }
  if (trench > 0) {
    const inf = clamp(trench / Math.max(trench, base, 1), 0, 1);
    const mix = 1 - Math.exp(-trench / 220);
    base = base * (1 - mix * inf) + Math.max(base, trench) * (mix * inf);
  }
  if (base < 0) return -5;
  return base;
}

export interface SampledGrid<T> {
  nx: number;
  ny: number;
  west: number;
  east: number;
  south: number;
  north: number;
  values: T[];
}

/** Row-major south → north, west → east over the operating box. */
export function sampleGrid<T>(fn: (lat: number, lon: number) => T): SampledGrid<T> {
  const { west, east, south, north } = REGION;
  const nx = GRID_NX;
  const ny = GRID_NY;
  const values: T[] = new Array(nx * ny);
  const dLat = (north - south) / Math.max(1, ny - 1);
  const dLon = (east - west) / Math.max(1, nx - 1);
  for (let j = 0; j < ny; j++) {
    const lat = south + dLat * j;
    for (let i = 0; i < nx; i++) {
      const lon = west + dLon * i;
      values[j * nx + i] = fn(lat, lon);
    }
  }
  return { nx, ny, west, east, south, north, values };
}

export function landPolygon(): GeoJSON.Feature {
  const coords: [number, number][] = [];
  for (let lat = REGION.south; lat <= REGION.north; lat += 0.1) {
    coords.push([coastLon(lat) - 0.03, lat]);
  }
  coords.push([REGION.west - 1.2, REGION.north], [REGION.west - 1.2, REGION.south], coords[0]!);
  return {
    type: "Feature",
    properties: { kind: "land" },
    geometry: { type: "Polygon", coordinates: [coords] },
  };
}

export function contourLines(levelM: number, step = 3): GeoJSON.FeatureCollection {
  const g = sampleGrid((la, lo) => depthM(la, lo));
  const features: GeoJSON.Feature[] = [];
  const { nx, ny, values } = g;
  const lonAt = (i: number) => REGION.west + ((REGION.east - REGION.west) * i) / (nx - 1);
  const latAt = (j: number) => REGION.south + ((REGION.north - REGION.south) * j) / (ny - 1);
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      if ((i + j) % step !== 0) continue;
      const v00 = values[j * nx + i] as number;
      const v10 = values[j * nx + i + 1] as number;
      const v01 = values[(j + 1) * nx + i] as number;
      const crossings: [number, number][] = [];
      const edge = (a: number, b: number, la: number, lo: number, lb: number, lbo: number) => {
        if ((a - levelM) * (b - levelM) > 0) return;
        const t = (levelM - a) / (b - a || 1e-6);
        crossings.push([lo + (lbo - lo) * t, la + (lb - la) * t]);
      };
      edge(v00, v10, latAt(j), lonAt(i), latAt(j), lonAt(i + 1));
      edge(v10, v01, latAt(j), lonAt(i + 1), latAt(j + 1), lonAt(i));
      edge(v00, v01, latAt(j), lonAt(i), latAt(j + 1), lonAt(i));
      if (crossings.length >= 2) {
        features.push({
          type: "Feature",
          properties: { depth: levelM },
          geometry: { type: "LineString", coordinates: crossings.slice(0, 2) },
        });
      }
    }
  }
  return { type: "FeatureCollection", features };
}

