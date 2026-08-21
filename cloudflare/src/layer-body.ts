/**
 * Serve the same layer bytes GET /api/packs just hashed.
 * Isolate cache first (must match requested hash when present), then R2
 * by hash key / stored manifest r2Key / latest alias.
 * A pinned packId or hash must not rebuild NOAA — a second NDBC snapshot
 * would hash differently from the helm's stored manifest.
 * HEAD (`opts.head`) is isolate/R2 only: never buildTripPack, never take
 * a skipCache live-rebuild slot. skipCache on HEAD is treated as off.
 */
import { specForLayer, type BBox } from "./ingest/pack";
import {
  buildTripPack,
  hashesMatch,
  packIdFor,
  peekBuiltPack,
  rememberBuiltPack,
  sha256Hex,
  type BuiltPack,
} from "../../src/lib/ahanu/pack";
import { NOAA_GRID_TIMEOUT_MS } from "../../src/lib/ahanu/noaa-http";
import {
  hashedLayerR2Key,
  latestLayerR2Key,
  packManifestR2Key,
  resolveR2LayerBody,
  r2ObjectText,
} from "./ingest/run";
import { workerGfsWaveSeriesFlag } from "../../src/lib/ahanu/noaa-gfs";
import { assertLiveRebuildAllowed, type LimitLiveRebuild } from "./live-rebuild-limit";

export interface LayerBodyEnv {
  PACKS?: {
    get?: (
      key: string,
    ) => Promise<{ text: () => Promise<string>; arrayBuffer?: () => Promise<ArrayBuffer> } | null>;
    put?: (key: string, value: string | ArrayBuffer) => Promise<unknown>;
  };
  AHANU_GFS_WAVE_SERIES?: string;
  GFS_WAVE_SERIES?: string;
  AISSTREAM_API_KEY?: string;
}

export interface LayerBodyResult {
  body: string;
  hash: string;
  contentType: string;
  source: "r2" | "fixture" | "noaa";
  r2Key: string;
  packId: string;
  persist?: { id: string; body: string };
}

function layerFromBuilt(built: BuiltPack, layerId: string): LayerBodyResult | null {
  const rec = built.manifest.layers.find((l) => l.id === layerId);
  const body = built.bodies[layerId];
  if (!rec || !body) return null;
  return {
    body,
    hash: rec.hash,
    contentType: rec.contentType,
    source: rec.source === "noaa" ? "noaa" : "fixture",
    r2Key: rec.r2Key,
    packId: built.manifest.packId,
  };
}

async function r2Text(bucket: LayerBodyEnv["PACKS"], key: string): Promise<string | null> {
  const raw = await r2ObjectText(bucket, key);
  if (raw == null) return null;
  return resolveR2LayerBody(bucket, raw);
}

async function r2IfHash(
  env: LayerBodyEnv,
  key: string,
  packId: string,
  contentType: string,
  wantHash?: string,
): Promise<LayerBodyResult | null> {
  const body = await r2Text(env.PACKS, key);
  if (!body) return null;
  const hash = await sha256Hex(body);
  if (wantHash && !hashesMatch(hash, wantHash)) return null;
  return { body, hash, contentType, source: "r2", r2Key: key, packId };
}

export async function layerBody(
  env: LayerBodyEnv,
  bbox: BBox,
  start: string,
  hours: number,
  layerId: string,
  opts?: {
    skipCache?: boolean;
    packId?: string;
    hash?: string;
    fetchImpl?: (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;
    /** HTTP only. Counted only when this call is about to rebuild NOAA. */
    limitLiveRebuild?: LimitLiveRebuild;
    /** HEAD: isolate/R2 only — never rebuild, never take a live-rebuild slot. */
    head?: boolean;
  },
): Promise<LayerBodyResult | null> {
  const spec = specForLayer(layerId);
  if (!spec) return null;
  const skipCache = opts?.skipCache === true && !opts?.head;
  const wantHash = (opts?.hash ?? "").trim().toLowerCase() || undefined;
  const pinned = Boolean(opts?.packId || wantHash);

  const cached = peekBuiltPack({ bbox, start, hours, packId: opts?.packId });
  const cacheOk = Boolean(cached) && (!skipCache || Boolean(opts?.packId && cached?.manifest.packId === opts.packId));
  if (cacheOk && cached) {
    const hit = layerFromBuilt(cached, layerId);
    if (hit && (!wantHash || hashesMatch(hit.hash, wantHash))) return hit;
  }

  if (!skipCache) {
    const packId = opts?.packId || (await packIdFor(bbox, start, hours));
    if (wantHash) {
      const hashed = await r2IfHash(
        env,
        hashedLayerR2Key(packId, spec.id, wantHash, spec.ext),
        packId,
        spec.contentType,
        wantHash,
      );
      if (hashed) return hashed;
    }
    const manText = await r2Text(env.PACKS, packManifestR2Key(packId));
    if (manText) {
      try {
        const man = JSON.parse(manText) as {
          layers?: { id: string; hash: string; r2Key: string; contentType: string; source?: string }[];
        };
        const rec = man.layers?.find((l) => l.id === layerId);
        if (rec?.r2Key && (!wantHash || hashesMatch(rec.hash, wantHash))) {
          const fromMan = await r2IfHash(env, rec.r2Key, packId, rec.contentType, wantHash);
          if (fromMan) return { ...fromMan, hash: rec.hash };
        }
      } catch {
        /* fall through */
      }
    }
    const latest = await r2IfHash(env, latestLayerR2Key(packId, spec.id), packId, spec.contentType, wantHash);
    if (latest) return latest;
    if (pinned) return null;
  }

  if (opts?.head) return null;
  if (pinned && !skipCache) return null;

  if (opts?.limitLiveRebuild) {
    await assertLiveRebuildAllowed(opts.limitLiveRebuild.ip, opts.limitLiveRebuild.limiter);
  }

  const built = await buildTripPack({
    bbox,
    start,
    hours,
    tryLive: true,
    timeoutMs: NOAA_GRID_TIMEOUT_MS,
    skipCache,
    fetchImpl: opts?.fetchImpl,
    gfsWaveSeries: workerGfsWaveSeriesFlag({
      AHANU_GFS_WAVE_SERIES: env.AHANU_GFS_WAVE_SERIES,
      GFS_WAVE_SERIES: env.GFS_WAVE_SERIES,
    }),
    aisstreamApiKey: env.AISSTREAM_API_KEY,
  });
  rememberBuiltPack(built);
  const rec = built.manifest.layers.find((l) => l.id === layerId);
  const body = built.bodies[layerId];
  if (!rec || !body) return null;
  if (wantHash && !hashesMatch(rec.hash, wantHash)) return null;
  return {
    body,
    hash: rec.hash,
    contentType: rec.contentType,
    source: rec.source === "noaa" ? "noaa" : "fixture",
    r2Key: rec.r2Key,
    packId: built.manifest.packId,
    persist: { id: rec.id, body },
  };
}
