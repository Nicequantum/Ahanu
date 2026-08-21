/**
 * Better Auth signing secret.
 *
 * Production Cloudflare injects BETTER_AUTH_SECRET as a Worker secret.
 * Missing or empty on CF fails closed — no public constant in source.
 * Local / Grok preview mints a process-local random (HMR-stable).
 * Never put this value in VITE_.
 */

import { randomBytes } from "node:crypto";

export type AuthSecretSource = "env" | "preview-random" | "missing";

export interface ResolvedAuthSecret {
  secret: string;
  source: AuthSecretSource;
}

export function runningOnCloudflareWorker(): boolean {
  try {
    return globalThis.navigator?.userAgent === "Cloudflare-Workers";
  } catch {
    return false;
  }
}

/** Read an env var, treating empty/whitespace as unset. */
export function envTrim(key: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

const globalAuthRef = globalThis as typeof globalThis & {
  __grokAuthPreviewSecret__?: string;
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Process-local preview secret. HMR-stable via globalThis. Not a public constant. */
export function mintPreviewAuthSecret(): string {
  if (globalAuthRef.__grokAuthPreviewSecret__) {
    return globalAuthRef.__grokAuthPreviewSecret__;
  }
  try {
    // Node / Vite preview. CF rejects node:crypto random at isolate global scope.
    globalAuthRef.__grokAuthPreviewSecret__ = randomBytes(32).toString("hex");
  } catch {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    globalAuthRef.__grokAuthPreviewSecret__ = bytesToHex(bytes);
  }
  return globalAuthRef.__grokAuthPreviewSecret__;
}

/**
 * Isolate-local boot secret when CF is missing BETTER_AUTH_SECRET.
 * Not a source constant — cannot forge sessions from the repo.
 * Auth HTTP still refuses while source === "missing".
 */
export function isolateBootSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function resolveBetterAuthSecret(input?: {
  envSecret?: string;
  cloudflare?: boolean;
  previewRandom?: string;
}): ResolvedAuthSecret {
  const envSecret = (input?.envSecret ?? envTrim("BETTER_AUTH_SECRET") ?? "").trim();
  if (envSecret) return { secret: envSecret, source: "env" };
  const cf = input?.cloudflare ?? runningOnCloudflareWorker();
  if (cf) return { secret: "", source: "missing" };
  return { secret: input?.previewRandom ?? mintPreviewAuthSecret(), source: "preview-random" };
}

/** False only on Cloudflare with no BETTER_AUTH_SECRET — fail closed. */
export function betterAuthSecretReady(input?: {
  envSecret?: string;
  cloudflare?: boolean;
}): boolean {
  return resolveBetterAuthSecret(input).source !== "missing";
}
