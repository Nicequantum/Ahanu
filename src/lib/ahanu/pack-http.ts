/**
 * Same-origin pack HTTP for the Vite / Nitro preview.
 * Shape matches ahanu-packs: GET /api/packs, GET /api/objects, POST /api/catches.
 * Production marine bytes still leave Cloudflare R2 — this is the fixture loop.
 */

import { buildFixturePack, type PackBBox } from "./pack";
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

function parseBbox(url: URL): PackBBox | Response {
  const west = Number(url.searchParams.get("west"));
  const south = Number(url.searchParams.get("south"));
  const east = Number(url.searchParams.get("east"));
  const north = Number(url.searchParams.get("north"));
  if ([west, south, east, north].every(Number.isFinite)) {
    if (east === west || north === south) {
      return json({ error: "bbox has zero area" }, 400);
    }
    return { west, south, east, north };
  }
  const raw = url.searchParams.get("bbox");
  if (raw) {
    const parts = raw.split(",").map((s) => Number(s.trim()));
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      return { west: parts[0]!, south: parts[1]!, east: parts[2]!, north: parts[3]! };
    }
    return json({ error: "bbox must be w,s,e,n" }, 400);
  }
  return { west: -72.8, south: 39.4, east: -68.8, north: 41.5 };
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

export async function handlePacksRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "GET" && path === "/api/packs") {
    const bbox = parseBbox(url);
    if (bbox instanceof Response) return bbox;
    const win = parseStartHours(url);
    if (win instanceof Response) return win;
    const { manifest } = await buildFixturePack({ bbox, start: win.start, hours: win.hours });
    return json(manifest, 200, { "X-Ahanu-Pack-Id": manifest.packId });
  }

  if (request.method === "GET" && (path === "/api/objects" || path.startsWith("/api/objects/"))) {
    const bbox = parseBbox(url);
    if (bbox instanceof Response) return bbox;
    const win = parseStartHours(url);
    if (win instanceof Response) return win;
    const layer = url.searchParams.get("layer") ?? path.split("/").pop() ?? "";
    const spec = specForLayer(layer);
    if (!spec) return json({ error: "unknown layer", layer }, 404);
    const { bodies, manifest } = await buildFixturePack({ bbox, start: win.start, hours: win.hours });
    const body = bodies[spec.id];
    if (!body) return json({ error: "missing fixture", layer }, 404);
    const rec = manifest.layers.find((l) => l.id === spec.id);
    return text(body, spec.contentType, {
      ETag: rec ? `"${rec.hash}"` : "",
      "X-Ahanu-Hash": rec?.hash ?? "",
      "X-Ahanu-Source": "fixture",
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
