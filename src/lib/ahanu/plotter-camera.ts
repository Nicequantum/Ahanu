/**
 * Plotter camera. Center/zoom (and bearing/pitch) survive reload so a
 * harbor ENC view is not reset to Veatch. Follow on → ownship center wins.
 */

import { DEFAULT_CENTER, DEFAULT_ZOOM, PLOTTER_MAX_ZOOM } from "./constants";

export const CAMERA_KEY = "ahanu-camera";
export const CAMERA_PERSIST_MS = 250;
export const PLOTTER_MIN_ZOOM = 5.4;

export interface PlotterCamera {
  lng: number;
  lat: number;
  zoom: number;
  bearing: number;
  pitch: number;
}

export const DEFAULT_CAMERA: PlotterCamera = {
  lng: DEFAULT_CENTER.lon,
  lat: DEFAULT_CENTER.lat,
  zoom: DEFAULT_ZOOM,
  bearing: 0,
  pitch: 0,
};

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

function finite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Valid lng/lat/zoom required. Bearing/pitch optional (0). Garbage → null. */
export function parseCamera(value: unknown): PlotterCamera | null {
  let raw: unknown = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const lng = finite(o.lng) ?? finite(o.lon);
  const lat = finite(o.lat);
  const zoomIn = finite(o.zoom);
  if (lng == null || lat == null || zoomIn == null) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  if (zoomIn < 4 || zoomIn > 24) return null;
  const bearingIn = finite(o.bearing);
  const pitchIn = finite(o.pitch);
  const bearing = bearingIn == null || !Number.isFinite(bearingIn) ? 0 : bearingIn;
  let pitch = pitchIn == null || !Number.isFinite(pitchIn) ? 0 : pitchIn;
  if (pitch < 0 || pitch > 85) pitch = 0;
  return {
    lng,
    lat,
    zoom: clamp(zoomIn, PLOTTER_MIN_ZOOM, PLOTTER_MAX_ZOOM),
    bearing,
    pitch,
  };
}

/** Dedicated key. Missing or invalid → null (caller uses Veatch / PJ default). */
export function readPersistedCamera(storage?: Readable | null): PlotterCamera | null {
  const store = storageGet(storage);
  if (!store) return null;
  try {
    return parseCamera(store.getItem(CAMERA_KEY));
  } catch {
    return null;
  }
}

export function writePersistedCamera(cam: unknown, storage?: Writable | null): void {
  const next = parseCamera(cam);
  if (!next) return;
  try {
    storageSet(storage)?.setItem(CAMERA_KEY, JSON.stringify(next));
  } catch {
    /* private mode / SSR */
  }
}

/**
 * First paint + load hydrate. Follow (and live replay off) → ownship center.
 * Follow off → stored harbor/canyon view, else Veatch / PJ default.
 */
export function cameraForChartLoad(input: {
  follow: boolean;
  ownship: { lon: number; lat: number };
  stored?: PlotterCamera | null;
}): PlotterCamera {
  const base = input.stored ?? DEFAULT_CAMERA;
  if (input.follow) {
    return { ...base, lng: input.ownship.lon, lat: input.ownship.lat };
  }
  return base;
}

export function jumpToPersistedCamera(
  map: {
    jumpTo: (cam: {
      center: [number, number];
      zoom: number;
      bearing: number;
      pitch: number;
    }) => void;
  },
  follow: boolean,
  stored: PlotterCamera | null = readPersistedCamera(),
): boolean {
  if (follow || !stored) return false;
  map.jumpTo({
    center: [stored.lng, stored.lat],
    zoom: stored.zoom,
    bearing: stored.bearing,
    pitch: stored.pitch,
  });
  return true;
}

export function cameraFromView(view: {
  lng: number;
  lat: number;
  zoom: number;
  bearing?: number;
  pitch?: number;
}): PlotterCamera | null {
  return parseCamera({
    lng: view.lng,
    lat: view.lat,
    zoom: view.zoom,
    bearing: view.bearing ?? 0,
    pitch: view.pitch ?? 0,
  });
}

export function createDebouncedCameraPersist(
  delayMs = CAMERA_PERSIST_MS,
  storage?: Writable | null,
): ((cam: unknown) => void) & { flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: PlotterCamera | null = null;
  const persist = (cam: unknown) => {
    const next = parseCamera(cam);
    if (!next) return;
    last = next;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (last) writePersistedCamera(last, storage);
    }, delayMs);
  };
  persist.flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (last) writePersistedCamera(last, storage);
  };
  persist.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return persist;
}
