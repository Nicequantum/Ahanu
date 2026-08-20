/**
 * Dock-side pack download: GET manifest, GET each object, verify SHA-256,
 * store in IndexedDB, evaluate Ready-for-offshore on the client.
 */

import {
  evaluateReadyForOffshore,
  sha256Hex,
  type LayerEvidence,
  type PackBBox,
  type ReadyOffshoreResult,
  type TripPackManifestV1,
} from "./pack";
import { hashesMatch } from "./pack-fixtures";
import { packedOceanFromBodies, setPackedOcean, type PackFieldSource } from "./packed-fields";
import { bodiesForPack, putObject, saveManifest } from "./pack-store";


function sourceFromManifest(manifest: TripPackManifestV1): PackFieldSource {
  return manifest.layers.length > 0 && manifest.layers.every((l) => l.source === "r2")
    ? "r2"
    : "fixture";
}

export function packsApiBase(): string {
  if (typeof window === "undefined") return "";
  const fromEnv = (import.meta as { env?: { VITE_AHANU_PACKS_URL?: string } }).env?.VITE_AHANU_PACKS_URL;
  return (fromEnv ?? "").replace(/\/+$/, "");
}

export function packQuery(
  bbox: PackBBox,
  start: string,
  hours: number,
  opts?: { live?: boolean },
): string {
  const p = new URLSearchParams({
    west: String(bbox.west),
    south: String(bbox.south),
    east: String(bbox.east),
    north: String(bbox.north),
    start,
    hours: String(hours),
  });
  if (opts?.live) p.set("live", "1");
  return p.toString();
}

export async function fetchManifest(
  bbox: PackBBox,
  start: string,
  hours: number,
  base = packsApiBase(),
  opts?: { live?: boolean },
): Promise<TripPackManifestV1> {
  const url = `${base}/api/packs?${packQuery(bbox, start, hours, opts)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET /api/packs ${res.status} ${text.slice(0, 160)}`);
  }
  return (await res.json()) as TripPackManifestV1;
}

export async function fetchLayerBody(
  bbox: PackBBox,
  start: string,
  hours: number,
  layerId: string,
  base = packsApiBase(),
  opts?: { live?: boolean },
): Promise<string> {
  const url = `${base}/api/objects?${packQuery(bbox, start, hours, opts)}&layer=${encodeURIComponent(layerId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET /api/objects ${layerId} ${res.status}`);
  }
  return res.text();
}

export interface DownloadProgress {
  done: number;
  total: number;
  layerId: string;
  hashOk: boolean;
}

export interface DownloadedPack {
  manifest: TripPackManifestV1;
  ready: ReadyOffshoreResult;
  workerReady: boolean;
  bodies: Record<string, string>;
}

export async function downloadTripPack(options: {
  bbox: PackBBox;
  start: string;
  hours: number;
  base?: string;
  now?: string;
  dayTrip?: boolean;
  sstOverride?: boolean;
  live?: boolean;
  onProgress?: (p: DownloadProgress) => void;
}): Promise<DownloadedPack> {
  const base = options.base ?? packsApiBase();
  const q = { live: Boolean(options.live) };
  const manifest = await fetchManifest(options.bbox, options.start, options.hours, base, q);
  const bodies: Record<string, string> = {};
  const evidence: LayerEvidence[] = [];
  const total = manifest.layers.length;
  let done = 0;

  for (const layer of manifest.layers) {
    let body = "";
    let hashActual = "";
    let present = false;
    try {
      body = await fetchLayerBody(manifest.bbox, manifest.start, manifest.hours, layer.id, base, q);
      hashActual = await sha256Hex(body);
      present = true;
      if (!hashesMatch(hashActual, layer.hash)) {
        // DATA_PACKS: delete, retry once, then fail the layer.
        body = await fetchLayerBody(manifest.bbox, manifest.start, manifest.hours, layer.id, base, q);
        hashActual = await sha256Hex(body);
      }
      const hashOk = hashesMatch(hashActual, layer.hash);
      if (hashOk) {
        bodies[layer.id] = body;
        await putObject({
          r2Key: layer.r2Key,
          layerId: layer.id,
          packId: manifest.packId,
          hash: hashActual,
          contentType: layer.contentType,
          body,
          storedAt: new Date().toISOString(),
        });
      }
      options.onProgress?.({ done: ++done, total, layerId: layer.id, hashOk });
      evidence.push({
        id: layer.id,
        present: hashOk,
        hashExpected: layer.hash,
        hashActual,
        updatedAt: layer.updatedAt,
        hoursCovered: layer.hours,
        cycleAt: manifest.generatedAt,
      });
    } catch {
      options.onProgress?.({ done: ++done, total, layerId: layer.id, hashOk: false });
      evidence.push({
        id: layer.id,
        present,
        hashExpected: layer.hash,
        hashActual: hashActual || undefined,
        updatedAt: layer.updatedAt,
        hoursCovered: layer.hours,
        cycleAt: manifest.generatedAt,
      });
    }
  }

  await saveManifest(manifest);
  const ready = evaluateReadyForOffshore({
    hours: manifest.hours,
    start: manifest.start,
    now: options.now ?? new Date().toISOString(),
    dayTrip: options.dayTrip,
    sstOverride: options.sstOverride,
    layers: evidence,
  });

  if (Object.keys(bodies).length) {
    setPackedOcean(packedOceanFromBodies(bodies, sourceFromManifest(manifest)));
  }

  return { manifest, ready, workerReady: manifest.readyForOffshore, bodies };
}

export async function applyStoredPack(packId: string): Promise<void> {
  const bodies = await bodiesForPack(packId);
  setPackedOcean(packedOceanFromBodies(bodies));
}

export function evidenceFromStored(
  manifest: TripPackManifestV1,
  bodies: Record<string, string>,
  actualHashes: Record<string, string>,
): LayerEvidence[] {
  return manifest.layers.map((layer) => ({
    id: layer.id,
    present: Boolean(bodies[layer.id]),
    hashExpected: layer.hash,
    hashActual: actualHashes[layer.id],
    updatedAt: layer.updatedAt,
    hoursCovered: layer.hours,
    cycleAt: manifest.generatedAt,
  }));
}

/** Rebuild evidence from a downloaded pack so Ready can re-run when the skipper flips SST override. */
export function evidenceFromPackLayers(
  manifest: TripPackManifestV1,
  layers: { id: string; verified?: boolean; hash?: string; updatedAt?: string; hours?: number }[],
): LayerEvidence[] {
  return manifest.layers.map((layer) => {
    const row = layers.find((p) => p.id === layer.id);
    const verified = Boolean(row?.verified);
    return {
      id: layer.id,
      present: verified,
      hashExpected: layer.hash,
      hashActual: verified ? (row?.hash ?? layer.hash) : undefined,
      updatedAt: row?.updatedAt ?? layer.updatedAt,
      hoursCovered: row?.hours ?? layer.hours,
      cycleAt: manifest.generatedAt,
    };
  });
}

export async function restorePackedSession(): Promise<TripPackManifestV1 | null> {
  const { loadCurrentManifest, bodiesForPack } = await import("./pack-store");
  const manifest = await loadCurrentManifest();
  if (!manifest) return null;
  const bodies = await bodiesForPack(manifest.packId);
  if (Object.keys(bodies).length) setPackedOcean(packedOceanFromBodies(bodies));
  return manifest;
}
