/**
 * Ingest pipeline.
 *
 * Cron (`15 2,8,14,20 * * *`) builds a live Point Judith trip pack
 * (`tryLive`, `skipCache`, NOAA timeouts) and puts each layer body at
 * `rec.r2Key` on R2 `ahanu-trip-packs` when PACKS.put exists. NOAA
 * bytes are written when that overlay landed; hashed fixtures are
 * written honestly when it did not. GET /api/packs never enables the
 * 72 h GFS-Wave series. Cron reads AHANU_GFS_WAVE_SERIES / GFS_WAVE_SERIES
 * and still leaves the series off unless those flags are set.
 *
 * ENC catalog is not official S-57. Hour-0 GFS-Wave is not a 72 h grid.
 * Live SST / chlorophyll / SSH / HMS / bathymetry / canyons are only the
 * public grids that parsed. CMEMS is not fetched.
 *
 * D1 `pack_layers` is upserted only when that table already exists.
 */
import { buildTripPack, type BuiltPack, type PackLayerRecord } from "../../../src/lib/ahanu/pack";
import { gfsWaveSeriesEnabled } from "../../../src/lib/ahanu/noaa-gfs";
import { NOAA_GRID_TIMEOUT_MS, type FetchLike } from "../../../src/lib/ahanu/noaa-http";
import { NORTHEAST_BBOX, POINT_JUDITH_CANYON_BBOX, type PackBBox } from "../../../src/lib/ahanu/pack-fixtures";

export interface IngestEnv {
  PACKS?: {
    put?: (key: string, value: string | ArrayBuffer) => Promise<unknown>;
    get?: (key: string) => Promise<{ text: () => Promise<string> } | null>;
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

export interface IngestResult {
  packId: string;
  r2Prefix: string;
  wrote: number;
  source: "r2" | "memory";
  noaa: number;
  fixture: number;
  layers: IngestLayerWrite[];
  liveErrors: string[];
  d1: boolean;
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
): Promise<number> {
  const bucket = env.PACKS;
  if (!bucket || typeof bucket.put !== "function") return 0;
  let wrote = 0;
  for (const rec of writes) {
    const body = bodies[rec.id];
    if (!body) continue;
    await bucket.put(rec.r2Key, body);
    wrote += 1;
  }
  return wrote;
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

export async function persistBuiltPack(env: IngestEnv, built: BuiltPack): Promise<IngestResult> {
  const writes = layerWrites(built.manifest, built.bodies);
  const wrote = await putPackObjects(env, writes, built.bodies);
  const d1 = await syncPackLayers(env, built.manifest.packId, writes, built.manifest.generatedAt);
  return {
    packId: built.manifest.packId,
    r2Prefix: built.manifest.r2Prefix,
    wrote,
    source: wrote > 0 ? "r2" : "memory",
    noaa: writes.filter((w) => w.source === "noaa").length,
    fixture: writes.filter((w) => w.source === "fixture").length,
    layers: writes,
    liveErrors: built.manifest.liveErrors ?? [],
    d1,
  };
}

export async function ingestFixturePack(env: IngestEnv, options: IngestOptions = {}): Promise<IngestResult> {
  const bbox = options.bbox ?? ingestDefaultBbox(env);
  const start = options.start ?? new Date().toISOString();
  const hours = options.hours ?? 72;
  const seriesOn = gfsWaveSeriesEnabled(undefined, {
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
