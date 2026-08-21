/**
 * Ingest pipeline.
 *
 * Cron (`15 2,8,14,20 * * *`) builds a live Point Judith trip pack
 * (`tryLive`, `skipCache`, NOAA timeouts) and puts every advertised
 * layer body at the hash key, `packs/{packId}/{layer}`, and
 * `packs/{packId}/manifest.json` on R2 `ahanu-trip-packs` when
 * PACKS.put exists. Official ENC (~3.4 MB), SST, and GRIB go as one
 * put (UTF-8 bytes). A body over R2_SINGLE_PUT_MAX_BYTES is split
 * into parts — never dropped silently. One layer throw does not abort
 * the rest. GET /api/packs and cron share persistBuiltPack.
 * GET /api/packs without skipCache serves packs/{packId}/manifest.json
 * when it is present (same 6 h packId window or explicit packId) and
 * does not rebuild NOAA. skipCache=1 or a miss is a live build + persist.
 *
 * Official S-57 packs when NOAA zips fetch and parse ISO 8211; catalog-only otherwise.
 * Hour-0 GFS-Wave is not a 72 h grid unless the series completes.
 * Live SST / chlorophyll / SSH / HMS / bathymetry / canyons are only the
 * public grids that parsed. CMEMS is not fetched.
 *
 * D1 `pack_layers` is upserted only when that table already exists.
 */
import { buildTripPack, packIdFor, type BuiltPack, type PackLayerRecord } from "../../../src/lib/ahanu/pack";
import { workerGfsWaveSeriesFlag } from "../../../src/lib/ahanu/noaa-gfs";
import { NOAA_GRID_TIMEOUT_MS, type FetchLike } from "../../../src/lib/ahanu/noaa-http";
import { assertLiveRebuildAllowed, type LimitLiveRebuild } from "../live-rebuild-limit";
import { NORTHEAST_BBOX, POINT_JUDITH_CANYON_BBOX, type PackBBox } from "../../../src/lib/ahanu/pack-fixtures";

export interface IngestEnv {
  PACKS?: {
    put?: (key: string, value: string | ArrayBuffer) => Promise<unknown>;
    get?: (
      key: string,
    ) => Promise<{ text: () => Promise<string>; arrayBuffer?: () => Promise<ArrayBuffer> } | null>;
  };
  DB?: {
    prepare: (query: string) => {
      bind: (...values: unknown[]) => { run: () => Promise<unknown> };
    };
  };
  AHANU_GFS_WAVE_SERIES?: string;
  GFS_WAVE_SERIES?: string;
  REGION_WEST?: string;
  REGION_SOUTH?: string;
  REGION_EAST?: string;
  REGION_NORTH?: string;
}

export interface IngestLayerWrite {
  id: string;
  r2Key: string;
  source: PackLayerRecord["source"];
  bytes: number;
  hash: string;
}

export interface IngestLayerFail {
  id: string;
  error: string;
}

export interface IngestResult {
  packId: string;
  r2Prefix: string;
  wrote: number;
  source: "r2" | "memory";
  noaa: number;
  fixture: number;
  layers: IngestLayerWrite[];
  failed: IngestLayerFail[];
  liveErrors: string[];
  d1: boolean;
}

export interface PersistPutOptions {
  /** Override R2_SINGLE_PUT_MAX_BYTES (tests). Official ENC ~3.4 MB must fit. */
  putMaxBytes?: number;
  partBytes?: number;
}

export interface PersistLayerInput {
  packId: string;
  id: string;
  r2Key: string;
  hash: string;
  body: string;
}

export interface R2PartPointer {
  ahanuR2Parts: 1;
  hash: string;
  bytes: number;
  parts: string[];
}

export interface IngestOptions {
  bbox?: PackBBox;
  start?: string;
  hours?: number;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  skipCache?: boolean;
}

/** Product default: Point Judith canyon box. Env NE box is opt-in via bbox. */
export function ingestDefaultBbox(_env?: IngestEnv): PackBBox {
  return POINT_JUDITH_CANYON_BBOX;
}

/** Stable alias so objects GET can find the last hashed body without rebuilding NOAA. */
export function latestLayerR2Key(packId: string, layerId: string): string {
  return `packs/${packId}/${layerId}`;
}

export function hashedLayerR2Key(packId: string, layerId: string, hash: string, ext: string): string {
  return `packs/${packId}/${layerId}/${hash.slice(0, 12)}.${ext}`;
}

export function packManifestR2Key(packId: string): string {
  return `packs/${packId}/manifest.json`;
}

function isPersistedManifest(value: unknown, packId: string): value is BuiltPack["manifest"] {
  if (!value || typeof value !== "object") return false;
  const man = value as BuiltPack["manifest"];
  if (man.packId !== packId || man.version !== 1) return false;
  if (!Array.isArray(man.layers) || man.layers.length === 0) return false;
  return man.layers.every(
    (l) => l && typeof l.id === "string" && l.id && typeof l.hash === "string" && l.hash,
  );
}

/** Last persist for this packId. Same 6 h window via packIdFor, or an explicit packId. */
export async function loadPersistedManifest(
  env: IngestEnv,
  packId: string,
): Promise<BuiltPack["manifest"] | null> {
  const id = packId.trim();
  if (!id) return null;
  const text = await r2ObjectText(env.PACKS, packManifestR2Key(id));
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isPersistedManifest(parsed, id) ? parsed : null;
  } catch {
    return null;
  }
}

export interface ResolvePackOptions {
  bbox: PackBBox;
  start: string;
  hours: number;
  skipCache?: boolean;
  packId?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** HTTP only. Cron / ingestFixturePack omit this so they are not limited. */
  limitLiveRebuild?: LimitLiveRebuild;
}

export interface ResolvedPack {
  manifest: BuiltPack["manifest"];
  source: "r2" | "live";
  built?: BuiltPack;
}

/**
 * skipCache off: last R2 manifest for this packId when present.
 * skipCache or miss: live buildTripPack. Caller persists a live result.
 * HTTP callers pass limitLiveRebuild so a live rebuild is fail-closed
 * per CF-Connecting-IP. An R2 hit returns before that gate.
 */
export async function resolvePackManifest(env: IngestEnv, opts: ResolvePackOptions): Promise<ResolvedPack> {
  const hours = opts.hours;
  const packId = (opts.packId ?? "").trim() || (await packIdFor(opts.bbox, opts.start, hours));
  if (!opts.skipCache) {
    const stored = await loadPersistedManifest(env, packId);
    if (stored) return { manifest: stored, source: "r2" };
  }
  if (opts.limitLiveRebuild) {
    await assertLiveRebuildAllowed(opts.limitLiveRebuild.ip, opts.limitLiveRebuild.limiter);
  }
  const built = await buildTripPack({
    bbox: opts.bbox,
    start: opts.start,
    hours,
    tryLive: true,
    skipCache: opts.skipCache === true,
    timeoutMs: opts.timeoutMs ?? NOAA_GRID_TIMEOUT_MS,
    fetchImpl: opts.fetchImpl,
    gfsWaveSeries: workerGfsWaveSeriesFlag({
      AHANU_GFS_WAVE_SERIES: env.AHANU_GFS_WAVE_SERIES,
      GFS_WAVE_SERIES: env.GFS_WAVE_SERIES,
    }),
  });
  return { manifest: built.manifest, source: "live", built };
}

/** Worker-safe single R2 put. Official S-57 ENC ~3.4 MB stays one object. */
export const R2_SINGLE_PUT_MAX_BYTES = 8_388_608;
export const R2_PART_BYTES = 4_194_304;
const PART_POINTER_PREFIX = '{"ahanuR2Parts":';

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function asPutBody(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export function parseR2PartPointer(text: string): R2PartPointer | null {
  if (!text.startsWith(PART_POINTER_PREFIX)) return null;
  try {
    const parsed = JSON.parse(text) as R2PartPointer;
    if (parsed.ahanuR2Parts !== 1 || !Array.isArray(parsed.parts) || parsed.parts.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function r2ObjectText(
  bucket: IngestEnv["PACKS"],
  key: string,
): Promise<string | null> {
  if (!bucket || typeof bucket.get !== "function") return null;
  try {
    const obj = await bucket.get(key);
    if (!obj) return null;
    if (typeof obj.arrayBuffer === "function") {
      const buf = new Uint8Array(await obj.arrayBuffer());
      return new TextDecoder("utf-8", { fatal: false }).decode(buf);
    }
    return await obj.text();
  } catch {
    return null;
  }
}

export async function resolveR2LayerBody(
  bucket: IngestEnv["PACKS"],
  raw: string,
): Promise<string | null> {
  const pointer = parseR2PartPointer(raw);
  if (!pointer) return raw;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (const partKey of pointer.parts) {
    const part = await r2ObjectText(bucket, partKey);
    if (part == null) return null;
    const bytes = utf8(part);
    chunks.push(bytes);
    total += bytes.byteLength;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(out);
}

async function putObject(
  bucket: NonNullable<IngestEnv["PACKS"]>,
  key: string,
  value: string | Uint8Array,
): Promise<void> {
  const body = typeof value === "string" ? asPutBody(utf8(value)) : asPutBody(value);
  await bucket.put!(key, body);
}

/**
 * Write hash key + latest alias. Split only above the real single-put cap.
 * One throw is returned, not thrown — callers persist the remaining layers.
 */
export async function persistLayerObject(
  env: IngestEnv,
  rec: PersistLayerInput,
  opts: PersistPutOptions = {},
): Promise<{ wrote: boolean; parts: number; error?: string }> {
  const bucket = env.PACKS;
  if (!bucket || typeof bucket.put !== "function") return { wrote: false, parts: 0, error: "no PACKS.put" };
  const bytes = utf8(rec.body);
  const maxBytes = opts.putMaxBytes ?? R2_SINGLE_PUT_MAX_BYTES;
  const partBytes = opts.partBytes ?? R2_PART_BYTES;
  const latest = latestLayerR2Key(rec.packId, rec.id);
  try {
    if (bytes.byteLength <= maxBytes) {
      await putObject(bucket, rec.r2Key, bytes);
      await putObject(bucket, latest, bytes);
      return { wrote: true, parts: 0 };
    }
    if (partBytes < 1) throw new Error(`layer ${rec.id} is ${bytes.byteLength} B over put cap ${maxBytes} and partBytes is invalid`);
    const partKeys: string[] = [];
    for (let i = 0, n = 0; i < bytes.byteLength; i += partBytes, n += 1) {
      const chunk = bytes.subarray(i, Math.min(i + partBytes, bytes.byteLength));
      const key = `${rec.r2Key}.part/${String(n).padStart(3, "0")}`;
      await putObject(bucket, key, chunk);
      partKeys.push(key);
    }
    const pointer = JSON.stringify({
      ahanuR2Parts: 1,
      hash: rec.hash,
      bytes: bytes.byteLength,
      parts: partKeys,
    } satisfies R2PartPointer);
    await putObject(bucket, rec.r2Key, pointer);
    await putObject(bucket, latest, pointer);
    return { wrote: true, parts: partKeys.length };
  } catch (err) {
    return { wrote: false, parts: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export function layerWrites(manifest: BuiltPack["manifest"], bodies: Record<string, string>): IngestLayerWrite[] {
  const out: IngestLayerWrite[] = [];
  for (const layer of manifest.layers) {
    const body = bodies[layer.id];
    if (!body) continue;
    out.push({
      id: layer.id,
      r2Key: layer.r2Key,
      source: layer.source,
      bytes: layer.sizeBytes,
      hash: layer.hash,
    });
  }
  return out;
}

export async function putPackObjects(
  env: IngestEnv,
  writes: IngestLayerWrite[],
  bodies: Record<string, string>,
  packId?: string,
  opts: PersistPutOptions = {},
): Promise<{ wrote: number; failed: IngestLayerFail[] }> {
  const bucket = env.PACKS;
  if (!bucket || typeof bucket.put !== "function") return { wrote: 0, failed: [] };
  let wrote = 0;
  const failed: IngestLayerFail[] = [];
  for (const rec of writes) {
    const body = bodies[rec.id];
    if (!body) {
      failed.push({ id: rec.id, error: "missing body" });
      continue;
    }
    if (!packId) {
      try {
        await putObject(bucket, rec.r2Key, utf8(body));
        wrote += 1;
      } catch (err) {
        failed.push({ id: rec.id, error: err instanceof Error ? err.message : String(err) });
      }
      continue;
    }
    const one = await persistLayerObject(
      env,
      { packId, id: rec.id, r2Key: rec.r2Key, hash: rec.hash, body },
      opts,
    );
    if (one.wrote) wrote += 1;
    else failed.push({ id: rec.id, error: one.error ?? "put failed" });
  }
  return { wrote, failed };
}

/**
 * Best-effort index. Missing / unused `pack_layers` is a no-op.
 * Do not create the table from ingest.
 */
export async function syncPackLayers(
  env: IngestEnv,
  packId: string,
  writes: IngestLayerWrite[],
  updatedAt: string,
): Promise<boolean> {
  const db = env.DB;
  if (!db || typeof db.prepare !== "function" || writes.length === 0) return false;
  try {
    for (const rec of writes) {
      await db
        .prepare(
          `INSERT INTO pack_layers (pack_id, layer_id, r2_key, sha256, bytes, source, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(pack_id, layer_id) DO UPDATE SET
             r2_key=excluded.r2_key, sha256=excluded.sha256, bytes=excluded.bytes,
             source=excluded.source, updated_at=excluded.updated_at`,
        )
        .bind(packId, rec.id, rec.r2Key, rec.hash, rec.bytes, rec.source, updatedAt)
        .run();
    }
    return true;
  } catch {
    return false;
  }
}

export async function persistBuiltPack(
  env: IngestEnv,
  built: BuiltPack,
  opts: PersistPutOptions = {},
): Promise<IngestResult> {
  const writes = layerWrites(built.manifest, built.bodies);
  const { wrote, failed } = await putPackObjects(env, writes, built.bodies, built.manifest.packId, opts);
  const bucket = env.PACKS;
  if (bucket && typeof bucket.put === "function") {
    try {
      await putObject(bucket, packManifestR2Key(built.manifest.packId), JSON.stringify(built.manifest));
    } catch {
      /* hash + latest keys already written; objects can still use those */
    }
  }
  const d1 = await syncPackLayers(env, built.manifest.packId, writes, built.manifest.generatedAt);
  return {
    packId: built.manifest.packId,
    r2Prefix: built.manifest.r2Prefix,
    wrote,
    source: wrote > 0 ? "r2" : "memory",
    noaa: writes.filter((w) => w.source === "noaa").length,
    fixture: writes.filter((w) => w.source === "fixture").length,
    layers: writes,
    failed,
    liveErrors: built.manifest.liveErrors ?? [],
    d1,
  };
}

export async function ingestFixturePack(env: IngestEnv, options: IngestOptions = {}): Promise<IngestResult> {
  const bbox = options.bbox ?? ingestDefaultBbox(env);
  const start = options.start ?? new Date().toISOString();
  const hours = options.hours ?? 72;
  const seriesOn = workerGfsWaveSeriesFlag({
    AHANU_GFS_WAVE_SERIES: env.AHANU_GFS_WAVE_SERIES,
    GFS_WAVE_SERIES: env.GFS_WAVE_SERIES,
  });
  const built = await buildTripPack({
    bbox,
    start,
    hours,
    tryLive: true,
    skipCache: options.skipCache !== false,
    timeoutMs: options.timeoutMs ?? NOAA_GRID_TIMEOUT_MS,
    fetchImpl: options.fetchImpl,
    gfsWaveSeries: seriesOn,
  });
  return persistBuiltPack(env, built);
}

export { NORTHEAST_BBOX, POINT_JUDITH_CANYON_BBOX };
