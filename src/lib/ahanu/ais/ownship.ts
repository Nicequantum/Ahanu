/** Own-ship from RMC / GGA. Invalid status or checksum is dropped — fail closed. */

import { decodeSentence } from "@/lib/ahanu/nmea";

export interface OwnShipFix {
  lat: number;
  lon: number;
  sog?: number;
  cog?: number;
  source: "RMC" | "GGA";
}

function dmToDeg(dm: string, hemi: string): number | null {
  if (!dm || !hemi) return null;
  const dot = dm.indexOf(".");
  const whole = dot >= 0 ? dm.slice(0, dot) : dm;
  if (whole.length < 3) return null;
  const deg = Number(whole.slice(0, -2));
  const minutes = Number(whole.slice(-2) + (dot >= 0 ? dm.slice(dot) : ""));
  if (!Number.isFinite(deg) || !Number.isFinite(minutes)) return null;
  let v = deg + minutes / 60;
  if (hemi === "S" || hemi === "W") v = -v;
  if (hemi === "N" || hemi === "S") {
    if (v < -90 || v > 90) return null;
  } else if (hemi === "E" || hemi === "W") {
    if (v < -180 || v > 180) return null;
  } else return null;
  return v;
}

/** Returns a fix, or null when the sentence is not own-ship or must be rejected. */
export function parseOwnShip(line: string): OwnShipFix | null {
  const decoded = decodeSentence(line);
  if (!decoded?.ok) return null;
  if (decoded.type === "RMC") {
    const [, status, la, ns, lo, ew, sog, cog] = decoded.fields;
    if (status !== "A") return null;
    const lat = dmToDeg(la ?? "", ns ?? "");
    const lon = dmToDeg(lo ?? "", ew ?? "");
    if (lat == null || lon == null) return null;
    const fix: OwnShipFix = { lat, lon, source: "RMC" };
    const sogN = Number(sog);
    const cogN = Number(cog);
    if (Number.isFinite(sogN)) fix.sog = sogN;
    if (Number.isFinite(cogN)) fix.cog = ((cogN % 360) + 360) % 360;
    return fix;
  }
  if (decoded.type === "GGA") {
    const [, la, ns, lo, ew, quality] = decoded.fields;
    const q = Number(quality);
    if (!Number.isFinite(q) || q <= 0) return null;
    const lat = dmToDeg(la ?? "", ns ?? "");
    const lon = dmToDeg(lo ?? "", ew ?? "");
    if (lat == null || lon == null) return null;
    return { lat, lon, source: "GGA" };
  }
  return null;
}
