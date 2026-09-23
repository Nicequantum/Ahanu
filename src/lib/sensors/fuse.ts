import { cpaTcpa } from "@/lib/ahanu/ais/cpa";
import { destination } from "@/lib/ahanu/geo";
import type { RadarReturn } from "@/lib/ahanu/types";
import type { AisTarget } from "@/lib/data/ais";
import { haversineNm } from "@/lib/ahanu/geo";

const MATCH_NM = 0.25;
const MATCH_MS = 30_000;

export interface OwnMotion {
  lat: number;
  lon: number;
  sog: number;
  cog: number;
  heading: number;
}

/** Relative bearing (bow, clockwise) + own heading → geographic position. */
export function radarToLatLon(
  own: { lat: number; lon: number; heading: number },
  rangeNm: number,
  bearingDeg: number,
): { lat: number; lon: number } {
  const trueBrg = (((own.heading + bearingDeg) % 360) + 360) % 360;
  return destination(own, trueBrg, Math.max(0, rangeNm));
}

export function projectRadar(
  own: { lat: number; lon: number; heading: number },
  hits: readonly { id: string; rangeNm: number; bearingDeg: number; strength: number; at: number; provenance: RadarReturn["provenance"] }[],
): RadarReturn[] {
  return hits.map((h) => {
    const pos = radarToLatLon(own, h.rangeNm, h.bearingDeg);
    return { ...h, lat: pos.lat, lon: pos.lon };
  });
}

export function annotateAis(targets: readonly AisTarget[], own: OwnMotion, now = Date.now()): AisTarget[] {
  return targets.map((t) => {
    const cpa = cpaTcpa(own, t);
    return { ...t, cpaNm: cpa.cpaNm, tcpaMin: cpa.tcpaMin, receivedAt: t.receivedAt ?? now };
  });
}

export interface FusedPicture {
  ais: AisTarget[];
  radarOnly: RadarReturn[];
}

/** Fold radar onto AIS when position and time agree. Sonar is not a map source. */
export function fusePicture(
  ais: readonly AisTarget[],
  radar: readonly RadarReturn[],
  now: number,
): FusedPicture {
  const used = new Set<string>();
  const next = ais.map((t) => {
    const at = t.receivedAt ?? now;
    const hit = radar.find((r) => {
      if (used.has(r.id)) return false;
      if (Math.abs(r.at - at) > MATCH_MS) return false;
      return haversineNm(t, r) <= MATCH_NM;
    });
    if (!hit) return { ...t, corroborated: false };
    used.add(hit.id);
    return { ...t, corroborated: true };
  });
  return { ais: next, radarOnly: radar.filter((r) => !used.has(r.id)) };
}
