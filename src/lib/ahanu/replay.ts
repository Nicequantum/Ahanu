import { haversineNm, interpolatePath, pathLengthNm } from "./geo";
import type { CatchRecord, LatLon } from "./types";

export interface ReplayFrame {
  t: number;
  pos: LatLon;
  cog: number;
  nearestCatch: CatchRecord | null;
  nmFromStart: number;
}

function clamp01(t: number): number {
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.min(1, t));
}

function distToSegment(a: LatLon, b: LatLon, p: LatLon): number {
  const seg = haversineNm(a, b);
  if (seg < 1e-6) return haversineNm(a, p);
  const pair = [a, b];
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 16; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const d1 = haversineNm(interpolatePath(pair, m1).pos, p);
    const d2 = haversineNm(interpolatePath(pair, m2).pos, p);
    if (d1 < d2) hi = m2;
    else lo = m1;
  }
  return haversineNm(interpolatePath(pair, (lo + hi) / 2).pos, p);
}

function distToTrack(track: LatLon[], p: LatLon): number {
  if (track.length === 0) return Infinity;
  if (track.length === 1) return haversineNm(track[0]!, p);
  let best = Infinity;
  for (let i = 1; i < track.length; i++) {
    best = Math.min(best, distToSegment(track[i - 1]!, track[i]!, p));
  }
  return best;
}

export function catchOnTrack(track: LatLon[], c: CatchRecord, maxNm = 1): boolean {
  const limit = Number.isFinite(maxNm) && maxNm >= 0 ? maxNm : 1;
  return distToTrack(track, c) <= limit;
}

export function replayAt(track: LatLon[], catches: CatchRecord[], t: number): ReplayFrame {
  const u = clamp01(t);
  if (track.length === 0) {
    return { t: u, pos: { lat: 0, lon: 0 }, cog: 0, nearestCatch: null, nmFromStart: 0 };
  }
  const { pos, cog } = interpolatePath(track, u);
  const total = pathLengthNm(track);
  let nearestCatch: CatchRecord | null = null;
  let best = Infinity;
  for (const rec of catches) {
    const d = haversineNm(pos, rec);
    if (d < best) {
      best = d;
      nearestCatch = rec;
    }
  }
  return { t: u, pos, cog, nearestCatch, nmFromStart: total * u };
}
