/**
 * AISStream snapshot ingest for the Point Judith canyon pack.
 *
 * Worker-only. The API key stays on the isolate (AISSTREAM_API_KEY secret).
 * Subscribe bbox is AISStream [[[lat, lon], [lat, lon]]]. Snapshot keeps
 * PositionReport plus Class B (Standard + Extended). Workers outbound WS
 * uses fetch+Upgrade+accept() (or new WebSocket + message events) so the
 * isolate actually reads frames. AISStream {error} text is a liveError.
 * Fail closed: missing key, websocket error, stream error, or zero useful
 * positions omit the overlay. Never invent tracks. Never log the key.
 *
 * Keep free of `@/` aliases so the ahanu-packs Worker can import it.
 */

import { encodeLayerBody, type PackBBox, type PackedJson } from "./pack-fixtures";

export const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
/** Class B around PJ often reports every 10–30 s; 10 s was an honest miss. */
export const AIS_SNAPSHOT_MS = 22_000;
export const AIS_SUBSCRIBE_DEADLINE_MS = 3_000;
export const AIS_MAX_MESSAGES = 400;
export const AIS_PACK_NOTE = "AISStream PositionReport + Class B snapshot";

/** AISStream FilterMessageTypes + parse set. Class B must stay subscribed. */
export const AIS_POSITION_MESSAGE_TYPES = [
  "PositionReport",
  "StandardClassBPositionReport",
  "ExtendedClassBPositionReport",
] as const;

const POSITION_TYPES = new Set<string>(AIS_POSITION_MESSAGE_TYPES);

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
  /** Workers fetch-upgrade sockets must accept() after listeners are attached. */
  accept?: () => void;
  needsAccept?: boolean;
  readyState?: number;
  binaryType?: string;
  on?: (type: string, fn: (ev: { data?: unknown }) => void) => void;
  onopen?: ((ev: { data?: unknown }) => void) | null;
  onmessage?: ((ev: { data?: unknown }) => void) | null;
  onerror?: ((ev: { data?: unknown }) => void) | null;
  onclose?: ((ev: { data?: unknown }) => void) | null;
}

export type OpenAisStream = (url: string) => AisStreamSocket | Promise<AisStreamSocket>;

const WS_OPEN = 1;

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
    FilterMessageTypes: [...AIS_POSITION_MESSAGE_TYPES],
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

function decodeBytes(data: ArrayBuffer | ArrayBufferView): string {
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  const v = data as ArrayBufferView;
  return new TextDecoder().decode(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
}

/** Sync text from a WS frame. Blob (Workers 2026-03-17+ binaryType) needs the async helper. */
export function socketMessageText(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) return decodeBytes(data);
  return null;
}

async function socketMessageTextAsync(data: unknown): Promise<string | null> {
  const sync = socketMessageText(data);
  if (sync != null) return sync;
  if (!data || typeof data !== "object") return null;
  const blob = data as { text?: () => Promise<string>; arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof blob.text === "function") {
    try {
      const t = await blob.text();
      return typeof t === "string" ? t : null;
    } catch {
      return null;
    }
  }
  if (typeof blob.arrayBuffer === "function") {
    try {
      return decodeBytes(await blob.arrayBuffer());
    } catch {
      return null;
    }
  }
  return null;
}

/** Official AISStream ErrorMessage: `{ "error": "Api Key Is Not Valid" }`. */
export function aisStreamErrorText(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const err = o.error ?? o.Error;
  if (typeof err !== "string") return undefined;
  const t = err.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 160) : undefined;
}

function publicAisError(text: string): string {
  return `ais: ${text} — live miss`;
}

function armSocket(socket: AisStreamSocket): void {
  try {
    if (socket.binaryType !== undefined) socket.binaryType = "arraybuffer";
  } catch {
    /* ignore */
  }
}

function acceptSocket(socket: AisStreamSocket): void {
  // Only fetch-upgrade sockets. accept() on a constructor client WS can
  // kill the receive pipeline and looks like 0 frames.
  if (socket.needsAccept !== true || typeof socket.accept !== "function") return;
  try {
    socket.accept();
  } catch {
    /* already accepted */
  }
}

function listen(
  socket: AisStreamSocket,
  type: "open" | "message" | "error" | "close",
  fn: (ev: { data?: unknown }) => void,
): void {
  try {
    socket.addEventListener(type, fn);
  } catch {
    /* ignore */
  }
  try {
    if (typeof socket.on === "function") socket.on(type, fn);
  } catch {
    /* ignore */
  }
  try {
    const prop =
      type === "open" ? "onopen" : type === "message" ? "onmessage" : type === "error" ? "onerror" : "onclose";
    socket[prop] = fn;
  } catch {
    /* ignore */
  }
}

function eventPayload(ev: unknown): unknown {
  if (typeof ev === "string" || ev instanceof ArrayBuffer || ArrayBuffer.isView(ev)) return ev;
  if (!ev || typeof ev !== "object") return ev;
  const o = ev as { data?: unknown; text?: unknown };
  if ("data" in o) return o.data;
  return ev;
}

function describePayload(raw: unknown): string {
  if (raw == null) return String(raw);
  if (typeof raw !== "object") return typeof raw;
  const name = (raw as { constructor?: { name?: string } }).constructor?.name;
  return name && name !== "Object" ? name : "object";
}

function workerFetchUpgradeAvailable(): boolean {
  return typeof (globalThis as { WebSocketPair?: unknown }).WebSocketPair === "function";
}

async function openAisStreamViaFetch(url: string): Promise<AisStreamSocket | undefined> {
  if (typeof fetch !== "function") return undefined;
  try {
    const resp = await fetch(url, { headers: { Upgrade: "websocket" } });
    const ws = (resp as Response & { webSocket?: (WebSocket & AisStreamSocket) | null }).webSocket;
    if (!ws) return undefined;
    armSocket(ws);
    ws.needsAccept = true;
    return ws;
  } catch {
    return undefined;
  }
}

async function defaultOpenAisStream(url: string): Promise<AisStreamSocket> {
  // Workers: fetch + Upgrade + accept() is the documented outbound read path.
  // Constructor is fallback (auto-accepted; do not accept() again).
  if (workerFetchUpgradeAvailable()) {
    const upgraded = await openAisStreamViaFetch(url);
    if (upgraded) return upgraded;
  }
  if (typeof WebSocket === "function") {
    const ws = new WebSocket(url) as unknown as AisStreamSocket;
    armSocket(ws);
    return ws;
  }
  throw new Error("websocket unavailable");
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
  let lastKind = "none";
  let streamEnded = false;
  let messageChain = Promise.resolve();
  let resolveEnded: () => void = () => {};
  const endedWait = new Promise<void>((resolve) => {
    resolveEnded = resolve;
  });

  try {
    const openedOrSocket = open(AISSTREAM_URL);
    // Sync openers must not yield — a microtask open/message would be missed.
    socket = openedOrSocket instanceof Promise ? await openedOrSocket : openedOrSocket;
  } catch {
    options.errors.push("ais: websocket failed — live miss");
    return undefined;
  }

  const finish = () => {
    streamEnded = true;
    resolveEnded();
  };

  const subscribe = () => {
    if (opened) return;
    opened = true;
    try {
      socket!.send(JSON.stringify(aisSubscribeMessage(key, options.bbox)));
    } catch {
      failed = "ais: subscribe failed — live miss";
    }
  };

  const handleMessage = async (ev: { data?: unknown } | string) => {
    if (messages >= maxMessages) return;
    messages += 1;
    const raw = eventPayload(ev);
    lastKind = describePayload(raw);
    const text = await socketMessageTextAsync(raw);
    if (!text) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    const streamErr = aisStreamErrorText(parsed);
    if (streamErr) {
      failed = publicAisError(streamErr);
      try {
        socket?.close();
      } catch {
        /* already closing */
      }
      finish();
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
      finish();
    }
  };

  const onMessage = (ev: { data?: unknown }) => {
    messageChain = messageChain.then(() => handleMessage(ev)).catch(() => {});
  };

  const openedWait = new Promise<void>((resolve) => {
    listen(socket!, "open", () => {
      subscribe();
      resolve();
    });
    listen(socket!, "message", onMessage);
    listen(socket!, "error", () => {
      if (!targets.size && !failed) failed = "ais: websocket failed — live miss";
      finish();
      resolve();
    });
    listen(socket!, "close", (ev) => {
      const code = (ev as { code?: number }).code;
      const reason = String((ev as { reason?: string }).reason ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
      if (!targets.size && !failed && (reason || (typeof code === "number" && code !== 1000))) {
        const bit = [typeof code === "number" ? String(code) : "", reason].filter(Boolean).join(" ");
        if (bit) failed = publicAisError(`websocket closed ${bit}`);
      }
      finish();
      resolve();
    });
  });

  // Listeners first, then accept() — otherwise the first AISStream error frame is dropped.
  acceptSocket(socket);
  if (socket.readyState === WS_OPEN) subscribe();

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

  await Promise.race([sleepMs(snapshotMs), endedWait]);
  await messageChain;
  try {
    socket.close();
  } catch {
    /* ignore */
  }

  if (!targets.size) {
    const frames = `${messages} frame${messages === 1 ? "" : "s"}`;
    const kind = lastKind !== "none" ? `, last=${lastKind}` : "";
    options.errors.push(failed ?? `ais: no positions in snapshot (${frames}${kind}) — live miss`);
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
