/** Persist Accept stale SST. Default off. Same pattern as night-bridge / tide harbor. */

import { STORE_PERSIST_KEY } from "./display-mode";

export const SST_STALE_OVERRIDE_KEY = "ahanu-sst-stale-override";

type Readable = Pick<Storage, "getItem">;
type Writable = Pick<Storage, "setItem">;

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

export function parseSstStaleOverride(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === "string") {
    const t = value.trim().toLowerCase();
    if (t === "1" || t === "true" || t === "yes") return true;
    if (t === "0" || t === "false" || t === "no" || t === "") return false;
  }
  return false;
}

function readZustandSstStaleOverride(raw: string | null): boolean | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { state?: { sstStaleOverride?: unknown } };
    if (!parsed?.state || !("sstStaleOverride" in parsed.state)) return null;
    return parseSstStaleOverride(parsed.state.sstStaleOverride);
  } catch {
    return null;
  }
}

/** Dedicated key first, then the zustand persist blob, else off. Never auto-on. */
export function readPersistedSstStaleOverride(storage?: Readable | null): boolean {
  const store = storageGet(storage);
  if (!store) return false;
  try {
    const dedicated = store.getItem(SST_STALE_OVERRIDE_KEY);
    if (dedicated !== null) return parseSstStaleOverride(dedicated);
    return readZustandSstStaleOverride(store.getItem(STORE_PERSIST_KEY)) ?? false;
  } catch {
    return false;
  }
}

export function writePersistedSstStaleOverride(on: boolean, storage?: Writable | null): void {
  try {
    storageSet(storage)?.setItem(SST_STALE_OVERRIDE_KEY, on ? "1" : "0");
  } catch {
    /* private mode / SSR */
  }
}
