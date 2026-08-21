/**
 * Public NCEP NOMADS GFS-Wave subset (no secrets).
 * One Atlantic 0p16 hour is a few KB for the Point Judith box.
 * A full 72 h / 3 h pack is ~25 files. Worker GET uses pace 0 and a
 * 25 s budget (NOMADS served f000–f072 here in ~8 s sequential).
 * The 10 s pace is politeness for non-Worker callers, not a NOAA limit.
 * Do not replace the 72 h fixture with a single f000 clip.
 * Series cycle pick: newest cycle that has the requested horizon
 * (f072 for 72 h) wins. A publishing 00z with only f000–f027 must
 * not beat an 18z that already has f072. If every candidate 404s
 * the tail, keep the longest live prefix and name the fixture hours.
 * Keep free of `@/` aliases so the Worker can import it.
 */

import type { PackBBox, PackedGrid } from "./pack-fixtures";
import { ncepToPacked, parseNcep, type Hour0Packed } from "./grid-io";
import { formatGfsWaveCycle } from "./noaa-gfs-merge";

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

export interface GfsWaveCycleProbe extends GfsWaveCycle {
  hasHorizon: boolean;
  /** Last contiguous wanted hour that exists, or -1 if none. */
  prefixHours: number;
}

export function gfsWaveHorizonHour(hours: number[] = gfsWaveSeriesHours()): number {
  if (!hours.length) return 0;
  return Math.max(...hours);
}

/**
 * Newest complete-horizon cycle wins. Candidates must be newest-first
 * (same order as gfsWaveCycleCandidates). First-cycle-wins on any files
 * is wrong: a partial 00z must not beat a complete 18z.
 * If none have the horizon, take the longest prefix (newer wins a tie).
 */
export function pickGfsWaveSeriesCycle(
  probes: GfsWaveCycleProbe[],
  horizonHour = 72,
): GfsWaveCycleProbe | undefined {
  const complete = probes.filter((p) => p.hasHorizon || p.prefixHours >= horizonHour);
  if (complete.length) return complete[0];
  let best: GfsWaveCycleProbe | undefined;
  for (const p of probes) {
    if (p.prefixHours < 0) continue;
    if (!best || p.prefixHours > best.prefixHours) best = p;
  }
  return best;
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

export function gfsWaveBytesOk(buf: Uint8Array): boolean {
  return buf.byteLength >= 16 && buf.byteLength <= GFS_WAVE_MAX_BYTES && isGrib2(buf);
}

export async function fetchGfsWaveHourFile(options: {
  bbox: PackBBox;
  ymd: string;
  cc: string;
  hour: number;
  fetchImpl: (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;
  prefetched?: Map<string, Uint8Array>;
}): Promise<{ hour: number; url: string; bytes: Uint8Array } | undefined> {
  const url = gfsWaveFilterUrl(options.ymd, options.cc, options.hour, options.bbox);
  const hit = options.prefetched?.get(url);
  if (hit) return { hour: options.hour, url, bytes: hit };
  try {
    const res = await options.fetchImpl(url);
    if (!res.ok) return undefined;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!gfsWaveBytesOk(buf)) return undefined;
    options.prefetched?.set(url, buf);
    return { hour: options.hour, url, bytes: buf };
  } catch {
    return undefined;
  }
}

/** Probe f072 (or last wanted hour). Optional binary search of the live prefix. */
export async function probeGfsWaveCycle(options: {
  bbox: PackBBox;
  ymd: string;
  cc: string;
  hours?: number[];
  fetchImpl: (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;
  prefetched?: Map<string, Uint8Array>;
  horizonOnly?: boolean;
}): Promise<GfsWaveCycleProbe> {
  const hours = options.hours ?? gfsWaveSeriesHours();
  const horizon = gfsWaveHorizonHour(hours);
  const exists = async (hour: number) =>
    Boolean(
      await fetchGfsWaveHourFile({
        bbox: options.bbox,
        ymd: options.ymd,
        cc: options.cc,
        hour,
        fetchImpl: options.fetchImpl,
        prefetched: options.prefetched,
      }),
    );
  const hasHorizon = hours.includes(horizon) ? await exists(horizon) : false;
  if (hasHorizon) {
    return { ymd: options.ymd, cc: options.cc, hasHorizon: true, prefixHours: horizon };
  }
  if (options.horizonOnly) {
    return { ymd: options.ymd, cc: options.cc, hasHorizon: false, prefixHours: -1 };
  }
  const search = hours.length && hours[hours.length - 1] === horizon ? hours.slice(0, -1) : hours;
  let lo = 0;
  let hi = search.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (await exists(search[mid]!)) {
      last = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return {
    ymd: options.ymd,
    cc: options.cc,
    hasHorizon: false,
    prefixHours: last >= 0 ? search[last]! : -1,
  };
}

/**
 * Probe newest-first: first cycle whose horizon file is 200 is the pick.
 * If every horizon 404s, measure prefixes and take the longest.
 */
export async function pickGfsWaveSeriesCycleFromNomads(options: {
  bbox: PackBBox;
  cycles: GfsWaveCycle[];
  hours?: number[];
  fetchImpl: (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;
  prefetched?: Map<string, Uint8Array>;
}): Promise<GfsWaveCycleProbe | undefined> {
  const hours = options.hours ?? gfsWaveSeriesHours();
  const horizon = gfsWaveHorizonHour(hours);
  const seen: GfsWaveCycleProbe[] = [];
  for (const cycle of options.cycles) {
    const probe = await probeGfsWaveCycle({
      bbox: options.bbox,
      ymd: cycle.ymd,
      cc: cycle.cc,
      hours,
      fetchImpl: options.fetchImpl,
      prefetched: options.prefetched,
      horizonOnly: true,
    });
    seen.push(probe);
    if (probe.hasHorizon) return probe;
  }
  const prefixes = await Promise.all(
    seen.map((p) =>
      probeGfsWaveCycle({
        bbox: options.bbox,
        ymd: p.ymd,
        cc: p.cc,
        hours,
        fetchImpl: options.fetchImpl,
        prefetched: options.prefetched,
        horizonOnly: false,
      }),
    ),
  );
  return pickGfsWaveSeriesCycle(prefixes, horizon);
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
  budgetMs?: number;
  enabled?: boolean;
  sleep?: (ms: number) => Promise<void>;
  prefetched?: Map<string, Uint8Array>;
}): Promise<{ hour: number; url: string; bytes: Uint8Array }[]> {
  if (options.enabled !== true) return [];
  const hours = options.hours ?? gfsWaveSeriesHours();
  const pace = options.paceMs ?? GFS_WAVE_PACE_MS;
  const budget = options.budgetMs;
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const started = Date.now();
  const out: { hour: number; url: string; bytes: Uint8Array }[] = [];
  for (let i = 0; i < hours.length; i++) {
    if (budget != null && Date.now() - started > budget) break;
    if (i > 0 && pace > 0) await sleep(pace);
    const hour = hours[i]!;
    const url = gfsWaveFilterUrl(options.ymd, options.cc, hour, options.bbox);
    const cached = options.prefetched?.get(url);
    if (cached) {
      out.push({ hour, url, bytes: cached });
      continue;
    }
    try {
      const res = await options.fetchImpl(url);
      if (!res.ok) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (!gfsWaveBytesOk(buf)) continue;
      options.prefetched?.set(url, buf);
      out.push({ hour, url, bytes: buf });
    } catch {
      /* skip this hour */
    }
  }
  return out;
}

export const GFS_WAVE_SERIES_ENV = "AHANU_GFS_WAVE_SERIES";

/** Worker GET / cron: no 10 s NOMADS pause. Verified ~300 ms / file. */
export const GFS_WAVE_WORKER_PACE_MS = 0;

/** Stop the series and keep the live prefix if NOMADS is slow. */
export const GFS_WAVE_SERIES_BUDGET_MS = 25_000;

export type WorkerGfsWaveSeriesFlag =
  | false
  | { enabled: true; paceMs: number; budgetMs: number };

/**
 * Worker / cron series gate. On unless env is explicitly 0/false/off.
 * GET /api/packs used to ignore the env and stay hour-0 only.
 */
export function workerGfsWaveSeriesFlag(
  env?: Record<string, string | undefined> | null,
): WorkerGfsWaveSeriesFlag {
  const raw = env ? (env.AHANU_GFS_WAVE_SERIES ?? env.GFS_WAVE_SERIES) : undefined;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "0" || s === "false" || s === "off" || s === "no") return false;
  }
  return { enabled: true, paceMs: GFS_WAVE_WORKER_PACE_MS, budgetMs: GFS_WAVE_SERIES_BUDGET_MS };
}

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
  cycle?: GfsWaveCycle;
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
  cycle?: GfsWaveCycle,
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
  const named = cycle ? `${formatGfsWaveCycle(cycle)} ` : "";
  const note =
    complete && hoursCovered >= 72
      ? `NCEP Atlantic 0p16 ${named}f000–f072 / 3 h.`
      : `NCEP Atlantic 0p16 ${named}hours ${hours.join(",") || "none"} — hoursCovered ${hoursCovered}, not a 72 h forecast.`;
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
  cycle?: GfsWaveCycle,
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
    windKt: stackLayer(windHours, windPlanes, hoursCovered, complete, cycle),
    waveFt: stackLayer(waveHours, wavePlanes, hoursCovered, complete, cycle),
    fetchedHours: fetched,
    wantedHours,
    hoursCovered,
    complete,
    cycle,
  };
}

export {
  GFS_HOUR0_FIXTURE_NOTE,
  gfsHour0FixtureNote,
  gfsLiveHoursNote,
  hour0Plane,
  isGfsHonestyNote,
  mergeHour0IntoFixture,
  mergeLiveHoursIntoFixture,
  formatGfsWaveCycle,
} from "./noaa-gfs-merge";
