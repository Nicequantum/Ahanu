import { toDeg, toRad } from "./geo";

export interface MoonPhaseInfo {
  phase: number;
  name: string;
}

export interface SunTimes {
  sunrise: Date;
  sunset: Date;
  noon: Date;
}

export interface MoonTimes {
  moonrise: Date | null;
  moonset: Date | null;
  transit: Date | null;
  underfoot: Date | null;
}

export interface SolunarPeriods {
  major: [Date, Date][];
  minor: [Date, Date][];
  score: number;
  rating: string;
}

const SYNODIC = 29.530588853;
const KNOWN_NEW = Date.UTC(2000, 0, 6, 18, 14, 0);

function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}

function julianDate(date: Date): number {
  return date.getTime() / 86_400_000 + 2_440_587.5;
}

function localMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function wrap360(d: number): number {
  return ((d % 360) + 360) % 360;
}

export function moonPhase(date: Date): MoonPhaseInfo {
  const days = (date.getTime() - KNOWN_NEW) / 86_400_000;
  const phase = ((days / SYNODIC) % 1 + 1) % 1;
  let name: string;
  if (phase < 0.03 || phase >= 0.97) name = "New";
  else if (phase < 0.22) name = "Waxing Crescent";
  else if (phase < 0.28) name = "First Quarter";
  else if (phase < 0.47) name = "Waxing Gibbous";
  else if (phase < 0.53) name = "Full";
  else if (phase < 0.72) name = "Waning Gibbous";
  else if (phase < 0.78) name = "Last Quarter";
  else name = "Waning Crescent";
  return { phase, name };
}

/** NOAA solar calculator for the local calendar day. */
export function sunTimes(lat: number, lon: number, date: Date): SunTimes {
  const y = date.getFullYear();
  const mo = date.getMonth();
  const d = date.getDate();
  const utc0 = Date.UTC(y, mo, d);
  const doy = (utc0 - Date.UTC(y, 0, 0)) / 86_400_000;
  const gamma = ((2 * Math.PI) / 365) * (doy - 1 + (12 - lon / 15) / 24);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const dec =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const latR = toRad(lat);
  const zenith = toRad(90.833);
  const cosHa =
    (Math.cos(zenith) - Math.sin(latR) * Math.sin(dec)) /
    (Math.cos(latR) * Math.cos(dec));
  const ha = toDeg(Math.acos(clamp(cosHa, -1, 1)));
  const noonMin = 720 - 4 * lon - eqTime;
  return {
    sunrise: new Date(utc0 + (noonMin - 4 * ha) * 60_000),
    sunset: new Date(utc0 + (noonMin + 4 * ha) * 60_000),
    noon: new Date(utc0 + noonMin * 60_000),
  };
}

function moonLonLat(jd: number): { lon: number; lat: number } {
  const T = (jd - 2_451_545) / 36_525;
  const Lp = wrap360(218.3164477 + 481_267.88123421 * T);
  const D = wrap360(297.8501921 + 445_267.1114034 * T);
  const M = wrap360(134.9633964 + 477_198.8673981 * T);
  const Mp = wrap360(357.5291092 + 35_999.0502909 * T);
  const F = wrap360(93.272095 + 483_202.0175233 * T);
  const Dr = toRad(D);
  const Mr = toRad(M);
  const Mpr = toRad(Mp);
  const Fr = toRad(F);
  const lon =
    Lp +
    6.289 * Math.sin(Mr) +
    1.274 * Math.sin(2 * Dr - Mr) +
    0.658 * Math.sin(2 * Dr) +
    0.214 * Math.sin(2 * Mr) -
    0.186 * Math.sin(Mpr) -
    0.114 * Math.sin(2 * Fr);
  const lat =
    5.128 * Math.sin(Fr) +
    0.281 * Math.sin(Mr + Fr) +
    0.278 * Math.sin(Mr - Fr) +
    0.173 * Math.sin(2 * Dr - Fr);
  return { lon: wrap360(lon), lat };
}

function eclipticToDecRa(lon: number, lat: number, jd: number): { dec: number; ra: number } {
  const T = (jd - 2_451_545) / 36_525;
  const eps = toRad(23.439291 - 0.0130042 * T);
  const L = toRad(lon);
  const B = toRad(lat);
  const dec = Math.asin(Math.sin(B) * Math.cos(eps) + Math.cos(B) * Math.sin(eps) * Math.sin(L));
  const ra = Math.atan2(
    Math.sin(L) * Math.cos(eps) - Math.tan(B) * Math.sin(eps),
    Math.cos(L),
  );
  return { dec, ra };
}

function gmstRad(jd: number): number {
  const T = (jd - 2_451_545) / 36_525;
  const st =
    280.46061837 +
    360.98564736629 * (jd - 2_451_545) +
    0.000387933 * T * T;
  return toRad(wrap360(st));
}

function moonAltitude(lat: number, lon: number, date: Date): number {
  const jd = julianDate(date);
  const { lon: elon, lat: elat } = moonLonLat(jd);
  const { dec, ra } = eclipticToDecRa(elon, elat, jd);
  const lst = gmstRad(jd) + toRad(lon);
  const ha = lst - ra;
  const latR = toRad(lat);
  return Math.asin(
    Math.sin(latR) * Math.sin(dec) + Math.cos(latR) * Math.cos(dec) * Math.cos(ha),
  );
}

function interpolateZero(t0: number, a0: number, t1: number, a1: number): number {
  const frac = Math.abs(a0) / (Math.abs(a0) + Math.abs(a1) || 1e-12);
  return t0 + (t1 - t0) * frac;
}

/**
 * Approximate moonrise / moonset / transit for the local calendar day.
 * Samples the lunar altitude; good enough for solunar windows.
 */
export function moonTimes(lat: number, lon: number, date: Date): MoonTimes {
  const start = localMidnight(date);
  const stepMs = 10 * 60_000;
  const horizon = toRad(-0.125);
  let moonrise: Date | null = null;
  let moonset: Date | null = null;
  let transit: Date | null = null;
  let underfoot: Date | null = null;
  let maxAlt = -Infinity;
  let minAlt = Infinity;
  let prevAlt = moonAltitude(lat, lon, start) - horizon;
  let prevT = start.getTime();

  for (let i = 1; i <= 144; i++) {
    const t = start.getTime() + i * stepMs;
    const alt = moonAltitude(lat, lon, new Date(t)) - horizon;
    if (alt > maxAlt) {
      maxAlt = alt;
      transit = new Date(t);
    }
    if (alt < minAlt) {
      minAlt = alt;
      underfoot = new Date(t);
    }
    if (prevAlt < 0 && alt >= 0 && !moonrise) {
      moonrise = new Date(interpolateZero(prevT, prevAlt, t, alt));
    }
    if (prevAlt >= 0 && alt < 0 && !moonset) {
      moonset = new Date(interpolateZero(prevT, prevAlt, t, alt));
    }
    prevAlt = alt;
    prevT = t;
  }

  // If set happened before rise on this civil day, look once more after rise.
  if (moonrise && moonset && moonset.getTime() < moonrise.getTime()) {
    moonset = null;
    prevAlt = moonAltitude(lat, lon, moonrise) - horizon;
    prevT = moonrise.getTime();
    for (let t = prevT + stepMs; t <= start.getTime() + 24 * 3600_000; t += stepMs) {
      const alt = moonAltitude(lat, lon, new Date(t)) - horizon;
      if (prevAlt >= 0 && alt < 0) {
        moonset = new Date(interpolateZero(prevT, prevAlt, t, alt));
        break;
      }
      prevAlt = alt;
      prevT = t;
    }
  }

  return { moonrise, moonset, transit, underfoot };
}

function windowAround(center: Date, halfHours: number): [Date, Date] {
  const ms = halfHours * 3_600_000;
  return [new Date(center.getTime() - ms), new Date(center.getTime() + ms)];
}

function ratingFor(score: number): string {
  if (score >= 80) return "Excellent";
  if (score >= 65) return "Very Good";
  if (score >= 50) return "Good";
  if (score >= 35) return "Fair";
  return "Poor";
}

/**
 * Major = moon transit & underfoot ±1 h; minor = moonrise/set ±0.5 h.
 * Scores run higher near new and full moon.
 */
export function solunarPeriods(lat: number, lon: number, date: Date): SolunarPeriods {
  const moon = moonTimes(lat, lon, date);
  const sun = sunTimes(lat, lon, date);
  const { phase } = moonPhase(date);

  const major: [Date, Date][] = [];
  const minor: [Date, Date][] = [];
  if (moon.transit) major.push(windowAround(moon.transit, 1));
  if (moon.underfoot) major.push(windowAround(moon.underfoot, 1));
  if (moon.moonrise) minor.push(windowAround(moon.moonrise, 0.5));
  if (moon.moonset) minor.push(windowAround(moon.moonset, 0.5));

  const toNew = Math.min(phase, 1 - phase);
  const toFull = Math.abs(phase - 0.5);
  const syzygy = 1 - Math.min(toNew, toFull) / 0.25;
  let score = 30 + 58 * clamp(syzygy, 0, 1);

  if (moon.transit) {
    const dt = Math.abs(moon.transit.getTime() - sun.sunrise.getTime()) / 3_600_000;
    if (dt < 2) score += 8;
    const dtDusk = Math.abs(moon.transit.getTime() - sun.sunset.getTime()) / 3_600_000;
    if (dtDusk < 2) score += 5;
  }
  score = clamp(Math.round(score), 0, 100);

  return { major, minor, score, rating: ratingFor(score) };
}

/** Local 24-hour clock `HH:MM`. */
export function formatClock(d: Date): string {
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}
