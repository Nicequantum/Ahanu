import { METERS_PER_NM, NM_PER_DEG_LAT } from "./constants";
import type { LatLon } from "./types";

const R_NM = 3440.065; // Earth radius in nautical miles

export function toRad(d: number) {
  return (d * Math.PI) / 180;
}
export function toDeg(r: number) {
  return (r * 180) / Math.PI;
}

export function haversineNm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function initialBearing(a: LatLon, b: LatLon): number {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function destination(start: LatLon, bearingDeg: number, nm: number): LatLon {
  const dR = nm / R_NM;
  const br = toRad(bearingDeg);
  const lat1 = toRad(start.lat);
  const lon1 = toRad(start.lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dR) + Math.cos(lat1) * Math.sin(dR) * Math.cos(br),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(br) * Math.sin(dR) * Math.cos(lat1),
      Math.cos(dR) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
}

export function alongTrack(a: LatLon, b: LatLon, t: number): LatLon {
  const nm = haversineNm(a, b);
  if (nm < 1e-6) return a;
  return destination(a, initialBearing(a, b), nm * t);
}

export function pathLengthNm(pts: LatLon[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += haversineNm(pts[i - 1]!, pts[i]!);
  return n;
}

export function interpolatePath(pts: LatLon[], t: number): { pos: LatLon; cog: number } {
  if (pts.length === 0) return { pos: { lat: 0, lon: 0 }, cog: 0 };
  if (pts.length === 1) return { pos: pts[0]!, cog: 0 };
  const total = pathLengthNm(pts);
  let remain = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = haversineNm(a, b);
    if (remain <= seg || i === pts.length - 1) {
      const u = seg < 1e-6 ? 0 : remain / seg;
      return { pos: alongTrack(a, b, u), cog: initialBearing(a, b) };
    }
    remain -= seg;
  }
  const last = pts[pts.length - 1]!;
  return { pos: last, cog: initialBearing(pts[pts.length - 2]!, last) };
}

export function nmToLatLonDelta(lat: number, dNmNorth: number, dNmEast: number): LatLon {
  return {
    lat: dNmNorth / NM_PER_DEG_LAT,
    lon: dNmEast / (NM_PER_DEG_LAT * Math.cos(toRad(lat))),
  };
}

export function formatLat(lat: number): string {
  const hem = lat >= 0 ? "N" : "S";
  const a = Math.abs(lat);
  const d = Math.floor(a);
  const m = (a - d) * 60;
  return `${d}°${m.toFixed(3).padStart(6, "0")}'${hem}`;
}

export function formatLon(lon: number): string {
  const hem = lon >= 0 ? "E" : "W";
  const a = Math.abs(lon);
  const d = Math.floor(a);
  const m = (a - d) * 60;
  return `${d}°${m.toFixed(3).padStart(6, "0")}'${hem}`;
}

export function formatCoord(p: LatLon): string {
  return `${formatLat(p.lat)}  ${formatLon(p.lon)}`;
}

export function compass(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]!;
}

export function metersToFathoms(m: number) {
  return m / 1.8288;
}

export function metersToFeet(m: number) {
  return m * 3.28084;
}

export function hoursToHm(h: number): string {
  const s = Math.max(0, h);
  const hh = Math.floor(s);
  const mm = Math.round((s - hh) * 60);
  return `${hh}h ${mm.toString().padStart(2, "0")}m`;
}

export function lonLatToXY(p: LatLon, origin: LatLon): { x: number; y: number } {
  const dLat = p.lat - origin.lat;
  const dLon = p.lon - origin.lon;
  return {
    x: dLon * NM_PER_DEG_LAT * Math.cos(toRad(origin.lat)) * METERS_PER_NM,
    y: dLat * NM_PER_DEG_LAT * METERS_PER_NM,
  };
}

/** Closed ring as lon/lat pairs, clockwise from north. */
export function circlePoints(center: LatLon, radiusNm: number, n = 64): LatLon[] {
  const pts: LatLon[] = [];
  const steps = Math.max(8, n);
  for (let i = 0; i < steps; i++) {
    pts.push(destination(center, (i / steps) * 360, radiusNm));
  }
  pts.push(pts[0]!);
  return pts;
}

export function circleRingGeo(
  center: LatLon,
  radiusNm: number,
  n = 64,
): GeoJSON.FeatureCollection {
  const ring = circlePoints(center, radiusNm, n).map((p) => [p.lon, p.lat] as [number, number]);
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { radiusNm },
        geometry: { type: "LineString", coordinates: ring },
      },
    ],
  };
}

export function measureSummary(pts: LatLon[]): { nm: number; bearing: number; legs: number } {
  if (pts.length < 2) return { nm: 0, bearing: 0, legs: 0 };
  return {
    nm: pathLengthNm(pts),
    bearing: initialBearing(pts[pts.length - 2]!, pts[pts.length - 1]!),
    legs: pts.length - 1,
  };
}

