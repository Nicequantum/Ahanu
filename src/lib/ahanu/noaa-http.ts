/**
 * Shared public-NOAA fetch: timeout + one retry on timeout / 429 / 5xx.
 * 404 is not retried. Failure returns null so the caller keeps the fixture.
 * Keep free of `@/` aliases so the Worker can import it.
 */

export type FetchLikeInit = {
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

export type FetchLike = (input: string, init?: FetchLikeInit) => Promise<Response>;

/**
 * Bound Worker/browser fetch. Do not pass `globalThis.fetch` as a free
 * function — nodejs_compat undici throws "Illegal invocation" and NOAA
 * looks like an instant miss.
 */
export const defaultNoaaFetch: FetchLike = (input, init) => fetch(input, init);

/** Identify Ahanu on public NOAA hosts (Apache often rejects empty/CF UA). */
export const NOAA_USER_AGENT = "Ahanu/1.0 (trip-packs; +https://github.com/Nicequantum/Ahanu)";

/** NDBC / CO-OPS text is small; still long enough for a slow dock link. */
export const NOAA_QUICK_TIMEOUT_MS = 8_000;

/** ERDDAP grids, HMS KMZ, hour-0 GFS. Slow host, not dead. */
export const NOAA_GRID_TIMEOUT_MS = 18_000;

/** Backoff before the single retry (1–2 s). */
export const NOAA_RETRY_BACKOFF_MS = 1_500;

/** One retry = two attempts. */
export const NOAA_FETCH_RETRIES = 1;

export function noaaStatusRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

export function isNoaaAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "AbortError" || name === "TimeoutError";
}

export interface FetchNoaaOptions {
  url: string;
  fetchImpl: FetchLike;
  timeoutMs?: number;
  maxBytes: number;
  retries?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch bytes with a timeout. One retry on abort/timeout, 429, or 5xx.
 * Does not retry 404 or other 4xx. Empty / oversized bodies are a miss.
 */
export async function fetchNoaaBytes(options: FetchNoaaOptions): Promise<Uint8Array | null> {
  const timeoutMs = options.timeoutMs ?? NOAA_GRID_TIMEOUT_MS;
  const retries = options.retries ?? NOAA_FETCH_RETRIES;
  const backoffMs = options.backoffMs ?? NOAA_RETRY_BACKOFF_MS;
  const sleep = options.sleep ?? defaultSleep;
  const attempts = Math.max(1, retries + 1);

  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await options.fetchImpl(options.url, {
        signal: ctrl.signal,
        headers: { "User-Agent": NOAA_USER_AGENT },
      });
      if (!res.ok) {
        if (i < attempts - 1 && noaaStatusRetryable(res.status)) {
          await sleep(backoffMs);
          continue;
        }
        return null;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > options.maxBytes) return null;
      return buf;
    } catch (err) {
      if (i < attempts - 1 && isNoaaAbortError(err)) {
        await sleep(backoffMs);
        continue;
      }
      return null;
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

export async function fetchNoaaText(options: FetchNoaaOptions): Promise<string | null> {
  const bytes = await fetchNoaaBytes(options);
  if (!bytes) return null;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
