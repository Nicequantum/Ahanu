/* Ahanu pack cache — marina Wi-Fi download, then steam offline.
 *
 * Fixture GET /api/packs and GET /api/objects: cache-first after first success.
 * ?live=1: network-first; a 30 s stamp is only a freshness hint, never "live forever".
 * IndexedDB remains the source of truth for a pack already written on the device.
 * This worker is the same-origin HTTP fallback when those URLs are fetched again.
 */

export const CACHE_NAME = "ahanu-packs-v2";
export const LIVE_MAX_AGE_MS = 30_000;

export function isPackPath(pathname) {
  return (
    pathname === "/api/packs" || pathname === "/api/objects" || pathname.startsWith("/api/objects/")
  );
}

export function isLivePackRequest(url) {
  const v = (url.searchParams.get("live") ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function isSkipCachePackRequest(url) {
  const v = (url.searchParams.get("skipCache") ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** @returns {"cache-first" | "network-first" | null} */
export function packFetchStrategy(url) {
  if (!isPackPath(url.pathname)) return null;
  return isLivePackRequest(url) || isSkipCachePackRequest(url) ? "network-first" : "cache-first";
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

/**
 * Same-origin pack GET handler. Returns null when this worker should not claim the request.
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
  if (env.origin && url.origin !== env.origin) return null;
  const strategy = packFetchStrategy(url);
  if (!strategy) return null;

  const fetchImpl = env.fetchImpl;
  const now = env.now ?? Date.now();
  const cache = await env.cacheStore.open(CACHE_NAME);
  const cached = await cache.match(request);

  if (strategy === "cache-first") {
    if (cached) return cached;
    try {
      const res = await fetchImpl(request);
      if (res.ok) await remember(cache, request, res, strategy, now, env.waitUntil);
      return res;
    } catch {
      return Response.error();
    }
  }

  if (cached && isLiveCacheFresh(cached, now) && !isSkipCachePackRequest(url)) return cached;
  try {
    const res = await fetchImpl(request);
    if (res.ok) {
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

  self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;
    let url;
    try {
      url = new URL(req.url);
    } catch {
      return;
    }
    if (url.origin !== self.location.origin) return;
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
