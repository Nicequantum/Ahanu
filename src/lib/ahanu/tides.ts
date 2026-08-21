import { coastLon, isLand, shelfBreakLon } from "./bathymetry";
import { MONTAUK, NEWPORT, POINT_JUDITH } from "./constants";
import { haversineNm, toRad } from "./geo";
import { getPackedOcean } from "./packed-fields";

export interface TideConstituent {
  H: number;
  G: number;
}

export interface TideStation {
  name: string;
  lat: number;
  lon: number;
  m2: TideConstituent;
  s2: TideConstituent;
  n2: TideConstituent;
  floodDir: number;
}

export interface TideState {
  heightFt: number;
  rising: boolean;
  nextSlack: Date;
  floodDir: number;
}

export interface CurrentState {
  speedKt: number;
  dir: number;
}

const WOODS_HOLE = { lat: 41.5236, lon: -70.6731 };

/** Amplitudes in feet, Greenwich-ish phases in degrees. */
export const TIDE_STATIONS: readonly TideStation[] = [
  {
    name: "Newport",
    lat: NEWPORT.lat,
    lon: NEWPORT.lon,
    m2: { H: 1.75, G: 218 },
    s2: { H: 0.36, G: 242 },
    n2: { H: 0.39, G: 198 },
    floodDir: 352,
  },
  {
    name: "Point Judith",
    lat: POINT_JUDITH.lat,
    lon: POINT_JUDITH.lon,
    m2: { H: 1.58, G: 214 },
    s2: { H: 0.32, G: 238 },
    n2: { H: 0.36, G: 194 },
    floodDir: 318,
  },
  {
    name: "Montauk",
    lat: MONTAUK.lat,
    lon: MONTAUK.lon,
    m2: { H: 0.98, G: 228 },
    s2: { H: 0.2, G: 250 },
    n2: { H: 0.22, G: 208 },
    floodDir: 268,
  },
  {
    name: "Woods Hole",
    lat: WOODS_HOLE.lat,
    lon: WOODS_HOLE.lon,
    m2: { H: 0.7, G: 196 },
    s2: { H: 0.16, G: 220 },
    n2: { H: 0.15, G: 178 },
    floodDir: 52,
  },
];

const OMEGA_M2 = 28.984104221; // deg / hour
const OMEGA_S2 = 30.0;
const OMEGA_N2 = 28.439729531;
const EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}

function hoursSinceEpoch(date: Date): number {
  return (date.getTime() - EPOCH_MS) / 3_600_000;
}

function arg(omega: number, hours: number, G: number): number {
  return toRad(omega * hours - G);
}

function heightAt(st: TideStation, hours: number): number {
  return (
    st.m2.H * Math.cos(arg(OMEGA_M2, hours, st.m2.G)) +
    st.s2.H * Math.cos(arg(OMEGA_S2, hours, st.s2.G)) +
    st.n2.H * Math.cos(arg(OMEGA_N2, hours, st.n2.G))
  );
}

function dhdtAt(st: TideStation, hours: number): number {
  const radH = Math.PI / 180;
  return (
    -st.m2.H * OMEGA_M2 * radH * Math.sin(arg(OMEGA_M2, hours, st.m2.G)) +
    -st.s2.H * OMEGA_S2 * radH * Math.sin(arg(OMEGA_S2, hours, st.s2.G)) +
    -st.n2.H * OMEGA_N2 * radH * Math.sin(arg(OMEGA_N2, hours, st.n2.G))
  );
}

function nearestStation(lat: number, lon: number): TideStation {
  const p = { lat, lon };
  let best = TIDE_STATIONS[0]!;
  let bestD = Infinity;
  for (const st of TIDE_STATIONS) {
    const d = haversineNm(p, { lat: st.lat, lon: st.lon });
    if (d < bestD) {
      bestD = d;
      best = st;
    }
  }
  return best;
}

function blended(lat: number, lon: number): { H: (h: number) => number; dH: (h: number) => number; floodDir: number } {
  const p = { lat, lon };
  const weights: { st: TideStation; w: number }[] = [];
  let sum = 0;
  for (const st of TIDE_STATIONS) {
    const d = Math.max(0.08, haversineNm(p, { lat: st.lat, lon: st.lon }));
    const w = 1 / (d * d);
    weights.push({ st, w });
    sum += w;
  }
  const inv = sum > 0 ? 1 / sum : 1;
  return {
    H: (h) => {
      let v = 0;
      for (const { st, w } of weights) v += heightAt(st, h) * w * inv;
      return v;
    },
    dH: (h) => {
      let v = 0;
      for (const { st, w } of weights) v += dhdtAt(st, h) * w * inv;
      return v;
    },
    floodDir: (() => {
      let x = 0;
      let y = 0;
      for (const { st, w } of weights) {
        const r = toRad(st.floodDir);
        x += Math.cos(r) * w * inv;
        y += Math.sin(r) * w * inv;
      }
      return (Math.atan2(y, x) * 180) / Math.PI;
    })(),
  };
}

function nextSlackHours(dH: (h: number) => number, hours: number): number {
  const dt = 1 / 12; // 5 minutes
  let prev = dH(hours);
  for (let i = 1; i <= 160; i++) {
    const t = hours + i * dt;
    const cur = dH(t);
    if (prev === 0) return hours;
    if (prev * cur <= 0) {
      const frac = Math.abs(prev) / (Math.abs(prev) + Math.abs(cur) || 1e-9);
      return hours + (i - 1) * dt + frac * dt;
    }
    prev = cur;
  }
  return hours + 6.21;
}

function packedTideAt(lat: number, lon: number, date: Date): TideState | null {
  const tides = getPackedOcean()?.tides;
  if (!tides?.stations?.length) return null;
  const t = date.getTime();
  let best = tides.stations[0]!;
  let bestD = Infinity;
  for (const st of tides.stations) {
    const d = haversineNm({ lat, lon }, { lat: st.lat, lon: st.lon });
    if (d < bestD) {
      bestD = d;
      best = st;
    }
  }
  const series = best.series ?? [];
  if (series.length < 2) return null;
  let i = 0;
  while (i < series.length - 2 && Date.parse(series[i + 1]!.at) <= t) i += 1;
  const a = series[i]!;
  const b = series[Math.min(i + 1, series.length - 1)]!;
  const ta = Date.parse(a.at);
  const tb = Date.parse(b.at);
  const u = tb === ta ? 0 : clamp((t - ta) / (tb - ta), 0, 1);
  const heightFt = a.heightFt + (b.heightFt - a.heightFt) * u;
  const rising = b.heightFt >= a.heightFt;
  let nextSlack = new Date(tb);
  const hilo = best.hilo ?? [];
  for (const h of hilo) {
    const ht = Date.parse(h.at);
    if (ht >= t - 60_000) {
      nextSlack = new Date(ht);
      break;
    }
  }
  const local = nearestStation(lat, lon);
  return {
    heightFt,
    rising,
    nextSlack,
    floodDir: local.floodDir,
  };
}

/**
 * Prefer packed CO-OPS / fixture series when a pack is loaded.
 * Otherwise harmonic tide (M2+S2+N2) from Newport, Point Judith, Montauk, Woods Hole.
 */
export function tideAt(lat: number, lon: number, date: Date): TideState {
  const packed = packedTideAt(lat, lon, date);
  if (packed) return packed;
  const blend = blended(lat, lon);
  const hours = hoursSinceEpoch(date);
  const heightFt = blend.H(hours);
  const slope = blend.dH(hours);
  const slackH = nextSlackHours(blend.dH, hours);
  const floodDir = ((blend.floodDir % 360) + 360) % 360;
  return {
    heightFt,
    rising: slope > 0,
    nextSlack: new Date(EPOCH_MS + slackH * 3_600_000),
    floodDir,
  };
}

function alongBreakDir(lat: number): number {
  // Isobath heading, flowing eastward along the 100-fathom curve.
  const a = shelfBreakLon(lat - 0.12);
  const b = shelfBreakLon(lat + 0.12);
  const dLon = b - a;
  const dLat = 0.24;
  const east = dLon * 60 * Math.cos(toRad(lat));
  const north = dLat * 60;
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}

function addVectors(
  s1: number,
  d1: number,
  s2: number,
  d2: number,
): { speedKt: number; dir: number } {
  const x = s1 * Math.sin(toRad(d1)) + s2 * Math.sin(toRad(d2));
  const y = s1 * Math.cos(toRad(d1)) + s2 * Math.cos(toRad(d2));
  return {
    speedKt: Math.hypot(x, y),
    dir: (Math.atan2(x, y) * 180) / Math.PI,
  };
}

/**
 * Residual shelf-break jet (~0.4–1.2 kt eastward) plus the tidal stream.
 * `dir` is the direction the water is going toward.
 */
export function currentAt(lat: number, lon: number, date: Date): CurrentState {
  if (isLand(lat, lon)) return { speedKt: 0, dir: 0 };
  const tide = tideAt(lat, lon, date);
  const hours = hoursSinceEpoch(date);
  const st = nearestStation(lat, lon);
  const dH = dhdtAt(st, hours);
  const tidalKt = clamp(Math.abs(dH) * 0.85, 0, 2.1);
  const ebbDir = (tide.floodDir + 180) % 360;
  const tidalDir = dH > 0 ? tide.floodDir : ebbDir;

  const brk = shelfBreakLon(lat);
  const coast = coastLon(lat);
  const dist = lon - brk;
  const jetKt = 0.42 + 0.78 * Math.exp(-(dist * dist) / (2 * 0.38 ** 2));
  const inshore = clamp((lon - coast) / Math.max(0.15, brk - coast), 0, 1);
  const residual = jetKt * (0.35 + 0.65 * inshore);
  const jetDir = alongBreakDir(lat);

  const { speedKt, dir } = addVectors(tidalKt * (0.55 + 0.35 * (1 - inshore)), tidalDir, residual, jetDir);
  return { speedKt, dir: ((dir % 360) + 360) % 360 };
}

export { WOODS_HOLE };
