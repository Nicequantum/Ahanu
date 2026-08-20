/**
 * Public NCEP NOMADS GFS-Wave subset (no secrets).
 * One Atlantic 0p16 hour is a few KB for the Point Judith box.
 * A full 72 h / 3 h pack is ~25 files and needs cron pacing — do not
 * replace the 72 h fixture wind/wave grids with a single f000 clip.
 * Hour 0 may be painted when the subset parses.
 * Keep free of `@/` aliases so the Worker can import it.
 */

import type { PackBBox, PackedGrid } from "./pack-fixtures";
import { ncepToPacked, parseNcep, type Hour0Packed } from "./grid-io";

export const GFS_WAVE_FILTER_URL = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfswave.pl";
export const GFS_WAVE_PROD_DIR = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/";
export const GFS_WAVE_MAX_BYTES = 512_000;

export interface GfsWaveCycle {
  ymd: string;
  cc: string;
}

export interface GfsWaveIngest {
  live: true;
  source: "nomads-gfswave";
  grid: "atlocn.0p16";
  forecastHour: number;
  cycle: string;
  url: string;
  bytes: number;
  sha256: string;
  contentType: string;
  note: string;
  parsed?: Hour0Packed;
  parseError?: string;
}

export function ymdUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function gfsWaveCycleCandidates(now = new Date()): GfsWaveCycle[] {
  const out: GfsWaveCycle[] = [];
  let cc = Math.floor(now.getUTCHours() / 6) * 6;
  let t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), cc);
  for (let i = 0; i < 4; i++) {
    const d = new Date(t);
    out.push({ ymd: ymdUtc(d), cc: String(d.getUTCHours()).padStart(2, "0") });
    t -= 6 * 3_600_000;
  }
  return out;
}

export function gfsWaveFilterUrl(ymd: string, cc: string, fhour: number, bbox: PackBBox): string {
  const hh = String(Math.max(0, Math.round(fhour))).padStart(3, "0");
  const file = `gfswave.t${cc}z.atlocn.0p16.f${hh}.grib2`;
  const dir = `/gfs.${ymd}/${cc}/wave/gridded`;
  const q = [
    `file=${encodeURIComponent(file)}`,
    "var_HTSGW=on",
    "var_PERPW=on",
    "var_DIRPW=on",
    "var_WDIR=on",
    "var_WIND=on",
    "subregion=",
    `leftlon=${bbox.west}`,
    `rightlon=${bbox.east}`,
    `toplat=${bbox.north}`,
    `bottomlat=${bbox.south}`,
    `dir=${encodeURIComponent(dir)}`,
  ].join("&");
  return `${GFS_WAVE_FILTER_URL}?${q}`;
}

export function isGrib2(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 16) return false;
  const head = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  const tail = String.fromCharCode(
    bytes[bytes.length - 4]!,
    bytes[bytes.length - 3]!,
    bytes[bytes.length - 2]!,
    bytes[bytes.length - 1]!,
  );
  return head === "GRIB" && tail === "7777";
}

export const GFS_WAVE_NOTE =
  "NOMADS GFS-Wave atlocn.0p16 f000 subset. Hour-0 wind/wave paint only when the file parses; that is not a 72 h grid.";

export const GFS_WAVE_PACE_MS = 10_000;

export function gfsWaveSeriesHours(maxHour = 72, step = 3): number[] {
  const out: number[] = [];
  for (let h = 0; h <= maxHour; h += step) out.push(h);
  return out;
}

/** Off unless enabled. Paces ~10 s between files. Do not call from CI. */
export async function fetchGfsWaveSeries(options: {
  bbox: PackBBox;
  ymd: string;
  cc: string;
  hours?: number[];
  fetchImpl: (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;
  paceMs?: number;
  enabled?: boolean;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ hour: number; url: string; bytes: Uint8Array }[]> {
  if (options.enabled !== true) return [];
  const hours = options.hours ?? gfsWaveSeriesHours();
  const pace = options.paceMs ?? GFS_WAVE_PACE_MS;
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const out: { hour: number; url: string; bytes: Uint8Array }[] = [];
  for (let i = 0; i < hours.length; i++) {
    if (i > 0 && pace > 0) await sleep(pace);
    const hour = hours[i]!;
    const url = gfsWaveFilterUrl(options.ymd, options.cc, hour, options.bbox);
    try {
      const res = await options.fetchImpl(url);
      if (!res.ok) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength < 16 || buf.byteLength > GFS_WAVE_MAX_BYTES) continue;
      if (!isGrib2(buf)) continue;
      out.push({ hour, url, bytes: buf });
    } catch {
      /* skip this hour */
    }
  }
  return out;
}

export const GFS_WAVE_SERIES_ENV = "AHANU_GFS_WAVE_SERIES";

function truthyFlag(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes" || s === "on";
  }
  return false;
}

export function readGfsWaveSeriesEnv(env?: Record<string, string | undefined> | null): string | undefined {
  if (env) return env.AHANU_GFS_WAVE_SERIES ?? env.GFS_WAVE_SERIES;
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    return proc?.AHANU_GFS_WAVE_SERIES ?? proc?.GFS_WAVE_SERIES;
  } catch {
    return undefined;
  }
}

/** Off unless `{ enabled: true }` / truthy flag / env AHANU_GFS_WAVE_SERIES or GFS_WAVE_SERIES. */
export function gfsWaveSeriesEnabled(
  flag?: boolean | string | null,
  env?: Record<string, string | undefined> | null,
): boolean {
  if (flag === false) return false;
  if (truthyFlag(flag)) return true;
  if (flag === undefined || flag === null) return truthyFlag(readGfsWaveSeriesEnv(env));
  return false;
}

export interface GfsWaveSeriesGrids {
  windKt?: PackedGrid;
  waveFt?: PackedGrid;
  fetchedHours: number[];
  wantedHours: number[];
  hoursCovered: number;
  complete: boolean;
}

/** Contiguous prefix from the first wanted hour. A gap does not count as 72 h. */
export function seriesHoursCovered(wanted: number[], got: number[]): { hoursCovered: number; complete: boolean } {
  const have = new Set(got);
  const sortedWanted = [...wanted].sort((a, b) => a - b);
  const complete = sortedWanted.length > 0 && sortedWanted.every((h) => have.has(h));
  const prefix: number[] = [];
  for (const h of sortedWanted) {
    if (!have.has(h)) break;
    prefix.push(h);
  }
  if (prefix.length === 0) return { hoursCovered: 0, complete };
  if (prefix.length === 1) return { hoursCovered: prefix[0] === 0 ? 1 : prefix[0]!, complete };
  return { hoursCovered: Math.max(...prefix), complete };
}

function stackLayer(
  hours: number[],
  planes: PackedGrid[],
  hoursCovered: number,
  complete: boolean,
): PackedGrid | undefined {
  if (!hours.length || !planes.length) return undefined;
  const tmpl = planes[0]!;
  const values: number[][] = [];
  const dirValues: number[][] = [];
  const periodValues: number[][] = [];
  let dirsOk = true;
  let periodsOk = true;
  for (let i = 0; i < planes.length; i++) {
    const g = planes[i]!;
    if (g.nx !== tmpl.nx || g.ny !== tmpl.ny) return undefined;
    const plane = g.values[0];
    if (!plane) return undefined;
    values.push(plane);
    if (g.dirValues?.[0]) dirValues.push(g.dirValues[0]);
    else dirsOk = false;
    if (g.periodValues?.[0]) periodValues.push(g.periodValues[0]);
    else periodsOk = false;
  }
  const note =
    complete && hoursCovered >= 72
      ? "NCEP Atlantic 0p16 f000–f072 / 3 h."
      : `NCEP Atlantic 0p16 hours ${hours.join(",") || "none"} — hoursCovered ${hoursCovered}, not a 72 h forecast.`;
  const out: PackedGrid = {
    kind: "grid",
    layer: tmpl.layer,
    bbox: tmpl.bbox,
    nx: tmpl.nx,
    ny: tmpl.ny,
    hours,
    hoursCovered,
    unit: tmpl.unit,
    values,
    live: true,
    source: "noaa",
    fixture: false,
    note,
  };
  if (dirsOk && dirValues.length === hours.length) {
    out.dirUnit = tmpl.dirUnit ?? "deg";
    out.dirValues = dirValues;
  }
  if (periodsOk && periodValues.length === hours.length) {
    out.periodUnit = tmpl.periodUnit ?? "s";
    out.periodValues = periodValues;
  }
  return out;
}

/** Decode each hour and assemble wind/wave planes. Uses the requested hour, not GRIB metadata. */
export function assembleGfsWaveSeries(
  files: { hour: number; bytes: Uint8Array }[],
  wantedHours = gfsWaveSeriesHours(),
): GfsWaveSeriesGrids {
  const windHours: number[] = [];
  const waveHours: number[] = [];
  const windPlanes: PackedGrid[] = [];
  const wavePlanes: PackedGrid[] = [];
  const fetched: number[] = [];
  const seen = new Set<number>();
  const sorted = [...files].sort((a, b) => a.hour - b.hour);
  for (const file of sorted) {
    if (seen.has(file.hour)) continue;
    const packed = ncepToPacked(parseNcep(file.bytes));
    if (!packed.windKt && !packed.waveFt) continue;
    seen.add(file.hour);
    fetched.push(file.hour);
    if (packed.windKt) {
      windHours.push(file.hour);
      windPlanes.push(packed.windKt);
    }
    if (packed.waveFt) {
      waveHours.push(file.hour);
      wavePlanes.push(packed.waveFt);
    }
  }
  const { hoursCovered, complete } = seriesHoursCovered(wantedHours, fetched);
  return {
    windKt: stackLayer(windHours, windPlanes, hoursCovered, complete),
    waveFt: stackLayer(waveHours, wavePlanes, hoursCovered, complete),
    fetchedHours: fetched,
    wantedHours,
    hoursCovered,
    complete,
  };
}
