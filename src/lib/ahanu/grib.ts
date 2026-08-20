import { coastLon, isLand, shelfBreakLon } from "./bathymetry";
import { DEFAULT_BOAT, FORECAST_HOURS } from "./constants";
import { haversineNm } from "./geo";
import type { ForecastHour, GoNoGo, LatLon } from "./types";
import { samplePackedKind } from "./packed-fields";

export interface GribPoint {
  windKt: number;
  windDir: number;
  gustKt: number;
  waveFt: number;
  swellFt: number;
  swellDir: number;
  periodS: number;
  pressureMb: number;
  precipMm: number;
  visNm: number;
}

export interface RouteWeatherLeg {
  from: LatLon;
  to: LatLon;
  nm: number;
  hour: number;
  windKt: number;
  windDir: number;
  gustKt: number;
  waveFt: number;
  swellFt: number;
  swellDir: number;
  periodS: number;
  pressureMb: number;
  precipMm: number;
  visNm: number;
  go: GoNoGo;
}

export interface RouteWeather {
  legs: RouteWeatherLeg[];
  overall: GoNoGo;
  hours: number;
  nm: number;
}

function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}

function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Front envelope: quiet 0–24, peak ~36, cleaning after 48. */
function frontIntensity(hour: number): number {
  if (hour < 20) return 0;
  if (hour < 36) return smoothstep((hour - 20) / 16);
  if (hour < 40) return 1;
  if (hour < 54) return 1 - smoothstep((hour - 40) / 14);
  return 0.07 * Math.exp(-(hour - 54) / 12);
}

function exposure(lat: number, lon: number): number {
  const brk = shelfBreakLon(lat);
  const coast = coastLon(lat);
  const span = Math.max(0.2, brk - coast);
  // 0 inner shelf / lee, 1 open slope and abyss.
  return smoothstep((lon - brk + span * 0.35) / (span * 0.7 + 0.5));
}

function spatial(lat: number, lon: number): number {
  return Math.sin(lat * 2.15 + lon * 1.4) * 0.5 + Math.cos(lat * 4.7 - lon * 2.2) * 0.35;
}

/**
 * Deterministic 72 h weather story.
 * Hours 0–24 fair SW 10–16 kt; 24–40 a front (22–30 kt, 7–11 ft near h36);
 * 48–72 improving. Open slope is lumpier than the lee of the shelf.
 */
function syntheticGrib(lat: number, lon: number, hour: number): GribPoint {
  const h = hour;
  const front = frontIntensity(h);
  const exp = isLand(lat, lon) ? 0 : exposure(lat, lon);
  const tex = spatial(lat, lon);
  const tod = (8 + h) % 24;
  const seaBreeze =
    (1 - front) * (1 - exp) * 2.2 * Math.max(0, Math.sin(((tod - 9) / 12) * Math.PI));

  const fairWind = 12.4 + 2.6 * Math.sin(h * 0.22 + tex) + 1.1 * (h / 24) * (h < 24 ? 1 : 0);
  const windKt = clamp(fairWind + seaBreeze + front * (13.5 + 3.2 * tex + 1.4 * exp), 4, 34);
  const windDir = (225 + front * 62 + tex * 8 + seaBreeze * 6 + 360) % 360;
  const gustKt = windKt * (1.12 + front * 0.22 + exp * 0.04);

  const fairWave = 2.15 + 1.45 * exp;
  const waveFt = clamp(fairWave + front * (5.1 + 3.1 * exp) + tex * 0.35, 0.6, 14);
  const swellFt = clamp(waveFt * (0.62 + front * 0.18) + exp * 0.4, 0.4, 12);
  const swellDir = (215 + front * 55 + tex * 6 + 360) % 360;
  const periodS = clamp(5.6 + exp * 1.4 + front * 4.2, 4, 13);

  const pressureMb = 1021.5 - front * 15.5 - tex * 0.8 - exp * 0.6;
  const precipMm = front * (1.2 + 4.4 * smoothstep(1 - Math.abs(h - 36) / 10));
  const visNm = clamp(10.5 - front * 5.4 - precipMm * 0.35, 2.2, 11);

  return {
    windKt,
    windDir,
    gustKt,
    waveFt,
    swellFt,
    swellDir,
    periodS,
    pressureMb,
    precipMm,
    visNm,
  };
}

export function gribAt(lat: number, lon: number, hour: number): GribPoint {
  const syn = syntheticGrib(lat, lon, hour);
  const packedWind = samplePackedKind("windKt", lat, lon, hour);
  const packedWave = samplePackedKind("waveFt", lat, lon, hour);
  if (packedWind == null && packedWave == null) return syn;
  return {
    ...syn,
    windKt: packedWind ?? syn.windKt,
    gustKt: packedWind != null ? packedWind * 1.18 : syn.gustKt,
    waveFt: packedWave ?? syn.waveFt,
    swellFt: packedWave != null ? packedWave * 0.7 : syn.swellFt,
  };
}

export function scoreGoNoGo(
  windKt: number,
  waveFt: number,
  limits: { maxWindKt: number; maxWaveFt: number },
): GoNoGo {
  const w = limits.maxWindKt > 0 ? windKt / limits.maxWindKt : 1;
  const v = limits.maxWaveFt > 0 ? waveFt / limits.maxWaveFt : 1;
  const worst = Math.max(w, v);
  if (worst < 0.8) return "go";
  if (worst < 1) return "caution";
  return "no-go";
}

function worse(a: GoNoGo, b: GoNoGo): GoNoGo {
  const rank: Record<GoNoGo, number> = { go: 0, caution: 1, "no-go": 2 };
  return rank[a] >= rank[b] ? a : b;
}

/** 0..72 h every 3 hours at a single point. */
export function forecastSeries(lat: number, lon: number): ForecastHour[] {
  const limits = { maxWindKt: DEFAULT_BOAT.maxWindKt, maxWaveFt: DEFAULT_BOAT.maxWaveFt };
  const out: ForecastHour[] = [];
  for (let hour = 0; hour <= FORECAST_HOURS; hour += 3) {
    const g = gribAt(lat, lon, hour);
    out.push({
      hour,
      ...g,
      go: scoreGoNoGo(g.windKt, g.waveFt, limits),
    });
  }
  return out;
}

export function routeWeather(
  points: LatLon[],
  cruiseKt: number,
  startHour: number,
  limits: { maxWindKt: number; maxWaveFt: number },
): RouteWeather {
  const spd = Math.max(0.1, cruiseKt);
  if (points.length < 2) {
    const p = points[0];
    if (!p) {
      return { legs: [], overall: "go", hours: 0, nm: 0 };
    }
    const g = gribAt(p.lat, p.lon, startHour);
    return {
      legs: [],
      overall: scoreGoNoGo(g.windKt, g.waveFt, limits),
      hours: 0,
      nm: 0,
    };
  }

  const legs: RouteWeatherLeg[] = [];
  let t = startHour;
  let totalNm = 0;
  let overall: GoNoGo = "go";

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]!;
    const to = points[i]!;
    const nm = haversineNm(from, to);
    const hour = t + nm / (2 * spd);
    const lat = (from.lat + to.lat) / 2;
    const lon = (from.lon + to.lon) / 2;
    const g = gribAt(lat, lon, hour);
    const go = scoreGoNoGo(g.windKt, g.waveFt, limits);
    overall = worse(overall, go);
    legs.push({
      from,
      to,
      nm,
      hour,
      windKt: g.windKt,
      windDir: g.windDir,
      gustKt: g.gustKt,
      waveFt: g.waveFt,
      swellFt: g.swellFt,
      swellDir: g.swellDir,
      periodS: g.periodS,
      pressureMb: g.pressureMb,
      precipMm: g.precipMm,
      visNm: g.visNm,
      go,
    });
    totalNm += nm;
    t += nm / spd;
  }

  return { legs, overall, hours: t - startHour, nm: totalNm };
}
