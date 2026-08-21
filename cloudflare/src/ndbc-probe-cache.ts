/**
 * Last-successful NDBC latest_obs cache for GET /health and GET /api/buoys.
 *
 * Those routes used to fetch https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt
 * on every request (health via probeNdbc; buoys via tryLiveNoaa with a unique
 * start ISO so the 10 min liveCache never hit). A public URL must not do that
 * unbounded. Fresh last-good (10 min) is served from isolate memory, then R2.
 * A live miss still returns 200 /health with last-probe age. Buoy rows are
 * only last-successful parsed latest_obs — never invented observations.
 *
 * Optional light isolate gate: at most one live NDBC GET per 30s when a
 * last-good exists. /health is never 429.
 */
import {
  NDBC_LATEST_OBS_URL,
  parseNdbcLatestObs,
  type PackedBuoyRow,
} from "../../src/lib/ahanu/noaa-live";
import { defaultNoaaFetch, NOAA_USER_AGENT, type FetchLike } from "../../src/lib/ahanu/noaa-http";
import { POINT_JUDITH_CANYON_BBOX } from "../../src/lib/ahanu/pack-fixtures";

export const NDBC_PROBE_TTL_MS = 10 * 60 * 1000;
export const NDBC_PROBE_MIN_INTERVAL_MS = 30_000;
export const NDBC_HEALTH_PROBE_MS = 5_000;
export const NDBC_PROBE_R2_KEY = "cache/ndbc-latest.json";

export type NdbcCacheSource = "live" | "cached" | "stale" | "skipped";

export interface NdbcCacheEnv {
  PACKS?: {
    get?: (key: string) => Promise<{ text: () => Promise<string> } | null>;
    put?: (key: string, value: string | ArrayBuffer) => Promise<unknown>;
  };
  fetchImpl?: FetchLike;
}

export interface CachedNdbcProbe {
  host: "ndbc";
  ok: boolean;
  status?: number;
  bytes?: number;
  error?: string;
  probedAt: string;
}

export interface CachedNdbcBuoys {
  updatedAt?: string;
  count: number;
  buoys: PackedBuoyRow[];
  probedAt: string;
}

export interface NdbcCacheEntry {
  probedAt: string;
  probe: CachedNdbcProbe;
  buoys?: CachedNdbcBuoys;
}

export interface NdbcHealthResult {
  noaa: CachedNdbcProbe & { ageSec: number; cached: boolean; source: NdbcCacheSource };
  source: NdbcCacheSource;
}

export interface NdbcBuoysResult {
  buoys: PackedBuoyRow[] | null;
  updatedAt?: string;
  count: number;
  probedAt?: string;
  ageSec?: number;
  cached: boolean;
  source: NdbcCacheSource | "snapshot";
}

let isolate: { at: number; entry: NdbcCacheEntry } | null = null;
let lastLiveAt = 0;
let inflight: Promise<NdbcCacheEntry | null> | null = null;

export function resetNdbcProbeCache(): void {
  isolate = null;
  lastLiveAt = 0;
  inflight = null;
}

export function seedNdbcProbeCache(
  entry: NdbcCacheEntry | null,
  opts?: { isolateAt?: number; lastLiveAt?: number },
): void {
  isolate = entry ? { at: opts?.isolateAt ?? (Date.parse(entry.probedAt) || Date.now()), entry } : null;
  if (opts?.lastLiveAt !== undefined) lastLiveAt = opts.lastLiveAt;
}

function ageSec(probedAt: string, now: number): number {
  const t = Date.parse(probedAt);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.round((now - t) / 1000));
}

function entryFresh(entry: NdbcCacheEntry, now: number): boolean {
  const t = Date.parse(entry.probedAt);
  if (!Number.isFinite(t)) return false;
  return now - t < NDBC_PROBE_TTL_MS;
}

function asPackedBuoy(raw: unknown): PackedBuoyRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id.trim()) return null;
  if (typeof o.lat !== "number" || typeof o.lon !== "number") return null;
  if (!Number.isFinite(o.lat) || !Number.isFinite(o.lon)) return null;
  const row: PackedBuoyRow = { id: o.id, name: typeof o.name === "string" ? o.name : o.id, lat: o.lat, lon: o.lon };
  if (typeof o.windKt === "number") row.windKt = o.windKt;
  if (typeof o.windDir === "number") row.windDir = o.windDir;
  if (typeof o.gustKt === "number") row.gustKt = o.gustKt;
  if (typeof o.waveFt === "number") row.waveFt = o.waveFt;
  if (typeof o.periodS === "number") row.periodS = o.periodS;
  if (typeof o.sstC === "number") row.sstC = o.sstC;
  if (typeof o.pressureMb === "number") row.pressureMb = o.pressureMb;
  if (typeof o.updatedAt === "string") row.updatedAt = o.updatedAt;
  return row;
}

export function parseNdbcCacheEntry(raw: unknown): NdbcCacheEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.probedAt !== "string" || !o.probedAt) return null;
  if (!o.probe || typeof o.probe !== "object") return null;
  const p = o.probe as Record<string, unknown>;
  if (p.host !== "ndbc" || typeof p.ok !== "boolean") return null;
  const probe: CachedNdbcProbe = {
    host: "ndbc",
    ok: p.ok,
    probedAt: typeof p.probedAt === "string" ? p.probedAt : o.probedAt,
  };
  if (typeof p.status === "number") probe.status = p.status;
  if (typeof p.bytes === "number") probe.bytes = p.bytes;
  if (typeof p.error === "string") probe.error = p.error;
  const entry: NdbcCacheEntry = { probedAt: o.probedAt, probe };
  if (o.buoys && typeof o.buoys === "object") {
    const b = o.buoys as Record<string, unknown>;
    if (!Array.isArray(b.buoys)) return entry;
    const rows = b.buoys.map(asPackedBuoy).filter((r): r is PackedBuoyRow => r !== null);
    if (!rows.length) return entry;
    entry.buoys = {
      count: rows.length,
      buoys: rows,
      probedAt: typeof b.probedAt === "string" ? b.probedAt : o.probedAt,
      updatedAt: typeof b.updatedAt === "string" ? b.updatedAt : rows[0]?.updatedAt,
    };
  }
  return entry;
}

async function readR2(env: NdbcCacheEnv): Promise<NdbcCacheEntry | null> {
  if (!env.PACKS || typeof env.PACKS.get !== "function") return null;
  try {
    const obj = await env.PACKS.get(NDBC_PROBE_R2_KEY);
    if (!obj) return null;
    const text = await obj.text();
    return parseNdbcCacheEntry(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

async function writeR2(env: NdbcCacheEnv, entry: NdbcCacheEntry): Promise<void> {
  if (!env.PACKS || typeof env.PACKS.put !== "function") return;
  try {
    await env.PACKS.put(NDBC_PROBE_R2_KEY, JSON.stringify(entry));
  } catch {
    /* last-good isolate is enough */
  }
}

async function loadCache(env: NdbcCacheEnv): Promise<NdbcCacheEntry | null> {
  if (isolate?.entry) return isolate.entry;
  const fromR2 = await readR2(env);
  if (fromR2) {
    isolate = { at: Date.parse(fromR2.probedAt) || Date.now(), entry: fromR2 };
    return fromR2;
  }
  return null;
}

function remember(entry: NdbcCacheEntry, now: number): void {
  isolate = { at: now, entry };
}

function canLive(now: number, hasLastGood: boolean): boolean {
  if (lastLiveAt <= 0) return true;
  if (now - lastLiveAt >= NDBC_PROBE_MIN_INTERVAL_MS) return true;
  return !hasLastGood;
}

async function fetchLatestObs(
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<{ ok: boolean; status?: number; bytes?: number; text?: string; error?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(NDBC_LATEST_OBS_URL, {
      signal: ctrl.signal,
      headers: { "User-Agent": NOAA_USER_AGENT },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, bytes: new TextEncoder().encode(text).byteLength, text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(t);
  }
}

async function liveNdbc(
  env: NdbcCacheEnv,
  fetchImpl: FetchLike,
  now: number,
  prior: NdbcCacheEntry | null,
): Promise<NdbcCacheEntry | null> {
  if (inflight) return inflight;
  const run = (async () => {
    lastLiveAt = now;
    const got = await fetchLatestObs(fetchImpl, NDBC_HEALTH_PROBE_MS);
    const probedAt = new Date(now).toISOString();
    if (!got.ok || !(got.bytes && got.bytes > 0) || !got.text) {
      return null;
    }
    const rows = parseNdbcLatestObs(got.text, POINT_JUDITH_CANYON_BBOX);
    const probe: CachedNdbcProbe = {
      host: "ndbc",
      ok: true,
      status: got.status,
      bytes: got.bytes,
      probedAt,
    };
    const entry: NdbcCacheEntry = { probedAt, probe };
    if (rows.length) {
      entry.buoys = {
        updatedAt: rows[0]?.updatedAt,
        count: rows.length,
        buoys: rows,
        probedAt,
      };
    } else if (prior?.buoys?.buoys.length) {
      entry.buoys = prior.buoys;
    }
    remember(entry, now);
    await writeR2(env, entry);
    return entry;
  })();
  inflight = run;
  try {
    return await run;
  } finally {
    if (inflight === run) inflight = null;
  }
}

function resolveFetch(env: NdbcCacheEnv, fetchImpl?: FetchLike): FetchLike {
  return fetchImpl ?? env.fetchImpl ?? defaultNoaaFetch;
}

export async function resolveNdbcHealth(options: {
  env: NdbcCacheEnv;
  fetchImpl?: FetchLike;
  now?: number;
}): Promise<NdbcHealthResult> {
  const now = options.now ?? Date.now();
  const cached = await loadCache(options.env);
  if (cached && entryFresh(cached, now)) {
    return {
      source: "cached",
      noaa: {
        ...cached.probe,
        ageSec: ageSec(cached.probedAt, now),
        cached: true,
        source: "cached",
      },
    };
  }
  if (!canLive(now, Boolean(cached))) {
    if (cached) {
      return {
        source: "stale",
        noaa: {
          ...cached.probe,
          ageSec: ageSec(cached.probedAt, now),
          cached: true,
          source: "stale",
        },
      };
    }
    const probedAt = new Date(now).toISOString();
    return {
      source: "skipped",
      noaa: {
        host: "ndbc",
        ok: false,
        error: "ndbc probe skipped",
        probedAt,
        ageSec: 0,
        cached: false,
        source: "skipped",
      },
    };
  }
  const live = await liveNdbc(options.env, resolveFetch(options.env, options.fetchImpl), now, cached);
  if (live?.probe.ok) {
    return {
      source: "live",
      noaa: { ...live.probe, ageSec: 0, cached: false, source: "live" },
    };
  }
  if (cached) {
    return {
      source: "stale",
      noaa: {
        ...cached.probe,
        ageSec: ageSec(cached.probedAt, now),
        cached: true,
        source: "stale",
      },
    };
  }
  const probedAt = new Date(now).toISOString();
  return {
    source: "live",
    noaa: {
      host: "ndbc",
      ok: false,
      error: "ndbc fetch failed",
      probedAt,
      ageSec: 0,
      cached: false,
      source: "live",
    },
  };
}

export async function resolveNdbcBuoys(options: {
  env: NdbcCacheEnv;
  fetchImpl?: FetchLike;
  now?: number;
}): Promise<NdbcBuoysResult> {
  const now = options.now ?? Date.now();
  const cached = await loadCache(options.env);
  if (cached?.buoys?.buoys.length && entryFresh(cached, now)) {
    return {
      buoys: cached.buoys.buoys,
      updatedAt: cached.buoys.updatedAt,
      count: cached.buoys.count,
      probedAt: cached.buoys.probedAt,
      ageSec: ageSec(cached.buoys.probedAt, now),
      cached: true,
      source: "cached",
    };
  }
  if (!canLive(now, Boolean(cached?.buoys?.buoys.length))) {
    if (cached?.buoys?.buoys.length) {
      return {
        buoys: cached.buoys.buoys,
        updatedAt: cached.buoys.updatedAt,
        count: cached.buoys.count,
        probedAt: cached.buoys.probedAt,
        ageSec: ageSec(cached.buoys.probedAt, now),
        cached: true,
        source: "stale",
      };
    }
    return { buoys: null, count: 0, cached: false, source: "skipped" };
  }
  const live = await liveNdbc(options.env, resolveFetch(options.env, options.fetchImpl), now, cached);
  if (live?.buoys?.buoys.length) {
    return {
      buoys: live.buoys.buoys,
      updatedAt: live.buoys.updatedAt,
      count: live.buoys.count,
      probedAt: live.buoys.probedAt,
      ageSec: 0,
      cached: false,
      source: "live",
    };
  }
  if (cached?.buoys?.buoys.length) {
    return {
      buoys: cached.buoys.buoys,
      updatedAt: cached.buoys.updatedAt,
      count: cached.buoys.count,
      probedAt: cached.buoys.probedAt,
      ageSec: ageSec(cached.buoys.probedAt, now),
      cached: true,
      source: "stale",
    };
  }
  return { buoys: null, count: 0, cached: false, source: live ? "live" : "skipped" };
}
