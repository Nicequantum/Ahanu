/**
 * Browser Geolocation → ownship. GPS mode uses this device.
 * Denied / unavailable / timeout keeps the last position — no invented fix.
 * Trolling / steaming stay simulated. NMEA gateway is still future hardware.
 */

import { haversineNm, initialBearing } from "./geo";

export type GpsStatus = "off" | "waiting" | "live" | "denied" | "unavailable" | "timeout";

/** GeolocationCoordinates.speed is m/s. */
export const MS_TO_KT = 1.9438444924406;

/** Ignore derived COG from a GPS hop shorter than this (nmi). */
export const GPS_COG_MIN_NM = 0.02;

export const GPS_ON_KEY = "ahanu-nav-gps";

export interface GpsCoords {
  latitude: number;
  longitude: number;
  speed?: number | null;
  heading?: number | null;
  accuracy?: number | null;
}

export interface OwnshipGpsFix {
  lat: number;
  lon: number;
  /** Knots when the device reported speed; null = unknown (not simulated SOG). */
  sog: number | null;
  /** Degrees when the device reported heading; null = unknown. */
  cog: number | null;
  accuracyM: number | null;
}

export interface GeolocationLike {
  watchPosition(
    success: (pos: { coords: GpsCoords }) => void,
    error?: (err: { code?: number; message?: string }) => void,
    options?: { enableHighAccuracy?: boolean; maximumAge?: number; timeout?: number },
  ): number;
  clearWatch(id: number): void;
}

export const GEO_DENIED = 1;
export const GEO_UNAVAILABLE = 2;
export const GEO_TIMEOUT = 3;

type Readable = Pick<Storage, "getItem">;
type Writable = Pick<Storage, "setItem">;

function wrap360(d: number): number {
  return ((d % 360) + 360) % 360;
}

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

export function parseGpsOn(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === "string") {
    const t = value.trim().toLowerCase();
    if (t === "1" || t === "true" || t === "yes") return true;
    if (t === "0" || t === "false" || t === "no") return false;
  }
  return false;
}

/** Dedicated key. Missing = off. First visit stays trolling. */
export function readPersistedGpsOn(storage?: Readable | null): boolean {
  const store = storageGet(storage);
  if (!store) return false;
  try {
    const raw = store.getItem(GPS_ON_KEY);
    if (raw === null) return false;
    return parseGpsOn(raw);
  } catch {
    return false;
  }
}

export function writePersistedGpsOn(on: boolean, storage?: Writable | null): void {
  try {
    storageSet(storage)?.setItem(GPS_ON_KEY, on ? "1" : "0");
  } catch {
    /* private mode / SSR */
  }
}

export function parseGpsCoords(coords: GpsCoords | null | undefined): OwnshipGpsFix | null {
  if (!coords) return null;
  const lat = coords.latitude;
  const lon = coords.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const speedMs = coords.speed;
  const heading = coords.heading;
  const acc = coords.accuracy;
  return {
    lat,
    lon,
    sog: Number.isFinite(speedMs) && (speedMs as number) >= 0 ? (speedMs as number) * MS_TO_KT : null,
    cog: Number.isFinite(heading) ? wrap360(heading as number) : null,
    accuracyM: Number.isFinite(acc) && (acc as number) >= 0 ? (acc as number) : null,
  };
}

export function gpsStatusFromError(err: { code?: number; message?: string } | null | undefined): GpsStatus {
  const code = err?.code;
  if (code === GEO_DENIED) return "denied";
  if (code === GEO_TIMEOUT) return "timeout";
  return "unavailable";
}

export function gpsStatusLine(status: GpsStatus): string {
  switch (status) {
    case "waiting":
      return "GPS waiting for a fix";
    case "live":
      return "GPS live — this device";
    case "denied":
      return "GPS denied — last position";
    case "unavailable":
      return "GPS unavailable — last position";
    case "timeout":
      return "GPS timeout — last position";
    default:
      return "";
  }
}

/** Compact HUD prefix. Empty when GPS is off. */
export function gpsHudLabel(status: GpsStatus): string {
  switch (status) {
    case "waiting":
      return "GPS…";
    case "live":
      return "GPS";
    case "denied":
      return "GPS denied";
    case "unavailable":
      return "GPS off";
    case "timeout":
      return "GPS timeout";
    default:
      return "";
  }
}

/**
 * Map a parsed fix onto last-known vessel fields.
 * Unknown SOG is 0 — do not keep simulated trolling knots.
 * Unknown COG uses the hop from the last live GPS fix, else keeps last heading.
 */
export function applyOwnshipGpsFix(
  vessel: { lat: number; lon: number; sog: number; cog: number; heading: number },
  fix: OwnshipGpsFix,
  from?: { lat: number; lon: number } | null,
): { lat: number; lon: number; sog: number; cog: number; heading: number } {
  let cog = fix.cog;
  if (cog == null && from && haversineNm(from, { lat: fix.lat, lon: fix.lon }) >= GPS_COG_MIN_NM) {
    cog = initialBearing(from, { lat: fix.lat, lon: fix.lon });
  }
  if (cog == null) cog = vessel.cog;
  return {
    lat: fix.lat,
    lon: fix.lon,
    sog: fix.sog ?? 0,
    cog,
    heading: cog,
  };
}

let geoImpl: GeolocationLike | null = null;
let watchId: number | null = null;
let watchGeo: GeolocationLike | null = null;

export function setOwnshipGeolocation(impl: GeolocationLike | null): void {
  geoImpl = impl;
}

export function browserGeolocation(): GeolocationLike | null {
  try {
    const g = (globalThis as { navigator?: { geolocation?: GeolocationLike } }).navigator?.geolocation;
    return g ?? null;
  } catch {
    return null;
  }
}

export function isOwnshipGpsWatching(): boolean {
  return watchId != null;
}

export function stopOwnshipGps(): void {
  if (watchId == null) return;
  const geo = watchGeo ?? geoImpl ?? browserGeolocation();
  try {
    geo?.clearWatch(watchId);
  } catch {
    /* already gone */
  }
  watchId = null;
  watchGeo = null;
}

export function startOwnshipGps(handlers: {
  onFix: (fix: OwnshipGpsFix) => void;
  onStatus: (status: GpsStatus) => void;
  geolocation?: GeolocationLike | null;
}): boolean {
  stopOwnshipGps();
  const geo = handlers.geolocation !== undefined ? handlers.geolocation : (geoImpl ?? browserGeolocation());
  if (!geo) {
    handlers.onStatus("unavailable");
    return false;
  }
  handlers.onStatus("waiting");
  watchGeo = geo;
  watchId = geo.watchPosition(
    (pos) => {
      const fix = parseGpsCoords(pos?.coords);
      if (!fix) return;
      handlers.onStatus("live");
      handlers.onFix(fix);
    },
    (err) => {
      handlers.onStatus(gpsStatusFromError(err));
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15_000 },
  );
  return true;
}
