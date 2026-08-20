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

  it("fails stale SST without skipper override", async () => {
    const layers = await baseLayers();
    const sst = layers.find((l) => l.id === "sst")!;
    sst.updatedAt = "2026-08-19T06:00:00.000Z";
    const ready = evaluateReadyForOffshore({
      hours: 72,
      start: START,
      now: "2026-08-20T12:00:00.000Z",
      layers,
    });
    assert.equal(ready.ready, false);
    assert.equal(ready.sstOverrideUsed, false);
    const sstLayer = ready.layers.find((l) => l.id === "sst")!;
    assert.equal(sstLayer.fresh, false);
    assert.equal(sstLayer.ok, false);
    assert.ok(ready.failures.some((f) => f.includes("SST") && f.includes("24")));
  });

  it("passes stale SST with skipper override and warns", async () => {
    const layers = await baseLayers();
    const sst = layers.find((l) => l.id === "sst")!;
    sst.updatedAt = "2026-08-19T06:00:00.000Z";
    const ready = evaluateReadyForOffshore({
      hours: 72,
      start: START,
      now: "2026-08-20T12:00:00.000Z",
      sstOverride: true,
      layers,
    });
    assert.equal(ready.ready, true, ready.failures.join("; "));
    assert.equal(ready.sstOverrideUsed, true);
    const sstLayer = ready.layers.find((l) => l.id === "sst")!;
    assert.equal(sstLayer.present, true);
    assert.equal(sstLayer.hashOk, true);
    assert.equal(sstLayer.fresh, false);
    assert.equal(sstLayer.ok, true);
    assert.ok(ready.warnings.some((w) => w.includes("skipper override")));
    assert.equal(ready.failures.length, 0);
  });

  it("passes present 48 h SST with override and still warns", async () => {
    const layers = await baseLayers();
    const sst = layers.find((l) => l.id === "sst")!;
    sst.updatedAt = "2026-08-18T11:00:00.000Z";
    const ready = evaluateReadyForOffshore({
      hours: 72,
      start: START,
      now: "2026-08-20T12:00:00.000Z",
      sstOverride: true,
      layers,
    });
    assert.equal(ready.ready, true, ready.failures.join("; "));
    assert.equal(ready.sstOverrideUsed, true);
    assert.equal(ready.layers.find((l) => l.id === "sst")!.fresh, false);
    assert.ok(ready.warnings.some((w) => w.includes("skipper override")));
  });

  it("still fails missing SST even with override", async () => {
    const layers = await baseLayers();
    const sst = layers.find((l) => l.id === "sst")!;
    sst.present = false;
    sst.hashActual = undefined;
    const ready = evaluateReadyForOffshore({
      hours: 72,
      start: START,
      now: START,
      sstOverride: true,
      layers,
    });
    assert.equal(ready.ready, false);
    assert.equal(ready.sstOverrideUsed, false);
    assert.ok(ready.failures.some((f) => f.startsWith("sst:") && f.includes("missing")));
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

  it("GET /api/packs stays fixture unless live=1", async () => {
    const q = "west=-72.8&south=39.4&east=-68.8&north=41.5&hours=72&start=2026-08-20T12:00:00.000Z";
    const fix = await handlePacksRequest(new Request("http://ahanu.test/api/packs?" + q));
    const live = await handlePacksRequest(
      new Request("http://ahanu.test/api/packs?" + q + "&live=1"),
      {
        fetchImpl: async (url: string) => {
          if (url.includes("latest_obs")) {
            return new Response(
              `#STN LAT LON YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES PTDY ATMP WTMP DEWP VIS TIDE
44097 40.967 -71.126 26 08 20 16 40 210 5.2 6.8 1.0 8 5.4 200 1016.5 +0.0 22.1 21.8 MM MM MM
`,
              { status: 200 },
            );
          }
          return new Response("no", { status: 404 });
        },
      },
    );
    assert.equal(fix.status, 200);
    assert.equal(live.status, 200);
    const fixMan = (await fix.json()) as { layers: { id: string; hash: string; source: string }[] };
    const liveMan = (await live.json()) as { layers: { id: string; hash: string; source: string }[] };
    assert.equal(fixMan.layers.find((l) => l.id === "buoys")!.source, "fixture");
    assert.equal(liveMan.layers.find((l) => l.id === "buoys")!.source, "noaa");
    assert.notEqual(fixMan.layers.find((l) => l.id === "buoys")!.hash, liveMan.layers.find((l) => l.id === "buoys")!.hash);
    assert.equal(fixMan.layers.find((l) => l.id === "sst")!.hash, liveMan.layers.find((l) => l.id === "sst")!.hash);
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

const { packQuery, downloadTripPack } = await import("../src/lib/ahanu/pack-client.ts");
const { resetPackMemory } = await import("../src/lib/ahanu/pack-store.ts");

describe("packQuery live flag", () => {
  const bbox = { west: -72.8, south: 39.4, east: -68.8, north: 41.5 };

  it("omits live unless requested", () => {
    const q = new URLSearchParams(packQuery(bbox, START, 72));
    assert.equal(q.get("live"), null);
    assert.equal(q.get("hours"), "72");
  });

  it("sets live=1 when requested", () => {
    const q = new URLSearchParams(packQuery(bbox, START, 72, { live: true }));
    assert.equal(q.get("live"), "1");
  });
});

describe("downloadTripPack live query", () => {
  afterEach(() => {
    resetPackMemory();
  });

  async function stubDownload(live: boolean): Promise<string[]> {
    const { manifest, bodies } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const urls: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/api/packs")) {
        return new Response(JSON.stringify(manifest), { status: 200 });
      }
      const layer = new URL(url).searchParams.get("layer") ?? "";
      const body = bodies[layer];
      if (!body) return new Response("missing", { status: 404 });
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    try {
      await downloadTripPack({
        bbox: POINT_JUDITH_CANYON_BBOX,
        start: START,
        hours: 72,
        base: "http://ahanu.test",
        live,
        now: START,
      });
    } finally {
      globalThis.fetch = orig;
    }
    return urls;
  }

  it("requests packs and objects with live=1 when live is on", async () => {
    const urls = await stubDownload(true);
    assert.ok(urls.some((u) => u.includes("/api/packs?") && u.includes("live=1")));
    assert.ok(urls.some((u) => u.includes("/api/objects?") && u.includes("live=1")));
  });

  it("keeps fixture download without live", async () => {
    const urls = await stubDownload(false);
    assert.ok(urls.some((u) => u.includes("/api/packs?")));
    assert.ok(urls.every((u) => !u.includes("live=")));
  });
});
