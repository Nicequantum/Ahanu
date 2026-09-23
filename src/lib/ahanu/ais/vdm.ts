/**
 * NMEA 0183 VDM/VDO → AIS target.
 * Eyes only: this module never frames a sentence for the radio.
 * Bad checksums, bad armor, and "not available" positions are dropped.
 */

import { nmeaChecksum } from "@/lib/ahanu/nmea";
import type { AisShipType, AisTarget } from "@/lib/data/ais";
import { BitReader, armoredToBits, readSixbitText } from "./bits";

export interface AisStatic {
  name?: string;
  type?: AisShipType;
  lengthM?: number;
  destination?: string;
}

export type AisPush =
  | { kind: "target"; target: AisTarget }
  | { kind: "own-ais"; target: AisTarget }
  | { kind: "static"; mmsi: string }
  | { kind: "drop"; reason: string };

interface Group {
  total: number;
  parts: string[];
  fill: number;
}

function shipType(code: number): AisShipType {
  if (code === 30) return "fishing";
  if (code === 31 || code === 32 || code === 52) return "tug";
  if (code >= 70 && code <= 79) return "cargo";
  if (code >= 80 && code <= 89) return "tanker";
  if (code >= 36 && code <= 37) return "pleasure";
  if (code >= 60 && code <= 69) return "pleasure";
  return "cargo";
}

function finitePosition(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  if (Math.abs(lat - 91) < 1e-6 || Math.abs(lon - 181) < 1e-6) return false;
  return true;
}

function readPos(reader: BitReader, sogAt: "classA" | "classB"): {
  mmsi: string;
  sog: number;
  lon: number;
  lat: number;
  cog: number;
  heading: number;
  navStatus: number | null;
} | null {
  const type = reader.u(6);
  if (type == null) return null;
  if (reader.u(2) == null) return null;
  const mmsiN = reader.u(30);
  if (mmsiN == null) return null;
  let navStatus: number | null = null;
  if (sogAt === "classA") {
    navStatus = reader.u(4);
    if (reader.u(8) == null || navStatus == null) return null;
  } else if (reader.u(8) == null) return null;
  const sogRaw = reader.u(10);
  if (sogRaw == null || reader.u(1) == null) return null;
  const lonRaw = reader.s(28);
  const latRaw = reader.s(27);
  const cogRaw = reader.u(12);
  const hdgRaw = reader.u(9);
  if (lonRaw == null || latRaw == null || cogRaw == null || hdgRaw == null) return null;
  const lat = latRaw / 600_000;
  const lon = lonRaw / 600_000;
  if (!finitePosition(lat, lon)) return null;
  const sog = sogRaw === 1023 ? 0 : sogRaw / 10;
  const cog = cogRaw === 3600 ? (hdgRaw === 511 ? 0 : hdgRaw) : cogRaw / 10;
  const heading = hdgRaw === 511 ? cog : hdgRaw;
  return { mmsi: String(mmsiN), sog, lon, lat, cog, heading, navStatus };
}

function applyStatic(target: AisTarget, stat: AisStatic | undefined): AisTarget {
  if (!stat) return target;
  return {
    ...target,
    name: stat.name || target.name,
    type: stat.type ?? target.type,
    lengthM: stat.lengthM ?? target.lengthM,
    destination: stat.destination || target.destination,
  };
}

export class AisStream {
  private readonly groups = new Map<string, Group>();
  private readonly statics = new Map<string, AisStatic>();

  reset(): void {
    this.groups.clear();
    this.statics.clear();
  }

  pushLine(line: string, receivedAt = Date.now()): AisPush {
    const raw = line.trim();
    if (!raw.startsWith("!") && !raw.startsWith("$")) return { kind: "drop", reason: "not-nmea" };
    const star = raw.lastIndexOf("*");
    if (star < 0 || star + 3 > raw.length) return { kind: "drop", reason: "no-checksum" };
    const body = raw.slice(1, star);
    const given = raw.slice(star + 1, star + 3).toUpperCase();
    if (given !== nmeaChecksum(body)) return { kind: "drop", reason: "bad-checksum" };
    const parts = body.split(",");
    const tag = parts[0] ?? "";
    if (tag.length < 5) return { kind: "drop", reason: "short-tag" };
    const type = tag.slice(2);
    if (type !== "VDM" && type !== "VDO") return { kind: "drop", reason: "not-vdm" };
    const total = Number(parts[1]);
    const frag = Number(parts[2]);
    const seq = parts[3] ?? "";
    const channel = parts[4] ?? "";
    const payload = parts[5] ?? "";
    const fill = Number(parts[6] ?? "0");
    if (!Number.isInteger(total) || total < 1 || total > 9) return { kind: "drop", reason: "bad-total" };
    if (!Number.isInteger(frag) || frag < 1 || frag > total) return { kind: "drop", reason: "bad-frag" };
    if (!payload) return { kind: "drop", reason: "empty-payload" };
    const key = `${seq}:${channel}:${total}`;
    let group = this.groups.get(key);
    if (!group || frag === 1) {
      group = { total, parts: [], fill: 0 };
      this.groups.set(key, group);
    }
    group.parts[frag - 1] = payload;
    if (frag === total) group.fill = fill;
    if (group.parts.filter(Boolean).length < total) return { kind: "drop", reason: "awaiting-fragment" };
    const joined = group.parts.join("");
    this.groups.delete(key);
    const bits = armoredToBits(joined, group.fill);
    if (!bits) return { kind: "drop", reason: "bad-armor" };
    const decoded = this.decodeBits(bits, receivedAt, type === "VDO");
    return decoded ?? { kind: "drop", reason: "unsupported-or-invalid" };
  }

  private remember(mmsi: string, patch: AisStatic): void {
    const prev = this.statics.get(mmsi) ?? {};
    this.statics.set(mmsi, { ...prev, ...patch });
  }

  private decodeBits(bits: number[], receivedAt: number, own: boolean): AisPush | null {
    const peek = new BitReader(bits);
    const msg = peek.u(6);
    if (msg == null) return null;
    const rewind = new BitReader(bits);
    if (msg === 1 || msg === 2 || msg === 3) {
      const pos = readPos(rewind, "classA");
      if (!pos) return { kind: "drop", reason: "bad-position" };
      const target = applyStatic(baseTarget(pos, receivedAt), this.statics.get(pos.mmsi));
      if (pos.navStatus != null) target.navStatus = pos.navStatus;
      return own ? { kind: "own-ais", target } : { kind: "target", target };
    }
    if (msg === 18 || msg === 19) {
      const pos = readPos(rewind, "classB");
      if (!pos) return { kind: "drop", reason: "bad-position" };
      if (msg === 19) {
        const stamp = rewind.u(6);
        const spare = rewind.u(4);
        if (stamp == null || spare == null) return { kind: "drop", reason: "bad-class-b" };
        const name = readSixbitText(rewind, 20);
        const st = rewind.u(8);
        const bow = rewind.u(9);
        const stern = rewind.u(9);
        if (name == null || st == null || bow == null || stern == null) return { kind: "drop", reason: "bad-class-b" };
        this.remember(pos.mmsi, {
          name: name || undefined,
          type: shipType(st),
          lengthM: bow + stern || undefined,
        });
      }
      const target = applyStatic(baseTarget(pos, receivedAt), this.statics.get(pos.mmsi));
      return own ? { kind: "own-ais", target } : { kind: "target", target };
    }
    if (msg === 5) {
      if (rewind.u(6) == null || rewind.u(2) == null) return null;
      const mmsiN = rewind.u(30);
      if (mmsiN == null || rewind.u(2) == null || rewind.u(30) == null) return null;
      const call = readSixbitText(rewind, 7);
      const name = readSixbitText(rewind, 20);
      const st = rewind.u(8);
      const bow = rewind.u(9);
      const stern = rewind.u(9);
      if (call == null || name == null || st == null || bow == null || stern == null) return null;
      if (rewind.u(6) == null || rewind.u(6) == null || rewind.u(4) == null) return null;
      if (rewind.u(4) == null || rewind.u(5) == null || rewind.u(5) == null || rewind.u(6) == null) return null;
      if (rewind.u(8) == null) return null;
      const dest = readSixbitText(rewind, 20);
      if (dest == null) return null;
      const mmsi = String(mmsiN);
      this.remember(mmsi, {
        name: name || undefined,
        type: shipType(st),
        lengthM: bow + stern || undefined,
        destination: dest || undefined,
      });
      return { kind: "static", mmsi };
    }
    if (msg === 24) {
      if (rewind.u(6) == null || rewind.u(2) == null) return null;
      const mmsiN = rewind.u(30);
      const part = rewind.u(2);
      if (mmsiN == null || part == null) return null;
      const mmsi = String(mmsiN);
      if (part === 0) {
        const name = readSixbitText(rewind, 20);
        if (name == null) return null;
        this.remember(mmsi, { name: name || undefined });
      } else {
        const st = rewind.u(8);
        // Vendor ID is 42 bits (18 manufacturer + 4 model + 20 serial), not 18.
        if (st == null || rewind.u(42) == null) return null;
        const call = readSixbitText(rewind, 7);
        const bow = rewind.u(9);
        const stern = rewind.u(9);
        if (call == null || bow == null || stern == null) return null;
        this.remember(mmsi, { type: shipType(st), lengthM: bow + stern || undefined });
      }
      return { kind: "static", mmsi };
    }
    return null;
  }
}

function baseTarget(
  pos: { mmsi: string; sog: number; lon: number; lat: number; cog: number; heading: number; navStatus: number | null },
  receivedAt: number,
): AisTarget {
  return {
    mmsi: pos.mmsi,
    name: pos.mmsi,
    type: "pleasure",
    lat: pos.lat,
    lon: pos.lon,
    cog: pos.cog,
    sog: pos.sog,
    heading: pos.heading,
    lengthM: 0,
    destination: "",
    navStatus: pos.navStatus,
    receivedAt,
    provenance: "nmea-vdm",
  };
}
