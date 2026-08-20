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
  encodeLayerBody,
  generateLayerBody,
  generateLayerPayload,
  hashesMatch,
  parseLayerBody,
  PACK_LAYER_SPECS,
  POINT_JUDITH_CANYON_BBOX,
  REQUIRED_OFFSHORE_LAYERS,
  sha256Hex,
  specForLayer,
  utf8Bytes,
  type PackBBox,
  type PackLayerId,
  type PackLayerSpec,
  type PackedGrid,
} from "./pack-fixtures";
import {
  gfsHour0FixtureNote,
  hour0Plane,
  mergeHour0IntoFixture,
} from "./noaa-gfs-merge";

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

/** Hand-bumped when the pack merge contract changes. Not a live git hash. */
export const PACK_BUILDER_REV = "gfs-hour0-merge-2026-08-20";

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
  /** Live NOAA ingest misses. Empty when live is off or every overlay landed. Capped. */
  liveErrors: string[];
  /** Which pack.ts produced these bytes. */
  builder: { rev: string };
}

export const LIVE_ERROR_CAP = 8;

/** Layers Live NOAA can paint. Canyons stay fixture. */
export const LIVE_OVERLAY_LAYER_IDS = [
  "enc",
  "bathymetry",
  "contours",
  "sst",
  "chlorophyll",
  "altimetry",
  "wind",
  "waves",
  "buoys",
  "tides",
  "hms_zones",
] as const;

export function capLiveErrors(errors: readonly string[] | undefined | null): string[] {
  if (!errors?.length) return [];
  const out: string[] = [];
  for (const line of errors) {
    if (typeof line !== "string") continue;
    const t = line.trim();
    if (!t) continue;
    out.push(t);
    if (out.length >= LIVE_ERROR_CAP) break;
  }
  return out;
}

const LIVE_MISS_PREFIX: Record<string, string> = {
  sst: "sst",
  chlorophyll: "chl",
  altimetry: "ssh",
  bathymetry: "bathy",
  contours: "bathy",
  hms_zones: "hms",
  enc: "enc",
  wind: "gfs-wave",
  waves: "gfs-wave",
  buoys: "ndbc",
  tides: "coops",
};

/** Honest miss lines when a live result has no error list (stale cache shape). */
export function liveMissErrorLines(missingIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const id of missingIds) {
    const prefix = LIVE_MISS_PREFIX[id] ?? id;
    if (seen.has(prefix)) continue;
    seen.add(prefix);
    lines.push(`${prefix}: live miss — fixture kept`);
  }
  return lines;
}

export function liveErrorsForSession(input: {
  live: boolean;
  errors?: readonly string[] | undefined | null;
  overlayLanded?: boolean;
  missingOverlayIds?: readonly string[];
}): string[] {
  if (!input.live || input.overlayLanded) return [];
  const capped = capLiveErrors(input.errors);
  if (capped.length) return capped;
  return capLiveErrors(liveMissErrorLines(input.missingOverlayIds ?? []));
}

export function overlaysAllLanded(overlayIds: Iterable<string>): boolean {
  const have = new Set(overlayIds);
  return LIVE_OVERLAY_LAYER_IDS.every((id) => have.has(id));
}

export function canRetryLiveOverlays(input: {
  live: boolean;
  downloading: boolean;
  layers: { id: string; source?: string }[];
  liveErrors?: readonly string[] | null;
}): boolean {
  if (!input.live || input.downloading) return false;
  if (input.liveErrors && input.liveErrors.length > 0) return true;
  return input.layers.some(
    (l) => l.source === "fixture" && (LIVE_OVERLAY_LAYER_IDS as readonly string[]).includes(l.id),
  );
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
  /** True when skipper override is what made a stale/48h SST layer pass. */
  sstOverrideUsed: boolean;
  layers: ReadyLayerResult[];
  failures: string[];
  warnings: string[];
}

/** Ready badge: caution when override is the only reason SST passed. */
export function readyOffshoreBadge(result: ReadyOffshoreResult | null): {
  ready: boolean;
  caution: boolean;
  short: string;
  long: string;
} {
  if (!result) return { ready: false, caution: true, short: "No pack", long: "No pack" };
  if (result.ready && result.sstOverrideUsed) {
    return { ready: true, caution: true, short: "Offshore · stale SST", long: "Ready · stale SST" };
  }
  if (result.ready) {
    return { ready: true, caution: false, short: "Offshore", long: "Ready for offshore" };
  }
  return { ready: false, caution: true, short: "Not ready", long: "Not ready" };
}

function overlayUpdatedAt(body: string, fallback: string): string {
  const parsed = parseLayerBody(body);
  if (parsed && parsed.kind === "grid") {
    const t = parsed.updatedAt;
    if (typeof t === "string" && !Number.isNaN(Date.parse(t))) return t;
  }
  return fallback;
}

function overlayCoverHours(body: string, fallback: number): number {
  const parsed = parseLayerBody(body);
  if (parsed && parsed.kind === "grid") {
    const covered = parsed.hoursCovered;
    if (typeof covered === "number" && Number.isFinite(covered)) return covered;
    const hs = parsed.hours ?? [];
    if (hs.length <= 1) return 1;
    return Math.max(...hs);
  }
  if (parsed && "payload" in parsed) {
    const hours = (parsed.payload as { hours?: number })?.hours;
    if (typeof hours === "number" && Number.isFinite(hours)) return hours;
  }
  return fallback;
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
  const nowMs =
    typeof input.now === "number" ? input.now : Date.parse(input.now ?? new Date().toISOString());
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
      if (age > SST_STALE_H) {
        // File exists and hashes. Age > 48 h is "missing" for Ready unless the
        // skipper explicitly accepts stale SST. No body still fails above.
        fresh = false;
        const missingBand = age > SST_MISSING_H;
        if (sstOverride) {
          reason = missingBand
            ? `SST age ${age.toFixed(1)} h > 48 h — skipper override`
            : `SST age ${age.toFixed(1)} h stale — skipper override`;
          warnings.push(reason);
        } else {
          reason = missingBand
            ? `SST age ${age.toFixed(1)} h > 48 h (missing)`
            : `SST age ${age.toFixed(1)} h > 24 h`;
        }
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

    const sstOverridden = spec.id === "sst" && present && hashOk && !fresh && sstOverride;
    const ok = present && hashOk && (fresh || sstOverridden);
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

  const sstOverrideUsed = layers.some((l) => l.id === "sst" && l.ok && !l.fresh && sstOverride);

  return {
    ready: hoursOk && failures.length === 0,
    hoursOk,
    dayTrip,
    sstOverride,
    sstOverrideUsed,
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
  /** Honest live ingest misses. Do not invent. */
  liveErrors?: string[];
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
    const overlay = overlays[spec.id];
    const body = overlay ?? generateLayerBody(spec.id, bbox, start, hours);
    const fallbackHours = spec.hours === 0 ? 0 : Math.max(spec.hours, hours);
    const layerHours = overlay ? overlayCoverHours(overlay, fallbackHours) : fallbackHours;
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
      updatedAt: overlay ? overlayUpdatedAt(overlay, createdAt) : createdAt,
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
    hoursCovered: l.hours,
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
    builder: { rev: PACK_BUILDER_REV },
    notes: liveIds.length
      ? "Fixture grids plus live NOAA overlays where fetch succeeded (NDBC / CO-OPS / ENC catalog / CoastWatch SST / chlorophyll / SSH / HMS closed areas / CoastWatch ETOPO-GEBCO bathymetry). ENC catalog is a cell list, not official S-57. SST is source noaa only when a public ERDDAP grid parses; resolution is whatever arrived (CoralTemp is 5 km — not 1 km MUR). Chlorophyll is source noaa only when a public ERDDAP grid parses; resolution is whatever arrived (VIIRS L3 here is 4 km / 0.0375° — not 1 km VIIRS, not CMEMS). SSH / SLA is source noaa only when a public ERDDAP grid parses; resolution is whatever arrived (CoastWatch blended SLA here is 0.25° / ~25 km — not CMEMS L4, not AVISO DUACS). HMS is source noaa only when a public NMFS/NOAA closed-area KMZ or shapefile parses and intersects the box — reminder overlay, not a legal determination. Bathymetry is source noaa only when a public ERDDAP relief grid parses; resolution is whatever arrived (NCEI ETOPO 2022 here is 15″ subsampled to ~0.033° — not native 15″, not official ENC). Cheap 100/200-fm contours are derived from that grid when it paints. Chlorophyll and altimetry do not block Ready. Bathymetry is required for Ready (fixture still counts on a miss). Hour-0 wind/wave is painted from the NCEP subset when it parses; hours 3–72 stay fixture unless a paced series completes. That is not a live 72 h NOAA grid. A paced 72 h / 3 h GFS-Wave series is off unless enabled and only stamps 72 h noaa when every step decodes. Client must re-hash. Worker readyForOffshore is a hint."
      : "Fixture bodies with SHA-256 of the object bytes. Worker readyForOffshore is a hint. Client must re-download, re-hash, and re-check. Production cron writes R2; those objects do not exist here.",
    liveErrors: capLiveErrors(options.liveErrors),
  };

  return { manifest, bodies };
}

function asPackedGrid(body: ReturnType<typeof generateLayerPayload>): PackedGrid | undefined {
  return body.kind === "grid" ? body : undefined;
}

function overlayGfsWindWaves(input: {
  bbox: PackBBox;
  start: string;
  hours: number;
  series?:
    | {
        complete: boolean;
        hoursCovered: number;
        fetchedHours: number[];
        windKt?: PackedGrid;
        waveFt?: PackedGrid;
      }
    | undefined;
  hour0Wind?: PackedGrid;
  hour0Waves?: PackedGrid;
}): { wind?: string; waves?: string; note?: string } {
  const series = input.series;
  if (series?.complete && (series.windKt || series.waveFt)) {
    return {
      wind: series.windKt ? encodeLayerBody(series.windKt) : undefined,
      waves: series.waveFt ? encodeLayerBody(series.waveFt) : undefined,
    };
  }
  const seriesOff = !series || !series.fetchedHours.length;
  const note = gfsHour0FixtureNote(seriesOff ? "off" : "incomplete");
  const liveWind = hour0Plane(series?.windKt) ?? input.hour0Wind;
  const liveWaves = hour0Plane(series?.waveFt) ?? input.hour0Waves;
  const fixWind = asPackedGrid(generateLayerPayload("wind", input.bbox, input.start, input.hours));
  const fixWaves = asPackedGrid(generateLayerPayload("waves", input.bbox, input.start, input.hours));
  const out: { wind?: string; waves?: string; note?: string } = {};
  if (liveWind && fixWind) out.wind = encodeLayerBody(mergeHour0IntoFixture(liveWind, fixWind, note));
  if (liveWaves && fixWaves) out.waves = encodeLayerBody(mergeHour0IntoFixture(liveWaves, fixWaves, note));
  if (out.wind || out.waves) out.note = note;
  return out;
}

function gfsSourceName(
  series: { complete: boolean; hoursCovered: number; fetchedHours: number[] } | undefined,
  painted: boolean,
  hash: string,
  bytes: number,
  mergeNote?: string,
): string {
  if (series?.complete && series.hoursCovered >= 72) {
    return `GFS-Wave f000–f072 / 3 h parsed ${hash} (${bytes} B, 72 h)`;
  }
  if (series?.complete && series.fetchedHours.length) {
    return `GFS-Wave series hours ${series.fetchedHours.join(",")} — hoursCovered ${series.hoursCovered}, not 72 h ready`;
  }
  if (painted && mergeNote) return `${mergeNote} (${hash}, ${bytes} B)`;
  if (painted) return `GFS-Wave f000 parsed ${hash} (${bytes} B, hour-0 only)`;
  return `GFS-Wave f000 hashed ${hash} (${bytes} B, parse failed — fixture grids kept)`;
}

export type GfsWaveSeriesFlag =
  | boolean
  | {
      enabled?: boolean;
      hours?: number[];
      paceMs?: number;
      sleep?: (ms: number) => Promise<void>;
      ymd?: string;
      cc?: string;
    };

export async function buildTripPack(options: {
  bbox: PackBBox;
  start?: string;
  hours?: number;
  createdAt?: string;
  tryLive?: boolean;
  fetchImpl?: (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;
  timeoutMs?: number;
  /** Off unless true / { enabled: true }. Do not turn on in CI. */
  gfsWaveSeries?: GfsWaveSeriesFlag;
  sleep?: (ms: number) => Promise<void>;
  skipCache?: boolean;
}): Promise<BuiltPack> {
  const bbox = clampBbox(options.bbox);
  const hours = options.hours ?? DEFAULT_PACK_HOURS;
  const start = options.start ?? new Date().toISOString();
  const overlays: Record<string, string> = {};
  const extraSources: { id: string; name: string }[] = [];
  let liveErrors: string[] = [];
  if (options.tryLive) {
    const { tryLiveNoaa, encodeLiveLayer } = await import("./noaa-live");
    const live = await tryLiveNoaa({
      bbox,
      start,
      hours,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      skipCache: options.skipCache === true || Boolean(options.fetchImpl),
      gfsWaveSeries: options.gfsWaveSeries,
      sleep: options.sleep,
    });
    if (live.buoys) overlays.buoys = encodeLiveLayer(live.buoys);
    if (live.tides) overlays.tides = encodeLiveLayer(live.tides);
    if (live.enc) overlays.enc = encodeLiveLayer(live.enc);
    const series = live.gfsWaveSeries;
    const gfsMerge = overlayGfsWindWaves({
      bbox,
      start,
      hours,
      series,
      hour0Wind: live.gfsWave?.parsed?.windKt,
      hour0Waves: live.gfsWave?.parsed?.waveFt,
    });
    if (gfsMerge.wind) overlays.wind = gfsMerge.wind;
    if (gfsMerge.waves) overlays.waves = gfsMerge.waves;
    if (live.sst?.grid) {
      overlays.sst = encodeLayerBody(live.sst.grid);
      extraSources.push({ id: "noaa-sst", name: live.sst.note });
    }
    if (live.chlorophyll?.grid) {
      overlays.chlorophyll = encodeLayerBody(live.chlorophyll.grid);
      extraSources.push({ id: "noaa-chl", name: live.chlorophyll.note });
    }
    if (live.altimetry?.grid) {
      overlays.altimetry = encodeLayerBody(live.altimetry.grid);
      extraSources.push({ id: "noaa-ssh", name: live.altimetry.note });
    }
    if (live.hms?.body) {
      overlays.hms_zones = encodeLiveLayer(live.hms.body);
      extraSources.push({ id: "noaa-hms", name: live.hms.note });
    }
    if (live.bathymetry?.grid) {
      overlays.bathymetry = encodeLayerBody(live.bathymetry.grid);
      extraSources.push({ id: "noaa-bathy", name: live.bathymetry.note });
      if (live.bathymetry.contours) overlays.contours = encodeLiveLayer(live.bathymetry.contours);
    }
    if (live.gfsWave || series) {
      const painted = Boolean(gfsMerge.wind || gfsMerge.waves);
      const hash = live.gfsWave?.sha256.slice(0, 12) ?? "series";
      const bytes = live.gfsWave?.bytes ?? 0;
      extraSources.push({ id: "nomads-gfswave", name: gfsSourceName(series, painted, hash, bytes, gfsMerge.note) });
    }
    const overlayIds = Object.keys(overlays);
    liveErrors = liveErrorsForSession({
      live: true,
      errors: live.errors,
      overlayLanded: overlaysAllLanded(overlayIds),
      missingOverlayIds: LIVE_OVERLAY_LAYER_IDS.filter((id) => overlays[id] == null),
    });
    if (gfsMerge.note) liveErrors = capLiveErrors([gfsMerge.note, ...liveErrors]);
  }
  return buildFixturePack({
    bbox,
    start,
    hours,
    createdAt: options.createdAt,
    overlays: Object.keys(overlays).length ? overlays : undefined,
    extraSources: extraSources.length ? extraSources : undefined,
    liveErrors,
  });
}
