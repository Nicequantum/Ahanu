import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const {
  parseAisStreamMessage,
  aisSubscribeMessage,
  aisStreamBbox,
  aisTargetsToPackedJson,
  fetchLiveAis,
  aisStreamErrorText,
  socketMessageText,
  AISSTREAM_URL,
  AIS_SNAPSHOT_MS,
  AIS_POSITION_MESSAGE_TYPES,
} = await import("../src/lib/ahanu/ais-live.ts");
const { buildFixturePack, buildTripPack, evaluateReadyForOffshore, LIVE_OVERLAY_LAYER_IDS, POINT_JUDITH_CANYON_BBOX } =
  await import("../src/lib/ahanu/pack.ts");
const { parseLayerBody } = await import("../src/lib/ahanu/pack-fixtures.ts");
const { packedOceanFromBodies, setPackedOcean, clearPackedOcean } = await import("../src/lib/ahanu/packed-fields.ts");
const { layerPaintSource } = await import("../src/lib/ahanu/layer-status.ts");
const { aisForChart, aisHelmLabel, livePackedAis } = await import("../src/lib/ahanu/packed-chart.ts");
const { LAYER_META } = await import("../src/lib/ahanu/constants.ts");
const { DEMO_AIS_MMSIS, aisTargets } = await import("../src/lib/data/ais.ts");
const { resetLiveNoaaCache } = await import("../src/lib/ahanu/noaa-live.ts");

const START = "2026-08-20T12:00:00.000Z";
const BOX = POINT_JUDITH_CANYON_BBOX;

afterEach(() => {
  clearPackedOcean();
  resetLiveNoaaCache();
});

function positionEnvelope(input: {
  mmsi: number | string;
  lat: number;
  lon: number;
  sog?: number;
  cog?: number;
  heading?: number;
  name?: string;
  type?: string;
}) {
  const type = input.type ?? "PositionReport";
  return {
    MessageType: type,
    MetaData: {
      MMSI: typeof input.mmsi === "number" ? input.mmsi : Number(input.mmsi),
      ShipName: input.name ?? "",
      latitude: input.lat,
      longitude: input.lon,
    },
    Message: {
      [type]: {
        UserID: typeof input.mmsi === "number" ? input.mmsi : Number(input.mmsi),
        Latitude: input.lat,
        Longitude: input.lon,
        Sog: input.sog,
        Cog: input.cog,
        TrueHeading: input.heading,
      },
    },
  };
}

function mockOpen(
  messages: unknown[],
  opts?: {
    error?: boolean;
    neverOpen?: boolean;
    alreadyOpen?: boolean;
    asBlob?: boolean;
    close?: { code?: number; reason?: string };
    onAccept?: () => void;
    onSend?: () => void;
  },
) {
  return () => {
    const listeners: Record<string, Array<(ev: { data?: unknown }) => void>> = {
      open: [],
      message: [],
      error: [],
      close: [],
    };
    const frame = (m: unknown) => {
      const json = JSON.stringify(m);
      if (opts?.asBlob && typeof Blob === "function") return new Blob([json], { type: "application/json" });
      return json;
    };
    const sock = {
      readyState: opts?.alreadyOpen ? 1 : 0,
      needsAccept: true,
      send(_data: string) {
        opts?.onSend?.();
      },
      close() {
        for (const fn of listeners.close) fn({});
      },
      accept() {
        opts?.onAccept?.();
      },
      addEventListener(type: string, fn: (ev: { data?: unknown }) => void) {
        (listeners[type] ?? []).push(fn);
      },
    };
    queueMicrotask(() => {
      if (opts?.neverOpen) return;
      if (opts?.error) {
        for (const fn of listeners.error) fn({});
        return;
      }
      if (!opts?.alreadyOpen) {
        for (const fn of listeners.open) fn({});
      }
      for (const m of messages) {
        for (const fn of listeners.message) fn({ data: frame(m) });
      }
      if (opts?.close) {
        for (const fn of listeners.close) fn(opts.close);
      }
    });
    return sock;
  };
}

function packHasDemoMmsi(bodies: Record<string, string>): string[] {
  const blob = Object.values(bodies).join("\n");
  return DEMO_AIS_MMSIS.filter((m) => blob.includes(m));
}

describe("AISStream parse", () => {
  it("packs last-known PositionReport and Class B", () => {
    const a = parseAisStreamMessage(
      positionEnvelope({ mmsi: 366999111, lat: 40.2, lon: -71.1, sog: 8.4, cog: 175, heading: 176, name: "EXAMPLE" }),
    );
    assert.ok(a);
    assert.equal(a.mmsi, "366999111");
    assert.equal(a.lat, 40.2);
    assert.equal(a.lon, -71.1);
    assert.equal(a.sog, 8.4);
    assert.equal(a.name, "EXAMPLE");
    const b = parseAisStreamMessage(
      positionEnvelope({
        mmsi: "338000222",
        lat: 39.9,
        lon: -70.2,
        sog: 6,
        cog: 90,
        heading: 91,
        type: "StandardClassBPositionReport",
      }),
    );
    assert.ok(b);
    assert.equal(b.mmsi, "338000222");
    const ext = parseAisStreamMessage(
      positionEnvelope({
        mmsi: "338000333",
        lat: 41.2,
        lon: -71.5,
        sog: 4.5,
        cog: 250,
        heading: 248,
        type: "ExtendedClassBPositionReport",
        name: "CLASS B",
      }),
    );
    assert.ok(ext);
    assert.equal(ext.mmsi, "338000333");
    assert.equal(ext.name, "CLASS B");
    assert.equal(parseAisStreamMessage({ MessageType: "ShipStaticData", MetaData: {}, Message: {} }), null);
    assert.equal(parseAisStreamMessage({ MessageType: "PositionReport", MetaData: {}, Message: {} }), null);
  });

  it("subscribe bbox is AISStream [[lat,lon],[lat,lon]] corners", () => {
    const corners = aisStreamBbox(BOX);
    assert.deepEqual(corners, [
      [39.4, -72.8],
      [41.5, -68.8],
    ]);
    const sub = aisSubscribeMessage("test-key", BOX);
    assert.equal(sub.APIKey, "test-key");
    assert.deepEqual(sub.BoundingBoxes, [corners]);
    assert.deepEqual(sub.BoundingBoxes, [[[39.4, -72.8], [41.5, -68.8]]]);
    assert.deepEqual([...sub.FilterMessageTypes], [...AIS_POSITION_MESSAGE_TYPES]);
    assert.ok(sub.FilterMessageTypes.includes("PositionReport"));
    assert.ok(sub.FilterMessageTypes.includes("StandardClassBPositionReport"));
    assert.ok(sub.FilterMessageTypes.includes("ExtendedClassBPositionReport"));
    assert.ok(AIS_SNAPSHOT_MS >= 20_000 && AIS_SNAPSHOT_MS <= 25_000);
    assert.equal(AISSTREAM_URL, "wss://stream.aisstream.io/v0/stream");
  });
});

describe("fetchLiveAis fail-closed", () => {
  it("missing key does not open a socket and invents nothing", async () => {
    const errors: string[] = [];
    let opened = 0;
    const hit = await fetchLiveAis({
      bbox: BOX,
      errors,
      openSocket: () => {
        opened += 1;
        throw new Error("should not open");
      },
    });
    assert.equal(hit, undefined);
    assert.equal(opened, 0);
    assert.ok(errors.some((e) => e.startsWith("ais:") && /missing/i.test(e)));
    assert.ok(!errors.join(" ").includes("test-key"));
  });

  it("websocket error is a miss", async () => {
    const errors: string[] = [];
    const hit = await fetchLiveAis({
      bbox: BOX,
      apiKey: "test-key",
      errors,
      snapshotMs: 5,
      subscribeDeadlineMs: 20,
      openSocket: mockOpen([], { error: true }),
    });
    assert.equal(hit, undefined);
    assert.ok(errors.some((e) => e.startsWith("ais:")));
  });

  it("zero useful positions is a miss", async () => {
    const errors: string[] = [];
    const hit = await fetchLiveAis({
      bbox: BOX,
      apiKey: "test-key",
      errors,
      snapshotMs: 15,
      subscribeDeadlineMs: 20,
      openSocket: mockOpen([{ MessageType: "ShipStaticData", MetaData: {}, Message: {} }]),
    });
    assert.equal(hit, undefined);
    assert.ok(errors.some((e) => /no positions/i.test(e) && /1 frame/.test(e)));
  });

  it("websocket close reason is a liveError", async () => {
    const errors: string[] = [];
    const hit = await fetchLiveAis({
      bbox: BOX,
      apiKey: "test-key",
      errors,
      snapshotMs: 30,
      subscribeDeadlineMs: 20,
      openSocket: mockOpen([], { close: { code: 1008, reason: "Api Key Is Not Valid" } }),
    });
    assert.equal(hit, undefined);
    assert.ok(errors.some((e) => /1008/.test(e) && /Api Key Is Not Valid/i.test(e)));
    assert.ok(!errors.join(" ").includes("test-key"));
  });

  it("AISStream error frame is a liveError and invents nothing", async () => {
    const errors: string[] = [];
    const hit = await fetchLiveAis({
      bbox: BOX,
      apiKey: "test-key",
      errors,
      snapshotMs: 30,
      subscribeDeadlineMs: 20,
      openSocket: mockOpen([{ error: "Api Key Is Not Valid" }]),
    });
    assert.equal(hit, undefined);
    assert.ok(errors.some((e) => /Api Key Is Not Valid/i.test(e) && e.startsWith("ais:")));
    assert.ok(!errors.join(" ").includes("test-key"));
    assert.equal(aisStreamErrorText({ error: "Api Key Is Not Valid" }), "Api Key Is Not Valid");
    assert.equal(aisStreamErrorText({ MessageType: "PositionReport" }), undefined);
  });

  it("Blob frames are read (Workers binaryType default)", async () => {
    const errors: string[] = [];
    const env = positionEnvelope({ mmsi: 366333000, lat: 40.2, lon: -71.0, sog: 8, cog: 100 });
    const hit = await fetchLiveAis({
      bbox: BOX,
      apiKey: "test-key",
      errors,
      snapshotMs: 30,
      subscribeDeadlineMs: 20,
      openSocket: mockOpen([env], { asBlob: true }),
    });
    assert.ok(hit);
    assert.equal(hit.targetCount, 1);
    const buf = new TextEncoder().encode(JSON.stringify(env));
    assert.ok(socketMessageText(buf.buffer) != null);
  });

  it("accept() after listeners; already-open socket still subscribes", async () => {
    const errors: string[] = [];
    let accepted = 0;
    let sent = 0;
    const hit = await fetchLiveAis({
      bbox: BOX,
      apiKey: "test-key",
      errors,
      snapshotMs: 25,
      subscribeDeadlineMs: 20,
      openSocket: mockOpen(
        [positionEnvelope({ mmsi: 366444000, lat: 40.3, lon: -71.2, sog: 6, cog: 90 })],
        { alreadyOpen: true, onAccept: () => { accepted += 1; }, onSend: () => { sent += 1; } },
      ),
    });
    assert.ok(hit);
    assert.equal(hit.targetCount, 1);
    assert.equal(accepted, 1);
    assert.equal(sent, 1);
  });

  it("unique MMSI last-known packs live bytes", async () => {
    const errors: string[] = [];
    const hit = await fetchLiveAis({
      bbox: BOX,
      apiKey: "test-key",
      errors,
      snapshotMs: 20,
      subscribeDeadlineMs: 20,
      openSocket: mockOpen([
        positionEnvelope({ mmsi: 366111000, lat: 40.1, lon: -71.2, sog: 7, cog: 180, heading: 181, name: "LIVE ONE" }),
        positionEnvelope({ mmsi: 366111000, lat: 40.11, lon: -71.21, sog: 7.2, cog: 182, heading: 183, name: "LIVE ONE" }),
        positionEnvelope({ mmsi: 366222000, lat: 39.8, lon: -70.0, sog: 12, cog: 90 }),
        positionEnvelope({
          mmsi: 338111000,
          lat: 41.15,
          lon: -71.48,
          sog: 5,
          cog: 200,
          type: "ExtendedClassBPositionReport",
        }),
      ]),
    });
    assert.ok(hit);
    assert.equal(hit.targetCount, 3);
    assert.equal(hit.source, "aisstream");
    const body = JSON.stringify(hit.body);
    assert.ok(body.includes("366111000"));
    assert.ok(body.includes("40.11"));
    assert.ok(!body.includes("367812041"));
    assert.ok(!DEMO_AIS_MMSIS.some((m) => body.includes(m)));
  });
});

describe("pack AIS layer", () => {
  it("fixture AIS is empty — no invented MMSIs — and does not block Ready", async () => {
    const { manifest, bodies } = await buildFixturePack({
      bbox: BOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    assert.ok(manifest.layers.some((l) => l.id === "ais"));
    const ais = manifest.layers.find((l) => l.id === "ais")!;
    assert.equal(ais.source, "fixture");
    assert.ok(!/demo/i.test(ais.label) || ais.label === "AIS");
    assert.deepEqual(packHasDemoMmsi(bodies), []);
    const parsed = parseLayerBody(bodies.ais!);
    assert.ok(parsed && "payload" in parsed);
    const features = (parsed.payload as { features?: unknown[] }).features;
    assert.ok(Array.isArray(features));
    assert.equal(features.length, 0);
    assert.equal(LIVE_OVERLAY_LAYER_IDS.includes("ais"), true);
    const evidence = manifest.layers.map((l) => ({
      id: l.id,
      present: true,
      hashExpected: l.hash,
      hashActual: l.hash,
      updatedAt: l.updatedAt,
      hoursCovered: l.hours || 72,
      cycleAt: START,
    }));
    const ready = evaluateReadyForOffshore({ hours: 72, start: START, now: START, layers: evidence });
    assert.equal(ready.ready, true, ready.failures.join("; "));
    assert.equal(ready.layers.find((l) => l.id === "ais")?.required, false);
  });

  it("tryLive without key fail-closes AIS and never packs demo MMSIs", async () => {
    const built = await buildTripPack({
      bbox: BOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      skipCache: true,
      aisSnapshotMs: 5,
      fetchImpl: async () => new Response("no", { status: 404 }),
    });
    assert.ok((built.manifest.liveErrors ?? []).some((e) => e.startsWith("ais:")));
    assert.deepEqual(packHasDemoMmsi(built.bodies), []);
    const ais = built.manifest.layers.find((l) => l.id === "ais")!;
    assert.equal(ais.source, "fixture");
    setPackedOcean(packedOceanFromBodies(built.bodies));
    assert.equal(layerPaintSource("ais"), "missing");
    assert.equal(livePackedAis(), null);
    const painted = aisForChart(0, 0);
    assert.equal(painted.features.length, 0);
    assert.ok(!/demo/i.test(aisHelmLabel()));
  });

  it("live overlay paints packed AIS and never calls aisTargets", async () => {
    const live = aisTargetsToPackedJson([
      { mmsi: "366888000", name: "LIVE PACK", lat: 40.05, lon: -71.15, sog: 9, cog: 200, heading: 201 },
    ]);
    const { encodeLayerBody } = await import("../src/lib/ahanu/pack-fixtures.ts");
    const { manifest, bodies } = await buildFixturePack({
      bbox: BOX,
      start: START,
      hours: 72,
      createdAt: START,
      overlays: { ais: encodeLayerBody(live) },
    });
    const ais = manifest.layers.find((l) => l.id === "ais")!;
    assert.equal(ais.source, "noaa");
    assert.equal(ais.label, "AIS · AISStream");
    assert.ok(!/demo/i.test(ais.label));
    assert.deepEqual(packHasDemoMmsi(bodies), []);
    setPackedOcean(packedOceanFromBodies(bodies, "noaa"));
    assert.equal(layerPaintSource("ais"), "packed");
    assert.equal(aisHelmLabel(), "AIS · AISStream");
    assert.ok(!/demo/i.test(aisHelmLabel()));
    assert.equal(LAYER_META.ais.label, "AIS");
    assert.ok(!/demo/i.test(LAYER_META.ais.label));
    const painted = aisForChart(1_000, 3);
    assert.equal(painted.features.length, 1);
    assert.equal((painted.features[0]!.properties as { mmsi?: string }).mmsi, "366888000");
    const demo = aisTargets(1_000, 3);
    assert.equal(demo.length, 14);
    assert.ok(!painted.features.some((f) => DEMO_AIS_MMSIS.includes(String((f.properties as { mmsi?: string }).mmsi))));
  });

  it("no pack never paints the demo fleet", () => {
    assert.equal(layerPaintSource("ais"), "missing");
    assert.equal(LAYER_META.ais.label, "AIS");
    assert.ok(!/demo/i.test(LAYER_META.ais.label));
    assert.equal(aisHelmLabel(), "AIS");
    assert.ok(!/demo/i.test(aisHelmLabel()));
    const painted = aisForChart(0, 0);
    assert.equal(painted.features.length, 0);
    const demo = aisTargets(0, 0);
    assert.equal(demo.length, 14);
    assert.ok(DEMO_AIS_MMSIS.length === 14);
  });
});
