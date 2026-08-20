import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const {
  buildFixturePack,
  evaluateReadyForOffshore,
  POINT_JUDITH_CANYON_BBOX,
  REQUIRED_OFFSHORE_LAYERS,
  sha256Hex,
} = await import("../src/lib/ahanu/pack.ts");
const { hashesMatch, generateLayerBody } = await import("../src/lib/ahanu/pack-fixtures.ts");
const { habitatScore } = await import("../src/lib/ahanu/scoring.ts");
const { sstC } = await import("../src/lib/ahanu/ocean.ts");
const { gribAt, scoreGoNoGo } = await import("../src/lib/ahanu/grib.ts");
const { packedOceanFromBodies, setPackedOcean, clearPackedOcean, samplePackedKind } = await import(
  "../src/lib/ahanu/packed-fields.ts"
);
const { VEATCH_HEAD, DEFAULT_BOAT } = await import("../src/lib/ahanu/constants.ts");

const DATE = new Date(2026, 7, 20, 12, 0, 0);
const START = "2026-08-20T12:00:00.000Z";

afterEach(() => {
  clearPackedOcean();
});

describe("fixture pack hashes", () => {
  it("SHA-256 is of the object body, not an identity string", async () => {
    const { manifest, bodies } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    assert.equal(manifest.layers.length, 12);
    for (const layer of manifest.layers) {
      const body = bodies[layer.id];
      assert.ok(body && body.length > 8, `${layer.id} empty`);
      const hash = await sha256Hex(body);
      assert.equal(hash, layer.hash, `${layer.id} hash mismatch`);
      const identity = `${layer.id}|bbox|cycle`;
      assert.notEqual(hash, await sha256Hex(identity));
    }
  });

  it("Point Judith 72h fixture is ready by construction", async () => {
    const { manifest, bodies } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    assert.equal(manifest.readyForOffshore, true);
    const evidence = manifest.layers.map((l) => ({
      id: l.id,
      present: true,
      hashExpected: l.hash,
      hashActual: l.hash,
      updatedAt: l.updatedAt,
      hoursCovered: l.hours || manifest.hours,
      cycleAt: manifest.generatedAt,
    }));
    const ready = evaluateReadyForOffshore({
      hours: 72,
      start: START,
      now: START,
      layers: evidence,
    });
    assert.equal(ready.ready, true, ready.failures.join("; "));
    for (const id of REQUIRED_OFFSHORE_LAYERS) {
      assert.ok(bodies[id], `missing required ${id}`);
    }
  });
});

describe("evaluateReadyForOffshore", () => {
  async function baseLayers() {
    const { manifest } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    return manifest.layers.map((l) => ({
      id: l.id,
      present: true,
      hashExpected: l.hash,
      hashActual: l.hash,
      updatedAt: l.updatedAt,
      hoursCovered: l.hours || 72,
      cycleAt: START,
    }));
  }

  it("fails when ENC is missing", async () => {
    const layers = await baseLayers();
    const enc = layers.find((l) => l.id === "enc")!;
    enc.present = false;
    const ready = evaluateReadyForOffshore({ hours: 72, start: START, now: START, layers });
    assert.equal(ready.ready, false);
    assert.ok(ready.failures.some((f) => f.startsWith("enc:")));
  });

  it("fails on hash mismatch", async () => {
    const layers = await baseLayers();
    const sst = layers.find((l) => l.id === "sst")!;
    sst.hashActual = "0".repeat(sst.hashExpected!.length);
    const ready = evaluateReadyForOffshore({ hours: 72, start: START, now: START, layers });
    assert.equal(ready.ready, false);
    assert.ok(ready.failures.some((f) => f.includes("hash")));
  });

  it("fails when hours < 72 without day-trip", async () => {
    const layers = await baseLayers();
    const ready = evaluateReadyForOffshore({ hours: 24, start: START, now: START, layers });
    assert.equal(ready.ready, false);
    assert.equal(ready.hoursOk, false);
  });

  it("fails when SST is older than 48 h", async () => {
    const layers = await baseLayers();
    const sst = layers.find((l) => l.id === "sst")!;
    sst.updatedAt = "2026-08-17T12:00:00.000Z";
    const ready = evaluateReadyForOffshore({
      hours: 72,
      start: START,
      now: "2026-08-20T12:00:00.000Z",
      layers,
    });
    assert.equal(ready.ready, false);
    assert.ok(ready.failures.some((f) => f.includes("SST")));
  });

  it("fails when wind cycle is older than 6 h", async () => {
    const layers = await baseLayers();
    const wind = layers.find((l) => l.id === "wind")!;
    wind.cycleAt = "2026-08-20T00:00:00.000Z";
    const ready = evaluateReadyForOffshore({
      hours: 72,
      start: START,
      now: "2026-08-20T12:00:00.000Z",
      layers,
    });
    assert.equal(ready.ready, false);
    assert.ok(ready.failures.some((f) => f.startsWith("wind:")));
  });

  it("does not block on missing chlorophyll", async () => {
    const layers = await baseLayers();
    const chl = layers.find((l) => l.id === "chlorophyll")!;
    chl.present = false;
    const ready = evaluateReadyForOffshore({ hours: 72, start: START, now: START, layers });
    assert.equal(ready.ready, true, ready.failures.join("; "));
    assert.ok(ready.warnings.some((w) => w.startsWith("chlorophyll")));
  });

  it("does not trust a worker boolean (ignored input)", async () => {
    const layers = await baseLayers();
    layers.find((l) => l.id === "enc")!.present = false;
    const ready = evaluateReadyForOffshore({ hours: 72, start: START, now: START, layers });
    assert.equal(ready.ready, false);
  });
});

describe("packed fields — on-device scoring", () => {
  it("samples fixture SST and scores habitat from the pack", async () => {
    const { bodies } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    setPackedOcean(packedOceanFromBodies(bodies));
    const packed = samplePackedKind("sst", VEATCH_HEAD.lat, VEATCH_HEAD.lon, 0);
    assert.ok(packed != null, "expected packed SST at Veatch");
    const sst = sstC(VEATCH_HEAD.lat, VEATCH_HEAD.lon, 0);
    assert.equal(sst, packed);
    const score = habitatScore(VEATCH_HEAD.lat, VEATCH_HEAD.lon, "bigeye", 2, DATE);
    assert.ok(score >= 0 && score <= 100);
    assert.ok(Number.isInteger(score));
  });

  it("go/no-go uses packed wind/wave when present", async () => {
    const { bodies } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    setPackedOcean(packedOceanFromBodies(bodies));
    const g0 = gribAt(VEATCH_HEAD.lat, VEATCH_HEAD.lon, 0);
    const g36 = gribAt(VEATCH_HEAD.lat, VEATCH_HEAD.lon, 36);
    assert.ok(g36.windKt > g0.windKt, `front ${g36.windKt} vs ${g0.windKt}`);
    assert.ok(g36.waveFt > g0.waveFt);
    const go = scoreGoNoGo(g0.windKt, g0.waveFt, DEFAULT_BOAT);
    assert.ok(go === "go" || go === "caution" || go === "no-go");
  });
});

describe("hashesMatch", () => {
  it("rejects different lengths", () => {
    assert.equal(hashesMatch("aa", "a"), false);
  });
  it("accepts equal hex", () => {
    assert.equal(hashesMatch("deadbeef", "deadbeef"), true);
  });
});

describe("generateLayerBody", () => {
  it("ENC fixture lists harbor coverage", () => {
    const body = generateLayerBody("enc", POINT_JUDITH_CANYON_BBOX, START, 72);
    assert.match(body, /Point Judith/);
    assert.match(body, /US5RI10M/);
  });
});

const { handlePacksRequest } = await import("../src/lib/ahanu/pack-http.ts");

describe("pack HTTP (preview/Worker shape)", () => {
  it("GET /api/packs with no query defaults to the Point Judith canyon box", async () => {
    const res = await handlePacksRequest(new Request("http://ahanu.test/api/packs"));
    assert.equal(res.status, 200);
    const manifest = (await res.json()) as { bbox: { west: number; south: number; east: number; north: number }; hours: number };
    assert.deepEqual(manifest.bbox, { west: -72.8, south: 39.4, east: -68.8, north: 41.5 });
    assert.equal(manifest.hours, 72);
  });

  it("GET /api/packs then GET /api/objects verifies hash", async () => {
    const q = "west=-72.8&south=39.4&east=-68.8&north=41.5&hours=72&start=2026-08-20T12:00:00.000Z";
    const manRes = await handlePacksRequest(new Request("http://ahanu.test/api/packs?" + q));
    assert.equal(manRes.status, 200);
    const manifest = (await manRes.json()) as { layers: { id: string; hash: string }[]; readyForOffshore: boolean };
    assert.equal(manifest.readyForOffshore, true);
    const sst = manifest.layers.find((l) => l.id === "sst");
    assert.ok(sst);
    const objRes = await handlePacksRequest(new Request("http://ahanu.test/api/objects?" + q + "&layer=sst"));
    assert.equal(objRes.status, 200);
    const body = await objRes.text();
    const hash = await sha256Hex(body);
    assert.equal(hash, sst!.hash);
  });

  it("POST /api/catches without bearer is 401", async () => {
    const res = await handlePacksRequest(
      new Request("http://ahanu.test/api/catches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "catch_x",
          species: "bigeye",
          lat: 39.9,
          lon: -69.6,
          at: START,
          released: false,
        }),
      }),
    );
    assert.equal(res.status, 401);
  });
});
