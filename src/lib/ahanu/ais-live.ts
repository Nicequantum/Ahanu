/**
 * AISStream snapshot ingest for the Point Judith canyon pack.
 *
 * Worker-only. The API key stays on the isolate (AISSTREAM_API_KEY secret).
 * Fail closed: missing key, websocket error, or zero useful positions
 * omit the overlay. Never invent tracks. Never log the key.
 *
 * Keep free of `@/` aliases so the ahanu-packs Worker can import it.
 */

import { encodeLayerBody, type PackBBox, type PackedJson } from "./pack-fixtures";

export const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
export const AIS_SNAPSHOT_MS = 10_000;
export const AIS_SUBSCRIBE_DEADLINE_MS = 3_000;
export const AIS_MAX_MESSAGES = 400;
export const AIS_PACK_NOTE = "AISStream PositionReport snapshot";

const POSITION_TYPES = new Set([
  "PositionReport",
  "StandardClassBPositionReport",
  "ExtendedClassBPositionReport",
]);

export interface AisPackedTarget {
  mmsi: string;
  name?: string;
  lat: number;
  lon: number;
  sog?: number;
  cog?: number;
  heading?: number;
}

export interface AisIngest {
  live: true;
  source: "aisstream";
  note: string;
  targetCount: number;
  body: PackedJson;
}

export interface AisStreamSocket {
  send: (data: string) => void;
  close: () => void;
  addEventListener: (
    type: "open" | "message" | "error" | "close",
    fn: (ev: { data?: unknown }) => void,
  ) => void;
}

export type OpenAisStream = (url: string) => AisStreamSocket;

export function aisStreamBbox(bbox: PackBBox): [[number, number], [number, number]] {
  return [
    [bbox.south, bbox.west],
    [bbox.north, bbox.east],
  ];
}

/** Subscribe body. Caller supplies the key — never log this object. */
export function aisSubscribeMessage(apiKey: string, bbox: PackBBox): {
  APIKey: string;
  BoundingBoxes: [[number, number], [number, number]][];
  FilterMessageTypes: string[];
} {
  return {
    APIKey: apiKey,
    BoundingBoxes: [aisStreamBbox(bbox)],
    FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport"],
  };
}

function finite(n: unknown): number | undefined {
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  return n;
}

function mmsiOf(raw: unknown): string | undefined {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return String(Math.trunc(raw));
  if (typeof raw === "string") {
    const t = raw.trim();
    if (/^\d{5,9}$/.test(t)) return t;
  }
  return undefined;
}

function nameOf(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  return t && t !== "@@@@@@@@@@@@@@@@@@@@" ? t : undefined;
}

function headingOf(n: number | undefined): number | undefined {
  if (n == null) return undefined;
  if (n < 0 || n > 360 || n === 511) return undefined;
  return n;
}

function sogOf(n: number | undefined): number | undefined {
  if (n == null) return undefined;
  if (n < 0 || n >= 102.2) return undefined;
  return n;
}

function cogOf(n: number | undefined): number | undefined {
  if (n == null) return undefined;
  if (n < 0 || n >= 360) return undefined;
  return n;
}

function inRange(lat: number, lon: number): boolean {
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && !(lat === 0 && lon === 0);
}

function reportOf(envelope: Record<string, unknown>): Record<string, unknown> | undefined {
  const typed = envelope.MessageType;
  const message = envelope.Message;
  if (!message || typeof message !== "object") return undefined;
  const bag = message as Record<string, unknown>;
  if (typeof typed === "string" && bag[typed] && typeof bag[typed] === "object") {
    return bag[typed] as Record<string, unknown>;
  }
  for (const key of POSITION_TYPES) {
    if (bag[key] && typeof bag[key] === "object") return bag[key] as Record<string, unknown>;
  }
  return undefined;
}

/** Last-known position from an AISStream envelope. Null if not a useful position. */
export function parseAisStreamMessage(raw: unknown): AisPackedTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const envelope = raw as Record<string, unknown>;
  const typed = envelope.MessageType;
  if (typeof typed === "string" && typed && !POSITION_TYPES.has(typed)) return null;
  const meta = envelope.MetaData && typeof envelope.MetaData === "object"
    ? (envelope.MetaData as Record<string, unknown>)
    : {};
  const report = reportOf(envelope) ?? {};
  const mmsi = mmsiOf(report.UserID) ?? mmsiOf(meta.MMSI) ?? mmsiOf(meta.MMSI_String);
  if (!mmsi) return null;
  const lat = finite(report.Latitude) ?? finite(meta.latitude);
  const lon = finite(report.Longitude) ?? finite(meta.longitude);
  if (lat == null || lon == null || !inRange(lat, lon)) return null;
  const out: AisPackedTarget = { mmsi, lat, lon };
  const name = nameOf(meta.ShipName) ?? nameOf(report.Name);
  if (name) out.name = name;
  const sog = sogOf(finite(report.Sog));
  if (sog != null) out.sog = sog;
  const cog = cogOf(finite(report.Cog));
  if (cog != null) out.cog = cog;
  const heading = headingOf(finite(report.TrueHeading) ?? finite(report.Heading));
  if (heading != null) out.heading = heading;
  return out;
}

export function mergeAisTargets(into: Map<string, AisPackedTarget>, next: AisPackedTarget): void {
  into.set(next.mmsi, next);
}

export function aisTargetsToPackedJson(targets: AisPackedTarget[], note = AIS_PACK_NOTE): PackedJson {
  return {
    kind: "geojson",
    layer: "ais",
    payload: {
      type: "FeatureCollection",
      live: true,
      fixture: false,
      source: "aisstream",
      note,
      features: targets.map((t) => ({
        type: "Feature",
        properties: {
          mmsi: t.mmsi,
          ...(t.name ? { name: t.name } : {}),
          ...(t.sog != null ? { sog: t.sog } : {}),
          ...(t.cog != null ? { cog: t.cog } : {}),
          ...(t.heading != null ? { heading: t.heading } : {}),
        },
        geometry: { type: "Point", coordinates: [t.lon, t.lat] },
      })),
    },
  };
}

export function packedAisTargetCount(body: PackedJson | undefined): number {
  if (!body || !("payload" in body) || !body.payload || typeof body.payload !== "object") return 0;
  const features = (body.payload as { features?: unknown[] }).features;
  return Array.isArray(features) ? features.length : 0;
}

function socketMessageText(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    const v = data as ArrayBufferView;
    return new TextDecoder().decode(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  }
  return null;
}

function defaultOpenAisStream(url: string): AisStreamSocket {
  if (typeof WebSocket !== "function") {
    throw new Error("websocket unavailable");
  }
  return new WebSocket(url) as unknown as AisStreamSocket;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Short AISStream snapshot. Fail closed — never invent positions.
 * Does not throw. Does not log the API key.
 */
export async function fetchLiveAis(options: {
  bbox: PackBBox;
  apiKey?: string;
  errors: string[];
  openSocket?: OpenAisStream;
  snapshotMs?: number;
  maxMessages?: number;
  subscribeDeadlineMs?: number;
}): Promise<AisIngest | undefined> {
  const key = (options.apiKey ?? "").trim();
  if (!key) {
    options.errors.push("ais: AISSTREAM_API_KEY missing — live miss");
    return undefined;
  }
  const snapshotMs = options.snapshotMs ?? AIS_SNAPSHOT_MS;
  const maxMessages = options.maxMessages ?? AIS_MAX_MESSAGES;
  const subscribeDeadlineMs = options.subscribeDeadlineMs ?? AIS_SUBSCRIBE_DEADLINE_MS;
  const open = options.openSocket ?? defaultOpenAisStream;
  const targets = new Map<string, AisPackedTarget>();
  let socket: AisStreamSocket | undefined;
  let opened = false;
  let failed: string | undefined;
  let messages = 0;

  try {
    socket = open(AISSTREAM_URL);
  } catch {
    options.errors.push("ais: websocket failed — live miss");
    return undefined;
  }

  const onMessage = (ev: { data?: unknown }) => {
    if (messages >= maxMessages) return;
    const text = socketMessageText(ev.data);
    if (!text) return;
    messages += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    const hit = parseAisStreamMessage(parsed);
    if (hit) mergeAisTargets(targets, hit);
    if (messages >= maxMessages && socket) {
      try {
        socket.close();
      } catch {
        /* already closing */
      }
    }
  };

  const openedWait = new Promise<void>((resolve) => {
    socket!.addEventListener("open", () => {
      opened = true;
      try {
        socket!.send(JSON.stringify(aisSubscribeMessage(key, options.bbox)));
      } catch {
        failed = "ais: subscribe failed — live miss";
      }
      resolve();
    });
    socket!.addEventListener("message", onMessage);
    socket!.addEventListener("error", () => {
      if (!targets.size) failed = "ais: websocket failed — live miss";
      resolve();
    });
    socket!.addEventListener("close", () => {
      resolve();
    });
  });

  const openedOrTimeout = Promise.race([openedWait, sleepMs(subscribeDeadlineMs)]);
  await openedOrTimeout;
  if (!opened) {
    try {
      socket.close();
    } catch {
      /* ignore */
    }
    options.errors.push(failed ?? "ais: websocket failed — live miss");
    return undefined;
  }
  if (failed && !targets.size) {
    try {
      socket.close();
    } catch {
      /* ignore */
    }
    options.errors.push(failed);
    return undefined;
  }

  await sleepMs(snapshotMs);
  try {
    socket.close();
  } catch {
    /* ignore */
  }

  if (!targets.size) {
    options.errors.push(failed ?? "ais: no positions in snapshot — live miss");
    return undefined;
  }

  const list = [...targets.values()];
  const body = aisTargetsToPackedJson(list);
  return {
    live: true,
    source: "aisstream",
    note: `${AIS_PACK_NOTE} (${list.length} target${list.length === 1 ? "" : "s"})`,
    targetCount: list.length,
    body,
  };
}

export function encodeLiveAis(ingest: AisIngest): string {
  return encodeLayerBody(ingest.body);
}

export {
  encodeLayerBody,
};
