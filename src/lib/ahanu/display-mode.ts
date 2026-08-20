/** Persist and apply helm display mode. Default is night-bridge. */

import type { DisplayMode } from "./types";

export const DISPLAY_MODE_KEY = "ahanu-display-mode";
export const STORE_PERSIST_KEY = "ahanu-bridge-v1";
export const DEFAULT_DISPLAY_MODE: DisplayMode = "night";

export const DISPLAY_MODE_IDS = ["night", "high-contrast", "pure-black", "day"] as const;

export function isDisplayMode(value: unknown): value is DisplayMode {
  return value === "night" || value === "high-contrast" || value === "pure-black" || value === "day";
}

export function parseDisplayMode(value: unknown): DisplayMode {
  return isDisplayMode(value) ? value : DEFAULT_DISPLAY_MODE;
}

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

function readZustandDisplayMode(raw: string | null): DisplayMode | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { state?: { displayMode?: unknown } };
    const mode = parsed?.state?.displayMode;
    return isDisplayMode(mode) ? mode : null;
  } catch {
    return null;
  }
}

/** Dedicated key first, then the zustand persist blob, else night-bridge. */
export function readPersistedDisplayMode(storage?: Readable | null): DisplayMode {
  const store = storageGet(storage);
  if (!store) return DEFAULT_DISPLAY_MODE;
  try {
    const dedicated = store.getItem(DISPLAY_MODE_KEY);
    if (isDisplayMode(dedicated)) return dedicated;
    return readZustandDisplayMode(store.getItem(STORE_PERSIST_KEY)) ?? DEFAULT_DISPLAY_MODE;
  } catch {
    return DEFAULT_DISPLAY_MODE;
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

export function writePersistedDisplayMode(mode: DisplayMode, storage?: Writable | null): void {
  const next = parseDisplayMode(mode);
  try {
    storageSet(storage)?.setItem(DISPLAY_MODE_KEY, next);
  } catch {
    /* private mode / SSR */
  }
}

export function applyDisplayMode(
  mode: DisplayMode,
  root?: { dataset: DOMStringMap } | null,
): DisplayMode {
  const next = parseDisplayMode(mode);
  const el = root ?? (typeof document !== "undefined" ? document.documentElement : null);
  if (el) el.dataset.mode = next;
  if (typeof document !== "undefined") {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next === "day" ? "#d7e4ec" : "#071016");
  }
  return next;
}

/** Boot: paint the last helm before React. Safe on SSR / Node. */
export function applyPersistedDisplayMode(storage?: Readable | null): DisplayMode {
  const mode = readPersistedDisplayMode(storage);
  return applyDisplayMode(mode);
}
