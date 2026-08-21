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
 * when it is present (same 6 h packId window or explicit packId).
 * A stored SST analysis older than 24 h triggers an SST-first live fetch
 * (ACSPO path). A <=24 h grid replaces that layer and is persisted; other
 * R2 layer hashes stay. ACSPO miss keeps MUR and adds honesty.
 * Official ENC whose packed cellIds are below the current picker cap
 * (16) or missing harbor/approach ids the current picker would include
 * for this bbox is refetched on the liveEnc path, persisted, and other
 * R2 layers stay. Catalog-only / fixture ENC is not rebuilt here.
 * Live CO-OPS tides missing required catalog ids (8455083 POINT JUDITH,
 * HARBOR OF REFUGE) are refetched on the liveTides path, persisted, and
 * other R2 layers stay. Fixture tides are not rebuilt here.
 * skipCache=1 or a total miss is a live build + persist.
 * Persist (full, SST refresh, ENC refresh) rewrites layer.label / sources[]
 * from the landed body so R2 cannot keep a MUR label on an ACSPO object,
 * an NDFD label on a GFS-Wave wind object, or an L4 label on an Aqua
 * MODIS chlorophyll object. Official ENC persist includes cellIds +
 * updateCount. Serving R2 (GET and HEAD) also rewrites a leftover
 * MUR label when the stored SST body is already ACSPO, leftover NDFD wind
 * labels (NDFD is not fetched), leftover L4 chlorophyll labels (CMEMS L4
 * is not fetched), leftover "02° — not 1 km MUR" notes from
 * the first-period strip of 0.02°, leftover sources[] "not live GRIB/SST/CMEMS"
 * when those layers are live NOAA, and duplicate sst/enc/tides "live refresh"
 * liveErrors from stale-SST GET prepend (no NOAA fetch). HEAD persist writes
 * that catalog rewrite.
 * A stale SST keep-line replaces the previous same-kind line instead of growing.
 *
 * Official S-57 packs when NOAA zips fetch and parse ISO 8211; catalog-only otherwise.
 * Hour-0 GFS-Wave is not a 72 h grid unless the series completes.
 * Live SST / chlorophyll / SSH / HMS / bathymetry / canyons are only the
 * public grids that parsed. CMEMS is not fetched.
 *
 * D1 `pack_layers` is upserted only when that table already exists.
 */
import {
  buildTripPack,
  capLiveErrors,
  evaluateReadyForOffshore,
  encSourceName,
  leftoverFixtureSources,
  leftoverMurNotes,
  leftoverMurSstLabel,
  leftoverL4ChlLabel,
  leftoverNdfdWindLabel,
  packIdFor,
  rewriteLandedManifest,
  sha256Hex,
  sstLandedName,
  SST_STALE_H,
  sstLayerIsStale,
  sstPackRowLabel,
  type BuiltPack,
  type PackLayerRecord,
} from "../../../src/lib/ahanu/pack";
import { workerGfsWaveSeriesFlag } from "../../../src/lib/ahanu/noaa-gfs";
import { defaultNoaaFetch, NOAA_GRID_TIMEOUT_MS, type FetchLike } from "../../../src/lib/ahanu/noaa-http";
import {
  fetchLiveSst,
  SST_DEDICATED_TIMEOUT_MS,
  sstAgeHours,
  type SstIngest,
} from "../../../src/lib/ahanu/noaa-sst";
import {
  fetchLiveEnc,
  fetchLiveTides,
  packedTideStationIds,
  packedTidesNeedRefresh,
  POINT_JUDITH_COOPS,
} from "../../../src/lib/ahanu/noaa-live";
import {
  ENC_S57_MAX_CELLS,
  packedEncCellIds,
  packedEncNeedsRefresh,
} from "../../../src/lib/ahanu/noaa-enc";
import { assertLiveRebuildAllowed, type LimitLiveRebuild } from "../live-rebuild-limit";
import {
  encodeLayerBody,
  parseLayerBody,
  NORTHEAST_BBOX,
  POINT_JUDITH_CANYON_BBOX,
  specForLayer,
  utf8Bytes,
  type PackBBox,
} from "../../../src/lib/ahanu/pack-fixtures";

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
  AISSTREAM_API_KEY?: string;
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
  /** Tests pin the SST age clock. Production uses Date.now(). */
  now?: Date | number;
  /** HTTP only. Cron / ingestFixturePack omit this so they are not limited. */
  limitLiveRebuild?: LimitLiveRebuild;
}

export interface ResolvedPack {
  manifest: BuiltPack["manifest"];
  source: "r2" | "live";
  built?: BuiltPack;
}

export type HeadPackResult =
  | { manifest: BuiltPack["manifest"]; source: "r2"; built?: BuiltPack }
  | { manifest: null; source: "no-rebuild" };

/**
 * HEAD /api/packs: last R2 only. Never buildTripPack, never take a
 * skipCache live-rebuild slot. skipCache on the query is ignored.
 * Serving leftover MUR labels on an already-landed ACSPO body,
 * leftover "02° — not 1 km MUR" notes from the first-period strip,
 * leftover sources[] "not live GRIB/SST/CMEMS" when those layers are live NOAA, or
 * duplicate sst/enc/tides live-refresh liveErrors, is the same catalog
 * rewrite GET persist uses — no NOAA.
 */
export async function headPackManifest(
  env: IngestEnv,
  opts: Pick<ResolvePackOptions, "bbox" | "start" | "hours" | "packId">,
): Promise<HeadPackResult> {
  const packId = (opts.packId ?? "").trim() || (await packIdFor(opts.bbox, opts.start, opts.hours));
  const stored = await loadPersistedManifest(env, packId);
  if (!stored) return { manifest: null, source: "no-rebuild" };
  const leftover = await rewriteLeftoverR2Labels(env, stored);
  if (leftover.built) return { manifest: leftover.manifest, source: "r2", built: leftover.built };
  return { manifest: stored, source: "r2" };
}

/**
 * skipCache off: last R2 manifest for this packId when present.
 * A stored SST older than 24 h is not served as-is: SST-first live fetch
 * (ACSPO) can replace that layer and persist. Other R2 hashes stay.
 * Official ENC below the current picker cap or missing picker
 * harbor/approach ids is refetched (liveEnc only) and persisted.
 * Live CO-OPS missing required catalog stations (8455083) is
 * refetched (liveTides only) and persisted. Other R2 hashes stay.
 * skipCache or miss: live buildTripPack.
 * Caller persists a live result.
 * HTTP callers pass limitLiveRebuild so a full live rebuild is fail-closed
 * per CF-Connecting-IP. A fresh R2 hit returns before that gate. SST-only
 * and ENC-only refresh do not take a skipCache slot so Helm Retry still works.
 * HEAD uses headPackManifest and never reaches this path.
 */
export async function resolvePackManifest(env: IngestEnv, opts: ResolvePackOptions): Promise<ResolvedPack> {
  const hours = opts.hours;
  const packId = (opts.packId ?? "").trim() || (await packIdFor(opts.bbox, opts.start, hours));
  const nowMs = resolveNowMs(opts.now);
  if (!opts.skipCache) {
    const stored = await loadPersistedManifest(env, packId);
    if (stored) return refreshR2PackLayers(env, stored, opts, nowMs);
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
    now: typeof opts.now === "number" ? new Date(opts.now) : opts.now,
    gfsWaveSeries: workerGfsWaveSeriesFlag({
      AHANU_GFS_WAVE_SERIES: env.AHANU_GFS_WAVE_SERIES,
      GFS_WAVE_SERIES: env.GFS_WAVE_SERIES,
    }),
    aisstreamApiKey: env.AISSTREAM_API_KEY,
  });
  return { manifest: built.manifest, source: "live", built };
}

function resolveNowMs(now?: Date | number): number {
  if (now instanceof Date) return now.getTime();
  if (typeof now === "number" && Number.isFinite(now)) return now;
  return Date.now();
}

function storedSstName(layer: PackLayerRecord | undefined): string {
  if (!layer) return "stored SST";
  return sstLandedName(undefined, `${layer.label}`) ?? (/MUR/i.test(layer.label) ? "MUR" : "stored SST");
}

export function sstRefreshKeptLine(
  stored: PackLayerRecord | undefined,
  ingest: SstIngest | undefined,
  errors: string[],
  nowMs: number,
): string {
  const kept = storedSstName(stored);
  const when = stored?.updatedAt ?? "";
  if (ingest) {
    const age = sstAgeHours(ingest.analysedAt, nowMs);
    return `sst: live refresh still ${Math.round(age)} h (${ingest.dataset}) — kept ${kept} ${when}`.trim();
  }
  const why =
    errors.filter((e) => /^sst\b/i.test(e)).slice(0, 3).join("; ") || "all public paths failed";
  return `sst: live refresh failed (${why}) — kept ${kept} ${when}`.trim();
}

export function refreshKeptKind(line: string): "sst" | "enc" | "tides" | null {
  const t = line.trim();
  if (/^sst: live refresh /i.test(t)) return "sst";
  if (/^enc: live refresh /i.test(t)) return "enc";
  if (/^tides: live refresh /i.test(t)) return "tides";
  return null;
}

function liveErrorsEqual(a?: readonly string[] | null, b?: readonly string[] | null): boolean {
  const aa = a ?? [];
  const bb = b ?? [];
  if (aa.length !== bb.length) return false;
  return aa.every((line, i) => line === bb[i]);
}

/** Replace same-kind sst/enc/tides refresh-kept lines. Exact dups drop. Newest honesty first. */
export function mergeRefreshKeptLiveErrors(
  stored: readonly string[] | undefined | null,
  honesty: string,
): string[] {
  const kind = refreshKeptKind(honesty);
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (line: string) => {
    const t = line.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  push(honesty);
  for (const line of stored ?? []) {
    if (kind && refreshKeptKind(line) === kind) continue;
    push(line);
  }
  return capLiveErrors(out);
}

export function collapseRefreshKeptLiveErrors(errors: readonly string[] | undefined | null): string[] {
  const have = new Set<"sst" | "enc" | "tides">();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of errors ?? []) {
    const t = line.trim();
    if (!t || seen.has(t)) continue;
    const kind = refreshKeptKind(t);
    if (kind) {
      if (have.has(kind)) continue;
      have.add(kind);
    }
    seen.add(t);
    out.push(t);
  }
  return capLiveErrors(out);
}

export function leftoverRefreshKeptErrors(errors: readonly string[] | undefined | null): boolean {
  return !liveErrorsEqual(errors, collapseRefreshKeptLiveErrors(errors));
}

function honestyOnlyRefresh(stored: BuiltPack["manifest"], honesty: string): ResolvedPack {
  const liveErrors = mergeRefreshKeptLiveErrors(stored.liveErrors, honesty);
  if (liveErrorsEqual(liveErrors, stored.liveErrors)) {
    return { manifest: stored, source: "r2" };
  }
  const manifest = { ...stored, liveErrors };
  return { manifest, source: "live", built: { manifest, bodies: {} } };
}

async function builtPackWithRefreshedSst(
  stored: BuiltPack["manifest"],
  ingest: SstIngest,
  liveErrors: string[],
  nowMs: number,
): Promise<BuiltPack> {
  const spec = specForLayer("sst");
  if (!spec) throw new Error("sst spec missing");
  const body = encodeLayerBody(ingest.grid);
  const hash = await sha256Hex(body);
  const bytes = utf8Bytes(body).byteLength;
  const r2Key = hashedLayerR2Key(stored.packId, "sst", hash, spec.ext);
  const label = sstPackRowLabel({
    dataset: ingest.dataset,
    note: ingest.note,
    source: "noaa",
    stored: spec.label,
  });
  const layers = stored.layers.map((layer) =>
    layer.id === "sst"
      ? {
          ...layer,
          label,
          sizeMb: Math.round((bytes / (1024 * 1024)) * 1000) / 1000,
          sizeBytes: bytes,
          status: "ready" as const,
          updatedAt: ingest.analysedAt,
          hours: ingest.grid.hoursCovered ?? layer.hours,
          hash,
          r2Key,
          source: "noaa" as const,
        }
      : layer,
  );
  const totalBytes = layers.reduce((n, layer) => n + layer.sizeBytes, 0);
  const generatedAt = new Date(nowMs).toISOString();
  const evidence = layers.map((layer) => ({
    id: layer.id,
    present: true,
    hashExpected: layer.hash,
    hashActual: layer.hash,
    updatedAt: layer.updatedAt,
    hoursCovered: layer.hours,
    cycleAt: generatedAt,
  }));
  const check = evaluateReadyForOffshore({
    hours: stored.hours,
    start: stored.start,
    now: nowMs,
    layers: evidence,
    liveErrors,
  });
  const sources = [...stored.sources.filter((s) => s.id !== "noaa-sst"), { id: "noaa-sst", name: ingest.note }];
  const manifest = rewriteLandedManifest(
    {
      ...stored,
      generatedAt,
      readyForOffshore: check.ready,
      layers,
      totalBytes,
      totalMb: Math.round((totalBytes / (1024 * 1024)) * 10) / 10,
      sources,
      liveErrors: capLiveErrors(liveErrors),
    },
    { sst: body },
  );
  return { manifest, bodies: { sst: body } };
}

async function refreshR2PackLayers(
  env: IngestEnv,
  stored: BuiltPack["manifest"],
  opts: ResolvePackOptions,
  nowMs: number,
): Promise<ResolvedPack> {
  const sst = await refreshStaleR2Sst(env, stored, opts, nowMs);
  const enc = await refreshShortR2Enc(env, sst.manifest, opts, nowMs);
  const afterEnc = enc.built ? enc.manifest : sst.manifest;
  const tides = await refreshShortR2Tides(env, afterEnc, opts, nowMs);
  const current = tides.built ? tides.manifest : afterEnc;
  const leftover = await rewriteLeftoverR2Labels(env, current);
  const bodies = {
    ...(sst.built?.bodies ?? {}),
    ...(enc.built?.bodies ?? {}),
    ...(tides.built?.bodies ?? {}),
    ...(leftover.built?.bodies ?? {}),
  };
  const manifest = leftover.built ? leftover.manifest : current;
  if (!sst.built && !enc.built && !tides.built && !leftover.built) {
    return { manifest: current, source: "r2" };
  }
  return { manifest, source: "live", built: { manifest, bodies } };
}

async function loadStoredLayerBody(
  env: IngestEnv,
  stored: BuiltPack["manifest"],
  layerId: string,
): Promise<string | null> {
  const rec = stored.layers.find((layer) => layer.id === layerId);
  if (!rec) return null;
  const raw =
    (await r2ObjectText(env.PACKS, rec.r2Key)) ??
    (await r2ObjectText(env.PACKS, latestLayerR2Key(stored.packId, layerId)));
  if (!raw) return null;
  return resolveR2LayerBody(env.PACKS, raw);
}

/** Serving R2: leftover MUR label on an ACSPO body, leftover NDFD wind label, leftover L4 chlorophyll label, leftover 02° MUR notes, leftover live-grid fixture sources[], duplicate live-refresh errors, or official ENC without counts. No NOAA. NDFD and CMEMS L4 are not fetched. */
async function rewriteLeftoverR2Labels(
  env: IngestEnv,
  stored: BuiltPack["manifest"],
): Promise<ResolvedPack> {
  const overlays: Partial<Record<string, string>> = {};
  const sst = stored.layers.find((layer) => layer.id === "sst");
  if (sst && leftoverMurSstLabel(sst.label)) {
    const body = await loadStoredLayerBody(env, stored, "sst");
    if (body) {
      const parsed = parseLayerBody(body);
      const dataset = parsed && parsed.kind === "grid" && typeof parsed.dataset === "string" ? parsed.dataset : undefined;
      const note = parsed && parsed.kind === "grid" && typeof parsed.note === "string" ? parsed.note : undefined;
      if (sstLandedName(dataset, note) === "ACSPO") overlays.sst = body;
    }
  }
  const enc = stored.layers.find((layer) => layer.id === "enc");
  const encSrc = stored.sources?.find((s) => s.id === "noaa-enc");
  if (enc && /official S-57/i.test(enc.label) && !/\d+\s+cells/i.test(encSrc?.name ?? "")) {
    const body = await loadStoredLayerBody(env, stored, "enc");
    if (body && encSourceName(body)) overlays.enc = body;
  }
  const notesDirty = leftoverMurNotes(stored.notes);
  const errorsDirty = leftoverRefreshKeptErrors(stored.liveErrors);
  const sourcesDirty = leftoverFixtureSources(stored.sources, stored.layers);
  const wind = stored.layers.find((layer) => layer.id === "wind");
  const windDirty = leftoverNdfdWindLabel(wind?.label);
  const chl = stored.layers.find((layer) => layer.id === "chlorophyll");
  const chlDirty = leftoverL4ChlLabel(chl?.label);
  if (chlDirty) {
    const body = await loadStoredLayerBody(env, stored, "chlorophyll");
    if (body) overlays.chlorophyll = body;
  }
  if (!overlays.sst && !overlays.enc && !notesDirty && !errorsDirty && !sourcesDirty && !windDirty && !chlDirty) return { manifest: stored, source: "r2" };
  const rewritten = rewriteLandedManifest(stored, overlays);
  const liveErrors = collapseRefreshKeptLiveErrors(rewritten.liveErrors);
  const manifest = { ...rewritten, liveErrors };
  const windNext = manifest.layers.find((layer) => layer.id === "wind")?.label ?? "";
  const windPrev = wind?.label ?? "";
  const chlNext = manifest.layers.find((layer) => layer.id === "chlorophyll")?.label ?? "";
  const chlPrev = chl?.label ?? "";
  if (
    !overlays.sst &&
    !overlays.enc &&
    (manifest.notes ?? "") === (stored.notes ?? "") &&
    liveErrorsEqual(liveErrors, stored.liveErrors) &&
    !leftoverFixtureSources(manifest.sources, manifest.layers) &&
    JSON.stringify(manifest.sources ?? []) === JSON.stringify(stored.sources ?? []) &&
    windNext === windPrev &&
    chlNext === chlPrev
  ) {
    return { manifest: stored, source: "r2" };
  }
  return { manifest, source: "live", built: { manifest, bodies: overlays } };
}

function encRefreshKeptLine(storedIds: string[], errors: string[]): string {
  const n = storedIds.length;
  const why =
    errors.filter((e) => /^enc\b/i.test(e)).slice(0, 3).join("; ") || "official S-57 did not improve";
  return `enc: live refresh failed (${why}) — kept official ENC (${n} cells)`;
}

async function loadStoredEncPayload(
  env: IngestEnv,
  stored: BuiltPack["manifest"],
): Promise<{ official?: boolean; s57?: { cellIds?: string[] }; cells?: { id: string; usage: number; name: string; west?: number; south?: number; east?: number; north?: number; zipBytes?: number; scale?: number }[] } | null> {
  const body = await loadStoredLayerBody(env, stored, "enc");
  if (!body) return null;
  const parsed = parseLayerBody(body);
  if (!parsed || parsed.kind !== "enc-clip" || !("payload" in parsed) || !parsed.payload || typeof parsed.payload !== "object") {
    return null;
  }
  return parsed.payload as {
    official?: boolean;
    s57?: { cellIds?: string[] };
    cells?: { id: string; usage: number; name: string; west?: number; south?: number; east?: number; north?: number; zipBytes?: number; scale?: number }[];
  };
}

async function builtPackWithRefreshedEnc(
  stored: BuiltPack["manifest"],
  enc: Awaited<ReturnType<typeof fetchLiveEnc>>,
  liveErrors: string[],
  nowMs: number,
): Promise<BuiltPack> {
  if (!enc) throw new Error("enc body missing");
  const spec = specForLayer("enc");
  if (!spec) throw new Error("enc spec missing");
  const body = encodeLayerBody(enc);
  const hash = await sha256Hex(body);
  const bytes = utf8Bytes(body).byteLength;
  const r2Key = hashedLayerR2Key(stored.packId, "enc", hash, spec.ext);
  const payload = enc.payload as { official?: boolean; note?: string; s57?: { cellIds?: string[] } };
  const label = payload.official ? "NOAA ENC (official S-57)" : spec.label;
  const layers = stored.layers.map((layer) =>
    layer.id === "enc"
      ? {
          ...layer,
          label,
          sizeMb: Math.round((bytes / (1024 * 1024)) * 1000) / 1000,
          sizeBytes: bytes,
          status: "ready" as const,
          updatedAt: new Date(nowMs).toISOString(),
          hash,
          r2Key,
          source: "noaa" as const,
        }
      : layer,
  );
  const totalBytes = layers.reduce((n, layer) => n + layer.sizeBytes, 0);
  const generatedAt = new Date(nowMs).toISOString();
  const evidence = layers.map((layer) => ({
    id: layer.id,
    present: true,
    hashExpected: layer.hash,
    hashActual: layer.hash,
    updatedAt: layer.updatedAt,
    hoursCovered: layer.hours,
    cycleAt: generatedAt,
  }));
  const check = evaluateReadyForOffshore({
    hours: stored.hours,
    start: stored.start,
    now: nowMs,
    layers: evidence,
    liveErrors,
  });
  const note = encSourceName(body) ?? (typeof payload.note === "string" && payload.note ? payload.note : "Official NOAA S-57");
  const sources = [...stored.sources.filter((s) => s.id !== "noaa-enc"), { id: "noaa-enc", name: note }];
  const manifest = rewriteLandedManifest(
    {
      ...stored,
      generatedAt,
      readyForOffshore: check.ready,
      layers,
      totalBytes,
      totalMb: Math.round((totalBytes / (1024 * 1024)) * 10) / 10,
      sources,
      liveErrors: capLiveErrors([...(stored.liveErrors ?? []), ...liveErrors]),
    },
    { enc: body },
  );
  return { manifest, bodies: { enc: body } };
}

async function refreshShortR2Enc(
  env: IngestEnv,
  stored: BuiltPack["manifest"],
  opts: ResolvePackOptions,
  nowMs: number,
): Promise<ResolvedPack> {
  const payload = await loadStoredEncPayload(env, stored);
  if (!packedEncNeedsRefresh(payload, { maxCells: ENC_S57_MAX_CELLS })) {
    return { manifest: stored, source: "r2" };
  }
  const errors: string[] = [];
  let enc: Awaited<ReturnType<typeof fetchLiveEnc>>;
  try {
    enc = await fetchLiveEnc({
      bbox: opts.bbox,
      fetchImpl: opts.fetchImpl ?? defaultNoaaFetch,
      timeoutMs: opts.timeoutMs ?? NOAA_GRID_TIMEOUT_MS,
      errors,
    });
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  const nextIds = packedEncCellIds(enc?.payload as { official?: boolean; s57?: { cellIds?: string[] } } | undefined);
  const official = Boolean((enc?.payload as { official?: boolean } | undefined)?.official) && nextIds.length > 0;
  const oldIds = packedEncCellIds(payload);
  const improved = official && (nextIds.length > oldIds.length || nextIds.length >= ENC_S57_MAX_CELLS);
  if (enc && official && improved) {
    const built = await builtPackWithRefreshedEnc(stored, enc, errors, nowMs);
    return { manifest: built.manifest, source: "live", built };
  }
  const honesty = encRefreshKeptLine(oldIds, errors);
  return honestyOnlyRefresh(stored, honesty);
}

async function refreshStaleR2Sst(
  env: IngestEnv,
  stored: BuiltPack["manifest"],
  opts: ResolvePackOptions,
  nowMs: number,
): Promise<ResolvedPack> {
  const sst = stored.layers.find((layer) => layer.id === "sst");
  if (!sstLayerIsStale(sst, nowMs)) return { manifest: stored, source: "r2" };
  const errors: string[] = [];
  let ingest: SstIngest | undefined;
  try {
    ingest = await fetchLiveSst({
      bbox: opts.bbox,
      fetchImpl: opts.fetchImpl ?? defaultNoaaFetch,
      timeoutMs: Math.max(opts.timeoutMs ?? NOAA_GRID_TIMEOUT_MS, SST_DEDICATED_TIMEOUT_MS),
      errors,
      now: nowMs,
    });
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  const age = ingest ? sstAgeHours(ingest.analysedAt, nowMs) : Number.POSITIVE_INFINITY;
  if (ingest && age <= SST_STALE_H) {
    const built = await builtPackWithRefreshedSst(stored, ingest, errors, nowMs);
    return { manifest: built.manifest, source: "live", built };
  }
  const honesty = sstRefreshKeptLine(sst, ingest, errors, nowMs);
  return honestyOnlyRefresh(stored, honesty);
}

function tidesRefreshKeptLine(haveIds: string[], errors: string[]): string {
  const n = haveIds.length;
  const why =
    errors.filter((e) => /^coops\b/i.test(e)).slice(0, 3).join("; ") || "required harbor missing";
  return `tides: live refresh failed (${why}) — kept CO-OPS (${n} stations)`;
}

async function loadStoredTidesPayload(
  env: IngestEnv,
  stored: BuiltPack["manifest"],
): Promise<{
  live?: boolean;
  source?: string;
  fixture?: boolean;
  stations?: { id?: string; name?: string }[];
} | null> {
  const body = await loadStoredLayerBody(env, stored, "tides");
  if (!body) return null;
  const parsed = parseLayerBody(body);
  if (!parsed || parsed.kind !== "json" || !("payload" in parsed) || !parsed.payload || typeof parsed.payload !== "object") {
    return null;
  }
  return parsed.payload as {
    live?: boolean;
    source?: string;
    fixture?: boolean;
    stations?: { id?: string; name?: string }[];
  };
}

async function builtPackWithRefreshedTides(
  stored: BuiltPack["manifest"],
  tides: NonNullable<Awaited<ReturnType<typeof fetchLiveTides>>>,
  liveErrors: string[],
  nowMs: number,
): Promise<BuiltPack> {
  const spec = specForLayer("tides");
  if (!spec) throw new Error("tides spec missing");
  const body = encodeLayerBody(tides);
  const hash = await sha256Hex(body);
  const bytes = utf8Bytes(body).byteLength;
  const r2Key = hashedLayerR2Key(stored.packId, "tides", hash, spec.ext);
  const layers = stored.layers.map((layer) =>
    layer.id === "tides"
      ? {
          ...layer,
          label: spec.label,
          sizeMb: Math.round((bytes / (1024 * 1024)) * 1000) / 1000,
          sizeBytes: bytes,
          status: "ready" as const,
          updatedAt: new Date(nowMs).toISOString(),
          hash,
          r2Key,
          source: "noaa" as const,
        }
      : layer,
  );
  const totalBytes = layers.reduce((n, layer) => n + layer.sizeBytes, 0);
  const generatedAt = new Date(nowMs).toISOString();
  const evidence = layers.map((layer) => ({
    id: layer.id,
    present: true,
    hashExpected: layer.hash,
    hashActual: layer.hash,
    updatedAt: layer.updatedAt,
    hoursCovered: layer.hours,
    cycleAt: generatedAt,
  }));
  const check = evaluateReadyForOffshore({
    hours: stored.hours,
    start: stored.start,
    now: nowMs,
    layers: evidence,
    liveErrors,
  });
  const manifest = rewriteLandedManifest(
    {
      ...stored,
      generatedAt,
      readyForOffshore: check.ready,
      layers,
      totalBytes,
      totalMb: Math.round((totalBytes / (1024 * 1024)) * 10) / 10,
      liveErrors: capLiveErrors([...(stored.liveErrors ?? []), ...liveErrors]),
    },
    { tides: body },
  );
  return { manifest, bodies: { tides: body } };
}

async function refreshShortR2Tides(
  env: IngestEnv,
  stored: BuiltPack["manifest"],
  opts: ResolvePackOptions,
  nowMs: number,
): Promise<ResolvedPack> {
  const payload = await loadStoredTidesPayload(env, stored);
  if (!packedTidesNeedRefresh(payload)) {
    return { manifest: stored, source: "r2" };
  }
  const errors: string[] = [];
  let tides: Awaited<ReturnType<typeof fetchLiveTides>>;
  try {
    tides = await fetchLiveTides({
      bbox: opts.bbox,
      start: opts.start,
      hours: opts.hours,
      fetchImpl: opts.fetchImpl ?? defaultNoaaFetch,
      timeoutMs: opts.timeoutMs ?? NOAA_GRID_TIMEOUT_MS,
      errors,
    });
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  const nextIds = packedTideStationIds(
    tides && "payload" in tides && tides.payload && typeof tides.payload === "object"
      ? (tides.payload as { stations?: { id?: string }[] })
      : null,
  );
  const improved = Boolean(tides) && nextIds.includes(POINT_JUDITH_COOPS.id);
  if (tides && improved) {
    const built = await builtPackWithRefreshedTides(stored, tides, errors, nowMs);
    return { manifest: built.manifest, source: "live", built };
  }
  const honesty = tidesRefreshKeptLine(packedTideStationIds(payload), errors);
  return honestyOnlyRefresh(stored, honesty);
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
  const rewritten = rewriteLandedManifest(built.manifest, built.bodies);
  built.manifest.layers = rewritten.layers;
  built.manifest.sources = rewritten.sources;
  built.manifest.landedSources = rewritten.landedSources;
  built.manifest.notes = rewritten.notes;
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
    aisstreamApiKey: env.AISSTREAM_API_KEY,
  });
  return persistBuiltPack(env, built);
}

export { NORTHEAST_BBOX, POINT_JUDITH_CANYON_BBOX };
