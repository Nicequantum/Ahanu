/** JSON gateway payloads (WebSocket text or UDP datagram). No socket I/O. */

import type { AisShipType, AisTarget } from "@/lib/data/ais";
import type { SensorProvenance } from "@/lib/ahanu/types";

const TYPES = new Set<AisShipType>(["fishing", "tanker", "cargo", "pleasure", "tug"]);

export type GatewayIngest =
  | { kind: "nmea"; sentences: string[] }
  | { kind: "ais"; target: AisTarget }
  | { kind: "reject"; reason: string };

function asTarget(raw: Record<string, unknown>, provenance: SensorProvenance): AisTarget | null {
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  const mmsi = String(raw.mmsi ?? "");
  if (!mmsi || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const type = TYPES.has(raw.type as AisShipType) ? (raw.type as AisShipType) : "pleasure";
  const cog = Number(raw.cog);
  const sog = Number(raw.sog);
  const heading = Number(raw.heading);
  return {
    mmsi,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : mmsi,
    type,
    lat,
    lon,
    cog: Number.isFinite(cog) ? ((cog % 360) + 360) % 360 : 0,
    sog: Number.isFinite(sog) ? Math.max(0, sog) : 0,
    heading: Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : Number.isFinite(cog) ? cog : 0,
    lengthM: Number.isFinite(Number(raw.lengthM)) ? Number(raw.lengthM) : 0,
    destination: typeof raw.destination === "string" ? raw.destination : "",
    provenance,
    receivedAt: Date.now(),
  };
}

/** One websocket/UDP payload. Multiple NMEA lines may arrive in one chunk. */
export function parseGatewayPayload(text: string, provenance: SensorProvenance): GatewayIngest[] {
  const trimmed = text.trim();
  if (!trimmed) return [{ kind: "reject", reason: "empty" }];
  if (trimmed.startsWith("!") || trimmed.startsWith("$")) {
    const sentences = trimmed.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return [{ kind: "nmea", sentences }];
  }
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return [{ kind: "reject", reason: "not-json" }];
  }
  if (Array.isArray(json)) {
    const out: GatewayIngest[] = [];
    for (const item of json) {
      if (!item || typeof item !== "object") {
        out.push({ kind: "reject", reason: "bad-item" });
        continue;
      }
      const target = asTarget(item as Record<string, unknown>, provenance);
      if (!target) out.push({ kind: "reject", reason: "bad-target" });
      else out.push({ kind: "ais", target });
    }
    return out;
  }
  if (!json || typeof json !== "object") return [{ kind: "reject", reason: "bad-json" }];
  const obj = json as Record<string, unknown>;
  if (typeof obj.sentence === "string") return [{ kind: "nmea", sentences: [obj.sentence] }];
  if (Array.isArray(obj.sentences) && obj.sentences.every((s) => typeof s === "string")) {
    return [{ kind: "nmea", sentences: obj.sentences as string[] }];
  }
  if (obj.mmsi != null || obj.lat != null) {
    const target = asTarget(obj, provenance);
    if (!target) return [{ kind: "reject", reason: "bad-target" }];
    return [{ kind: "ais", target }];
  }
  return [{ kind: "reject", reason: "unknown-shape" }];
}
