import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { createSocket } from "node:dgram";
import { annotateAis, fusePicture, radarToLatLon } from "../src/lib/sensors/fuse.ts";
import { parseGatewayPayload } from "../src/lib/sensors/gateway-json.ts";
import { connectNmeaTcp } from "../src/lib/sensors/nmea-tcp.ts";
import { AisLineSource } from "../src/lib/sensors/sources.ts";
import { listenUdpJson } from "../src/lib/sensors/udp-json.ts";
import { nmeaChecksum } from "../src/lib/ahanu/nmea.ts";
import { destination, haversineNm } from "../src/lib/ahanu/geo.ts";
import type { AisTarget } from "../src/lib/data/ais.ts";

const own = { lat: 41.2, lon: -71.4, sog: 7, cog: 90, heading: 90, depthM: 20 };

function target(partial: Partial<AisTarget> = {}): AisTarget {
  return {
    mmsi: "367000001",
    name: "Test",
    type: "fishing",
    lat: 41.21,
    lon: -71.4,
    cog: 90,
    sog: 6,
    heading: 90,
    lengthM: 12,
    destination: "",
    receivedAt: 1_000,
    ...partial,
  };
}

describe("sensor bus", () => {
  it("connects, streams, and disconnects the simulated AIS source", async () => {
    const src = new AisLineSource({
      mode: "sim",
      simFallback: false,
      wsUrl: "",
      simTargets: () => [target()],
      onStatus: () => {},
      onOwn: () => {},
    });
    await src.connect();
    const iter = src.stream()[Symbol.asyncIterator]();
    const frame = await iter.next();
    assert.equal(frame.done, false);
    if (frame.done) return;
    assert.equal(frame.value.kind, "ais");
    assert.equal(frame.value.provenance, "sim");
    assert.equal(frame.value.payload[0]?.name, "Test");
    await src.disconnect();
  });

  it("projects radar range/bearing with own-ship heading", () => {
    const ahead = radarToLatLon({ lat: 41, lon: -71, heading: 90 }, 1, 0);
    const expect = destination({ lat: 41, lon: -71 }, 90, 1);
    assert.ok(Math.abs(ahead.lat - expect.lat) < 1e-6);
    assert.ok(Math.abs(ahead.lon - expect.lon) < 1e-6);
    const right = radarToLatLon({ lat: 41, lon: -71, heading: 0 }, 2, 90);
    const expectE = destination({ lat: 41, lon: -71 }, 90, 2);
    assert.ok(haversineNm(right, expectE) < 0.01);
  });

  it("merges a radar return onto AIS by position and time, and leaves sonar off the picture", () => {
    const close = radarToLatLon(own, 0.05, 0);
    const ais = annotateAis([target({ lat: close.lat, lon: close.lon, receivedAt: 10_000 })], own, 10_000);
    const picture = fusePicture(
      ais,
      [
        {
          id: "near",
          rangeNm: 0.05,
          bearingDeg: 0,
          lat: close.lat,
          lon: close.lon,
          at: 10_000,
          strength: 0.5,
          provenance: "stub",
        },
        {
          id: "far",
          rangeNm: 8,
          bearingDeg: 180,
          lat: 40.5,
          lon: -71.4,
          at: 10_000,
          strength: 0.2,
          provenance: "stub",
        },
      ],
      10_000,
    );
    assert.equal(picture.ais[0]?.corroborated, true);
    assert.equal(picture.radarOnly.length, 1);
    assert.equal(picture.radarOnly[0]?.id, "far");
    assert.ok(picture.ais[0]?.cpaNm != null);
  });

  it("rejects a JSON target with no position", () => {
    const out = parseGatewayPayload(JSON.stringify({ mmsi: "1", name: "Nope" }), "ws-json");
    assert.equal(out[0]?.kind, "reject");
  });

  it("receives NMEA on TCP and never writes", async () => {
    const body = "AIVDM,1,1,,A,0,0";
    const line = `!${body}*${nmeaChecksum(body)}\r\n`;
    const server = createServer((sock) => {
      sock.write(line);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const lines: string[] = [];
    const handle = await connectNmeaTcp({
      host: "127.0.0.1",
      port,
      onLine: (l) => lines.push(l),
    });
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(handle.bytesWritten(), 0);
    assert.equal(lines.length, 1);
    assert.ok(lines[0]!.startsWith("!AIVDM"));
    await handle.disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("receives a UDP JSON datagram and never sends", async () => {
    const got: string[] = [];
    const ear = await listenUdpJson({
      port: 0,
      onPayload: (text) => got.push(text),
    });
    const sender = createSocket("udp4");
    const payload = JSON.stringify({
      mmsi: "338124011",
      name: "Quonnie",
      lat: 41.05,
      lon: -71.8,
      cog: 80,
      sog: 9,
      type: "pleasure",
    });
    await new Promise<void>((resolve, reject) => {
      sender.send(payload, ear.port(), "127.0.0.1", (err) => (err ? reject(err) : resolve()));
    });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(ear.bytesSent(), 0);
    assert.equal(got[0], payload);
    sender.close();
    await ear.disconnect();
  });
});
