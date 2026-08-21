/**
 * HTTP auth for ahanu-packs.
 *
 * POST /api/ingest requires INGEST_TOKEN (AHANU_INGEST_TOKEN alias).
 * Missing or empty secret fails closed (401). Cron does not use this
 * gate — scheduled() calls ingestFixturePack in-process in the same
 * isolate, where the secret already lives.
 *
 * POST /api/catches keeps device-token identity: any non-empty Bearer.
 * Helm catch-sync already sends the skipper's localStorage token
 * (`ahanu-device-token`). Do not require INGEST_TOKEN here — that would
 * lock the skipper out. Never put INGEST_TOKEN in VITE_ public env.
 */

export type IngestAuthEnv = {
  INGEST_TOKEN?: string;
  AHANU_INGEST_TOKEN?: string;
};

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Ahanu-Device",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Expose-Headers": "ETag, X-Ahanu-Pack-Id, X-Ahanu-Hash, X-Ahanu-Source",
};

function unauthorized(hint: string): Response {
  return new Response(JSON.stringify({ error: "unauthorized", hint }, null, 2), {
    status: 401,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS,
    },
  });
}

/** Bearer payload after `Bearer `, or null when missing/empty. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

export function ingestSecret(env: IngestAuthEnv): string {
  return (env.INGEST_TOKEN ?? env.AHANU_INGEST_TOKEN ?? "").trim();
}

export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  if (left.length !== right.length) return false;
  let out = 0;
  for (let i = 0; i < left.length; i++) out |= left[i]! ^ right[i]!;
  return out === 0;
}

/** Device-token gate for POST /api/catches. Any non-empty Bearer. */
export function requireDeviceAuth(req: Request): Response | null {
  if (!bearerToken(req)) {
    return unauthorized("Authorization: Bearer <device-token>");
  }
  return null;
}

/**
 * Fail-closed ingest gate. Empty/missing INGEST_TOKEN → 401.
 * Cron is not HTTP and does not call this.
 */
export function requireIngestAuth(req: Request, env: IngestAuthEnv): Response | null {
  const token = bearerToken(req);
  if (!token) {
    return unauthorized("Authorization: Bearer <INGEST_TOKEN>");
  }
  const secret = ingestSecret(env);
  if (!secret) {
    return unauthorized("INGEST_TOKEN is not configured");
  }
  if (!timingSafeEqual(token, secret)) {
    return unauthorized("ingest token mismatch");
  }
  return null;
}
