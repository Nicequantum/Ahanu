/**
 * Fail-closed per-IP limit for HTTP live NOAA rebuilds.
 *
 * GET /api/packs?skipCache=1 and objects rebuild-on-total-miss still hit
 * NOAA + ENC (~11s, many subrequests). A public URL must not do that
 * unbounded. R2 / isolate hits do not take a slot. Cron and POST /api/ingest
 * call buildTripPack in-process and never come through this gate.
 *
 * Default: 3 live rebuilds / 60s / CF-Connecting-IP. Missing IP denies
 * (fail closed). Limiter errors deny. Helm Retry (skipCache=1) still works.
 */
export const LIVE_REBUILD_LIMIT = 3;
export const LIVE_REBUILD_WINDOW_MS = 60_000;

export type LiveRebuildDecision = { ok: true } | { ok: false; retryAfter: number };

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

/** Throw when this HTTP call is about to rebuild NOAA. No-op when not gated. */
export function assertLiveRebuildAllowed(ip: string | null | undefined): void {
  if (ip === undefined) return;
  const decision = takeLiveRebuildSlot(ip);
  if (!decision.ok) throw new LiveRebuildLimitError(decision.retryAfter);
}

export interface LimitLiveRebuild {
  ip: string | null;
}
