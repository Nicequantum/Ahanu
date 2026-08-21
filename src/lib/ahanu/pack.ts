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
  GFS_HOUR0_FIXTURE_NOTE,
  gfsHour0FixtureNote,
  gfsLiveHoursNote,
  hour0Plane,
  isGfsHonestyNote,
  mergeHour0IntoFixture,
  mergeLiveHoursIntoFixture,
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
export const PACK_BUILDER_REV = "enc-s57-2026-08-21";

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

/** Layers Live NOAA can paint. Canyon live paint is named heads only. */
export const LIVE_OVERLAY_LAYER_IDS = [
  "enc",
  "bathymetry",
  "contours",
  "canyons",
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

/** GFS hour-0 / partial-series honesty lines. Visible on Packs; not overlay misses. */
export function isHonestyLiveError(line: string): boolean {
  return isGfsHonestyNote(line);
}

/** Helm copy: real live vs fixture hours. Does not claim 72 h live unless it is. */
export function gfsHelmLine(input: {
  liveErrors?: readonly string[] | null;
  wind?: { source?: string; hours?: number };
  waves?: { source?: string; hours?: number };
}): string {
  const note = (input.liveErrors ?? []).find((e) => e.trim().startsWith("gfs:"));
  if (note) return note.trim();
  const hours = Math.min(input.wind?.hours ?? 0, input.waves?.hours ?? 0);
  if (input.wind?.source === "noaa" && input.waves?.source === "noaa" && hours >= 72) {
    return "GFS-Wave 72 h live (NOMADS atlocn.0p16 / 3 h).";
  }
  return "GFS-Wave: hour-0 live when it parses; 72 h series on the Worker when NOMADS serves it.";
}

function sstAgeBand(ageH: number): "fresh" | "stale" | "missing-band" {
  if (ageH > SST_MISSING_H) return "missing-band";
  if (ageH > SST_STALE_H) return "stale";
  return "fresh";
}

/**
 * Helm copy: real SST source, analysis age, and packed spacing.
 * Does not claim 1 km unless the note says native 1 km arrived.
 */
export function sstHelmLine(input: {
  source?: string;
  updatedAt?: string;
  note?: string;
  nowMs?: number;
}): string {
  const now = input.nowMs ?? Date.now();
  const age = ageHours(input.updatedAt, now);
  const known = Number.isFinite(age) && age < 1e8;
  const band = known ? sstAgeBand(age) : "age unknown";
  const ageBit = known ? `${Math.round(age)} h` : null;
  const when = input.updatedAt
    ? input.updatedAt.replace(/\.\d{3}Z$/, "Z")
    : null;
  const note = (input.note ?? "").replace(/\s+\d+[×x]\d+ at \S+\.?$/, "").trim();
  if (input.source !== "noaa" && input.source !== "r2") {
    return "SST fixture — not live NOAA.";
  }
  const bits = [
    `SST ${input.source}`,
    ageBit,
    band,
    when,
    note || null,
  ].filter(Boolean);
  return bits.join(" · ");
}

/** liveErrors that are real overlay misses (honesty notes stripped). */
export function blockingLiveErrors(errors: readonly string[] | undefined | null): string[] {
  return capLiveErrors(errors).filter((line) => !isHonestyLiveError(line));
}

const LIVE_MISS_PREFIX: Record<string, string> = {
  sst: "sst",
  chlorophyll: "chl",
  altimetry: "ssh",
  bathymetry: "bathy",
  contours: "bathy",
  canyons: "canyons",
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
  if (blockingLiveErrors(input.liveErrors).length > 0) return true;
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

export type HashedLayer = {
  id?: string;
  verified?: boolean;
  hashOk?: boolean;
  status?: string;
};

/**
 * Hashed numerator is verify (SHA-256 ok), not Ready freshness.
 * Stale SST / hour-0 GFS cover < 72 h still count when hashOk. A real hash miss does not.
 */
export function layerIsHashed(layer: HashedLayer): boolean {
  if (layer.verified === true || layer.hashOk === true) return true;
  if (layer.verified === false || layer.hashOk === false) return false;
  return layer.status === "ready" || layer.status === "stale";
}

export function hashedPackCount(
  layers: readonly HashedLayer[],
): { hashed: number; total: number; stale: number; misses: string[] } {
  let hashed = 0;
  let stale = 0;
  const misses: string[] = [];
  for (const layer of layers) {
    if (!layerIsHashed(layer)) {
      if (layer.id) misses.push(layer.id);
      continue;
    }
    hashed += 1;
    if (layer.status === "stale") stale += 1;
  }
  return { hashed, total: layers.length, stale, misses };
}

/** Copy shown only when SST age is the sole Ready block (hash-ok, body present). */
export const SST_STALE_FLIP_COPY = "Accept stale SST to pass Ready";

const SST_AGE_REASON = /SST age ([\d.]+) h/;

/**
 * Highlight Accept stale SST when Ready fails only on SST age.
 * Warnings (optional layers) are allowed. Hash / missing / weather hours are not.
 * Does not flip the switch and does not change Ready.
 */
export function sstStaleReadyCue(result: ReadyOffshoreResult | null): {
  highlight: boolean;
  line: string | null;
} {
  if (!result || result.ready) return { highlight: false, line: null };

  const sst = result.layers.find((l) => l.id === "sst");
  if (!sst?.present || !sst.hashOk || sst.fresh || sst.ok) {
    return { highlight: false, line: null };
  }

  const ageMatch = sst.reason.match(SST_AGE_REASON);
  const age = ageMatch ? Number(ageMatch[1]) : Number.NaN;
  if (!Number.isFinite(age)) return { highlight: false, line: null };
  if (!result.hoursOk) return { highlight: false, line: null };

  const otherRequiredFail = result.layers.some((l) => l.required && l.id !== "sst" && !l.ok);
  if (otherRequiredFail) return { highlight: false, line: null };

  const otherFailures = result.failures.filter((f) => !/^sst:/i.test(f));
  if (otherFailures.length) return { highlight: false, line: null };

  return {
    highlight: true,
    line: `SST is ${Math.round(age)} h old — ${SST_STALE_FLIP_COPY}`,
  };
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
  /** Honesty notes stay visible on the pack; they never fail Ready. */
  liveErrors?: readonly string[] | null;
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
  // Honesty notes (GFS hour-0 / series-off) ride liveErrors for Packs.
  // They are not overlay misses. Real misses keep fixture bodies.

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

  // Honesty notes never become failures. A "has liveErrors → not ready"
  // check must use blockingLiveErrors (honesty stripped). Fixture still counts,
  // so miss lines do not AND Ready here.
  const cleanFailures = failures.filter((f) => !isHonestyLiveError(f));
  return {
    ready: hoursOk && cleanFailures.length === 0,
    hoursOk,
    dayTrip,
    sstOverride,
    sstOverrideUsed,
    layers,
    failures: cleanFailures,
    warnings,
  };
}

export interface BuiltPack {
  manifest: TripPackManifestV1;
  bodies: Record<string, string>;
}

/** Deterministic pack id: bbox + 6 h cycle + hours. Content hashes are not in it. */
export async function packIdFor(bbox: PackBBox, start: string, hours: number): Promise<string> {
  const boxed = clampBbox(bbox);
  const cycle = cycleStamp(start);
  const key = bboxKey(boxed);
  return (await sha256Hex(`ahanu|${key}|${cycle}|${hours}`)).slice(0, 16);
}

const PACK_BUILD_TTL_MS = 10 * 60 * 1000;
const lastBuilt = new Map<string, { at: number; built: BuiltPack }>();

export function packBuildCacheKey(bbox: PackBBox, start: string, hours: number): string {
  return `${bboxKey(clampBbox(bbox))}|${start}|${hours}`;
}

/** In-isolate last buildTripPack. Objects reuse these bytes so helm hash matches. */
export function rememberBuiltPack(built: BuiltPack): void {
  const at = Date.now();
  lastBuilt.set(packBuildCacheKey(built.manifest.bbox, built.manifest.start, built.manifest.hours), {
    at,
    built,
  });
  lastBuilt.set(`id:${built.manifest.packId}`, { at, built });
}

export function peekBuiltPack(opts: {
  bbox?: PackBBox;
  start?: string;
  hours?: number;
  packId?: string;
}): BuiltPack | undefined {
  const now = Date.now();
  if (opts.packId) {
    const hit = lastBuilt.get(`id:${opts.packId}`);
    if (hit && now - hit.at < PACK_BUILD_TTL_MS) return hit.built;
  }
  if (opts.bbox && opts.start != null && opts.hours != null) {
    const hit = lastBuilt.get(packBuildCacheKey(opts.bbox, opts.start, opts.hours));
    if (hit && now - hit.at < PACK_BUILD_TTL_MS) return hit.built;
  }
  return undefined;
}

export function resetBuiltPackCache(): void {
  lastBuilt.clear();
}

function overlayIsOfficialEnc(overlay?: string): boolean {
  if (!overlay) return false;
  const parsed = parseLayerBody(overlay);
  if (!parsed || !("payload" in parsed)) return false;
  return Boolean((parsed.payload as { official?: boolean }).official);
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
  const packId = await packIdFor(bbox, start, hours);
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
      label: spec.id === "enc" && overlayIsOfficialEnc(overlay) ? "NOAA ENC (official S-57)" : spec.label,
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
  const check = evaluateReadyForOffshore({
    hours,
    start,
    now: createdAt,
    layers: evidence,
    liveErrors: options.liveErrors,
  });

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
      ? "Fixture grids plus live NOAA overlays where fetch succeeded (NDBC / CO-OPS / ENC catalog or official S-57 / CoastWatch SST / chlorophyll / SSH / HMS closed areas / CoastWatch ETOPO-GEBCO bathymetry). Official S-57 packs only when NOAA zips fetch and the .000 is ISO 8211; catalog-only otherwise. SST is source noaa only when a public ERDDAP grid parses; resolution is whatever arrived (a 0.05° public grid is not native 1 km MUR). Chlorophyll is source noaa only when a public ERDDAP grid parses; resolution is whatever arrived (PFEG Aqua MODIS 8-day NRT here is 4 km / 0.0417° — not 1 km VIIRS, not CMEMS). SSH / SLA is source noaa only when a public ERDDAP grid parses; resolution is whatever arrived (CoastWatch blended SLA here is 0.25° / ~25 km — not CMEMS L4, not AVISO DUACS). HMS is source noaa only when a public NMFS/NOAA closed-area KMZ or shapefile parses and intersects the box — reminder overlay, not a legal determination. Bathymetry is source noaa only when a public ERDDAP relief grid parses; resolution is whatever arrived (NCEI ETOPO 2022 here is 15″ subsampled to ~0.033° — not native 15″, not official ENC). Cheap 100/200-fm contours are derived from that grid when it paints. Chlorophyll and altimetry do not block Ready. Bathymetry is required for Ready (fixture still counts on a miss). Hour-0 wind/wave is painted from the NCEP subset when it parses. A 72 h / 3 h GFS-Wave series is fetched on the Worker (pace 0, 25 s budget). A complete series stamps 72 h noaa. A short prefix paints those hours and keeps a fixture tail — the liveErrors line says which. Client must re-hash. Worker readyForOffshore is a hint."
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
  if (series?.complete && series.hoursCovered >= 72 && (series.windKt || series.waveFt)) {
    return {
      wind: series.windKt ? encodeLayerBody(series.windKt) : undefined,
      waves: series.waveFt ? encodeLayerBody(series.waveFt) : undefined,
    };
  }
  const seriesOff = !series || !series.fetchedHours.length;
  const liveHours = series?.fetchedHours?.length
    ? series.fetchedHours
    : ((input.hour0Wind ?? input.hour0Waves)?.hours ?? [0]);
  const note = seriesOff ? gfsHour0FixtureNote("off") : gfsLiveHoursNote(liveHours, input.hours);
  const liveWind = series?.windKt ?? input.hour0Wind;
  const liveWaves = series?.waveFt ?? input.hour0Waves;
  const fixWind = asPackedGrid(generateLayerPayload("wind", input.bbox, input.start, input.hours));
  const fixWaves = asPackedGrid(generateLayerPayload("waves", input.bbox, input.start, input.hours));
  const out: { wind?: string; waves?: string; note?: string } = {};
  const merge = (live: PackedGrid, fix: PackedGrid) =>
    (live.hours?.length ?? 0) > 1
      ? mergeLiveHoursIntoFixture(live, fix, note)
      : mergeHour0IntoFixture(live, fix, note);
  if (liveWind && fixWind) out.wind = encodeLayerBody(merge(liveWind, fixWind));
  if (liveWaves && fixWaves) out.waves = encodeLayerBody(merge(liveWaves, fixWaves));
  if ((out.wind || out.waves) && note) out.note = note;
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
      budgetMs?: number;
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
    if (live.canyons?.body) {
      overlays.canyons = encodeLiveLayer(live.canyons.body);
      extraSources.push({ id: "noaa-canyons", name: live.canyons.note });
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
    // Honesty only — Packs still lists the line. Ready / Retry ignore it.
    if (gfsMerge.note) liveErrors = capLiveErrors([gfsMerge.note, ...liveErrors]);
  }
  const built = await buildFixturePack({
    bbox,
    start,
    hours,
    createdAt: options.createdAt,
    overlays: Object.keys(overlays).length ? overlays : undefined,
    extraSources: extraSources.length ? extraSources : undefined,
    liveErrors,
  });
  rememberBuiltPack(built);
  return built;
}
