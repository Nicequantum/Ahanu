/**
 * Plotter Follow. Camera tracks ownship until the skipper pans, drags,
 * pinches, or zooms. Then Follow drops. Tap Follow to re-arm and center.
 * Ownship marker is independent — this module never invents a GPS fix.
 * On/off is persisted like night-bridge / sst-override.
 */

import { STORE_PERSIST_KEY } from "./display-mode";

export const FOLLOW_KEY = "ahanu-follow";
export const DEFAULT_FOLLOW = true;

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

export function shouldRecenterOnOwnship(followShip: boolean, replayT: number | null): boolean {
  return followShip && replayT == null;
}

/** MapLibre user pan/zoom/rotate carry originalEvent; Follow easeTo does not. */
export function isUserPlotterGesture(e: { originalEvent?: unknown } | null | undefined): boolean {
  return e != null && e.originalEvent != null;
}

/** Skipper moved the map. Follow is off until the next Follow tap. */
export function followAfterSkipperMapMove(): false {
  return false;
}

/** Exit replay: restore the persisted Follow value. Do not force ON. */
export function followAfterReplayExit(persistedFollow: boolean): boolean {
  return persistedFollow;
}

export function parseFollow(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === "string") {
    const t = value.trim().toLowerCase();
    if (t === "1" || t === "true" || t === "yes") return true;
    if (t === "0" || t === "false" || t === "no") return false;
  }
  return DEFAULT_FOLLOW;
}

function readZustandFollow(raw: string | null): boolean | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { state?: { followShip?: unknown } };
    if (!parsed?.state || !("followShip" in parsed.state)) return null;
    return parseFollow(parsed.state.followShip);
  } catch {
    return null;
  }
}

/** Dedicated key first, then the zustand persist blob, else ON. First visit stays ON. */
export function readPersistedFollow(storage?: Readable | null): boolean {
  const store = storageGet(storage);
  if (!store) return DEFAULT_FOLLOW;
  try {
    const dedicated = store.getItem(FOLLOW_KEY);
    if (dedicated !== null) return parseFollow(dedicated);
    return readZustandFollow(store.getItem(STORE_PERSIST_KEY)) ?? DEFAULT_FOLLOW;
  } catch {
    return DEFAULT_FOLLOW;
  }
}

export function writePersistedFollow(on: boolean, storage?: Writable | null): void {
  try {
    storageSet(storage)?.setItem(FOLLOW_KEY, on ? "1" : "0");
  } catch {
    /* private mode / SSR */
  }
}
