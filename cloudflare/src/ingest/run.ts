/**
 * Ingest pipeline.
 *
 * Production ops (not runnable in this environment — no NOAA/CMEMS creds, no
 * provisioned R2):
 *   1. wrangler.toml [triggers] crons = ["15 2,8,14,20 * * *"]  (6-hourly, after cycle)
 *   2. Each adapter in sources.ts fetches, clips to bbox, writes
 *      r2://ahanu-trip-packs/packs/{packId}/{layerId}/{hash12}.{ext}
 *   3. SHA-256 of the object bytes replaces fixture hashes; D1 records the index.
 *   4. Durable Object CommunityHub can hold a pack-build lease so two crons
 *      do not write the same prefix.
 *
 * Until that cron exists, this function tries public NDBC / CO-OPS / ENC
 * catalog / GFS-Wave f000 / CoastWatch ERDDAP SST and chlorophyll (no keys), then writes
 * fixture bodies for anything the network did not return, when an R2 binding
 * is present, and is a no-op otherwise. ENC catalog is not official S-57.
 * A parsed GFS-Wave hour is hour-0 only, not a 72 h wind/wave grid. The paced
 * f000–f072 / 3 h series stays off unless AHANU_GFS_WAVE_SERIES or
 * GFS_WAVE_SERIES is set. Live SST is only the public grid that parsed
 * (CoralTemp 5 km when that path works) — not invented 1 km MUR / GHRSST.
 * Live chlorophyll is only the public grid that parsed (S-NPP VIIRS L3 daily
 * 4 km when that path works) — not invented 1 km VIIRS or CMEMS L4.
 * CMEMS still needs a licence and is not fetched.
 */
import { buildTripPack } from "../../../src/lib/ahanu/pack";
import { gfsWaveSeriesEnabled } from "../../../src/lib/ahanu/noaa-gfs";
import { POINT_JUDITH_CANYON_BBOX } from "./fixtures";
import { NORTHEAST_BBOX } from "../../../src/lib/ahanu/pack-fixtures";

export interface IngestEnv {
  PACKS?: {
    put?: (key: string, value: string | ArrayBuffer) => Promise<unknown>;
    get?: (key: string) => Promise<{ text: () => Promise<string> } | null>;
  };
  AHANU_GFS_WAVE_SERIES?: string;
  GFS_WAVE_SERIES?: string;
}

export async function ingestFixturePack(
  env: IngestEnv,
  bbox = POINT_JUDITH_CANYON_BBOX,
  start = new Date().toISOString(),
  hours = 72,
): Promise<{ packId: string; wrote: number; source: "r2" | "memory" }> {
  const seriesOn = gfsWaveSeriesEnabled(undefined, {
    AHANU_GFS_WAVE_SERIES: env.AHANU_GFS_WAVE_SERIES,
    GFS_WAVE_SERIES: env.GFS_WAVE_SERIES,
  });
  const { manifest, bodies } = await buildTripPack({
    bbox,
    start,
    hours,
    tryLive: true,
    gfsWaveSeries: seriesOn,
  });
  const bucket = env.PACKS;
  let wrote = 0;
  if (bucket && typeof bucket.put === "function") {
    for (const layer of manifest.layers) {
      const body = bodies[layer.id];
      if (!body) continue;
      await bucket.put(layer.r2Key, body);
      wrote += 1;
    }
    return { packId: manifest.packId, wrote, source: "r2" };
  }
  return { packId: manifest.packId, wrote: 0, source: "memory" };
}

export { NORTHEAST_BBOX };
