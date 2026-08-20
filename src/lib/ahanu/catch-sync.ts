import type { CatchRecord } from "./types";
import { packsApiBase } from "./pack-client";

export const DEVICE_TOKEN_KEY = "ahanu-device-token";

type Readable = Pick<Storage, "getItem">;
type Writable = Pick<Storage, "setItem" | "removeItem">;

function storageGet(storage?: Readable | null): Readable | null {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function storageSet(storage?: Writable | null): Writable | null {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * POST a catch to the data plane. Never throws to the helm.
 * 401 / network / 5xx → synced: false. The log stays on the boat.
 */
export async function syncCatch(
  rec: CatchRecord,
  opts?: { token?: string; base?: string },
): Promise<CatchRecord> {
  const base = opts?.base ?? packsApiBase();
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts?.token) headers.Authorization = `Bearer ${opts.token}`;
    const res = await fetch(`${base}/api/catches`, {
      method: "POST",
      headers,
      body: JSON.stringify(rec),
    });
    if (!res.ok) return { ...rec, synced: false };
    const payload = (await res.json()) as { catch?: { synced?: boolean } };
    return { ...rec, synced: payload.catch?.synced === true };
  } catch {
    return { ...rec, synced: false };
  }
}

export function deviceToken(storage?: Readable | null): string | undefined {
  const store = storageGet(storage);
  if (!store) return undefined;
  try {
    const t = store.getItem(DEVICE_TOKEN_KEY);
    return t && t.trim() ? t.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function deviceTokenStatus(
  storage?: Readable | null,
): "Sync on" | "Local only (no device token)" {
  return deviceToken(storage) ? "Sync on" : "Local only (no device token)";
}

export function issueDeviceToken(): string {
  return crypto.randomUUID();
}

export function writeDeviceToken(token: string, storage?: Writable | null): string | undefined {
  const next = token.trim();
  if (!next) {
    clearDeviceToken(storage);
    return undefined;
  }
  try {
    storageSet(storage)?.setItem(DEVICE_TOKEN_KEY, next);
    return next;
  } catch {
    return undefined;
  }
}

/** Persist a typed token, or issue one if the field is blank. */
export function saveDeviceToken(typed?: string, storage?: Writable | null): string {
  const next = (typed ?? "").trim() || issueDeviceToken();
  writeDeviceToken(next, storage);
  return next;
}

export function clearDeviceToken(storage?: Writable | null): void {
  try {
    storageSet(storage)?.removeItem(DEVICE_TOKEN_KEY);
  } catch {
    /* private mode / SSR */
  }
}
