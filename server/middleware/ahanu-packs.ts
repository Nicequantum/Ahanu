/**
 * Same-origin fixture pack API on the Vercel/Nitro preview.
 * Production marine bytes still leave Cloudflare R2 via ahanu-packs.
 */
import { handlePacksRequest } from "../../src/lib/ahanu/pack-http";

interface PackEvent {
  url: URL;
  req: {
    method: string;
    headers: Headers;
    arrayBuffer?: () => Promise<ArrayBuffer>;
  };
}

export default async function ahanuPacksMiddleware(
  event: PackEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const path = event.url.pathname.replace(/\/+$/, "") || "/";
  const hit =
    path === "/api/packs" ||
    path === "/api/objects" ||
    path.startsWith("/api/objects/") ||
    path === "/api/catches";
  if (!hit) return next();
  const method = (event.req.method ?? "GET").toUpperCase();
  let body: ArrayBuffer | undefined;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && event.req.arrayBuffer) {
    body = await event.req.arrayBuffer();
  }
  const request = new Request(event.url, {
    method,
    headers: event.req.headers,
    body: body && body.byteLength ? body : undefined,
  });
  return handlePacksRequest(request);
}
