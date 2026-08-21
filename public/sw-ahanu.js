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
 *
 * Shell precache (same-origin only): install fetches `/` (index), helm assets linked
 * from that document, and `/sw-ahanu.js` (already versioned via this file / cache name).
 * Documents are network-first with cache fallback so a dock visit can still take a
 * newer helm. Hashed `/assets/*` are cache-first. Never cache-first api.ahanu.dev packs.
 * A reload sea trial after a successful dock Download must still paint helm.
 */

export const CACHE_NAME = "ahanu-packs-v2";
export const SHELL_CACHE_NAME = "ahanu-shell-v1";
export const LIVE_MAX_AGE_MS = 30_000;
/** Index document + this worker. Helm JS/CSS come from the document at install. */
export const SHELL_PRECACHE_PATHS = ["/", "/sw-ahanu.js"];

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

export function isApiPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/** Same-origin helm document / versioned assets. Pack APIs are never shell. */
export function isShellPath(pathname) {
  if (isPackPath(pathname) || isApiPath(pathname)) return false;
  if (pathname === "/" || pathname === "/index.html") return true;
  if (pathname === "/login") return true;
  if (pathname === "/sw-ahanu.js") return true;
  if (pathname === "/manifest.webmanifest" || pathname === "/favicon.svg") return true;
  if (pathname.startsWith("/assets/") || pathname.startsWith("/__grok/")) return true;
  return /\.(?:js|mjs|css|woff2?|svg|png|webmanifest)$/.test(pathname);
}

export function isShellRequest(request, selfOrigin) {
  const req = typeof request === "string" ? new Request(request) : request;
  let url;
  try {
    url = new URL(requestUrl(req));
  } catch {
    return false;
  }
  if (selfOrigin && url.origin !== selfOrigin) return false;
  if (isPackPath(url.pathname) || isApiPath(url.pathname)) return false;
  if (req.mode === "navigate") return true;
  return isShellPath(url.pathname);
}

/** @returns {"cache-first" | "network-first" | null} */
export function shellFetchStrategy(request, selfOrigin) {
  if (!isShellRequest(request, selfOrigin)) return null;
  const req = typeof request === "string" ? new Request(request) : request;
  const url = new URL(requestUrl(req));
  if (req.mode === "navigate") return "network-first";
  if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/login") {
    return "network-first";
  }
  if (url.pathname === "/manifest.webmanifest") return "network-first";
  return "cache-first";
}

export function helmAssetUrlsFromHtml(html, origin) {
  if (typeof html !== "string" || !html || !origin) return [];
  let base;
  try {
    base = new URL(origin);
  } catch {
    return [];
  }
  const found = [];
  const seen = new Set();
  const re = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = (m[1] ?? "").trim();
    if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) continue;
    try {
      const u = new URL(raw, base);
      if (u.origin !== base.origin) continue;
      if (isPackPath(u.pathname) || isApiPath(u.pathname)) continue;
      if (!isShellPath(u.pathname)) continue;
      if (seen.has(u.href)) continue;
      seen.add(u.href);
      found.push(u.href);
    } catch {
      /* ignore bad URLs */
    }
  }
  return found;
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

function shellCacheKey(request, origin) {
  const url = new URL(requestUrl(request));
  if (origin) return new URL(url.pathname + url.search, origin).href;
  return url.href;
}

async function matchShell(cache, request, origin) {
  const direct = await cache.match(request);
  if (direct) return direct;
  const key = shellCacheKey(request, origin);
  const byKey = await cache.match(key);
  if (byKey) return byKey;
  const url = new URL(requestUrl(request));
  if (url.pathname === "/" || url.pathname === "/index.html" || request.mode === "navigate") {
    const index = await cache.match(new URL("/", origin).href);
    if (index) return index;
  }
  return undefined;
}

/**
 * Precache the helm document, assets it links, and sw-ahanu.js.
 * Partial success is kept — a failed asset must not abort install.
 *
 * @param {{
 *   fetchImpl: (input: Request) => Promise<Response>,
 *   cacheStore: { open: (name: string) => Promise<{ match: Function, put: Function }> },
 *   origin: string,
 *   waitUntil?: (p: Promise<unknown>) => void,
 *   now?: number,
 * }} env
 */
export async function precacheShell(env) {
  if (!env?.origin) return [];
  const cache = await env.cacheStore.open(SHELL_CACHE_NAME);
  const now = env.now ?? Date.now();
  const stored = [];
  const seen = new Set();

  const putOk = async (url) => {
    if (seen.has(url)) return null;
    seen.add(url);
    try {
      const res = await env.fetchImpl(new Request(url));
      if (canCachePackResponse(res)) {
        await remember(cache, url, res, "cache-first", now, env.waitUntil);
        stored.push(url);
        return res;
      }
    } catch {
      /* dock Wi-Fi glitch — keep going */
    }
    return null;
  };

  for (const path of SHELL_PRECACHE_PATHS) {
    const url = new URL(path, env.origin).href;
    const res = await putOk(url);
    if (res && (path === "/" || path === "/index.html")) {
      try {
        const html = await res.text();
        for (const asset of helmAssetUrlsFromHtml(html, env.origin)) {
          await putOk(asset);
        }
      } catch {
        /* document body unreadable — index is still cached */
      }
    }
  }
  return stored;
}

/**
 * Same-origin helm GET. Returns null when this worker should not claim the request.
 * Never claims pack /api paths — those stay on respondToPackRequest.
 */
export async function respondToShellRequest(request, env) {
  if (request.method !== "GET") return null;
  if (!isShellRequest(request, env.origin)) return null;
  const strategy = shellFetchStrategy(request, env.origin);
  if (!strategy) return null;

  const fetchImpl = env.fetchImpl;
  const now = env.now ?? Date.now();
  const cache = await env.cacheStore.open(SHELL_CACHE_NAME);
  const cached = await matchShell(cache, request, env.origin);
  const storeKey = shellCacheKey(request, env.origin);
  const network = () => fetchImpl(typeof request === "string" ? new Request(request) : request);

  if (strategy === "cache-first") {
    if (cached) return cached;
    try {
      const res = await network();
      if (canCachePackResponse(res)) await remember(cache, storeKey, res, strategy, now, env.waitUntil);
      return res;
    } catch {
      return cached || Response.error();
    }
  }

  try {
    const res = await network();
    if (canCachePackResponse(res)) {
      await remember(cache, storeKey, res, strategy, now, env.waitUntil);
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
    event.waitUntil(
      (async () => {
        await precacheShell({
          fetchImpl: (input) => fetch(input),
          cacheStore: caches,
          origin: self.location.origin,
        });
        await self.skipWaiting();
      })(),
    );
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter(
              (k) =>
                (k.startsWith("ahanu-packs") && k !== CACHE_NAME) ||
                (k.startsWith("ahanu-shell") && k !== SHELL_CACHE_NAME),
            )
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
    if (isAllowedPackOrigin(url.origin, self.location.origin) && isPackPath(url.pathname)) {
      event.respondWith(
        respondToPackRequest(req, {
          fetchImpl: (input) => fetch(input),
          cacheStore: caches,
          origin: self.location.origin,
          waitUntil: (p) => event.waitUntil(p),
        }),
      );
      return;
    }
    if (url.origin !== self.location.origin) return;
    if (!isShellRequest(req, self.location.origin)) return;
    event.respondWith(
      respondToShellRequest(req, {
        fetchImpl: (input) => fetch(input),
        cacheStore: caches,
        origin: self.location.origin,
        waitUntil: (p) => event.waitUntil(p),
      }),
    );
  });
}
