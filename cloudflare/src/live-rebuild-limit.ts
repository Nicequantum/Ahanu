/**
 * Fail-closed per-IP limit for HTTP live NOAA rebuilds.
 *
 * GET /api/packs?skipCache=1 and objects rebuild-on-total-miss still hit
 * NOAA + ENC (~11s, many subrequests). A public URL must not do that
 * unbounded. R2 / isolate hits do not take a slot. HEAD of those routes
 * never rebuilds and never takes a slot. Cron and POST /api/ingest
 * call buildTripPack in-process and never come through this gate.
 *
 * Default: 3 live rebuilds / 60s / CF-Connecting-IP.
 * Production uses the Workers Rate Limiting binding (per colo). Tests and a
 * missing binding fall back to isolate memory. Missing IP or limiter errors
 * deny. Helm Retry (skipCache=1) still works.
 */
export const LIVE_REBUILD_LIMIT = 3;
export const LIVE_REBUILD_WINDOW_MS = 60_000;

export type LiveRebuildDecision = { ok: true } | { ok: false; retryAfter: number };

export interface LiveRebuildLimiter {
  limit: (opts: { key: string }) => Promise<{ success: boolean }>;
}

const stampsByIp = new Map<string, number[]>();

export class LiveRebuildLimitError extends Error {
  readonly retryAfter: number;
  constructor(retryAfter: number) {
    super("too many live rebuilds");
    this.name = "LiveRebuildLimitError";
    this.retryAfter = retryAfter;
  }
}

export function resetLiveRebuildLimit(): void {
  stampsByIp.clear();
}

export function connectingIp(request: Request): string | null {
  const cf = (request.headers.get("CF-Connecting-IP") ?? "").trim();
  if (cf) return cf;
  const xff = (request.headers.get("X-Forwarded-For") ?? "").split(",")[0]?.trim() ?? "";
  return xff || null;
}

export function takeLiveRebuildSlot(
  ip: string | null,
  now = Date.now(),
  limit = LIVE_REBUILD_LIMIT,
  windowMs = LIVE_REBUILD_WINDOW_MS,
): LiveRebuildDecision {
  try {
    const key = (ip ?? "").trim();
    if (!key) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil(windowMs / 1000)) };
    }
    const cutoff = now - windowMs;
    const stamps = (stampsByIp.get(key) ?? []).filter((t) => t > cutoff);
    if (stamps.length >= limit) {
      const oldest = stamps[0]!;
      const retryAfter = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
      stampsByIp.set(key, stamps);
      return { ok: false, retryAfter };
    }
    stamps.push(now);
    stampsByIp.set(key, stamps);
    return { ok: true };
  } catch {
    return { ok: false, retryAfter: Math.max(1, Math.ceil(windowMs / 1000)) };
  }
}

/**
 * Throw when this HTTP call is about to rebuild NOAA. No-op when not gated
 * (`ip === undefined`, cron / ingest). Binding first; isolate memory fallback.
 */
export async function assertLiveRebuildAllowed(
  ip: string | null | undefined,
  limiter?: LiveRebuildLimiter,
): Promise<void> {
  if (ip === undefined) return;
  const key = (ip ?? "").trim();
  const windowSec = Math.max(1, Math.ceil(LIVE_REBUILD_WINDOW_MS / 1000));
  if (!key) throw new LiveRebuildLimitError(windowSec);
  if (limiter && typeof limiter.limit === "function") {
    try {
      const { success } = await limiter.limit({ key });
      if (!success) throw new LiveRebuildLimitError(windowSec);
      return;
    } catch (err) {
      if (err instanceof LiveRebuildLimitError) throw err;
      throw new LiveRebuildLimitError(windowSec);
    }
  }
  const decision = takeLiveRebuildSlot(key);
  if (!decision.ok) throw new LiveRebuildLimitError(decision.retryAfter);
}

export interface LimitLiveRebuild {
  ip: string | null;
  limiter?: LiveRebuildLimiter;
}
