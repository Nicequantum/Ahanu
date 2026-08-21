/* Ahanu pack cache — marina Wi-Fi download, then steam offline.
 *
 * Same-origin fixture GET /api/packs and GET /api/objects: cache-first after first success.
 * ?live=1 / ?skipCache=1: network-first; a 30 s stamp is only a freshness hint, never "live forever".
 * Production Worker origins (api.ahanu.dev, workers.dev, extra allowlist): network-first even
 * without live=1 — helm Download omits that flag (preview-only). Cache-first would hide a
 * newer cron / Retry / notes persist behind the last dock GET.
 * IndexedDB remains the source of truth for a pack already written on the device.
 * This worker is the HTTP fallback when those URLs are fetched again — same origin
 * (local Vite) and the live ahanu-packs Worker. Arbitrary cross-origin is not cached.
 * Airplane after dock download still uses IndexedDB + last successful SW cache.
 */

export const CACHE_NAME = "ahanu-packs-v2";
export const LIVE_MAX_AGE_MS = 30_000;

/** Live packs Worker on zone ahanu.dev. Helm VITE_AHANU_PACKS_URL points here on CF/prod. */
export const PACKS_CUSTOM_ORIGIN = "https://api.ahanu.dev";
/** workers.dev fallback — still allowlisted if helm overrides VITE_AHANU_PACKS_URL. */
export const PACKS_WORKER_ORIGIN = "https://ahanu-packs.hombre3536.workers.dev";

const extraPackOrigins = new Set();

export function isPackPath(pathname) {
  return (
    pathname === "/api/packs" || pathname === "/api/objects" || pathname.startsWith("/api/objects/")
  );
}

export function allowPackOrigin(origin) {
  if (typeof origin !== "string" || !origin.trim()) return null;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.origin === "null") return null;
    extraPackOrigins.add(u.origin);
    return u.origin;
  } catch {
    return null;
  }
}

export function resetPackOrigins() {
  extraPackOrigins.clear();
}

export function applyPacksOriginMessage(data) {
  if (!data || data.type !== "ahanu-packs-origin") return null;
  return allowPackOrigin(data.origin);
}

export function isAllowedPackOrigin(urlOrigin, selfOrigin) {
  if (selfOrigin && urlOrigin === selfOrigin) return true;
  if (urlOrigin === PACKS_CUSTOM_ORIGIN) return true;
  if (urlOrigin === PACKS_WORKER_ORIGIN) return true;
  if (extraPackOrigins.has(urlOrigin)) return true;
  return false;
}

export function isLivePackRequest(url) {
  const v = (url.searchParams.get("live") ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function isSkipCachePackRequest(url) {
  const v = (url.searchParams.get("skipCache") ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Allowlisted packs Worker / override — not same-origin Vite fixture. */
export function isRemotePackOrigin(urlOrigin, selfOrigin) {
  if (selfOrigin && urlOrigin === selfOrigin) return false;
  return isAllowedPackOrigin(urlOrigin, undefined);
}

/** @returns {"cache-first" | "network-first" | null} */
export function packFetchStrategy(url, selfOrigin) {
  if (!isPackPath(url.pathname)) return null;
  if (isLivePackRequest(url) || isSkipCachePackRequest(url)) return "network-first";
  // Production helm Download talks to the Worker without live=1.
  if (isRemotePackOrigin(url.origin, selfOrigin)) return "network-first";
  return "cache-first";
}

/**
 * Cross-origin pack GETs must be CORS (readable, cacheable). no-cors would be
 * opaque — we refuse to invent or store a body we cannot read.
 */
export function packNetworkRequest(request, selfOrigin) {
  const req = typeof request === "string" ? new Request(request) : request;
  const url = new URL(requestUrl(req));
  if (selfOrigin && url.origin === selfOrigin) return req;
  return new Request(req, { mode: "cors", credentials: "omit" });
}

export function cachedAtMs(res) {
  const raw = res.headers.get("X-Ahanu-Cached-At");
  const n = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(n) ? n : 0;
}

export function isLiveCacheFresh(res, now = Date.now(), maxAgeMs = LIVE_MAX_AGE_MS) {
  const at = cachedAtMs(res);
  return at > 0 && now - at < maxAgeMs;
}

function requestUrl(req) {
  return typeof req === "string" ? req : req.url;
}

function stampCached(res, strategy, now) {
  const headers = new Headers(res.headers);
  headers.set("X-Ahanu-Cached-At", String(now));
  headers.set("X-Ahanu-Sw-Strategy", strategy);
  if (!headers.has("Cache-Control")) {
    headers.set(
      "Cache-Control",
      strategy === "network-first" ? "public, max-age=30" : "public, max-age=86400",
    );
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function remember(cache, request, res, strategy, now, waitUntil) {
  const stamped = stampCached(res.clone(), strategy, now);
  const put = cache.put(request, stamped);
  if (typeof waitUntil === "function") waitUntil(put);
  await put;
}

function canCachePackResponse(res) {
  return Boolean(res && res.ok && res.type !== "opaque" && res.type !== "error");
}

/**
 * Allowlisted pack GET handler. Returns null when this worker should not claim the request.
 *
 * @param {Request} request
 * @param {{
 *   fetchImpl: (input: Request) => Promise<Response>,
 *   cacheStore: { open: (name: string) => Promise<{ match: Function, put: Function }> },
 *   origin?: string,
 *   waitUntil?: (p: Promise<unknown>) => void,
 *   now?: number,
 * }} env
 * @returns {Promise<Response | null>}
 */
export async function respondToPackRequest(request, env) {
  if (request.method !== "GET") return null;
  const url = new URL(requestUrl(request));
  if (!isAllowedPackOrigin(url.origin, env.origin)) return null;
  const strategy = packFetchStrategy(url, env.origin);
  if (!strategy) return null;

  const fetchImpl = env.fetchImpl;
  const now = env.now ?? Date.now();
  const cache = await env.cacheStore.open(CACHE_NAME);
  const cached = await cache.match(request);

  const network = () => fetchImpl(packNetworkRequest(request, env.origin));

  if (strategy === "cache-first") {
    if (cached) return cached;
    try {
      const res = await network();
      if (canCachePackResponse(res)) await remember(cache, request, res, strategy, now, env.waitUntil);
      return res;
    } catch {
      return Response.error();
    }
  }

  if (cached && isLiveCacheFresh(cached, now) && !isSkipCachePackRequest(url)) return cached;
  try {
    const res = await network();
    if (canCachePackResponse(res)) {
      await remember(cache, request, res, strategy, now, env.waitUntil);
      return res;
    }
    return cached || res;
  } catch {
    return cached || Response.error();
  }
}

function runningAsServiceWorker() {
  return (
    typeof self !== "undefined" &&
    typeof caches !== "undefined" &&
    typeof ServiceWorkerGlobalScope !== "undefined" &&
    self instanceof ServiceWorkerGlobalScope
  );
}

if (runningAsServiceWorker()) {
  self.addEventListener("install", (event) => {
    event.waitUntil(self.skipWaiting());
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((k) => k.startsWith("ahanu-packs") && k !== CACHE_NAME)
            .map((k) => caches.delete(k)),
        );
        await self.clients.claim();
      })(),
    );
  });

  self.addEventListener("message", (event) => {
    applyPacksOriginMessage(event.data);
  });

  self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;
    let url;
    try {
      url = new URL(req.url);
    } catch {
      return;
    }
    if (!isAllowedPackOrigin(url.origin, self.location.origin)) return;
    if (!isPackPath(url.pathname)) return;
    event.respondWith(
      respondToPackRequest(req, {
        fetchImpl: (input) => fetch(input),
        cacheStore: caches,
        origin: self.location.origin,
        waitUntil: (p) => event.waitUntil(p),
      }),
    );
  });
}
