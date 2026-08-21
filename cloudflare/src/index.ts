/**
 * ahanu-packs — Cloudflare Worker for Ahanu trip-pack delivery.
 *
 * THIS WORKER PACKAGES BYTES. It does not score habitat, detect temperature
 * breaks, compute solunar, or evaluate go/no-go. Those run on the device
 * against the TypeScript domain in src/lib/ahanu (and later the Dart/WASM
 * port). Sending a raster to the helm and letting the helm think is the
 * whole point of the offline-first design.
 *
 * Production bindings: R2 `ahanu-trip-packs`, D1 `ahanu-core`, DO CommunityHub.
 * When R2 is empty, fixture bodies are generated and hashed (SHA-256 of
 * the object bytes). Production ingest replaces fixtures with NOAA/CMEMS
 * clips. The Worker never scores habitat or go/no-go.
 */

import { listIngestSources } from "./ingest/sources";
import {
  clampBbox,
  NORTHEAST,
  specForLayer,
  type BBox,
} from "./ingest/pack";
import { buildTripPack, landedPackNotes, landedPackSources, landedProductSources, rememberBuiltPack } from "../../src/lib/ahanu/pack";
import { layerBody } from "./layer-body";
import { NOAA_GRID_TIMEOUT_MS, type FetchLike } from "../../src/lib/ahanu/noaa-http";
import {
  resolveNdbcBuoys,
  resolveNdbcHealth,
  type CachedNdbcProbe,
} from "./ndbc-probe-cache";
import { ingestFixturePack, persistBuiltPack, persistLayerObject, ingestDefaultBbox, headPackManifest, resolvePackManifest } from "./ingest/run";
import {
  bearerToken,
  catchBindDecision,
  hashDeviceToken,
  requireDeviceAuth,
  requireIngestAuth,
} from "./ingest-auth";
import {
  LIVE_REBUILD_LIMIT,
  LIVE_REBUILD_WINDOW_MS,
  LiveRebuildLimitError,
  connectingIp,
} from "./live-rebuild-limit";
import { applyPacksSecurityHeaders } from "../../src/lib/ahanu/security-headers";

export type { BBox } from "./ingest/pack";

/** Binding shapes — structural stand-ins for Cloudflare runtime types. */
interface D1RunResult {
  meta?: { changes?: number };
}
interface D1Prepared {
  bind: (...values: unknown[]) => D1Prepared;
  run: () => Promise<D1RunResult | unknown>;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
}
interface D1Binding {
  prepare: (query: string) => D1Prepared;
}
interface DoId {
  toString: () => string;
}
interface DoStub {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}
interface DoNamespace {
  idFromName: (name: string) => DoId;
  get: (id: DoId) => DoStub;
}
interface DoStorage {
  get: <T>(key: string) => Promise<T | undefined>;
  put: <T>(key: string, value: T) => Promise<void>;
}
interface DoState {
  storage: DoStorage;
}

interface R2Like {
  get?: (
    key: string,
  ) => Promise<{ text: () => Promise<string>; arrayBuffer?: () => Promise<ArrayBuffer> } | null>;
  put?: (key: string, value: string | ArrayBuffer) => Promise<unknown>;
}

export interface Env {
  PACKS?: R2Like;
  DB?: D1Binding;
  COMMUNITY?: DoNamespace;
  SERVICE?: string;
  REGION_WEST?: string;
  REGION_SOUTH?: string;
  REGION_EAST?: string;
  REGION_NORTH?: string;
  AHANU_GFS_WAVE_SERIES?: string;
  GFS_WAVE_SERIES?: string;
  INGEST_TOKEN?: string;
  AHANU_INGEST_TOKEN?: string;
  /** Node tests inject a stub. Production isolate has none. */
  fetchImpl?: FetchLike;
  LIVE_REBUILD?: { limit: (opts: { key: string }) => Promise<{ success: boolean }> };
}

interface ExecCtx {
  waitUntil: (p: Promise<unknown>) => void;
}

// ---------------------------------------------------------------------------
// Domain types — keep in lockstep with src/lib/ahanu/types.ts
// (Worker cannot import the React app; this is a deliberate copy of the
// contract, not a second source of truth for scoring.)
// ---------------------------------------------------------------------------

export type SpeciesId =
  | "bigeye"
  | "yellowfin"
  | "bluefin"
  | "mahi"
  | "white_marlin"
  | "blue_marlin"
  | "swordfish"
  | "albacore";

const SPECIES: readonly SpeciesId[] = [
  "bigeye",
  "yellowfin",
  "bluefin",
  "mahi",
  "white_marlin",
  "blue_marlin",
  "swordfish",
  "albacore",
];

export interface CatchRecord {
  id: string;
  userId?: string;
  species: SpeciesId;
  lat: number;
  lon: number;
  at: string;
  lengthIn?: number;
  weightLb?: number;
  released: boolean;
  photoDataUrl?: string;
  notes?: string;
  sstC?: number;
  depthM?: number;
  conditions?: string;
  synced?: boolean;
}

export interface Buoy {
  id: string;
  name: string;
  lat: number;
  lon: number;
  windKt: number;
  windDir: number;
  gustKt: number;
  waveFt: number;
  periodS: number;
  sstC: number;
  pressureMb: number;
  updatedAt: string;
}

export interface CommunityReport {
  id: string;
  who: string;
  species: SpeciesId;
  lat: number;
  lon: number;
  at: string;
  note: string;
  size?: string;
}

/** Worker-side extension of TripPackLayer — adds hash + R2 key. */
export interface TripPackLayer {
  id: string;
  label: string;
  sizeMb: number;
  sizeBytes: number;
  status: "ready" | "stale" | "missing" | "downloading";
  updatedAt: string;
  hours: number;
  hash: string;
  r2Key: string;
  contentType: string;
  format: string;
  source?: "fixture" | "r2" | "noaa";
}

export interface TripPackManifest {
  packId: string;
  version: 1;
  bbox: BBox;
  start: string;
  hours: number;
  generatedAt: string;
  readyForOffshore: boolean;
  layers: TripPackLayer[];
  totalBytes: number;
  totalMb: number;
  r2Prefix: string;
  sources: { id: string; name: string }[];
  landedSources?: { id: string; name: string }[];
  notes: string;
  liveErrors?: string[];
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Ahanu-Device",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Expose-Headers": "ETag, X-Ahanu-Pack-Id, X-Ahanu-Hash, X-Ahanu-Source, X-Ahanu-Ndbc, Retry-After",
};

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status === 200 ? "public, max-age=30" : "no-store",
      ...CORS_HEADERS,
      ...extra,
    },
  });
}

/** HEAD keeps GET status + headers; body may be empty (LB / uptime probes). */
function maybeHead(request: Request, response: Response): Response {
  if (request.method !== "HEAD") return response;
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function isRead(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

/** HEAD miss: never start skipCache NOAA. Same headers on the empty-body HEAD. */
function headNoRebuild(message: string, extra: Record<string, string> = {}): Response {
  return json(
    { error: message, hint: "HEAD does not live-rebuild NOAA" },
    503,
    { "Cache-Control": "no-store", "X-Ahanu-Source": "no-rebuild", ...extra },
  );
}

function error(status: number, message: string, extra?: Record<string, unknown>): Response {
  return json({ error: message, ...extra }, status, { "Cache-Control": "no-store" });
}

function tooManyLiveRebuilds(retryAfter: number): Response {
  return json(
    {
      error: "too many live rebuilds",
      hint: "skipCache / miss NOAA rebuilds are limited per client IP; R2 hits are not",
      retryAfter,
      limit: LIVE_REBUILD_LIMIT,
      windowSec: LIVE_REBUILD_WINDOW_MS / 1000,
    },
    429,
    { "Cache-Control": "no-store", "Retry-After": String(retryAfter) },
  );
}

function envBbox(env: Env): BBox {
  const west = Number(env.REGION_WEST);
  const south = Number(env.REGION_SOUTH);
  const east = Number(env.REGION_EAST);
  const north = Number(env.REGION_NORTH);
  if ([west, south, east, north].every((n) => Number.isFinite(n))) {
    return clampBbox({ west, south, east, north });
  }
  return NORTHEAST;
}

function parseBboxCsv(raw: string | null, fallback: BBox): BBox | Response {
  if (!raw || raw.trim() === "") return fallback;
  const parts = raw.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return error(400, "bbox must be w,s,e,n as four comma-separated numbers");
  }
  const [west, south, east, north] = parts as [number, number, number, number];
  if (east === west || north === south) {
    return error(400, "bbox has zero area");
  }
  return clampBbox({ west, south, east, north });
}

function parseCoord(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * Accepts `west`/`south`/`east`/`north` (preferred) or legacy `bbox=w,s,e,n`.
 * Empty individual params fall through to `bbox`, then to the Northeast default.
 */
function parseBboxFromUrl(url: URL, fallback: BBox): BBox | Response {
  const west = parseCoord(url.searchParams.get("west"));
  const south = parseCoord(url.searchParams.get("south"));
  const east = parseCoord(url.searchParams.get("east"));
  const north = parseCoord(url.searchParams.get("north"));
  const provided = [west, south, east, north].filter((n) => n !== undefined);
  if (provided.length > 0) {
    if (provided.length !== 4 || [west, south, east, north].some((n) => n === undefined || Number.isNaN(n))) {
      return error(400, "west, south, east, north must all be finite numbers");
    }
    if (east === west || north === south) {
      return error(400, "bbox has zero area");
    }
    return clampBbox({ west: west as number, south: south as number, east: east as number, north: north as number });
  }
  return parseBboxCsv(url.searchParams.get("bbox"), fallback);
}

function parseIso(raw: string | null): string {
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function workerManifest(manifest: Awaited<ReturnType<typeof buildTripPack>>["manifest"]): TripPackManifest {
  const layers: TripPackLayer[] = manifest.layers.map((layer) => ({
    id: layer.id,
    label: layer.label,
    sizeMb: layer.sizeMb,
    sizeBytes: layer.sizeBytes,
    status: layer.status,
    updatedAt: layer.updatedAt,
    hours: layer.hours,
    hash: layer.hash,
    r2Key: layer.r2Key,
    contentType: layer.contentType,
    format: layer.format,
    source: layer.source,
  }));
  return {
    packId: manifest.packId,
    version: 1,
    bbox: manifest.bbox,
    start: manifest.start,
    hours: manifest.hours,
    generatedAt: manifest.generatedAt,
    readyForOffshore: manifest.readyForOffshore,
    layers,
    totalBytes: manifest.totalBytes,
    totalMb: manifest.totalMb,
    r2Prefix: manifest.r2Prefix,
    sources: landedPackSources(manifest),
    landedSources: landedProductSources(manifest),
    notes: landedPackNotes({
      ...manifest,
      notes:
        manifest.notes ||
        "SHA-256 of pack object bytes. Live NOAA overlays land where fetch succeeded " +
          "(NDBC / CO-OPS / ENC catalog or official S-57 / CoastWatch SST / chlorophyll / SSH / HMS / ETOPO bathymetry / GFS-Wave). " +
          "Official S-57 packs only when NOAA zips fetch and the .000 is ISO 8211; .00n update files in the zip are packed with the cell. SST is live NOAA when a public ERDDAP grid parses — not CMEMS. " +
          "GFS-Wave fetches NOMADS atlocn.0p16 f000–f072 / 3 h (pace 0, 25 s budget). " +
          "Newest cycle that has the requested horizon wins; a publishing 00z that 404s f072 does not beat a complete 18z. " +
          "A complete series is 72 h noaa. A short prefix paints those hours and keeps a fixture tail — liveErrors name the cycle and which hours are live vs fixture. " +
          "Client must re-hash. On-device scoring does not run here.",
    }),
    liveErrors: manifest.liveErrors ?? [],
  };
}

export { layerBody } from "./layer-body";

function schedulePersist(ctx: ExecCtx | undefined, work: Promise<unknown>): void {
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(work);
  else void work;
}

// ---------------------------------------------------------------------------
// Buoys — coherent Northeast snapshot (not live NDBC; ingest will replace)
// ---------------------------------------------------------------------------

const BUOY_STATIONS: Array<Pick<Buoy, "id" | "name" | "lat" | "lon"> & { sstBias: number; waveBias: number }> = [
  { id: "44097", name: "Block Island", lat: 40.967, lon: -71.124, sstBias: 0.4, waveBias: 0.2 },
  { id: "44017", name: "Montauk Point", lat: 40.693, lon: -72.049, sstBias: 0.1, waveBias: 0.4 },
  { id: "44025", name: "Long Island", lat: 40.251, lon: -73.164, sstBias: -0.3, waveBias: 0.6 },
  { id: "44065", name: "New York Harbor Entrance", lat: 40.369, lon: -73.703, sstBias: -0.6, waveBias: 0.3 },
  { id: "44008", name: "Nantucket", lat: 40.504, lon: -69.248, sstBias: 0.8, waveBias: 1.1 },
  { id: "44066", name: "Texas Tower (Hudson Canyon)", lat: 39.61, lon: -72.62, sstBias: 1.6, waveBias: 1.4 },
  { id: "44018", name: "SE Cape Cod", lat: 41.258, lon: -69.305, sstBias: 0.2, waveBias: 0.9 },
  { id: "44020", name: "Nantucket Sound", lat: 41.443, lon: -70.187, sstBias: 1.1, waveBias: -0.4 },
  { id: "44009", name: "Delaware Bay", lat: 38.461, lon: -74.702, sstBias: 0.7, waveBias: 0.5 },
  { id: "44091", name: "Barnegat", lat: 39.775, lon: -73.769, sstBias: 0.5, waveBias: 0.7 },
  { id: "BUZM3", name: "Buzzards Bay C-MAN", lat: 41.397, lon: -71.033, sstBias: 0.9, waveBias: -0.6 },
  { id: "NWPR1", name: "Newport C-MAN", lat: 41.504, lon: -71.326, sstBias: 1.2, waveBias: -0.8 },
];

function buoySnapshot(now: Date): Buoy[] {
  const hour = now.getUTCHours() + now.getUTCMinutes() / 60;
  const swell = 2.6 + Math.sin((2 * Math.PI * hour) / 24) * 0.7;
  const wind = 11 + Math.cos((2 * Math.PI * (hour - 4)) / 24) * 4;
  const sstBase = 23.4 + Math.sin((2 * Math.PI * (now.getUTCMonth() + 1)) / 12) * 0.4;
  const dir = (215 + hour * 3) % 360;
  const updatedAt = now.toISOString();
  return BUOY_STATIONS.map((s) => ({
    id: s.id,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    windKt: round1(Math.max(3, wind + (s.waveBias - 0.4) * 1.2)),
    windDir: Math.round((dir + s.lon) % 360),
    gustKt: round1(Math.max(5, wind * 1.28 + s.waveBias)),
    waveFt: round1(Math.max(0.8, swell + s.waveBias)),
    periodS: round1(7.4 + s.waveBias * 0.6),
    sstC: round1(sstBase + s.sstBias),
    pressureMb: round1(1015.2 - s.waveBias * 0.4),
    updatedAt,
  }));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// Community seed (canyon box) — DO stores live upserts on top
// ---------------------------------------------------------------------------

const SEED_REPORTS: CommunityReport[] = [
  {
    id: "rpt-veatch-01",
    who: "Laughing One",
    species: "bigeye",
    lat: 39.91,
    lon: -69.63,
    at: "2026-08-18T07:40:00.000Z",
    note: "Weed line on the 100-fathom, 72–74 F SST, birds working the east wall.",
    size: "60 lb class",
  },
  {
    id: "rpt-atlantis-01",
    who: "Southwester",
    species: "yellowfin",
    lat: 39.86,
    lon: -70.21,
    at: "2026-08-18T11:05:00.000Z",
    note: "Schoolies on the Atlantis head, 6-oz cedar, 7.2 kt.",
    size: "40–50 lb",
  },
  {
    id: "rpt-hudson-01",
    who: "Cold Spring",
    species: "white_marlin",
    lat: 39.56,
    lon: -72.38,
    at: "2026-08-17T15:22:00.000Z",
    note: "Two whites released, color edge 12 nmi south of the Texas Tower.",
    size: "released",
  },
  {
    id: "rpt-block-01",
    who: "Point Club",
    species: "mahi",
    lat: 40.72,
    lon: -71.05,
    at: "2026-08-19T14:10:00.000Z",
    note: "Dolphinfish under a pallet 18 nmi SSE of Block.",
    size: "school",
  },
  {
    id: "rpt-hydro-01",
    who: "Watcher",
    species: "swordfish",
    lat: 40.14,
    lon: -69.02,
    at: "2026-08-16T02:18:00.000Z",
    note: "Night drop on the Hydrographer west wall, 1,200 ft.",
    size: "150 lb class",
  },
];

// ---------------------------------------------------------------------------
// Auth — ingest fail-closed on INGEST_TOKEN; catches stay device-token (bound per row).
// Cron is in-process (scheduled → ingestFixturePack) and does not HTTP.
// ---------------------------------------------------------------------------

function isSpecies(s: unknown): s is SpeciesId {
  return typeof s === "string" && (SPECIES as readonly string[]).includes(s);
}

function parseCatch(body: unknown): CatchRecord | string {
  if (body === null || typeof body !== "object") return "body must be a JSON object";
  const b = body as Record<string, unknown>;
  if (typeof b.id !== "string" || b.id.length < 4) return "id is required";
  if (!isSpecies(b.species)) return `species must be one of ${SPECIES.join(", ")}`;
  if (typeof b.lat !== "number" || typeof b.lon !== "number") return "lat and lon must be numbers";
  if (b.lat < -90 || b.lat > 90 || b.lon < -180 || b.lon > 180) return "lat/lon out of range";
  if (typeof b.at !== "string" || Number.isNaN(Date.parse(b.at))) return "at must be an ISO timestamp";
  if (typeof b.released !== "boolean") return "released must be boolean";
  const rec: CatchRecord = {
    id: b.id,
    species: b.species,
    lat: b.lat,
    lon: b.lon,
    at: new Date(b.at).toISOString(),
    released: b.released,
    synced: false,
  };
  if (typeof b.userId === "string") rec.userId = b.userId;
  if (typeof b.lengthIn === "number") rec.lengthIn = b.lengthIn;
  if (typeof b.weightLb === "number") rec.weightLb = b.weightLb;
  if (typeof b.photoDataUrl === "string") rec.photoDataUrl = b.photoDataUrl;
  if (typeof b.notes === "string") rec.notes = b.notes;
  if (typeof b.sstC === "number") rec.sstC = b.sstC;
  if (typeof b.depthM === "number") rec.depthM = b.depthM;
  if (typeof b.conditions === "string") rec.conditions = b.conditions;
  return rec;
}

export type UpsertCatchResult =
  | { ok: true; rec: CatchRecord; created: boolean }
  | { ok: false; status: 403; error: string };

function runChanges(result: unknown): number | undefined {
  if (!result || typeof result !== "object" || !("meta" in result)) return undefined;
  const changes = (result as D1RunResult).meta?.changes;
  return typeof changes === "number" ? changes : undefined;
}

/**
 * Bind-and-upsert. Missing / unbound / unprovisioned DB is a no-op: the
 * worker still 201s the record so the helm can keep a local log. `synced`
 * is true only when the statement actually ran. A different device token
 * on an already-bound id is 403 and does not overwrite.
 */
export async function upsertCatch(
  env: Env,
  rec: CatchRecord,
  deviceToken: string,
): Promise<UpsertCatchResult> {
  const hash = await hashDeviceToken(deviceToken);
  const db = env.DB;
  if (!db || typeof db.prepare !== "function") {
    return { ok: true, rec: { ...rec, synced: false }, created: true };
  }
  try {
    const existing = await db
      .prepare("SELECT device_hash FROM catches WHERE id = ?")
      .bind(rec.id)
      .first<{ device_hash?: string | null }>();
    const decision = catchBindDecision(existing, hash);
    if (decision === "deny") {
      return { ok: false, status: 403, error: "catch belongs to another device" };
    }
    const written = await db
      .prepare(
        `INSERT INTO catches (id, user_id, species, lat, lon, at, length_in, weight_lb, released, notes, sst_c, depth_m, conditions, synced, device_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(id) DO UPDATE SET
           species=excluded.species, lat=excluded.lat, lon=excluded.lon, at=excluded.at,
           length_in=excluded.length_in, weight_lb=excluded.weight_lb, released=excluded.released,
           notes=excluded.notes, sst_c=excluded.sst_c, depth_m=excluded.depth_m,
           conditions=excluded.conditions, synced=1,
           device_hash=COALESCE(catches.device_hash, excluded.device_hash)
         WHERE catches.device_hash IS NULL OR catches.device_hash = excluded.device_hash`,
      )
      .bind(
        rec.id,
        rec.userId ?? null,
        rec.species,
        rec.lat,
        rec.lon,
        rec.at,
        rec.lengthIn ?? null,
        rec.weightLb ?? null,
        rec.released ? 1 : 0,
        rec.notes ?? null,
        rec.sstC ?? null,
        rec.depthM ?? null,
        rec.conditions ?? null,
        hash,
      )
      .run();
    const changes = runChanges(written);
    if (changes === 0) {
      return { ok: false, status: 403, error: "catch belongs to another device" };
    }
    return { ok: true, rec: { ...rec, synced: true }, created: decision === "insert" };
  } catch {
    return { ok: true, rec: { ...rec, synced: false }, created: true };
  }
}

// ---------------------------------------------------------------------------
// Durable Object — bbox-scoped community reports (live, not scored)
// ---------------------------------------------------------------------------

/** Not HTTP. Binding kept for later pack-build leases. /api/community is 404. */
export class CommunityHub {
  private readonly state: DoState;
  constructor(state: DoState, _env: Env) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET") {
      const stored = (await this.state.storage.get<CommunityReport[]>("reports")) ?? [];
      return json({ reports: [...SEED_REPORTS, ...stored] });
    }
    if (request.method === "PUT") {
      const body = (await request.json()) as CommunityReport;
      const stored = (await this.state.storage.get<CommunityReport[]>("reports")) ?? [];
      const next = [body, ...stored.filter((r) => r.id !== body.id)].slice(0, 200);
      await this.state.storage.put("reports", next);
      return json({ ok: true, id: body.id });
    }
    return json({ error: "method not allowed", path: url.pathname }, 405);
  }
}

export type NoaaHealthProbe = CachedNdbcProbe;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async scheduled(_event: unknown, env: Env, ctx: ExecCtx): Promise<void> {
    // Privileged: same isolate as INGEST_TOKEN. Does not POST /api/ingest.
    ctx.waitUntil(ingestFixturePack(env));
  },
  async fetch(request: Request, env: Env, ctx?: ExecCtx): Promise<Response> {
    return applyPacksSecurityHeaders(request, await packsFetch(request, env, ctx));
  },
};

async function packsFetch(request: Request, env: Env, ctx?: ExecCtx): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if ((request.method === "GET" || request.method === "HEAD") && (path === "/health" || path === "/")) {
        const resolved = await resolveNdbcHealth({ env, fetchImpl: env.fetchImpl });
        return maybeHead(
          request,
          json(
            {
              ok: true,
              service: env.SERVICE ?? "ahanu-packs",
              ts: new Date().toISOString(),
              scoring: "on-device-only",
              noaa: resolved.noaa,
            },
            200,
            { "Cache-Control": "no-store", "X-Ahanu-Ndbc": resolved.source },
          ),
        );
      }

      if (isRead(request.method) && path === "/api/packs") {
        const bboxOrErr = parseBboxFromUrl(url, envBbox(env));
        if (bboxOrErr instanceof Response) return maybeHead(request, bboxOrErr);
        const start = parseIso(url.searchParams.get("start"));
        const hoursRaw = url.searchParams.get("hours");
        const hours = hoursRaw && hoursRaw.trim() !== "" ? Number(hoursRaw) : 72;
        if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
          return maybeHead(request, error(400, "hours must be 1–168"));
        }
        const packId = (url.searchParams.get("packId") ?? "").trim() || undefined;
        if (request.method === "HEAD") {
          const headed = await headPackManifest(env, {
            bbox: bboxOrErr,
            start,
            hours: Math.round(hours),
            packId,
          });
          if (headed.source === "no-rebuild") {
            return maybeHead(request, headNoRebuild("no cached pack"));
          }
          const manifest = workerManifest(headed.manifest);
          return maybeHead(
            request,
            json(manifest, 200, {
              "X-Ahanu-Pack-Id": manifest.packId,
              "X-Ahanu-Source": headed.source,
              ETag: `"${manifest.packId}"`,
            }),
          );
        }
        const skipRaw = (url.searchParams.get("skipCache") ?? "").trim().toLowerCase();
        const skipCache = skipRaw === "1" || skipRaw === "true" || skipRaw === "yes";
        const resolved = await resolvePackManifest(env, {
          bbox: bboxOrErr,
          start,
          hours: Math.round(hours),
          skipCache,
          packId,
          fetchImpl: env.fetchImpl,
          limitLiveRebuild: { ip: connectingIp(request), limiter: env.LIVE_REBUILD },
        });
        if (resolved.built) {
          rememberBuiltPack(resolved.built);
          try {
            await persistBuiltPack(env, resolved.built);
          } catch {
            schedulePersist(ctx, persistBuiltPack(env, resolved.built));
          }
        }
        const manifest = workerManifest(resolved.manifest);
        return json(manifest, 200, {
          "X-Ahanu-Pack-Id": manifest.packId,
          "X-Ahanu-Source": resolved.source,
          ETag: `"${manifest.packId}"`,
        });
      }

      if (isRead(request.method) && (path === "/api/objects" || path.startsWith("/api/objects/"))) {
        const bboxOrErr = parseBboxFromUrl(url, envBbox(env));
        if (bboxOrErr instanceof Response) return maybeHead(request, bboxOrErr);
        const start = parseIso(url.searchParams.get("start"));
        const hoursRaw = url.searchParams.get("hours");
        const hours = hoursRaw && hoursRaw.trim() !== "" ? Number(hoursRaw) : 72;
        if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
          return maybeHead(request, error(400, "hours must be 1–168"));
        }
        const layer = url.searchParams.get("layer") ?? path.split("/").pop() ?? "";
        const spec = specForLayer(layer);
        if (!spec) return maybeHead(request, error(404, "unknown layer", { layer }));
        const objSkipRaw = (url.searchParams.get("skipCache") ?? "").trim().toLowerCase();
        const objSkipCache = objSkipRaw === "1" || objSkipRaw === "true" || objSkipRaw === "yes";
        const packId = (url.searchParams.get("packId") ?? "").trim() || undefined;
        const hash = (url.searchParams.get("hash") ?? "").trim() || undefined;
        const head = request.method === "HEAD";
        const obj = await layerBody(env, bboxOrErr, start, Math.round(hours), spec.id, {
          skipCache: head ? false : objSkipCache,
          packId,
          hash,
          fetchImpl: env.fetchImpl,
          limitLiveRebuild: head ? undefined : { ip: connectingIp(request), limiter: env.LIVE_REBUILD },
          head,
        });
        if (!obj) {
          if (head) return maybeHead(request, headNoRebuild("layer body missing"));
          return error(404, "layer body missing", { layer });
        }
        if (!head && obj.source !== "r2" && env.PACKS && typeof env.PACKS.put === "function") {
          schedulePersist(
            ctx,
            persistLayerObject(env, {
              packId: obj.packId,
              id: spec.id,
              r2Key: obj.r2Key,
              hash: obj.hash,
              body: obj.body,
            }),
          );
        }
        return maybeHead(
          request,
          new Response(obj.body, {
            status: 200,
            headers: {
              "Content-Type": obj.contentType,
              ETag: `"${obj.hash}"`,
              "X-Ahanu-Hash": obj.hash,
              "X-Ahanu-Source": obj.source,
              "X-Ahanu-Pack-Id": obj.packId,
              ...CORS_HEADERS,
            },
          }),
        );
      }

      if (isRead(request.method) && path === "/api/sources") {
        const sources = listIngestSources();
        return maybeHead(
          request,
          json({
            count: sources.length,
            scoring: "on-device-only",
            notes: "Adapters return metadata and real upstream URLs. The Worker packages bytes; it does not score habitat.",
            sources,
          }),
        );
      }

      if (isRead(request.method) && path === "/api/buoys") {
        const resolved = await resolveNdbcBuoys({ env, fetchImpl: env.fetchImpl });
        if (resolved.buoys?.length) {
          return maybeHead(
            request,
            json(
              {
                updatedAt: resolved.updatedAt,
                count: resolved.count,
                source: "ndbc-live",
                cached: resolved.cached,
                probedAt: resolved.probedAt,
                ageSec: resolved.ageSec,
                buoys: resolved.buoys,
              },
              200,
              { "X-Ahanu-Ndbc": resolved.source },
            ),
          );
        }
        const snap = buoySnapshot(new Date());
        return maybeHead(
          request,
          json(
            {
              updatedAt: snap[0]?.updatedAt,
              count: snap.length,
              source: "ndbc-snapshot",
              cached: false,
              buoys: snap,
            },
            200,
            { "X-Ahanu-Ndbc": "snapshot" },
          ),
        );
      }

      if ((request.method === "POST" || request.method === "GET") && path === "/api/ingest") {
        if (request.method !== "POST") return error(405, "method not allowed", { hint: "POST /api/ingest with Authorization: Bearer" });
        const denied = requireIngestAuth(request, env);
        if (denied) return denied;
        const bboxOrErr = parseBboxFromUrl(url, ingestDefaultBbox(env));
        if (bboxOrErr instanceof Response) return bboxOrErr;
        const start = parseIso(url.searchParams.get("start"));
        const hoursRaw = url.searchParams.get("hours");
        const hours = hoursRaw && hoursRaw.trim() !== "" ? Number(hoursRaw) : 72;
        if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
          return error(400, "hours must be 1–168");
        }
        const result = await ingestFixturePack(env, {
          bbox: bboxOrErr,
          start,
          hours: Math.round(hours),
          skipCache: true,
          timeoutMs: NOAA_GRID_TIMEOUT_MS,
        });
        return json({ ok: true, ingest: result }, 200, { "Cache-Control": "no-store" });
      }

      if (path === "/api/catches" || path.startsWith("/api/catches/")) {
        if (request.method !== "POST" || path !== "/api/catches") {
          return error(404, "not found", {
            path,
            hint: "catch list is device-local; POST /api/catches upserts the skipper's own log",
          });
        }
        const denied = requireDeviceAuth(request);
        if (denied) return denied;
        const token = bearerToken(request);
        if (!token) {
          return error(401, "unauthorized", { hint: "Authorization: Bearer <device-token>" });
        }
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return error(400, "invalid JSON");
        }
        const parsed = parseCatch(body);
        if (typeof parsed === "string") return error(400, parsed);
        const saved = await upsertCatch(env, parsed, token);
        if (!saved.ok) {
          return error(saved.status, saved.error, {
            hint: "POST /api/catches updates only the device that created this id",
          });
        }
        return json({ ok: true, catch: saved.rec }, saved.created ? 201 : 200, {
          "Cache-Control": "no-store",
        });
      }

      if (path === "/api/community" || path.startsWith("/api/community/")) {
        return error(404, "not found", {
          path,
          hint: "community HTTP is unused; helm paints a packed local snapshot",
        });
      }

      return error(404, "not found", { path });
    } catch (err) {
      if (err instanceof LiveRebuildLimitError) return tooManyLiveRebuilds(err.retryAfter);
      const message = err instanceof Error ? err.message : "internal error";
      return error(500, message);
    }
}
