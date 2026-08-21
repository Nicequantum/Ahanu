/**
 * Serve the same layer bytes GET /api/packs just hashed.
 * Isolate cache first, then R2 by the stored manifest r2Key / latest alias.
 * Rebuild NOAA only when both miss — a second NDBC snapshot would otherwise
 * hash differently from the helm's manifest.
 */
import { specForLayer, type BBox } from "./ingest/pack";
import {
  buildTripPack,
  packIdFor,
  peekBuiltPack,
  rememberBuiltPack,
  sha256Hex,
  type BuiltPack,
} from "../../src/lib/ahanu/pack";
import { NOAA_GRID_TIMEOUT_MS } from "../../src/lib/ahanu/noaa-http";
import { latestLayerR2Key, packManifestR2Key } from "./ingest/run";

export interface LayerBodyEnv {
  PACKS?: {
    get?: (key: string) => Promise<{ text: () => Promise<string> } | null>;
    put?: (key: string, value: string | ArrayBuffer) => Promise<unknown>;
  };
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
  if (!bucket || typeof bucket.get !== "function") return null;
  try {
    const obj = await bucket.get(key);
    if (!obj) return null;
    return await obj.text();
  } catch {
    return null;
  }
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
    fetchImpl?: (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;
  },
): Promise<LayerBodyResult | null> {
  const spec = specForLayer(layerId);
  if (!spec) return null;
  const skipCache = opts?.skipCache === true;
  const cached = peekBuiltPack({ bbox, start, hours, packId: opts?.packId });
  const cacheOk = Boolean(cached) && (!skipCache || Boolean(opts?.packId && cached?.manifest.packId === opts.packId));
  if (cacheOk && cached) {
    const hit = layerFromBuilt(cached, layerId);
    if (hit) return hit;
  }

  if (!skipCache) {
    const packId = opts?.packId || (await packIdFor(bbox, start, hours));
    const manText = await r2Text(env.PACKS, packManifestR2Key(packId));
    if (manText) {
      try {
        const man = JSON.parse(manText) as {
          layers?: { id: string; hash: string; r2Key: string; contentType: string; source?: string }[];
        };
        const rec = man.layers?.find((l) => l.id === layerId);
        if (rec?.r2Key) {
          const body = await r2Text(env.PACKS, rec.r2Key);
          if (body) {
            return {
              body,
              hash: rec.hash,
              contentType: rec.contentType,
              source: "r2",
              r2Key: rec.r2Key,
              packId,
            };
          }
        }
      } catch {
        /* fall through */
      }
    }
    const latestKey = latestLayerR2Key(packId, spec.id);
    const latest = await r2Text(env.PACKS, latestKey);
    if (latest) {
      return {
        body: latest,
        hash: await sha256Hex(latest),
        contentType: spec.contentType,
        source: "r2",
        r2Key: latestKey,
        packId,
      };
    }
  }

  const built = await buildTripPack({
    bbox,
    start,
    hours,
    tryLive: true,
    timeoutMs: NOAA_GRID_TIMEOUT_MS,
    skipCache,
    fetchImpl: opts?.fetchImpl,
  });
  rememberBuiltPack(built);
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
    persist: { id: rec.id, body },
  };
}
