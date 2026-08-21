/**
 * Same-origin pack HTTP for the Vite / Nitro preview.
 * Shape matches ahanu-packs: GET /api/packs, GET /api/objects, POST /api/catches.
 * Production marine bytes still leave Cloudflare R2. Preview stays fixture unless ?live=1.
 *
 * `?live=1` uses the same Worker overlays as buildTripPack({ tryLive }):
 * NDBC buoys, CO-OPS tides, ENC catalog, CoastWatch SST / chlorophyll / SSH,
 * HMS closed areas, ETOPO bathymetry + cheap contours, and hour-0 GFS-Wave
 * when that subset decodes. A failed individual fetch keeps that layer fixture.
 * The paced 72 h GFS-Wave series stays off.
 */

import { POINT_JUDITH_CANYON_BBOX } from "./constants";
import { NOAA_GRID_TIMEOUT_MS } from "./noaa-http";
import { buildFixturePack, buildTripPack, peekBuiltPack, type PackBBox } from "./pack";
import { specForLayer } from "./pack-fixtures";
import type { CatchRecord, SpeciesId } from "./types";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Ahanu-Device",
};

const SPECIES: readonly SpeciesId[] = [
  "bigeye",
  "yellowfin",
  "bluefin",
  "mahi",
  "white_marlin",
  "blue_marlin",
  "swordfish",
  "albacore",
];

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra },
  });
}

function text(body: string, contentType: string, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": contentType, ...CORS, ...extra },
  });
}

function parseCoord(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.NaN;
}

function parseBbox(url: URL): PackBBox | Response {
  const west = parseCoord(url.searchParams.get("west"));
  const south = parseCoord(url.searchParams.get("south"));
  const east = parseCoord(url.searchParams.get("east"));
  const north = parseCoord(url.searchParams.get("north"));
  const provided = [west, south, east, north].filter((n) => n !== undefined);
  if (provided.length > 0) {
    if (provided.length !== 4 || [west, south, east, north].some((n) => n === undefined || Number.isNaN(n))) {
      return json({ error: "west, south, east, north must all be finite numbers" }, 400);
    }
    if (east === west || north === south) {
      return json({ error: "bbox has zero area" }, 400);
    }
    return { west: west as number, south: south as number, east: east as number, north: north as number };
  }
  const raw = url.searchParams.get("bbox");
  if (raw) {
    const parts = raw.split(",").map((s) => Number(s.trim()));
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      return { west: parts[0]!, south: parts[1]!, east: parts[2]!, north: parts[3]! };
    }
    return json({ error: "bbox must be w,s,e,n" }, 400);
  }
  return { ...POINT_JUDITH_CANYON_BBOX };
}

function wantLive(url: URL): boolean {
  const v = (url.searchParams.get("live") ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function wantSkipCache(url: URL): boolean {
  const v = (url.searchParams.get("skipCache") ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Fixture bodies are deterministic. Live NOAA is not fresh forever. */
function packCacheControl(live: boolean, skipCache = false): Record<string, string> {
  if (skipCache) return { "Cache-Control": "no-store" };
  return { "Cache-Control": live ? "public, max-age=30" : "public, max-age=86400" };
}

function parseStartHours(url: URL): { start: string; hours: number } | Response {
  const startRaw = url.searchParams.get("start");
  const start = startRaw && !Number.isNaN(Date.parse(startRaw)) ? new Date(startRaw).toISOString() : new Date().toISOString();
  const hoursRaw = url.searchParams.get("hours");
  const hours = hoursRaw && hoursRaw.trim() !== "" ? Number(hoursRaw) : 72;
  if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
    return json({ error: "hours must be 1–168" }, 400);
  }
  return { start, hours: Math.round(hours) };
}

/** Same overlay set as Worker ingestFixturePack / buildTripPack({ tryLive }). */
function previewTripPack(
  bbox: PackBBox,
  start: string,
  hours: number,
  fetchImpl?: (input: string, init?: { signal?: AbortSignal }) => Promise<Response>,
  extra?: { timeoutMs?: number; sleep?: (ms: number) => Promise<void>; skipCache?: boolean },
) {
  return buildTripPack({
    bbox,
    start,
    hours,
    tryLive: true,
    timeoutMs: extra?.timeoutMs ?? NOAA_GRID_TIMEOUT_MS,
    fetchImpl,
    sleep: extra?.sleep,
    skipCache: extra?.skipCache,
  });
}

export async function handlePacksRequest(
  request: Request,
  opts?: {
    fetchImpl?: (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "GET" && path === "/api/packs") {
    const bbox = parseBbox(url);
    if (bbox instanceof Response) return bbox;
    const win = parseStartHours(url);
    if (win instanceof Response) return win;
    const skipCache = wantSkipCache(url);
    const built = wantLive(url)
      ? await previewTripPack(bbox, win.start, win.hours, opts?.fetchImpl, { ...opts, skipCache })
      : await buildFixturePack({ bbox, start: win.start, hours: win.hours });
    return json(built.manifest, 200, {
      "X-Ahanu-Pack-Id": built.manifest.packId,
      ...packCacheControl(wantLive(url), skipCache),
    });
  }

  if (request.method === "GET" && (path === "/api/objects" || path.startsWith("/api/objects/"))) {
    const bbox = parseBbox(url);
    if (bbox instanceof Response) return bbox;
    const win = parseStartHours(url);
    if (win instanceof Response) return win;
    const layer = url.searchParams.get("layer") ?? path.split("/").pop() ?? "";
    const spec = specForLayer(layer);
    if (!spec) return json({ error: "unknown layer", layer }, 404);
    const skipCache = wantSkipCache(url);
    const packId = (url.searchParams.get("packId") ?? "").trim() || undefined;
    const hash = (url.searchParams.get("hash") ?? "").trim().toLowerCase() || undefined;
    const cached = peekBuiltPack({ bbox, start: win.start, hours: win.hours, packId });
    const cachedRec = cached?.manifest.layers.find((l) => l.id === spec.id);
    const hashOk = !hash || Boolean(cachedRec && cachedRec.hash === hash);
    const reuse =
      Boolean(cached) &&
      hashOk &&
      (!skipCache || Boolean(packId && cached?.manifest.packId === packId));
    const pinned = Boolean(packId || hash);
    if (!reuse && pinned && !skipCache) {
      return json({ error: "layer body missing", layer }, 404);
    }
    const built =
      reuse && cached
        ? cached
        : wantLive(url)
          ? await previewTripPack(bbox, win.start, win.hours, opts?.fetchImpl, { ...opts, skipCache })
          : await buildFixturePack({ bbox, start: win.start, hours: win.hours });
    const body = built.bodies[spec.id];
    if (!body) return json({ error: "missing fixture", layer }, 404);
    const rec = built.manifest.layers.find((l) => l.id === spec.id);
    return text(body, spec.contentType, {
      ETag: rec ? `"${rec.hash}"` : "",
      "X-Ahanu-Hash": rec?.hash ?? "",
      "X-Ahanu-Source": rec?.source ?? "fixture",
      "X-Ahanu-Pack-Id": built.manifest.packId,
      ...packCacheControl(wantLive(url), skipCache),
    });
  }

  if (request.method === "POST" && path === "/api/catches") {
    const header = request.headers.get("Authorization") ?? "";
    if (!header.startsWith("Bearer ") || !header.slice(7).trim()) {
      return json(
        { error: "unauthorized", hint: "Authorization: Bearer <token>. Keep the catch local with synced:false." },
        401,
      );
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid JSON" }, 400);
    }
    if (!body || typeof body !== "object") return json({ error: "body must be a JSON object" }, 400);
    const b = body as Record<string, unknown>;
    if (typeof b.id !== "string" || !SPECIES.includes(b.species as SpeciesId)) {
      return json({ error: "id and species required" }, 400);
    }
    if (typeof b.lat !== "number" || typeof b.lon !== "number") return json({ error: "lat/lon required" }, 400);
    const rec: CatchRecord = {
      id: b.id,
      species: b.species as SpeciesId,
      lat: b.lat,
      lon: b.lon,
      at: typeof b.at === "string" ? b.at : new Date().toISOString(),
      released: Boolean(b.released),
      synced: false,
    };
    // Preview has no D1. Accept the upsert so a token path can mark synced:true.
    return json({ ok: true, catch: { ...rec, synced: true } }, 201, { "Cache-Control": "no-store" });
  }

  return json({ error: "not found", path }, 404);
}
