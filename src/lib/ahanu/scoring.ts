import { SPECIES } from "@/lib/data/species";
import { CANYONS, nearestCanyon } from "@/lib/data/canyons";
import { clamp } from "@/lib/utils";
import { depthM, isLand } from "./bathymetry";
import { REGION } from "./constants";
import { compass, haversineNm, initialBearing, metersToFathoms } from "./geo";
import {
  chlGradient,
  chlorophyll,
  isTempBreak,
  sstC,
  sstGradient,
} from "./ocean";
import { solunarPeriods } from "./solunar";
import type { LatLon, SpeciesId } from "./types";

/** Hardcoded cells that have paid the ice bill — Veatch west wall, Atlantis, Hydro corner. */
const HISTORICAL: { lat: number; lon: number; species: SpeciesId; w: number }[] = [
  { lat: 39.91, lon: -69.78, species: "bigeye", w: 1 },
  { lat: 39.88, lon: -69.74, species: "bigeye", w: 0.92 },
  { lat: 39.93, lon: -69.7, species: "swordfish", w: 0.72 },
  { lat: 39.86, lon: -70.32, species: "yellowfin", w: 0.88 },
  { lat: 39.84, lon: -70.24, species: "white_marlin", w: 0.74 },
  { lat: 39.87, lon: -70.26, species: "bigeye", w: 0.82 },
  { lat: 40.16, lon: -69.08, species: "bigeye", w: 0.86 },
  { lat: 40.12, lon: -68.96, species: "yellowfin", w: 0.78 },
  { lat: 40.18, lon: -69.02, species: "white_marlin", w: 0.66 },
  { lat: 39.56, lon: -72.38, species: "yellowfin", w: 0.7 },
];

const FM_100_M = 183;
const FM_50_M = 91;

function clockHour(hour: number): number {
  return ((hour % 24) + 24) % 24;
}

function isNight(hour: number): boolean {
  const h = clockHour(hour);
  return h >= 20 || h < 6;
}

function dateAtHour(date: Date, hour: number): Date {
  const d = new Date(date.getTime());
  d.setHours(Math.floor(clockHour(hour)), Math.round((hour % 1) * 60), 0, 0);
  return d;
}

function sstFit(sst: number, id: SpeciesId): number {
  const s = SPECIES[id];
  if (sst < s.sstMinC || sst > s.sstMaxC) {
    const d = sst < s.sstMinC ? s.sstMinC - sst : sst - s.sstMaxC;
    return clamp(0.4 - d * 0.12, 0, 0.35);
  }
  const [a, b] = s.sstPrefC;
  if (sst >= a && sst <= b) return 1;
  if (sst < a) return 0.5 + 0.5 * clamp((sst - s.sstMinC) / Math.max(0.2, a - s.sstMinC), 0, 1);
  return 0.5 + 0.5 * clamp((s.sstMaxC - sst) / Math.max(0.2, s.sstMaxC - b), 0, 1);
}

function gradientScore(lat: number, lon: number, hour: number, id: SpeciesId): number {
  const s = SPECIES[id];
  const g = sstGradient(lat, lon, hour);
  const mag = clamp(g / 0.18, 0, 1);
  const brk = isTempBreak(lat, lon, hour) ? 1 : mag;
  return s.likesBreaks ? clamp(0.35 + 0.65 * brk, 0, 1) : clamp(0.25 + 0.55 * mag, 0, 1);
}

function structureScore(lat: number, lon: number, id: SpeciesId, hour: number): number {
  const s = SPECIES[id];
  const d = depthM(lat, lon);
  if (d < 8) return 0;
  const mid = (s.depthMinM + s.depthMaxM) / 2;
  const inBand =
    d >= s.depthMinM && d <= s.depthMaxM
      ? 1
      : clamp(1 - Math.abs(d - mid) / Math.max(120, s.depthMaxM - s.depthMinM), 0, 0.42);

  let head = 0;
  for (const c of CANYONS) {
    head = Math.max(head, Math.exp(-((haversineNm({ lat, lon }, c.head) / 10) ** 2)));
  }

  const hundredFm = Math.exp(-(((d - FM_100_M) / 55) ** 2));
  const twoHundred = Math.exp(-(((d - 366) / 80) ** 2));

  const n = depthM(lat + 0.035, lon);
  const e = depthM(lat, lon + 0.045);
  const slope = Math.hypot(n - d, e - d);
  const wall = clamp(slope / 220, 0, 1);

  const lump =
    d > 25 && d < 140
      ? clamp((Math.min(n, e) - d) / 35, 0, 1) * Math.exp(-(((d - FM_50_M) / 50) ** 2))
      : 0;

  let struct = 0.32 * inBand + 0.28 * head + 0.18 * hundredFm + 0.12 * wall + 0.1 * lump;
  if (id === "bigeye" && isNight(hour)) struct = clamp(struct + 0.18 * hundredFm, 0, 1);
  if (id === "swordfish") struct = clamp(0.45 * inBand + 0.2 * head + 0.2 * twoHundred + 0.15 * hundredFm, 0, 1);
  if (id === "bluefin") struct = clamp(0.4 * inBand + 0.35 * lump + 0.15 * head + 0.1 * hundredFm, 0, 1);
  if (id === "mahi") struct = clamp(0.25 * inBand + 0.15 * head + 0.6 * (d < 80 ? 1 : 0.2), 0, 1);
  return clamp(struct, 0, 1);
}

function chlScore(lat: number, lon: number, hour: number, id: SpeciesId): number {
  const s = SPECIES[id];
  const edge = clamp(chlGradient(lat, lon, hour) / 0.45, 0, 1);
  const chl = chlorophyll(lat, lon, hour);
  const weed = clamp(1 - Math.abs(chl - 0.55) / 0.7, 0, 1);
  if (s.likesChlEdge && s.likesWeed) return clamp(0.55 * edge + 0.45 * weed, 0, 1);
  if (s.likesChlEdge) return clamp(0.25 + 0.75 * edge, 0, 1);
  if (s.likesWeed) return clamp(0.2 + 0.8 * weed, 0, 1);
  return clamp(0.35 + 0.3 * (1 - edge), 0, 1);
}

function inWindows(windows: [Date, Date][], at: Date): boolean {
  return windows.some(([a, b]) => at >= a && at <= b);
}

function solunarScore(lat: number, lon: number, date: Date, hour: number): number {
  const sol = solunarPeriods(lat, lon, date);
  const at = dateAtHour(date, hour);
  if (inWindows(sol.major, at)) return clamp(0.72 + (sol.score / 100) * 0.28, 0, 1);
  if (inWindows(sol.minor, at)) return clamp(0.48 + (sol.score / 100) * 0.22, 0, 1);
  return clamp(0.22 + (sol.score / 100) * 0.28, 0, 1);
}

function historicalScore(lat: number, lon: number, id: SpeciesId): number {
  let v = 0;
  for (const h of HISTORICAL) {
    const same = h.species === id ? 1 : 0.28;
    v = Math.max(v, same * h.w * Math.exp(-((haversineNm({ lat, lon }, h) / 7.5) ** 2)));
  }
  return clamp(v, 0, 1);
}

export function habitatScore(
  lat: number,
  lon: number,
  species: SpeciesId,
  hour: number,
  date: Date,
  historicalWeight = 0.1,
): number {
  if (isLand(lat, lon) || depthM(lat, lon) < 8) return 0;
  const s = SPECIES[species];
  const sst = sstC(lat, lon, hour);
  const histW = clamp(historicalWeight, 0, 0.4);
  const rest = 1 - histW;
  const raw =
    rest *
      (0.3 / 0.9) *
      sstFit(sst, species) +
    rest * (0.18 / 0.9) * gradientScore(lat, lon, hour, species) +
    rest * (0.22 / 0.9) * structureScore(lat, lon, species, hour) +
    rest * (0.12 / 0.9) * chlScore(lat, lon, hour, species) +
    rest * (0.08 / 0.9) * solunarScore(lat, lon, date, hour) +
    histW * historicalScore(lat, lon, species);
  const nightMul = 1 + s.nightBonus * (isNight(hour) ? 1 : 0);
  return Math.round(clamp(raw * nightMul * 100, 0, 100));
}

export function zoneLabel(score: number): "Fire" | "Warm" | "Worth a look" | "Cold" {
  if (score >= 78) return "Fire";
  if (score >= 62) return "Warm";
  if (score >= 45) return "Worth a look";
  return "Cold";
}

export function rankCells(
  species: SpeciesId,
  hour: number,
  date: Date,
  stepDeg = 0.12,
): { lat: number; lon: number; score: number }[] {
  const cells: { lat: number; lon: number; score: number }[] = [];
  const south = Math.max(REGION.south, 37.35);
  const north = Math.min(REGION.north, 41.35);
  const west = Math.max(REGION.west, -74.7);
  const east = Math.min(REGION.east, -66.7);
  for (let lat = south; lat <= north; lat += stepDeg) {
    for (let lon = west; lon <= east; lon += stepDeg) {
      if (isLand(lat, lon)) continue;
      const score = habitatScore(lat, lon, species, hour, date);
      if (score <= 0) continue;
      cells.push({ lat: round3(lat), lon: round3(lon), score });
    }
  }
  cells.sort((a, b) => b.score - a.score);
  return cells.slice(0, 40);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function briefing(species: SpeciesId, hour: number, date: Date, vessel: LatLon): string {
  const name = SPECIES[species].common;
  const here = habitatScore(vessel.lat, vessel.lon, species, hour, date);
  const label = zoneLabel(here);
  const sst = sstC(vessel.lat, vessel.lon, hour);
  const canyon = nearestCanyon(vessel);
  const top = rankCells(species, hour, date, 0.16)[0];
  const dest = top ?? { lat: canyon.head.lat, lon: canyon.head.lon, score: here };
  const nm = haversineNm(vessel, dest);
  const brg = compass(initialBearing(vessel, dest));
  const brkHere = isTempBreak(vessel.lat, vessel.lon, hour);
  const brkThere = isTempBreak(dest.lat, dest.lon, hour);
  const fm = metersToFathoms(Math.max(0, depthM(dest.lat, dest.lon)));
  const breakLine = brkThere
    ? `The SST break is parked on that cell${brkHere ? " and you are already on a gradient under the keel" : ""} — ${sst.toFixed(1)}°C here, fish the warm side and do not cut across it.`
    : brkHere
      ? `You are on a temperature break right now at ${sst.toFixed(1)}°C; the model still likes ${dest.lat.toFixed(2)}N / ${Math.abs(dest.lon).toFixed(2)}W a little more.`
      : `SST under the keel is ${sst.toFixed(1)}°C with no hard break at the bow — look for the color change on the way to the high cell.`;
  return [
    `${label} for ${name} under the keel (${here}); hottest cell on the pack is ${dest.lat.toFixed(2)}N ${Math.abs(dest.lon).toFixed(2)}W scoring ${dest.score}, ${nm.toFixed(0)} nm ${brg} of you in about ${fm.toFixed(0)} fathoms.`,
    breakLine,
    `Nearest hole is ${canyon.name}, ${canyon.fromRiNm} nm from Point Judith — ${canyon.notes.split(".")[0]}.`,
    `Sea state is not in this overlay: check weather panel before you commit the spread or the overnight.`,
    `Ahanu wants you laughing at first light on the right edge, not punching leftover swell for empty blue.`,
  ].join(" ");
}

export type RankedCell = { lat: number; lon: number; score: number };
