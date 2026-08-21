import { depthM, isLand, shelfBreakLon } from "./bathymetry";
import { HUDSON_HEAD, REGION, VEATCH_HEAD } from "./constants";
import { toRad } from "./geo";
import { samplePackedKind } from "./packed-fields";

export type RasterKind = "sst" | "chl" | "ssh" | "depth";

export interface OceanRaster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  west: number;
  east: number;
  south: number;
  north: number;
}

export type Colorizer = (value: number) => [number, number, number, number];

function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}

function nmEastPerDeg(lat: number): number {
  return 60 * Math.max(0.2, Math.cos(toRad(lat)));
}

interface Eddy {
  lat0: number;
  lon0: number;
  rLat: number;
  rLon: number;
  sst: number;
  ssh: number;
  dLat: number;
  dLon: number;
}

const EDDIES: readonly Eddy[] = [
  // Warm-core ring south of Veatch.
  {
    lat0: VEATCH_HEAD.lat - 0.72,
    lon0: VEATCH_HEAD.lon + 0.12,
    rLat: 0.38,
    rLon: 0.52,
    sst: 3.1,
    ssh: 19,
    dLat: -0.0011,
    dLon: -0.0034,
  },
  // Cold-core ring east of Hudson.
  {
    lat0: HUDSON_HEAD.lat - 0.62,
    lon0: HUDSON_HEAD.lon + 1.12,
    rLat: 0.34,
    rLon: 0.48,
    sst: -2.7,
    ssh: -18,
    dLat: -0.0008,
    dLon: -0.0026,
  },
  // Second warm-core south-east of Hydrographer / Lydonia.
  {
    lat0: 39.48,
    lon0: -68.22,
    rLat: 0.3,
    rLon: 0.42,
    sst: 2.4,
    ssh: 15,
    dLat: -0.001,
    dLon: -0.003,
  },
];

function eddyField(
  lat: number,
  lon: number,
  hour: number,
): { sst: number; ssh: number; edge: number } {
  let sst = 0;
  let ssh = 0;
  let edge = 0;
  for (const e of EDDIES) {
    const cy = e.lat0 + hour * e.dLat;
    const cx = e.lon0 + hour * e.dLon;
    const u = (lat - cy) / e.rLat;
    const v = (lon - cx) / e.rLon;
    const r2 = u * u + v * v;
    const g = Math.exp(-r2 / 2);
    sst += e.sst * g;
    ssh += e.ssh * g;
    const ring = r2 * Math.exp(-r2);
    edge += ring;
  }
  return { sst, ssh, edge };
}

function gsCoreOffset(lat: number, hour: number): number {
  const meander =
    0.22 * Math.sin((lat - 38.2) * 1.65 + hour * 0.014) +
    0.1 * Math.cos((lat - 39.4) * 2.4 - hour * 0.01);
  return 0.62 + meander;
}

function texture(lat: number, lon: number, hour: number): number {
  return (
    0.32 * Math.sin(lat * 11.3 + hour * 0.02) * Math.cos(lon * 8.7) +
    0.18 * Math.sin(lat * 4.1 + lon * 6.2 + hour * 0.012)
  );
}

/**
 * August SST (°C). Cooler shelf, Gulf Stream 26–28 seaward of the break,
 * two or three rings, slow westward drift with hour.
 */
export function sstC(lat: number, lon: number, hour = 0): number {
  const packed = samplePackedKind("sst", lat, lon, hour);
  if (packed != null) return packed;
  if (isLand(lat, lon)) return 21.5;
  const brk = shelfBreakLon(lat);
  const beyond = lon - brk;
  let t = 26.4 - (lat - 37) * 0.82;
  if (beyond < 0) {
    const shelf = clamp(-beyond / 1.8, 0, 1);
    t -= shelf * 4.4;
    t -= Math.max(0, lat - 40.1) * 0.55 * shelf;
    // Georges / Nantucket mixing keeps the bank cool.
    const bank =
      Math.exp(-(((lat - 41.1) / 0.7) ** 2) - ((lon - -67.5) / 1.4) ** 2);
    t -= bank * 3.2;
  } else {
    const core = gsCoreOffset(lat, hour);
    const gs = Math.exp(-((beyond - core) ** 2) / (2 * 0.38 ** 2));
    t += gs * 4.5;
    const sargasso = 1 / (1 + Math.exp(-(beyond - core - 0.55) * 3.2));
    t += sargasso * 0.7;
  }
  const ed = eddyField(lat, lon, hour);
  t += ed.sst;
  t += texture(lat, lon, hour);
  t += 0.42 * Math.sin(((hour + 8) / 24) * Math.PI * 2 - 0.35);
  return clamp(t, 15.6, 29.2);
}

/** Chlorophyll-a (mg m⁻³). High on the shelf and color edges, low in Stream blue. */
export function chlorophyll(lat: number, lon: number, hour = 0): number {
  const packed = samplePackedKind("chl", lat, lon, hour);
  if (packed != null) return packed;
  if (isLand(lat, lon)) return 0;
  const brk = shelfBreakLon(lat);
  const beyond = lon - brk;
  const ed = eddyField(lat, lon, hour);
  let chl: number;
  if (beyond < 0) {
    const inner = clamp(-beyond / 1.6, 0, 1);
    chl = 0.55 + inner * 1.7;
    chl += Math.max(0, lat - 40.4) * 0.35 * inner;
    const bank =
      Math.exp(-(((lat - 41.1) / 0.65) ** 2) - ((lon - -67.6) / 1.35) ** 2);
    chl += bank * 1.8;
  } else {
    const core = gsCoreOffset(lat, hour);
    const gs = Math.exp(-((beyond - core) ** 2) / (2 * 0.4 ** 2));
    chl = 0.22 - gs * 0.16;
    chl = Math.max(0.04, chl);
  }
  // Color edges at the north wall and ring peripheries.
  const wall = Math.exp(-((beyond - gsCoreOffset(lat, hour) + 0.15) ** 2) / 0.05);
  chl += wall * 0.55 + ed.edge * 0.9;
  chl *= 1 + 0.08 * Math.sin(lat * 9.4 + lon * 7.1 + hour * 0.018);
  return clamp(chl, 0.03, 8);
}

/** Sea-surface height anomaly (cm). Rings ±20 cm; Stream high on the Sargasso side. */
export function sshCm(lat: number, lon: number, hour = 0): number {
  const packed = samplePackedKind("ssh", lat, lon, hour);
  if (packed != null) return packed;
  if (isLand(lat, lon)) return 0;
  const brk = shelfBreakLon(lat);
  const beyond = lon - brk;
  const core = gsCoreOffset(lat, hour);
  const step = Math.tanh((beyond - core) * 2.4) * 12;
  const ed = eddyField(lat, lon, hour);
  const rip =
    1.4 * Math.sin(lat * 5.2 + lon * 4.1 + hour * 0.02) +
    0.8 * Math.cos(lat * 8.8 - lon * 3.3);
  return clamp(step + ed.ssh + rip - 2, -24, 24);
}

function centeredGradient(
  fn: (lat: number, lon: number, hour: number) => number,
  lat: number,
  lon: number,
  hour: number,
): number {
  const hNm = 1.6;
  const dLat = hNm / 60;
  const dLon = hNm / nmEastPerDeg(lat);
  const dN = fn(lat + dLat, lon, hour) - fn(lat - dLat, lon, hour);
  const dE = fn(lat, lon + dLon, hour) - fn(lat, lon - dLon, hour);
  return Math.hypot(dN, dE) / (2 * hNm);
}

/** SST gradient in °C per nautical mile. */
export function sstGradient(lat: number, lon: number, hour = 0): number {
  return centeredGradient(sstC, lat, lon, hour);
}

/** Chlorophyll gradient in mg m⁻³ per nautical mile. */
export function chlGradient(lat: number, lon: number, hour = 0): number {
  return centeredGradient(chlorophyll, lat, lon, hour);
}

const TEMP_BREAK_C_PER_NM = 0.26;

export function isTempBreak(
  lat: number,
  lon: number,
  hour = 0,
  sensitivity = 1,
): boolean {
  const s = Math.max(0.15, sensitivity);
  return sstGradient(lat, lon, hour) >= TEMP_BREAK_C_PER_NM * s;
}

const COLOR_EDGE_PER_NM = 0.045;

export function isColorEdge(
  lat: number,
  lon: number,
  hour = 0,
  sensitivity = 1,
): boolean {
  const s = Math.max(0.15, sensitivity);
  return chlGradient(lat, lon, hour) >= COLOR_EDGE_PER_NM * s;
}

type RGB = [number, number, number];

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  const u = clamp(t, 0, 1);
  return [
    Math.round(a[0] + (b[0] - a[0]) * u),
    Math.round(a[1] + (b[1] - a[1]) * u),
    Math.round(a[2] + (b[2] - a[2]) * u),
  ];
}

function sampleStops(stops: { v: number; c: RGB }[], v: number): RGB {
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (v <= first.v) return first.c;
  for (let i = 1; i < stops.length; i++) {
    const b = stops[i]!;
    const a = stops[i - 1]!;
    if (v <= b.v) {
      const t = (v - a.v) / (b.v - a.v || 1e-9);
      return lerpRGB(a.c, b.c, t);
    }
  }
  return last.c;
}

const LAND: RGB = [0x1a, 0x2a, 0x22];
const LAGOON: RGB = [0x4e, 0xcd, 0xc4];
const GOLD: RGB = [0xe4, 0xb5, 0x6a];
const DARK: RGB = [10, 16, 22];

const SST_STOPS: { v: number; c: RGB }[] = [
  { v: 16, c: [8, 28, 78] },
  { v: 20, c: [32, 188, 206] },
  { v: 22, c: [46, 168, 88] },
  { v: 24, c: GOLD },
  { v: 26, c: [232, 118, 46] },
  { v: 28, c: [214, 86, 128] },
];

const DEPTH_STOPS: { v: number; c: RGB }[] = [
  { v: 8, c: [198, 176, 128] },
  { v: 40, c: [168, 150, 108] },
  { v: 180, c: [28, 96, 102] },
  { v: 900, c: [12, 48, 78] },
  { v: 2500, c: [8, 28, 58] },
  { v: 4200, c: [7, 16, 22] },
];

export function colorizeSst(c: number): [number, number, number, number] {
  const rgb = sampleStops(SST_STOPS, c);
  return [rgb[0], rgb[1], rgb[2], 255];
}

export function colorizeChl(mg: number): [number, number, number, number] {
  const logv = Math.log10(Math.max(0.03, mg));
  const stops: { v: number; c: RGB }[] = [
    { v: Math.log10(0.03), c: [4, 10, 28] },
    { v: Math.log10(0.12), c: [8, 32, 78] },
    { v: Math.log10(0.5), c: [16, 110, 92] },
    { v: Math.log10(1.6), c: [48, 196, 78] },
    { v: Math.log10(5), c: [170, 230, 72] },
  ];
  const rgb = sampleStops(stops, logv);
  return [rgb[0], rgb[1], rgb[2], 255];
}

export function colorizeSsh(cm: number): [number, number, number, number] {
  const t = clamp(cm / 22, -1, 1);
  const rgb = t < 0 ? lerpRGB(DARK, LAGOON, -t) : lerpRGB(DARK, GOLD, t);
  return [rgb[0], rgb[1], rgb[2], 255];
}

export function colorizeDepth(m: number): [number, number, number, number] {
  if (m < 0) return [LAND[0], LAND[1], LAND[2], 255];
  const rgb = sampleStops(DEPTH_STOPS, m);
  return [rgb[0], rgb[1], rgb[2], 255];
}

export function colorizerFor(kind: RasterKind): Colorizer {
  switch (kind) {
    case "sst":
      return colorizeSst;
    case "chl":
      return colorizeChl;
    case "ssh":
      return colorizeSsh;
    case "depth":
      return colorizeDepth;
  }
}

function sampleKind(kind: RasterKind, lat: number, lon: number, hour: number): number {
  switch (kind) {
    case "sst":
      return sstC(lat, lon, hour);
    case "chl":
      return chlorophyll(lat, lon, hour);
    case "ssh":
      return sshCm(lat, lon, hour);
    case "depth":
      return depthM(lat, lon);
  }
}

function colorFor(
  kind: RasterKind,
  lat: number,
  lon: number,
  hour: number,
): [number, number, number, number] {
  if (kind !== "depth" && isLand(lat, lon)) {
    return [LAND[0], LAND[1], LAND[2], 255];
  }
  return colorizerFor(kind)(sampleKind(kind, lat, lon, hour));
}

/** Colorized RGBA raster of the operating box. North is the top row. */
export function buildRaster(
  kind: RasterKind,
  hour: number,
  width: number,
  height: number,
): OceanRaster {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const { west, east, south, north } = REGION;
  const data = new Uint8ClampedArray(w * h * 4);
  const dLon = w === 1 ? 0 : (east - west) / (w - 1);
  const dLat = h === 1 ? 0 : (north - south) / (h - 1);
  for (let y = 0; y < h; y++) {
    const lat = north - dLat * y;
    for (let x = 0; x < w; x++) {
      const lon = west + dLon * x;
      const [r, g, b, a] = colorFor(kind, lat, lon, hour);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { data, width: w, height: h, west, east, south, north };
}

/**
 * Paint a raster onto a canvas and return a PNG data URL.
 * SSR-safe: returns null when `document` is missing.
 *
 * `data` is RGBA (`w*h*4`) when `colorizer` is omitted, or one scalar byte
 * per pixel (`w*h`) when a colorizer is supplied.
 */
export function rasterToDataUrl(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  colorizer?: Colorizer,
): string | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  if (colorizer && data.length === w * h) {
    for (let i = 0; i < data.length; i++) {
      const [r, g, b, a] = colorizer((data[i] ?? 0) / 255);
      const o = i * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = a;
    }
  } else if (colorizer && data.length >= w * h * 4) {
    for (let i = 0; i < w * h; i++) {
      const [r, g, b, a] = colorizer((data[i * 4] ?? 0) / 255);
      const o = i * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = a;
    }
  } else {
    img.data.set(data.subarray(0, w * h * 4));
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}
