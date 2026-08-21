/**
 * HTTP auth for ahanu-packs.
 *
 * POST /api/ingest requires INGEST_TOKEN (AHANU_INGEST_TOKEN alias).
 * Missing or empty secret fails closed (401). Cron does not use this
 * gate — scheduled() calls ingestFixturePack in-process in the same
 * isolate, where the secret already lives.
 *
 * POST /api/catches keeps device-token identity: any non-empty Bearer
 * opens the door; each catch row is then bound to SHA-256 of that
 * bearer (not the raw token). Same token updates; a different token
 * gets 403 and must not overwrite. Helm catch-sync already sends the
 * skipper's localStorage token (`ahanu-device-token`). Do not require
 * INGEST_TOKEN here — that would lock the skipper out. Never put
 * INGEST_TOKEN in VITE_ public env.
 */

import { applyPacksSecurityHeaders } from "../../src/lib/ahanu/security-headers";

export type IngestAuthEnv = {
  INGEST_TOKEN?: string;
  AHANU_INGEST_TOKEN?: string;
};

function unauthorized(req: Request, hint: string): Response {
  return applyPacksSecurityHeaders(
    req,
    new Response(JSON.stringify({ error: "unauthorized", hint }, null, 2), {
      status: 401,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }),
  );
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
    return unauthorized(req, "Authorization: Bearer <device-token>");
  }
  return null;
}

/** SHA-256 hex of the device bearer. Stored on the catch row; never the raw token. */
export async function hashDeviceToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type CatchBindDecision = "insert" | "update" | "bind" | "deny";

/**
 * Bind rule for a catch id.
 * - no row → insert bound to this token
 * - same hash → update (skipper path)
 * - NULL/empty hash → unbound-once: first successful write binds
 * - different hash → deny (do not overwrite)
 */
export function catchBindDecision(
  existing: { device_hash?: string | null } | null,
  incomingHash: string,
): CatchBindDecision {
  if (!existing) return "insert";
  const have = (existing.device_hash ?? "").trim();
  if (!have) return "bind";
  return timingSafeEqual(have, incomingHash) ? "update" : "deny";
}

/**
 * Fail-closed ingest gate. Empty/missing INGEST_TOKEN → 401.
 * Cron is not HTTP and does not call this.
 */
export function requireIngestAuth(req: Request, env: IngestAuthEnv): Response | null {
  const token = bearerToken(req);
  if (!token) {
    return unauthorized(req, "Authorization: Bearer <INGEST_TOKEN>");
  }
  const secret = ingestSecret(env);
  if (!secret) {
    return unauthorized(req, "INGEST_TOKEN is not configured");
  }
  if (!timingSafeEqual(token, secret)) {
    return unauthorized(req, "ingest token mismatch");
  }
  return null;
}
