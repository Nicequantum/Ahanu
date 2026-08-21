/**
 * PWA Worker liveness. Packs /health stays on ahanu-packs (NDBC probe).
 * This is a cheap 200 for ahanu.dev uptime — no NOAA, no scoring.
 */
export const PWA_HEALTH_SERVICE = "ahanu";

export function isPwaHealthPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === "/health";
}

export function isPwaHealthMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD";
}

/** GET: JSON { ok, service }. HEAD: same status/headers, empty body. */
export function pwaHealthResponse(request: Request): Response {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  return new Response(JSON.stringify({ ok: true, service: PWA_HEALTH_SERVICE }, null, 2), {
    status: 200,
    headers,
  });
}
