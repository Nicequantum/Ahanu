/**
 * Trip-pack contract used by the PWA.
 * Ready-for-offshore is evaluated HERE after download + hash verify.
 * The Worker boolean is a hint only.
 */

import {
  bboxKey,
  clampBbox,
  cycleStamp,
  DEFAULT_PACK_HOURS,
  generateLayerBody,
  hashesMatch,
  PACK_LAYER_SPECS,
  POINT_JUDITH_CANYON_BBOX,
  REQUIRED_OFFSHORE_LAYERS,
  sha256Hex,
  specForLayer,
  utf8Bytes,
  type PackBBox,
  type PackLayerId,
  type PackLayerSpec,
} from "./pack-fixtures";

export {
  bboxKey,
  clampBbox,
  cycleStamp,
  DEFAULT_PACK_HOURS,
  hashesMatch,
  PACK_LAYER_SPECS,
  POINT_JUDITH_CANYON_BBOX,
  REQUIRED_OFFSHORE_LAYERS,
  sha256Hex,
  specForLayer,
  type PackBBox,
  type PackLayerId,
  type PackLayerSpec,
};

export const SST_STALE_H = 24;
export const SST_MISSING_H = 48;
export const WEATHER_STALE_H = 6;

export interface PackLayerRecord {
  id: PackLayerId;
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
  source: "fixture" | "r2" | "noaa";
}

export interface TripPackManifestV1 {
  packId: string;
  version: 1;
  bbox: PackBBox;
  start: string;
  hours: number;
  generatedAt: string;
  /** Worker hint. Client must re-check. */
  readyForOffshore: boolean;
  layers: PackLayerRecord[];
  totalBytes: number;
  totalMb: number;
  r2Prefix: string;
  sources: { id: string; name: string }[];
  notes: string;
}

export interface LayerEvidence {
  id: string;
  present: boolean;
  hashExpected?: string;
  hashActual?: string;
  updatedAt?: string;
  hoursCovered?: number;
  cycleAt?: string;
}

export interface ReadyLayerResult {
  id: string;
  required: boolean;
  ok: boolean;
  present: boolean;
  hashOk: boolean;
  fresh: boolean;
  reason: string;
}

export interface ReadyOffshoreResult {
  ready: boolean;
  hoursOk: boolean;
  dayTrip: boolean;
  sstOverride: boolean;
  layers: ReadyLayerResult[];
  failures: string[];
  warnings: string[];
}

export function ageHours(updatedAt: string | undefined, nowMs: number): number {
  if (!updatedAt) return Number.POSITIVE_INFINITY;
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (nowMs - t) / 3_600_000;
}

export function evaluateReadyForOffshore(input: {
  hours: number;
  start: string;
  now?: string | number;
  dayTrip?: boolean;
  sstOverride?: boolean;
  layers: LayerEvidence[];
}): ReadyOffshoreResult {
  const nowMs = typeof input.now === "number" ? input.now : Date.parse(input.now ?? new Date().toISOString());
  const dayTrip = Boolean(input.dayTrip);
  const sstOverride = Boolean(input.sstOverride);
  const hoursOk = dayTrip || input.hours >= DEFAULT_PACK_HOURS;
  const byId = new Map(input.layers.map((l) => [l.id, l]));
  const layers: ReadyLayerResult[] = [];
  const failures: string[] = [];
  const warnings: string[] = [];

  if (!hoursOk) {
    failures.push(`hours ${input.hours} < 72 (day-trip override not set)`);
  }

  for (const spec of PACK_LAYER_SPECS) {
    const ev = byId.get(spec.id);
    const present = Boolean(ev?.present);
    const hashOk =
      present &&
      Boolean(ev?.hashExpected) &&
      Boolean(ev?.hashActual) &&
      hashesMatch(ev!.hashActual!, ev!.hashExpected!);
    let fresh = present;
    let reason = "";

    if (!present) {
      reason = "missing";
    } else if (!hashOk) {
      reason = "hash mismatch";
    } else if (spec.id === "sst") {
      const age = ageHours(ev?.updatedAt, nowMs);
      if (age > SST_MISSING_H) {
        fresh = false;
        reason = `SST age ${age.toFixed(1)} h > 48 h (missing)`;
      } else if (age > SST_STALE_H) {
        fresh = sstOverride;
        reason = sstOverride
          ? `SST age ${age.toFixed(1)} h stale — skipper override`
          : `SST age ${age.toFixed(1)} h > 24 h`;
        if (sstOverride) warnings.push(reason);
      }
    } else if (spec.id === "wind" || spec.id === "waves") {
      const cycleAge = ageHours(ev?.cycleAt ?? ev?.updatedAt, nowMs);
      const cover = ev?.hoursCovered ?? 0;
      if (cover < input.hours) {
        fresh = false;
        reason = `${spec.id} covers ${cover} h < ${input.hours} h`;
      } else if (cycleAge > WEATHER_STALE_H) {
        fresh = false;
        reason = `${spec.id} cycle age ${cycleAge.toFixed(1)} h > 6 h`;
      }
    } else if (spec.id === "tides") {
      const cover = ev?.hoursCovered ?? 0;
      if (cover < input.hours) {
        fresh = false;
        reason = `tides cover ${cover} h < ${input.hours} h`;
      }
    }

    const ok = present && hashOk && fresh;
    if (!reason) reason = ok ? "ok" : "failed";
    layers.push({
      id: spec.id,
      required: spec.required,
      ok,
      present,
      hashOk,
      fresh,
      reason,
    });
    if (spec.required && !ok) failures.push(`${spec.id}: ${reason}`);
    if (!spec.required && !ok) {
      warnings.push(`${spec.id} not packed (${reason})`);
    }
  }

  return {
    ready: hoursOk && failures.length === 0,
    hoursOk,
    dayTrip,
    sstOverride,
    layers,
    failures,
    warnings,
  };
}

export interface BuiltPack {
  manifest: TripPackManifestV1;
  bodies: Record<string, string>;
}

export async function buildFixturePack(options: {
  bbox: PackBBox;
  start?: string;
  hours?: number;
  createdAt?: string;
  /** Encoded layer bodies that replace fixtures (live NOAA, tests). */
  overlays?: Partial<Record<string, string>>;
  extraSources?: { id: string; name: string }[];
}): Promise<BuiltPack> {
  const bbox = clampBbox(options.bbox);
  const hours = options.hours ?? DEFAULT_PACK_HOURS;
  const start = options.start ?? new Date().toISOString();
  const createdAt = options.createdAt ?? new Date().toISOString();
  const cycle = cycleStamp(start);
  const key = bboxKey(bbox);
  const packId = (await sha256Hex(`ahanu|${key}|${cycle}|${hours}`)).slice(0, 16);
  const r2Prefix = `packs/${packId}`;
  const bodies: Record<string, string> = {};
  const layers: PackLayerRecord[] = [];
  const overlays = options.overlays ?? {};
  const liveIds: string[] = [];

  for (const spec of PACK_LAYER_SPECS) {
    const layerHours = spec.hours === 0 ? 0 : Math.max(spec.hours, hours);
    const overlay = overlays[spec.id];
    const body = overlay ?? generateLayerBody(spec.id, bbox, start, hours);
    const source: PackLayerRecord["source"] = overlay ? "noaa" : "fixture";
    if (overlay) liveIds.push(spec.id);
    const hash = await sha256Hex(body);
    const bytes = utf8Bytes(body).byteLength;
    const r2Key = `${r2Prefix}/${spec.id}/${hash.slice(0, 12)}.${spec.ext}`;
    bodies[spec.id] = body;
    layers.push({
      id: spec.id,
      label: spec.label,
      sizeMb: Math.round((bytes / (1024 * 1024)) * 1000) / 1000,
      sizeBytes: bytes,
      status: "ready",
      updatedAt: createdAt,
      hours: layerHours,
      hash,
      r2Key,
      contentType: spec.contentType,
      format: spec.format,
      source,
    });
  }

  const totalBytes = layers.reduce((n, l) => n + l.sizeBytes, 0);
  const evidence: LayerEvidence[] = layers.map((l) => ({
    id: l.id,
    present: true,
    hashExpected: l.hash,
    hashActual: l.hash,
    updatedAt: l.updatedAt,
    hoursCovered: l.hours || hours,
    cycleAt: createdAt,
  }));
  const check = evaluateReadyForOffshore({ hours, start, now: createdAt, layers: evidence });

  const manifest: TripPackManifestV1 = {
    packId,
    version: 1,
    bbox,
    start,
    hours,
    generatedAt: createdAt,
    readyForOffshore: check.ready,
    layers,
    totalBytes,
    totalMb: Math.round((totalBytes / (1024 * 1024)) * 10) / 10,
    r2Prefix,
    sources: [
      ...(liveIds.length
        ? [
            { id: "fixture", name: "Hashed fixture objects (not live GRIB/SST/CMEMS)" },
            { id: "noaa", name: `Public NOAA overlay (${liveIds.join(", ")})` },
          ]
        : [{ id: "fixture", name: "Hashed fixture objects (not live NOAA/CMEMS)" }]),
      ...(options.extraSources ?? []),
    ],
    notes: liveIds.length
      ? "Fixture grids plus live NOAA overlays where fetch succeeded (NDBC / CO-OPS / ENC catalog). ENC catalog is a cell list, not official S-57. GFS-Wave f000 may be fetched+hashed but does not replace 72 h wind/wave grids. Client must re-hash. Worker readyForOffshore is a hint."
      : "Fixture bodies with SHA-256 of the object bytes. Worker readyForOffshore is a hint. Client must re-download, re-hash, and re-check. Production cron writes R2; those objects do not exist here.",
  };

  return { manifest, bodies };
}

export async function buildTripPack(options: {
  bbox: PackBBox;
  start?: string;
  hours?: number;
  createdAt?: string;
  tryLive?: boolean;
  fetchImpl?: (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;
  timeoutMs?: number;
}): Promise<BuiltPack> {
  const bbox = clampBbox(options.bbox);
  const hours = options.hours ?? DEFAULT_PACK_HOURS;
  const start = options.start ?? new Date().toISOString();
  const overlays: Record<string, string> = {};
  const extraSources: { id: string; name: string }[] = [];
  if (options.tryLive) {
    const { tryLiveNoaa, encodeLiveLayer } = await import("./noaa-live");
    const live = await tryLiveNoaa({
      bbox,
      start,
      hours,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });
    if (live.buoys) overlays.buoys = encodeLiveLayer(live.buoys);
    if (live.tides) overlays.tides = encodeLiveLayer(live.tides);
    if (live.enc) overlays.enc = encodeLiveLayer(live.enc);
    if (live.gfsWave) {
      extraSources.push({
        id: "nomads-gfswave",
        name: `GFS-Wave f000 hashed ${live.gfsWave.sha256.slice(0, 12)} (${live.gfsWave.bytes} B, not a 72 h grid)`,
      });
    }
  }
  return buildFixturePack({
    bbox,
    start,
    hours,
    createdAt: options.createdAt,
    overlays: Object.keys(overlays).length ? overlays : undefined,
    extraSources: extraSources.length ? extraSources : undefined,
  });
}
