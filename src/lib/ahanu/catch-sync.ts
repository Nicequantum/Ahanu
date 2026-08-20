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

export type UnsyncedRetry = {
  attempted: number;
  synced: number;
  failed: number;
  records: CatchRecord[];
};

/** Catches that have not been acknowledged by the worker. */
export function unsyncedCatches(catches: CatchRecord[]): CatchRecord[] {
  return catches.filter((c) => c.synced !== true);
}

/**
 * POST each unsynced catch through syncCatch, one at a time.
 * No token → do not fetch (local Vite stays quiet). Failures stay local.
 */
export async function retryUnsyncedCatches(
  catches: CatchRecord[],
  opts?: { token?: string; base?: string },
): Promise<UnsyncedRetry> {
  const pending = unsyncedCatches(catches);
  if (!opts?.token || pending.length === 0) {
    return { attempted: 0, synced: 0, failed: 0, records: [] };
  }
  const records: CatchRecord[] = [];
  let synced = 0;
  let failed = 0;
  for (const rec of pending) {
    const next = await syncCatch(rec, opts);
    records.push(next);
    if (next.synced) synced += 1;
    else failed += 1;
  }
  return { attempted: pending.length, synced, failed, records };
}

/** One quiet helm line after a Save-token retry. */
export function retryUnsyncedStatus(
  r: Pick<UnsyncedRetry, "attempted" | "synced" | "failed">,
): string {
  if (r.attempted === 0) return "Sync on";
  if (r.failed === 0) return `Sync on · ${r.synced} synced`;
  if (r.synced === 0) return `Sync on · ${r.failed} still local`;
  return `Sync on · ${r.synced} synced, ${r.failed} still local`;
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
