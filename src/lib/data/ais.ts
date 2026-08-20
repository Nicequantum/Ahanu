/** DEMO/GATEWAY simulated AIS. Adapter boundary for a future NMEA/Wi-Fi gateway — not a live feed. */

import { CANYONS } from "@/lib/data/canyons";
import {
  ATLANTIS_HEAD,
  HUDSON_HEAD,
  HYDRO_HEAD,
  MONTAUK,
  POINT_JUDITH,
  VEATCH_HEAD,
} from "@/lib/ahanu/constants";
import { destination, haversineNm, initialBearing } from "@/lib/ahanu/geo";
import type { LatLon } from "@/lib/ahanu/types";

export type AisShipType = "fishing" | "tanker" | "cargo" | "pleasure" | "tug";

export interface AisTarget {
  mmsi: string;
  name: string;
  type: AisShipType;
  lat: number;
  lon: number;
  cog: number;
  sog: number;
  heading: number;
  lengthM: number;
  destination: string;
}

interface Spec {
  mmsi: string;
  name: string;
  type: AisShipType;
  lengthM: number;
  dest: string;
  role: "troll" | "tssE" | "tssW" | "pleasure" | "tug" | "sword";
  canyon?: string;
  sog: number;
  phase: number;
  offsetNm: number;
}

const FLEET: readonly Spec[] = [
  { mmsi: "367812041", name: "Laughing Gull", type: "fishing", lengthM: 18, dest: "VEATCH W WALL", role: "troll", canyon: "veatch", sog: 7.2, phase: 0.2, offsetNm: 2.0 },
  { mmsi: "367812108", name: "Two Coves", type: "fishing", lengthM: 16, dest: "VEATCH W WALL", role: "troll", canyon: "veatch", sog: 6.8, phase: 1.6, offsetNm: 3.2 },
  { mmsi: "367812215", name: "Hard Alee", type: "fishing", lengthM: 20, dest: "VEATCH 105", role: "troll", canyon: "veatch", sog: 7.6, phase: 3.1, offsetNm: 1.3 },
  { mmsi: "367812330", name: "Weekapaug", type: "fishing", lengthM: 17, dest: "ATLANTIS W WALL", role: "troll", canyon: "atlantis", sog: 7.0, phase: 0.7, offsetNm: 2.2 },
  { mmsi: "367812441", name: "Saltbox", type: "fishing", lengthM: 19, dest: "ATLANTIS W WALL", role: "troll", canyon: "atlantis", sog: 6.5, phase: 2.4, offsetNm: 3.5 },
  { mmsi: "367812552", name: "Foggy Bottom", type: "fishing", lengthM: 21, dest: "ATLANTIS 110", role: "troll", canyon: "atlantis", sog: 7.8, phase: 4.0, offsetNm: 1.5 },
  { mmsi: "367812663", name: "Watch Hill", type: "fishing", lengthM: 18, dest: "HYDRO 100", role: "troll", canyon: "hydrographer", sog: 7.1, phase: 1.1, offsetNm: 2.4 },
  { mmsi: "367812774", name: "Galilee Girl", type: "fishing", lengthM: 16, dest: "HYDRO W WALL", role: "troll", canyon: "hydrographer", sog: 6.7, phase: 2.9, offsetNm: 3.0 },
  { mmsi: "636019882", name: "Overseas Boston", type: "tanker", lengthM: 228, dest: "BOSTON", role: "tssE", sog: 14.2, phase: 0.0, offsetNm: 1.2 },
  { mmsi: "367001904", name: "Coastal Trader", type: "cargo", lengthM: 162, dest: "NEW YORK", role: "tssW", sog: 13.6, phase: 6.4, offsetNm: 1.4 },
  { mmsi: "338124011", name: "Quonnie", type: "pleasure", lengthM: 14, dest: "MONTAUK", role: "pleasure", sog: 9.4, phase: 0.5, offsetNm: 0 },
  { mmsi: "338124226", name: "Sakonnet", type: "pleasure", lengthM: 13, dest: "BLOCK IS", role: "pleasure", sog: 8.1, phase: 1.8, offsetNm: 1 },
  { mmsi: "367555018", name: "Bull Dog", type: "tug", lengthM: 30, dest: "POINT JUDITH", role: "tug", sog: 6.8, phase: 0.9, offsetNm: 0 },
  { mmsi: "367890441", name: "Night Moves", type: "fishing", lengthM: 20, dest: "DRIFT", role: "sword", sog: 0.9, phase: 0.3, offsetNm: 0 },
];

const TSS: LatLon[] = [
  { lat: 39.6, lon: -73.5 },
  { lat: HUDSON_HEAD.lat + 0.28, lon: HUDSON_HEAD.lon + 0.35 },
  { lat: 40.15, lon: -71.1 },
  { lat: 40.4, lon: -70.0 },
  { lat: 40.55, lon: -69.2 },
];

const TSS_WEST: LatLon[] = TSS.slice().reverse();

const MONTAUK_LOOP: LatLon[] = [
  { lat: MONTAUK.lat - 0.13, lon: MONTAUK.lon + 0.06 },
  { lat: 40.88, lon: -71.72 },
  { lat: 40.82, lon: -71.86 },
  { lat: 40.9, lon: -72.04 },
  { lat: MONTAUK.lat - 0.13, lon: MONTAUK.lon + 0.06 },
];

const BLOCK_LOOP: LatLon[] = [
  { lat: 41.05, lon: -71.52 },
  { lat: 41.02, lon: -71.38 },
  { lat: 40.96, lon: -71.48 },
  { lat: 41.0, lon: -71.66 },
  { lat: 41.05, lon: -71.52 },
];

const TUG_PATH: LatLon[] = [
  { lat: POINT_JUDITH.lat - 0.07, lon: POINT_JUDITH.lon },
  { lat: 41.22, lon: -71.55 },
  { lat: 41.14, lon: -71.7 },
  { lat: MONTAUK.lat - 0.1, lon: MONTAUK.lon + 0.18 },
];

function headOf(id: string): LatLon {
  if (id === "atlantis") return ATLANTIS_HEAD;
  if (id === "hydrographer") return HYDRO_HEAD;
  return VEATCH_HEAD;
}

function wet(p: LatLon): LatLon {
  return {
    lat: Math.min(41.5, Math.max(38.5, p.lat)),
    lon: Math.min(-66.5, Math.max(-73.98, p.lon)),
  };
}

function wrap360(d: number): number {
  return ((d % 360) + 360) % 360;
}

function alongNm(pts: LatLon[], nm: number): { pos: LatLon; cog: number } {
  if (pts.length === 0) return { pos: VEATCH_HEAD, cog: 0 };
  if (pts.length === 1) return { pos: pts[0]!, cog: 0 };
  let remain = Math.max(0, nm);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = haversineNm(a, b);
    if (remain <= seg || i === pts.length - 1) {
      const cog = initialBearing(a, b);
      const u = seg < 1e-6 ? 0 : Math.min(1, remain / seg);
      return { pos: destination(a, cog, seg * u), cog };
    }
    remain -= seg;
  }
  const last = pts[pts.length - 1]!;
  return { pos: last, cog: initialBearing(pts[pts.length - 2]!, last) };
}

function pathNm(pts: LatLon[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += haversineNm(pts[i - 1]!, pts[i]!);
  return Math.max(0.1, n);
}

function westWall(id: string, offsetNm: number): LatLon[] {
  const c = CANYONS.find((x) => x.id === id);
  const axis = c?.axis.slice(0, 3) ?? [headOf(id), destination(headOf(id), 158, 13)];
  return axis.map((a, i) => {
    const next = axis[i + 1] ?? axis[i - 1] ?? a;
    const brg = i < axis.length - 1 ? initialBearing(a, next) : initialBearing(next, a);
    return destination(a, brg + 90, offsetNm);
  });
}

function travel(
  path: LatLon[],
  tH: number,
  sog: number,
  pingPong: boolean,
  laneNm: number,
): { pos: LatLon; cog: number } {
  const total = pathNm(path);
  const dist = tH * sog;
  let along: number;
  let reverse = false;
  if (pingPong) {
    const cycle = total * 2;
    const d = ((dist % cycle) + cycle) % cycle;
    reverse = d > total;
    along = reverse ? cycle - d : d;
  } else {
    along = ((dist % total) + total) % total;
  }
  const hit = alongNm(path, along);
  const cog = reverse ? wrap360(hit.cog + 180) : wrap360(hit.cog);
  const pos = laneNm !== 0 ? destination(hit.pos, wrap360(cog + 90), laneNm) : hit.pos;
  return { pos, cog };
}

function place(spec: Spec, tH: number): { pos: LatLon; cog: number; sog: number; heading: number } {
  const t = tH + spec.phase;
  if (spec.role === "troll") {
    const { pos, cog } = travel(westWall(spec.canyon ?? "veatch", spec.offsetNm), t, spec.sog, true, 0);
    return { pos, cog, sog: spec.sog, heading: cog };
  }
  if (spec.role === "tssE") {
    const { pos, cog } = travel(TSS, t, spec.sog, false, spec.offsetNm);
    return { pos, cog, sog: spec.sog, heading: cog };
  }
  if (spec.role === "tssW") {
    const { pos, cog } = travel(TSS_WEST, t, spec.sog, false, spec.offsetNm);
    return { pos, cog, sog: spec.sog, heading: cog };
  }
  if (spec.role === "pleasure") {
    const loop = spec.offsetNm > 0.5 ? BLOCK_LOOP : MONTAUK_LOOP;
    const { pos, cog } = travel(loop, t, spec.sog, false, 0);
    return { pos, cog, sog: spec.sog, heading: cog };
  }
  if (spec.role === "tug") {
    const { pos, cog } = travel(TUG_PATH, t, spec.sog, true, 0);
    return { pos, cog, sog: spec.sog, heading: cog };
  }
  const tod = ((tH % 24) + 24) % 24;
  const night = tod >= 20 || tod < 6;
  const sog = night ? spec.sog : spec.sog * 0.35;
  const finger = destination(VEATCH_HEAD, 172, 8.5);
  const span = 4.5;
  const cycle = span * 2;
  const d = ((t * sog) % cycle + cycle) % cycle;
  const fwd = d <= span;
  const along = fwd ? d : cycle - d;
  const cog = fwd ? 245 : 65;
  return { pos: destination(finger, 245, along), cog, sog, heading: wrap360(cog + 40) };
}

export function aisTargets(clockMs: number, hour: number): AisTarget[] {
  const tH = clockMs / 3_600_000 + hour;
  return FLEET.map((spec) => {
    const { pos, cog, sog, heading } = place(spec, tH);
    const p = wet(pos);
    return {
      mmsi: spec.mmsi,
      name: spec.name,
      type: spec.type,
      lat: p.lat,
      lon: p.lon,
      cog,
      sog,
      heading,
      lengthM: spec.lengthM,
      destination: spec.dest,
    };
  });
}

export function aisGeo(targets: AisTarget[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: targets.map((t) => ({
      type: "Feature" as const,
      properties: {
        mmsi: t.mmsi,
        name: t.name,
        type: t.type,
        cog: t.cog,
        sog: t.sog,
        heading: t.heading,
      },
      geometry: { type: "Point" as const, coordinates: [t.lon, t.lat] },
    })),
  };
}
