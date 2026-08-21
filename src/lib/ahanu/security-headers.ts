/**
 * Production HTTP security headers for the PWA Worker and ahanu-packs.
 * Keep free of `@/` aliases so the packs Worker can import it.
 *
 * CSP is document-level (HTML). It must keep MapLibre `setWorkerUrl`
 * (same-origin Vite worker chunk, plus blob: fallback), the helm service
 * worker, and pack GETs to api.ahanu.dev / workers.dev. Rasters are data:
 * URLs; NOAA tiles are packed on the Worker, not fetched by the plotter.
 */

export const PACKS_CUSTOM_ORIGIN = "https://api.ahanu.dev";
export const PACKS_WORKER_ORIGIN = "https://ahanu-packs.hombre3536.workers.dev";
export const HELM_APEX_ORIGIN = "https://ahanu.dev";
export const HELM_WWW_ORIGIN = "https://www.ahanu.dev";
export const HELM_WORKERS_ORIGIN = "https://ahanu.hombre3536.workers.dev";
export const AUTH_ISSUER_ORIGIN = "https://auth.grok.me";

export const HSTS_VALUE = "max-age=31536000; includeSubDomains";
export const REFERRER_POLICY = "strict-origin-when-cross-origin";
export const PERMISSIONS_POLICY =
  "camera=(), microphone=(), payment=(), usb=(), browsing-topics=(), geolocation=(self)";

const PACKS_EXPOSE =
  "ETag, X-Ahanu-Pack-Id, X-Ahanu-Hash, X-Ahanu-Source, X-Ahanu-Ndbc, Retry-After";

function hostnameOf(hostOrOrigin: string): string {
  const raw = hostOrOrigin.trim();
  if (!raw) return "";
  try {
    if (raw.includes("://")) return new URL(raw).hostname.toLowerCase();
  } catch {
    return "";
  }
  return raw.split(":")[0]!.toLowerCase();
}

function requestHost(request: Request): string {
  return (
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    (() => {
      try {
        return new URL(request.url).host;
      } catch {
        return "";
      }
    })()
  );
}

/** Apex / www / api on zone ahanu.dev — HSTS lives here, not on workers.dev. */
export function isCustomAhanuHost(host: string): boolean {
  const h = hostnameOf(host);
  return h === "ahanu.dev" || h === "www.ahanu.dev" || h === "api.ahanu.dev";
}

/** Production helm (custom domain or the ahanu PWA workers.dev aliases). */
export function isProductionHelmHost(host: string): boolean {
  const h = hostnameOf(host);
  if (h === "ahanu.dev" || h === "www.ahanu.dev") return true;
  if (h === "ahanu.hombre3536.workers.dev") return true;
  if (h.endsWith(".ahanu.hombre3536.workers.dev")) return true;
  return false;
}

/**
 * Origins that may read ahanu-packs via CORS (helm download + SW cache).
 * SW fetch is mode=cors / credentials=omit, so the browser sends Origin.
 * Reflect that origin; do not send `*`.
 */
export function isHelmOrigin(origin: string | null | undefined): boolean {
  if (typeof origin !== "string" || !origin.trim()) return false;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:") return false;
    if (u.origin !== `${u.protocol}//${u.host}`) return false;
    return isProductionHelmHost(u.host);
  } catch {
    return false;
  }
}

export function pwaContentSecurityPolicy(opts?: { frameAncestorsNone?: boolean }): string {
  const frame = opts?.frameAncestorsNone === false ? "" : " frame-ancestors 'none';";
  return (
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; " +
    "font-src 'self' data:; " +
    `connect-src 'self' ${PACKS_CUSTOM_ORIGIN} ${PACKS_WORKER_ORIGIN}; ` +
    "worker-src 'self' blob:; " +
    "child-src 'self' blob:; " +
    "frame-src 'none'; " +
    "object-src 'none'; " +
    "base-uri 'self'; " +
    `form-action 'self' ${AUTH_ISSUER_ORIGIN}; ` +
    "manifest-src 'self';" +
    frame
  ).trim();
}

export function pwaSecurityHeaders(request: Request): Record<string, string> {
  const host = requestHost(request);
  const prod = isProductionHelmHost(host);
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": REFERRER_POLICY,
    "Permissions-Policy": PERMISSIONS_POLICY,
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": pwaContentSecurityPolicy({ frameAncestorsNone: prod }),
  };
  if (prod) headers["X-Frame-Options"] = "DENY";
  if (isCustomAhanuHost(host)) headers["Strict-Transport-Security"] = HSTS_VALUE;
  return headers;
}

/** CORS + nosniff for ahanu-packs. ACAO is reflected helm origin, never `*`. */
export function packsSecurityHeaders(request: Request): Record<string, string> {
  const origin = (request.headers.get("Origin") ?? "").trim();
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Ahanu-Device",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Expose-Headers": PACKS_EXPOSE,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": REFERRER_POLICY,
    "Cross-Origin-Resource-Policy": "cross-origin",
    Vary: "Origin",
  };
  if (isHelmOrigin(origin)) headers["Access-Control-Allow-Origin"] = origin;
  const host = requestHost(request);
  if (isCustomAhanuHost(host)) headers["Strict-Transport-Security"] = HSTS_VALUE;
  return headers;
}

function appendVary(headers: Headers, token: string): void {
  const cur = headers.get("Vary");
  if (!cur) {
    headers.set("Vary", token);
    return;
  }
  const parts = cur
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.some((p) => p.toLowerCase() === token.toLowerCase())) {
    headers.set("Vary", [...parts, token].join(", "));
  }
}

export function applyHeaderMap(headers: Headers, extra: Record<string, string>): Headers {
  for (const [key, value] of Object.entries(extra)) {
    if (key.toLowerCase() === "vary") {
      for (const token of value.split(",")) {
        const t = token.trim();
        if (t) appendVary(headers, t);
      }
      continue;
    }
    headers.set(key, value);
  }
  return headers;
}

export function applyPwaSecurityHeaders(request: Request, response: Response): Response {
  const headers = applyHeaderMap(new Headers(response.headers), pwaSecurityHeaders(request));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function applyPacksSecurityHeaders(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete("Access-Control-Allow-Origin");
  applyHeaderMap(headers, packsSecurityHeaders(request));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
