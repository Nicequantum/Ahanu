import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const {
  buildFixturePack,
  evaluateReadyForOffshore,
  hashedPackCount,
  PACK_BUILDER_REV,
  POINT_JUDITH_CANYON_BBOX,
  REQUIRED_OFFSHORE_LAYERS,
  sha256Hex,
  sstStaleReadyCue,
  sstHelmLine,
  sstLandedName,
  sstPackRowLabel,
  SST_STALE_FLIP_COPY,
  landedPackSources,
  landedPackNotes,
  landedProductSources,
  encSourceName,
  leftoverFixtureSources,
  leftoverMurNotes,
  leftoverMurSstLabel,
  leftoverNdfdWindLabel,
  rewriteLandedManifest,
  windPackRowLabel,
} = await import("../src/lib/ahanu/pack.ts");
const { tripPackLayersFromReady } = await import("../src/lib/ahanu/pack-client.ts");
const { GFS_HOUR0_FIXTURE_NOTE } = await import("../src/lib/ahanu/noaa-gfs-merge.ts");
const { hashesMatch, generateLayerBody, encodeLayerBody } = await import("../src/lib/ahanu/pack-fixtures.ts");
const { habitatScore } = await import("../src/lib/ahanu/scoring.ts");
const { sstC } = await import("../src/lib/ahanu/ocean.ts");
const { gribAt, scoreGoNoGo } = await import("../src/lib/ahanu/grib.ts");
const { packedOceanFromBodies, setPackedOcean, clearPackedOcean, samplePackedKind } =
  await import("../src/lib/ahanu/packed-fields.ts");
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
    assert.equal(manifest.layers.length, 13);
    assert.equal(PACK_BUILDER_REV, "ais-ws-read-2026-08-21");
    assert.equal(manifest.builder.rev, PACK_BUILDER_REV);
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

  it("does not block on missing altimetry", async () => {
    const layers = await baseLayers();
    const ssh = layers.find((l) => l.id === "altimetry")!;
    ssh.present = false;
    const ready = evaluateReadyForOffshore({ hours: 72, start: START, now: START, layers });
    assert.equal(ready.ready, true, ready.failures.join("; "));
    assert.ok(ready.warnings.some((w) => w.startsWith("altimetry")));
  });

  it("fails when wind and waves have no coverage", async () => {
    const layers = await baseLayers();
    const wind = layers.find((l) => l.id === "wind")!;
    const waves = layers.find((l) => l.id === "waves")!;
    wind.hoursCovered = 0;
    waves.hoursCovered = 0;
    const ready = evaluateReadyForOffshore({ hours: 72, start: START, now: START, layers });
    assert.equal(ready.ready, false);
    assert.ok(ready.failures.some((f) => f.startsWith("wind:") && f.includes("0 h")));
    assert.ok(ready.failures.some((f) => f.startsWith("waves:") && f.includes("0 h")));
  });

  it("does not trust a worker boolean (ignored input)", async () => {
    const layers = await baseLayers();
    layers.find((l) => l.id === "enc")!.present = false;
    const ready = evaluateReadyForOffshore({ hours: 72, start: START, now: START, layers });
    assert.equal(ready.ready, false);
  });
});

describe("sstStaleReadyCue", () => {
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

  it("highlights when the only Ready failure is SST age", async () => {
    const layers = await baseLayers();
    const sst = layers.find((l) => l.id === "sst")!;
    sst.updatedAt = "2026-08-19T00:00:00.000Z";
    const ready = evaluateReadyForOffshore({
      hours: 72,
      start: START,
      now: "2026-08-20T12:00:00.000Z",
      layers,
    });
    assert.equal(ready.ready, false);
    const cue = sstStaleReadyCue(ready);
    assert.equal(cue.highlight, true);
    assert.equal(cue.line, `SST is 36 h old — ${SST_STALE_FLIP_COPY}`);
    assert.match(cue.line ?? "", /Accept stale SST to pass Ready/);
  });

  it("still highlights SST age plus optional-layer warnings", async () => {
    const layers = await baseLayers();
    layers.find((l) => l.id === "sst")!.updatedAt = "2026-08-19T00:00:00.000Z";
    layers.find((l) => l.id === "chlorophyll")!.present = false;
    const ready = evaluateReadyForOffshore({
      hours: 72,
      start: START,
      now: "2026-08-20T12:00:00.000Z",
      layers,
    });
    assert.equal(ready.ready, false);
    assert.ok(ready.warnings.some((w) => w.startsWith("chlorophyll")));
    const cue = sstStaleReadyCue(ready);
    assert.equal(cue.highlight, true);
    assert.match(cue.line ?? "", /SST is 36 h old/);
  });

  it("does not offer just-flip copy when SST is missing", async () => {
    const layers = await baseLayers();
    const sst = layers.find((l) => l.id === "sst")!;
    sst.present = false;
    sst.hashActual = undefined;
    const ready = evaluateReadyForOffshore({ hours: 72, start: START, now: START, layers });
    const cue = sstStaleReadyCue(ready);
    assert.equal(cue.highlight, false);
    assert.equal(cue.line, null);
    assert.doesNotMatch(JSON.stringify(cue), /Accept stale SST to pass Ready/);
  });

  it("does not offer just-flip copy on SST hash mismatch", async () => {
    const layers = await baseLayers();
    const sst = layers.find((l) => l.id === "sst")!;
    sst.hashActual = "0".repeat(sst.hashExpected!.length);
    const ready = evaluateReadyForOffshore({ hours: 72, start: START, now: START, layers });
    const cue = sstStaleReadyCue(ready);
    assert.equal(cue.highlight, false);
    assert.equal(cue.line, null);
    assert.doesNotMatch(JSON.stringify(cue), /Accept stale SST to pass Ready/);
  });

  it("does not highlight when weather hours also fail", async () => {
    const layers = await baseLayers();
    layers.find((l) => l.id === "sst")!.updatedAt = "2026-08-19T00:00:00.000Z";
    layers.find((l) => l.id === "wind")!.hoursCovered = 1;
    const ready = evaluateReadyForOffshore({
      hours: 72,
      start: START,
      now: "2026-08-20T12:00:00.000Z",
      layers,
    });
    assert.ok(ready.failures.some((f) => f.startsWith("wind:")));
    const cue = sstStaleReadyCue(ready);
    assert.equal(cue.highlight, false);
    assert.equal(cue.line, null);
  });

  it("does not highlight after skipper override makes Ready", async () => {
    const layers = await baseLayers();
    layers.find((l) => l.id === "sst")!.updatedAt = "2026-08-19T00:00:00.000Z";
    const ready = evaluateReadyForOffshore({
      hours: 72,
      start: START,
      now: "2026-08-20T12:00:00.000Z",
      sstOverride: true,
      layers,
    });
    assert.equal(ready.ready, true);
    const cue = sstStaleReadyCue(ready);
    assert.equal(cue.highlight, false);
    assert.equal(cue.line, null);
  });

  it("live pack with only GFS_HOUR0_FIXTURE_NOTE is Ready unless SST is stale", async () => {
    const { manifest } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      liveErrors: [GFS_HOUR0_FIXTURE_NOTE],
    });
    assert.deepEqual(manifest.liveErrors, [GFS_HOUR0_FIXTURE_NOTE]);
    assert.equal(manifest.readyForOffshore, true);

    const layers = manifest.layers.map((l) => ({
      id: l.id,
      present: true,
      hashExpected: l.hash,
      hashActual: l.hash,
      updatedAt: l.updatedAt,
      hoursCovered: l.hours || 72,
      cycleAt: START,
    }));
    const ready = evaluateReadyForOffshore({
      hours: 72,
      start: START,
      now: START,
      layers,
      liveErrors: [GFS_HOUR0_FIXTURE_NOTE],
    });
    assert.equal(ready.ready, true, ready.failures.join("; "));
    assert.ok(!ready.failures.some((f) => /gfs|hour-0|series off/i.test(f)));

    const staleSst = layers.map((l) =>
      l.id === "sst" ? { ...l, updatedAt: "2026-08-19T00:00:00.000Z" } : l,
    );
    const stale = evaluateReadyForOffshore({
      hours: 72,
      start: START,
      now: "2026-08-20T12:00:00.000Z",
      layers: staleSst,
      liveErrors: [GFS_HOUR0_FIXTURE_NOTE],
    });
    assert.equal(stale.ready, false);
    assert.ok(stale.failures.some((f) => f.includes("SST")));
    assert.ok(!stale.failures.some((f) => /gfs|hour-0|series off/i.test(f)));
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
    const manifest = (await res.json()) as {
      bbox: { west: number; south: number; east: number; north: number };
      hours: number;
      builder: { rev: string };
    };
    assert.deepEqual(manifest.bbox, { west: -72.8, south: 39.4, east: -68.8, north: 41.5 });
    assert.equal(manifest.hours, 72);
    assert.equal(manifest.builder.rev, PACK_BUILDER_REV);
  });

  it("GET /api/packs then GET /api/objects verifies hash", async () => {
    const q = "west=-72.8&south=39.4&east=-68.8&north=41.5&hours=72&start=2026-08-20T12:00:00.000Z";
    const manRes = await handlePacksRequest(new Request("http://ahanu.test/api/packs?" + q));
    assert.equal(manRes.status, 200);
    const manifest = (await manRes.json()) as {
      layers: { id: string; hash: string }[];
      readyForOffshore: boolean;
      builder: { rev: string };
    };
    assert.equal(manifest.readyForOffshore, true);
    assert.equal(manifest.builder.rev, PACK_BUILDER_REV);
    const sst = manifest.layers.find((l) => l.id === "sst");
    assert.ok(sst);
    const objRes = await handlePacksRequest(
      new Request("http://ahanu.test/api/objects?" + q + "&layer=sst"),
    );
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
    const liveMan = (await live.json()) as {
      layers: { id: string; hash: string; source: string }[];
    };
    assert.equal(fixMan.layers.find((l) => l.id === "buoys")!.source, "fixture");
    assert.equal(liveMan.layers.find((l) => l.id === "buoys")!.source, "noaa");
    assert.notEqual(
      fixMan.layers.find((l) => l.id === "buoys")!.hash,
      liveMan.layers.find((l) => l.id === "buoys")!.hash,
    );
    assert.equal(
      fixMan.layers.find((l) => l.id === "sst")!.hash,
      liveMan.layers.find((l) => l.id === "sst")!.hash,
    );
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

  it("sets skipCache=1 only when requested", () => {
    const off = new URLSearchParams(packQuery(bbox, START, 72, { live: true }));
    assert.equal(off.get("skipCache"), null);
    const on = new URLSearchParams(packQuery(bbox, START, 72, { live: true, skipCache: true }));
    assert.equal(on.get("skipCache"), "1");
    assert.equal(on.get("live"), "1");
  });
});

describe("downloadTripPack live query", () => {
  afterEach(() => {
    resetPackMemory();
  });

  async function stubDownload(live: boolean, skipCache = false): Promise<string[]> {
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
        skipCache,
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

  it("helm live download omits skipCache so Worker can serve last R2 persist", async () => {
    const urls = await stubDownload(true);
    assert.ok(urls.some((u) => u.includes("/api/packs?") && u.includes("live=1")));
    assert.ok(
      urls.filter((u) => u.includes("/api/packs?")).every((u) => !u.includes("skipCache=")),
      "Download 72h must not force skipCache",
    );
    const objects = urls.filter((u) => u.includes("/api/objects?"));
    assert.ok(objects.length > 0);
    assert.ok(objects.every((u) => u.includes("live=1") && !u.includes("skipCache=")));
    assert.ok(objects.every((u) => u.includes("packId=")), "objects must pin the pack just hashed");
    assert.ok(objects.every((u) => u.includes("hash=")), "objects must pin the stored layer hash");
  });

  it("keeps fixture download without live", async () => {
    const urls = await stubDownload(false);
    assert.ok(urls.some((u) => u.includes("/api/packs?")));
    assert.ok(urls.every((u) => !u.includes("live=")));
  });

  it("retry skipCache re-requests live packs", async () => {
    const first = await stubDownload(true, false);
    const retry = await stubDownload(true, true);
    assert.ok(first.some((u) => u.includes("/api/packs?") && u.includes("live=1") && !u.includes("skipCache=")));
    assert.ok(retry.some((u) => u.includes("/api/packs?") && u.includes("live=1") && u.includes("skipCache=1")));
    const objectRetries = retry.filter((u) => u.includes("/api/objects?"));
    assert.ok(objectRetries.length > 0);
    assert.ok(objectRetries.every((u) => !u.includes("skipCache=")));
  });
});


const {
  capLiveErrors,
  canRetryLiveOverlays,
  isSstHonestyLiveError,
  sstLayerIsStale,
  liveErrorsForSession,
  blockingLiveErrors,
  gfsHelmLine,
  isHonestyLiveError,
  LIVE_ERROR_CAP,
} = await import("../src/lib/ahanu/pack.ts");

describe("live ingest errors on pack session", () => {
  it("caps honest lines and stays empty when live is off", () => {
    assert.equal(LIVE_ERROR_CAP, 12);
    assert.deepEqual(liveErrorsForSession({ live: false, errors: ["sst: fetch failed"] }), []);
    assert.deepEqual(liveErrorsForSession({ live: true, overlayLanded: true, errors: ["sst mur: fetch failed"] }), []);
    const prefer = "sst: preferred noaacwLEOACSPOSSTL3SnrtKDaily lost (timeout) — using jplMURSST41";
    assert.deepEqual(
      liveErrorsForSession({ live: true, overlayLanded: true, errors: ["sst mur: fetch failed", prefer] }),
      [prefer],
    );
    assert.equal(isHonestyLiveError(prefer), true);
    const hiddenSst = liveErrorsForSession({
      live: true,
      overlayLanded: false,
      errors: [],
      missingOverlayIds: ["sst", "chlorophyll"],
    });
    assert.ok(hiddenSst.some((e) => e.startsWith("sst")), hiddenSst.join(" | "));
    const many = Array.from({ length: 12 }, (_, i) => `sst path ${i}: fetch failed`);
    const capped = capLiveErrors(many);
    assert.equal(capped.length, 12);
    assert.equal(capped[0], "sst path 0: fetch failed");
    assert.equal(capped[11], "sst path 11: fetch failed");
  });

  it("enables retry when live is on and a live layer is still fixture", () => {
    assert.equal(
      canRetryLiveOverlays({
        live: true,
        downloading: false,
        layers: [{ id: "sst", source: "fixture" }],
        liveErrors: [],
      }),
      true,
    );
    assert.equal(
      canRetryLiveOverlays({
        live: true,
        downloading: false,
        layers: [{ id: "canyons", source: "fixture" }, { id: "sst", source: "noaa" }],
        liveErrors: [],
      }),
      true,
    );
    assert.equal(
      canRetryLiveOverlays({
        live: true,
        downloading: false,
        layers: [{ id: "not-a-layer", source: "fixture" }, { id: "sst", source: "noaa" }],
        liveErrors: [],
      }),
      false,
    );
    assert.equal(
      canRetryLiveOverlays({
        live: true,
        downloading: false,
        layers: [{ id: "sst", source: "noaa" }],
        liveErrors: ["sst: all public paths failed — fixture kept"],
      }),
      true,
    );
    assert.equal(
      canRetryLiveOverlays({
        live: false,
        downloading: false,
        layers: [{ id: "sst", source: "fixture" }],
        liveErrors: ["sst: fetch failed"],
      }),
      false,
    );
    assert.equal(
      canRetryLiveOverlays({
        live: true,
        downloading: true,
        layers: [{ id: "sst", source: "fixture" }],
        liveErrors: ["sst: fetch failed"],
      }),
      false,
    );
    assert.equal(isHonestyLiveError(GFS_HOUR0_FIXTURE_NOTE), true);
    assert.equal(
      isHonestyLiveError("gfs: hours 0,3,6 live; remaining hours through 72 fixture (series incomplete)"),
      true,
    );
    assert.equal(
      isHonestyLiveError("gfs: 20260820 18z hours 0–54 live; remaining hours through 72 fixture (series incomplete)"),
      true,
    );
    assert.equal(isHonestyLiveError("sst: fetch failed"), false);
    assert.deepEqual(blockingLiveErrors([GFS_HOUR0_FIXTURE_NOTE, "sst: fetch failed"]), [
      "sst: fetch failed",
    ]);
    assert.equal(
      canRetryLiveOverlays({
        live: true,
        downloading: false,
        layers: [
          { id: "sst", source: "noaa" },
          { id: "wind", source: "noaa" },
          { id: "waves", source: "noaa" },
        ],
        liveErrors: [GFS_HOUR0_FIXTURE_NOTE],
      }),
      false,
    );
  });

  it("enables retry when not ready or SST is stale", () => {
    const nowMs = Date.parse("2026-08-21T06:18:00.000Z");
    const mur = "2026-08-19T09:00:00.000Z";
    assert.equal(
      canRetryLiveOverlays({
        live: true,
        downloading: false,
        layers: [{ id: "sst", source: "noaa", updatedAt: mur }],
        liveErrors: [],
        ready: false,
        nowMs,
      }),
      true,
    );
    assert.equal(
      canRetryLiveOverlays({
        live: true,
        downloading: false,
        layers: [{ id: "sst", source: "r2", updatedAt: mur }],
        liveErrors: [],
        ready: true,
        nowMs,
      }),
      true,
    );
    assert.equal(sstLayerIsStale({ updatedAt: mur }, nowMs), true);
    assert.equal(sstLayerIsStale({ updatedAt: "2026-08-20T12:00:00.000Z" }, nowMs), false);
    assert.equal(sstLayerIsStale({ }, nowMs), false);
    assert.equal(
      canRetryLiveOverlays({
        live: true,
        downloading: false,
        layers: [{ id: "sst", source: "noaa", updatedAt: "2026-08-20T12:00:00.000Z" }],
        liveErrors: [],
        ready: true,
        nowMs,
      }),
      false,
    );
    assert.equal(
      isSstHonestyLiveError("sst: live refresh failed (timeout) — kept MUR 2026-08-19T09:00:00.000Z"),
      true,
    );
  });

  it("enables retry when SST is stale even if Live NOAA is off", () => {
    const nowMs = Date.parse("2026-08-21T14:45:00.000Z");
    const acspo = "2026-08-20T12:00:00.000Z";
    assert.equal(sstLayerIsStale({ updatedAt: acspo }, nowMs), true);
    assert.equal(
      canRetryLiveOverlays({
        live: false,
        downloading: false,
        layers: [{ id: "sst", source: "noaa", updatedAt: acspo }],
        liveErrors: [],
        ready: false,
        nowMs,
      }),
      true,
    );
    assert.equal(
      canRetryLiveOverlays({
        live: false,
        downloading: false,
        layers: [{ id: "sst", source: "noaa", updatedAt: acspo }],
        liveErrors: [],
        ready: true,
        nowMs,
      }),
      true,
    );
    assert.equal(
      canRetryLiveOverlays({
        live: false,
        downloading: false,
        layers: [{ id: "sst", source: "fixture" }],
        liveErrors: ["sst: fetch failed"],
      }),
      false,
    );
    assert.equal(
      canRetryLiveOverlays({
        live: false,
        downloading: true,
        layers: [{ id: "sst", source: "noaa", updatedAt: acspo }],
        ready: false,
        nowMs,
      }),
      false,
    );
  });
});

describe("sstHelmLine", () => {
  it("names MUR, age, and subsampled resolution without claiming 1 km", () => {
    const line = sstHelmLine({
      source: "noaa",
      dataset: "jplMURSST41",
      updatedAt: "2026-08-19T09:00:00.000Z",
      note: "JPL MUR L4 (ERDDAP) subsampled to ~0.02° (stride 2) — not native 1 km / 0.01°. 201×106 at 2026-08-19T09:00:00.000Z.",
      nowMs: Date.parse("2026-08-21T01:00:00.000Z"),
    });
    assert.match(line, /SST MUR/);
    assert.match(line, /noaa/);
    assert.match(line, /40 h/);
    assert.match(line, /stale/);
    assert.match(line, /2026-08-19T09:00:00Z/);
    assert.match(line, /stride 2/);
    assert.match(line, /not native 1 km/);
    assert.doesNotMatch(line, /native 1 km MUR/);
    assert.doesNotMatch(line, /ACSPO/);
  });

  it("names ACSPO when that grid landed and does not claim MUR", () => {
    const line = sstHelmLine({
      source: "noaa",
      dataset: "noaacwLEOACSPOSSTL3SnrtKDaily",
      updatedAt: "2026-08-20T12:00:00.000Z",
      note: "NOAA ACSPO L3S-LEO NRT daily 2 km / 0.02° — not 1 km MUR / GHRSST L4. 93×51 at 2026-08-20T12:00:00.000Z.",
      nowMs: Date.parse("2026-08-21T06:00:00.000Z"),
    });
    assert.match(line, /SST ACSPO/);
    assert.match(line, /18 h/);
    assert.match(line, /fresh/);
    assert.doesNotMatch(line, /^SST MUR/);
    assert.equal(sstLandedName("noaacwLEOACSPOSSTL3SnrtKDaily", line), "ACSPO");
  });

  it("names GeoPolar and CoralTemp from the landed id", () => {
    assert.match(
      sstHelmLine({
        source: "noaa",
        dataset: "noaacwBLENDEDsstDNDaily",
        updatedAt: "2026-08-19T12:00:00.000Z",
        nowMs: Date.parse("2026-08-21T06:00:00.000Z"),
      }),
      /SST GeoPolar/,
    );
    assert.match(
      sstHelmLine({
        source: "noaa",
        dataset: "noaacrwsstDaily",
        updatedAt: "2026-08-19T12:00:00.000Z",
        nowMs: Date.parse("2026-08-21T06:00:00.000Z"),
      }),
      /SST CoralTemp/,
    );
  });

  it("does not invent freshness when analysis time is missing", () => {
    const line = sstHelmLine({
      source: "noaa",
      dataset: "noaacwLEOACSPOSSTL3SnrtKDaily",
      nowMs: Date.parse("2026-08-21T06:00:00.000Z"),
    });
    assert.match(line, /SST ACSPO/);
    assert.match(line, /age unknown/);
    assert.doesNotMatch(line, /\bfresh\b/);
    assert.doesNotMatch(line, /\d+ h/);
  });

  it("does not invent live NOAA on a fixture layer", () => {
    const line = sstHelmLine({
      source: "fixture",
      updatedAt: START,
      nowMs: Date.parse(START),
    });
    assert.equal(line, "SST fixture — not live NOAA.");
  });
});

describe("sstPackRowLabel", () => {
  it("names the landed product and remaps leftover MUR catalog copy", () => {
    assert.equal(sstPackRowLabel({ source: "fixture" }), "SST composite (fixture)");
    assert.equal(
      sstPackRowLabel({
        source: "noaa",
        dataset: "noaacwLEOACSPOSSTL3SnrtKDaily",
        stored: "SST composite (MUR / CoastWatch)",
      }),
      "SST ACSPO",
    );
    assert.equal(sstPackRowLabel({ source: "noaa", dataset: "jplMURSST41" }), "SST MUR");
    assert.equal(sstPackRowLabel({ source: "noaa", dataset: "noaacwBLENDEDsstDNDaily" }), "SST GeoPolar");
    assert.equal(sstPackRowLabel({ source: "noaa", dataset: "noaacrwsstDaily" }), "SST CoralTemp");
    assert.equal(
      sstPackRowLabel({
        source: "noaa",
        note: "NOAA ACSPO L3S-LEO NRT daily 2 km / 0.02° — not 1 km MUR / GHRSST L4.",
        stored: "SST composite (MUR / CoastWatch)",
      }),
      "SST ACSPO",
    );
    assert.doesNotMatch(
      sstPackRowLabel({ source: "noaa", dataset: "noaacwLEOACSPOSSTL3SnrtKDaily" }),
      /MUR/,
    );
  });

  it("writes the landed name on the fixture-pack row, not the MUR catalog label", async () => {
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    assert.equal(fixture.manifest.layers.find((l) => l.id === "sst")!.label, "SST composite (fixture)");
    assert.doesNotMatch(fixture.manifest.layers.find((l) => l.id === "sst")!.label, /MUR/);

    const overlay = encodeLayerBody({
      kind: "grid",
      layer: "sst",
      bbox: POINT_JUDITH_CANYON_BBOX,
      nx: 2,
      ny: 2,
      hours: [0],
      hoursCovered: 24,
      unit: "degC",
      values: [[20, 21, 22, 23]],
      live: true,
      source: "noaa",
      updatedAt: "2026-08-20T12:00:00.000Z",
      dataset: "noaacwLEOACSPOSSTL3SnrtKDaily",
      note: "NOAA ACSPO L3S-LEO NRT daily 2 km / 0.02° — not 1 km MUR / GHRSST L4.",
    });
    const live = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      overlays: { sst: overlay },
    });
    const sst = live.manifest.layers.find((l) => l.id === "sst")!;
    assert.equal(sst.source, "noaa");
    assert.equal(sst.label, "SST ACSPO");
    assert.doesNotMatch(sst.label, /MUR/);
    const sstSrc = live.manifest.sources.find((s) => s.id === "noaa-sst");
    assert.ok(sstSrc);
    assert.match(sstSrc.name, /ACSPO/);
    assert.doesNotMatch(sstSrc.name, /GHRSST \/ CoastWatch SST/);
    assert.match(live.manifest.notes, /ACSPO/);
    const products = live.manifest.landedSources ?? [];
    assert.ok(products.some((s) => s.id === "noaa-sst" && /ACSPO/.test(s.name)));
    assert.ok(!products.some((s) => s.id === "ghrsst-coastwatch-sst"));
  });
});

describe("windPackRowLabel", () => {
  it("names GFS-Wave and remaps leftover NDFD catalog copy", () => {
    assert.equal(leftoverNdfdWindLabel("NDFD oceanic + GFS-Wave wind GRIB"), true);
    assert.equal(leftoverNdfdWindLabel("GFS-Wave wind"), false);
    assert.equal(windPackRowLabel({ source: "fixture" }), "GFS-Wave wind (fixture)");
    assert.equal(
      windPackRowLabel({
        source: "noaa",
        stored: "NDFD oceanic + GFS-Wave wind GRIB",
        note: "GFS-Wave 20260821 06z f000–f072 / 3 h parsed series (72 h)",
      }),
      "GFS-Wave wind",
    );
    assert.equal(
      windPackRowLabel({
        source: "noaa",
        stored: "NDFD oceanic + GFS-Wave wind GRIB",
      }),
      "GFS-Wave wind",
    );
    assert.doesNotMatch(
      windPackRowLabel({ source: "noaa", stored: "NDFD oceanic + GFS-Wave wind GRIB" }),
      /NDFD/,
    );
  });

  it("writes GFS-Wave on the fixture-pack row, not leftover NDFD", async () => {
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const fixtureWind = fixture.manifest.layers.find((l) => l.id === "wind")!;
    assert.equal(fixtureWind.label, "GFS-Wave wind (fixture)");
    assert.doesNotMatch(fixtureWind.label, /NDFD/);

    const overlay = encodeLayerBody({
      kind: "grid",
      layer: "wind",
      bbox: POINT_JUDITH_CANYON_BBOX,
      nx: 2,
      ny: 2,
      hours: [0, 3],
      hoursCovered: 72,
      unit: "kt",
      values: [[1, 2, 3, 4], [2, 3, 4, 5]],
      live: true,
      source: "noaa",
      updatedAt: START,
      note: "GFS-Wave 20260821 06z f000–f072 / 3 h parsed series (72 h)",
    });
    const live = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      overlays: { wind: overlay },
    });
    const wind = live.manifest.layers.find((l) => l.id === "wind")!;
    assert.equal(wind.source, "noaa");
    assert.equal(wind.label, "GFS-Wave wind");
    assert.doesNotMatch(wind.label, /NDFD/);
  });

  it("rewriteLandedManifest replaces a leftover NDFD label from a GFS-Wave body", () => {
    const overlay = encodeLayerBody({
      kind: "grid",
      layer: "wind",
      bbox: POINT_JUDITH_CANYON_BBOX,
      nx: 2,
      ny: 2,
      hours: [0],
      hoursCovered: 72,
      unit: "kt",
      values: [[1, 2, 3, 4]],
      live: true,
      source: "noaa",
      updatedAt: START,
      note: "GFS-Wave 20260821 06z f000–f072 / 3 h parsed series (72 h)",
    });
    const next = rewriteLandedManifest(
      {
        sources: [{ id: "nws-ndfd", name: "NDFD oceanic" }],
        layers: [{ id: "wind", label: "NDFD oceanic + GFS-Wave wind GRIB", source: "noaa" }],
      },
      { wind: overlay },
    );
    assert.equal(next.layers.find((l) => l.id === "wind")?.label, "GFS-Wave wind");
    assert.doesNotMatch(next.layers.find((l) => l.id === "wind")?.label ?? "", /NDFD/);
    assert.ok(!next.sources.some((s) => s.id === "nws-ndfd"));
  });

  it("rewriteLandedManifest remaps leftover NDFD without a wind overlay", () => {
    const next = rewriteLandedManifest(
      {
        sources: [],
        layers: [{ id: "wind", label: "NDFD oceanic + GFS-Wave wind GRIB", source: "noaa" }],
      },
      {},
    );
    assert.equal(next.layers.find((l) => l.id === "wind")?.label, "GFS-Wave wind");
    assert.doesNotMatch(next.layers.find((l) => l.id === "wind")?.label ?? "", /NDFD/);
  });
});

describe("landedPackSources", () => {
  it("drops the static ingest catalog and names the landed SST", () => {
    const sources = landedPackSources({
      sources: [
        { id: "ghrsst-coastwatch-sst", name: "GHRSST / CoastWatch SST" },
        { id: "ncep-gfswave", name: "NCEP GFS-Wave / WAVEWATCH III" },
        { id: "noaa-sst", name: "NOAA ACSPO L3S-LEO NRT daily 2 km / 0.02° — not 1 km MUR / GHRSST L4." },
        { id: "nomads-gfswave", name: "GFS-Wave 20260820 18z f000–f072 / 3 h parsed series (72 h)" },
      ],
      layers: [{ id: "sst", label: "SST ACSPO", source: "noaa" }],
    });
    assert.ok(!sources.some((s) => s.id === "ghrsst-coastwatch-sst"));
    assert.ok(!sources.some((s) => s.id === "ncep-gfswave"));
    const sst = sources.find((s) => s.id === "noaa-sst");
    assert.match(sst?.name ?? "", /ACSPO/);
    assert.doesNotMatch(sst?.name ?? "", /^GHRSST/);
    const gfs = sources.find((s) => s.id === "nomads-gfswave");
    assert.match(gfs?.name ?? "", /20260820 18z/);
    assert.match(gfs?.name ?? "", /f000–f072/);
  });

  it("reconstructs ACSPO from the pack row when sources are catalog-only", () => {
    const sources = landedPackSources({
      sources: [{ id: "ghrsst-coastwatch-sst", name: "GHRSST / CoastWatch SST" }],
      layers: [{ id: "sst", label: "SST ACSPO", source: "noaa" }],
    });
    assert.equal(sources.find((s) => s.id === "noaa-sst")?.name, "SST ACSPO");
    assert.ok(!sources.some((s) => s.id === "ghrsst-coastwatch-sst"));
  });

  it("names official ENC cells and updates from the extra source, not the catalog string", () => {
    const note =
      "Official NOAA S-57 (16 cells, 9 update files). Exchange set update files (ISO 8211): US5RI1BD edition 3 update 1 (1 file).";
    const sources = landedPackSources({
      sources: [
        { id: "noaa-enc", name: "NOAA Electronic Navigational Charts (S-57 / S-101)" },
        { id: "noaa-enc", name: note },
      ],
      layers: [{ id: "enc", label: "NOAA ENC (official S-57)", source: "noaa" }],
    });
    const enc = sources.find((s) => s.id === "noaa-enc");
    assert.match(enc?.name ?? "", /official/i);
    assert.match(enc?.name ?? "", /16 cells/);
    assert.match(enc?.name ?? "", /update/);
    assert.doesNotMatch(enc?.name ?? "", /S-57 \/ S-101/);
  });

  it("does not invent an SST product on fixture layers", () => {
    const sources = landedProductSources({
      sources: [{ id: "fixture", name: "Hashed fixture objects (not live NOAA/CMEMS)" }],
      layers: [{ id: "sst", label: "SST composite (fixture)", source: "fixture" }],
    });
    assert.ok(!sources.some((s) => s.id === "noaa-sst"));
    const notes = landedPackNotes({
      sources: [{ id: "fixture", name: "Hashed fixture objects (not live NOAA/CMEMS)" }],
      layers: [{ id: "sst", label: "SST composite (fixture)", source: "fixture" }],
      notes: "Fixture bodies.",
    });
    assert.doesNotMatch(notes, /ACSPO|MUR|Landed this pack/);
  });

  it("names official ENC cell count and updates from the packed body", async () => {
    const overlay = encodeLayerBody({
      kind: "enc-clip",
      layer: "enc",
      payload: {
        official: true,
        note: "Official NOAA S-57 (2 cells, 1 update file). US5PVDCB edition 3 update 1.",
        s57: { cellIds: ["US5PVDCB", "US5PVDBB"], updateCount: 1 },
      },
    });
    assert.match(encSourceName(overlay) ?? "", /Official NOAA S-57/);
    assert.match(encSourceName(overlay) ?? "", /2 cells|US5PVDCB/);
    const live = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      overlays: { enc: overlay },
    });
    const encSrc = live.manifest.sources.find((s) => s.id === "noaa-enc");
    assert.ok(encSrc);
    assert.match(encSrc.name, /official/i);
    assert.match(encSrc.name, /US5PVDCB|2 cells/);
    assert.match(live.manifest.notes, /official/i);
  });

  it("counts official ENC cells/updates when the note omitted them", () => {
    const overlay = encodeLayerBody({
      kind: "enc-clip",
      layer: "enc",
      payload: {
        official: true,
        note: "Official NOAA S-57 exchange-set cells from charts.noaa.gov.",
        s57: { cellIds: ["US5PVDCB", "US5PVDBB"], updateCount: 1 },
      },
    });
    assert.equal(encSourceName(overlay), "Official NOAA S-57 (2 cells, 1 update file)");
  });

  it("does not treat a fixture ENC clip as a landed official source", () => {
    const overlay = encodeLayerBody({
      kind: "enc-clip",
      layer: "enc",
      payload: { fixture: true, official: false, note: "Fixture cell list — not official S-57." },
    });
    assert.equal(encSourceName(overlay), undefined);
  });

  it("rewriteLandedManifest replaces a leftover MUR label from an ACSPO body", () => {
    const overlay = encodeLayerBody({
      kind: "grid",
      layer: "sst",
      bbox: POINT_JUDITH_CANYON_BBOX,
      nx: 2,
      ny: 2,
      hours: [0],
      hoursCovered: 24,
      unit: "degC",
      values: [[20, 21, 22, 23]],
      live: true,
      source: "noaa",
      updatedAt: "2026-08-20T12:00:00.000Z",
      dataset: "noaacwLEOACSPOSSTL3SnrtKDaily",
      note: "NOAA ACSPO L3S-LEO NRT daily 2 km / 0.02° — not 1 km MUR / GHRSST L4.",
    });
    assert.equal(leftoverMurSstLabel("SST composite (MUR / CoastWatch)"), true);
    const next = rewriteLandedManifest(
      {
        sources: [
          { id: "ghrsst-coastwatch-sst", name: "GHRSST / CoastWatch SST" },
          { id: "noaa-sst", name: "SST MUR" },
        ],
        layers: [{ id: "sst", label: "SST composite (MUR / CoastWatch)", source: "noaa" }],
        notes: "Landed this pack: SST MUR. SHA-256 of pack object bytes.",
      },
      { sst: overlay },
    );
    assert.equal(next.layers.find((l) => l.id === "sst")?.label, "SST ACSPO");
    assert.match(next.sources.find((s) => s.id === "noaa-sst")?.name ?? "", /ACSPO/);
    assert.ok(!next.sources.some((s) => s.id === "ghrsst-coastwatch-sst"));
    assert.doesNotMatch(next.layers.find((l) => l.id === "sst")?.label ?? "", /MUR \/ CoastWatch/);
    assert.match(next.notes ?? "", /ACSPO/);
    assert.doesNotMatch(next.notes ?? "", /Landed this pack: SST MUR/);
  });

  it("landedPackNotes is idempotent when ACSPO name has 0.02° and does not leave MUR leftover", () => {
    const sst =
      "NOAA ACSPO L3S-LEO NRT daily 2 km / 0.02° — not 1 km MUR / GHRSST L4. 201×106 at 2026-08-20T12:00:00.000Z.";
    const gfs = "GFS-Wave 20260821 06z f000–f072 / 3 h parsed d14755eaf17e (79778 B, 72 h)";
    const enc = "Official NOAA S-57 (20 cells, 21 update files)";
    const boilerplate = "Fixture grids plus live NOAA overlays where fetch succeeded.";
    const manifest = {
      sources: [
        { id: "noaa-sst", name: sst },
        { id: "nomads-gfswave", name: gfs },
        { id: "noaa-enc", name: enc },
      ],
      layers: [
        { id: "sst", label: "SST ACSPO", source: "noaa" },
        { id: "enc", label: "NOAA ENC (official S-57)", source: "noaa" },
      ],
      notes: boilerplate,
    };
    const once = landedPackNotes(manifest);
    const twice = landedPackNotes({ ...manifest, notes: once });
    const thrice = landedPackNotes({ ...manifest, notes: twice });
    assert.equal(once, twice);
    assert.equal(twice, thrice);
    assert.match(once, /^Landed this pack: NOAA ACSPO/);
    assert.match(once, /0\.02°/);
    assert.match(once, /Fixture grids/);
    assert.equal(leftoverMurNotes(once), false);
    assert.doesNotMatch(once, /(?:^|[^\d.])02°\s*—\s*not 1 km MUR/);
    assert.equal((once.match(/Landed this pack:/g) ?? []).length, 1);
    assert.equal((once.match(/GFS-Wave/g) ?? []).length, 1);
    assert.equal((once.match(/Official NOAA S-57/g) ?? []).length, 1);
  });

  it("rewriteLandedManifest strips leftover 02° MUR notes already on R2", () => {
    const sst =
      "NOAA ACSPO L3S-LEO NRT daily 2 km / 0.02° — not 1 km MUR / GHRSST L4. 201×106 at 2026-08-20T12:00:00.000Z.";
    const leftover =
      `Landed this pack: ${sst} · GFS-Wave 20260821 06z. · Official NOAA S-57 (20 cells, 21 update files). 02° — not 1 km MUR / GHRSST L4. 201×106 at 2026-08-20T12:00:00.000Z. · GFS-Wave 20260821 06z. · Official NOAA S-57 (20 cells, 21 update files). Fixture grids plus live NOAA overlays where fetch succeeded.`;
    assert.equal(leftoverMurNotes(leftover), true);
    assert.equal(leftoverMurNotes(sst), false);
    const next = rewriteLandedManifest(
      {
        sources: [
          { id: "noaa-sst", name: sst },
          { id: "nomads-gfswave", name: "GFS-Wave 20260821 06z" },
          { id: "noaa-enc", name: "Official NOAA S-57 (20 cells, 21 update files)" },
        ],
        layers: [
          { id: "sst", label: "SST ACSPO", source: "noaa" },
          { id: "enc", label: "NOAA ENC (official S-57)", source: "noaa" },
        ],
        notes: leftover,
      },
      {},
    );
    assert.equal(leftoverMurNotes(next.notes), false);
    assert.match(next.notes ?? "", /0\.02°/);
    assert.doesNotMatch(next.notes ?? "", /(?:^|[^\d.])02°\s*—\s*not 1 km MUR/);
    assert.equal((next.notes ?? "").match(/Landed this pack:/g)?.length, 1);
    assert.equal((next.notes ?? "").match(/GFS-Wave/g)?.length, 1);
    assert.equal((next.notes ?? "").match(/Official NOAA S-57/g)?.length, 1);
    assert.match(next.notes ?? "", /Fixture grids/);
  });
});

describe("honest leftover fixture sources[]", () => {
  function liveGrid(layer: string, extra: Record<string, unknown> = {}) {
    return encodeLayerBody({
      kind: "grid",
      layer,
      bbox: POINT_JUDITH_CANYON_BBOX,
      nx: 2,
      ny: 2,
      hours: [0],
      hoursCovered: layer === "sst" ? 24 : 72,
      unit: layer === "sst" ? "degC" : layer === "bathymetry" ? "m" : "kt",
      values: [[1, 2, 3, 4]],
      live: true,
      source: "noaa",
      updatedAt: START,
      ...extra,
    });
  }

  it("does not label live NOAA SST/wind/waves/bathy as hashed GRIB/SST/CMEMS fixtures", async () => {
    const live = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      overlays: {
        sst: liveGrid("sst", {
          dataset: "noaacwLEOACSPOSSTL3SnrtKDaily",
          note: "NOAA ACSPO L3S-LEO NRT daily 2 km / 0.02° — not 1 km MUR / GHRSST L4.",
        }),
        wind: liveGrid("wind", { note: "GFS-Wave 20260820 18z f000–f072 / 3 h parsed series (72 h)" }),
        waves: liveGrid("waves", { note: "GFS-Wave 20260820 18z f000–f072 / 3 h parsed series (72 h)" }),
        bathymetry: liveGrid("bathymetry", { note: "NCEI ETOPO 2022 15″ subsampled to ~0.033°." }),
      },
      liveErrors: ["ais: no positions in snapshot (0 frames) — live miss"],
    });
    const fixture = live.manifest.sources.find((s) => s.id === "fixture");
    assert.ok(fixture);
    assert.doesNotMatch(fixture.name, /not live GRIB\/SST\/CMEMS/);
    assert.match(fixture.name, /ais/i);
    assert.match(fixture.name, /miss|fixture/i);
    const noaa = live.manifest.sources.find((s) => s.id === "noaa");
    assert.ok(noaa);
    assert.match(noaa.name, /sst/);
    assert.match(noaa.name, /wind/);
    assert.match(noaa.name, /waves/);
    assert.match(noaa.name, /bathymetry/);
    assert.equal(live.manifest.layers.find((l) => l.id === "ais")?.source, "fixture");
    assert.equal(live.manifest.layers.find((l) => l.id === "sst")?.source, "noaa");
    assert.equal(leftoverFixtureSources(live.manifest.sources, live.manifest.layers), false);
  });

  it("keeps an all-fixture pack labeled hashed fixtures", async () => {
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const row = fixture.manifest.sources.find((s) => s.id === "fixture");
    assert.ok(row);
    assert.match(row.name, /Hashed fixture objects \(not live NOAA\/CMEMS\)/);
    assert.ok(!fixture.manifest.sources.some((s) => s.id === "noaa"));
    assert.equal(leftoverFixtureSources(fixture.manifest.sources, fixture.manifest.layers), false);
  });

  it("drops leftover GRIB/SST/CMEMS fixture copy when those layers are already live NOAA", () => {
    const layers = [
      { id: "sst", label: "SST ACSPO", source: "noaa" as const },
      { id: "wind", label: "GFS-Wave", source: "noaa" as const },
      { id: "waves", label: "GFS-Wave", source: "noaa" as const },
      { id: "bathymetry", label: "Bathymetry", source: "noaa" as const },
      { id: "ais", label: "AIS", source: "fixture" as const },
    ];
    const leftover = [{ id: "fixture", name: "Hashed fixture objects (not live GRIB/SST/CMEMS)" }];
    assert.equal(leftoverFixtureSources(leftover, layers), true);
    const sources = landedPackSources({
      sources: leftover,
      layers,
      liveErrors: ["ais: no positions in snapshot (0 frames) — live miss"],
    });
    const fixture = sources.find((s) => s.id === "fixture");
    assert.ok(fixture);
    assert.doesNotMatch(fixture.name, /not live GRIB\/SST\/CMEMS/);
    assert.match(fixture.name, /ais/i);
    assert.equal(leftoverFixtureSources(sources, layers), false);
  });

  it("rewriteLandedManifest strips leftover live-grid fixture sources[]", () => {
    const layers = [
      { id: "sst", label: "SST ACSPO", source: "noaa" as const },
      { id: "wind", label: "GFS-Wave", source: "noaa" as const },
      { id: "waves", label: "GFS-Wave", source: "noaa" as const },
      { id: "bathymetry", label: "Bathymetry", source: "noaa" as const },
      { id: "ais", label: "AIS", source: "fixture" as const },
    ];
    const next = rewriteLandedManifest(
      {
        sources: [{ id: "fixture", name: "Hashed fixture objects (not live GRIB/SST/CMEMS)" }],
        layers,
        liveErrors: ["ais: AISSTREAM_API_KEY missing — live miss"],
      },
      {},
    );
    const fixture = next.sources.find((s) => s.id === "fixture");
    assert.ok(fixture);
    assert.doesNotMatch(fixture.name, /not live GRIB\/SST\/CMEMS/);
    assert.match(fixture.name, /ais/i);
    assert.equal(leftoverFixtureSources(next.sources, next.layers), false);
  });
});

describe("gfsHelmLine", () => {
  it("does not claim 72 h live when the honesty note is a fixture tail", async () => {
    const line = gfsHelmLine({
      liveErrors: [GFS_HOUR0_FIXTURE_NOTE],
      wind: { source: "noaa", hours: 72 },
      waves: { source: "noaa", hours: 72 },
    });
    assert.equal(line, GFS_HOUR0_FIXTURE_NOTE);
    const live = gfsHelmLine({
      liveErrors: [],
      wind: { source: "noaa", hours: 72 },
      waves: { source: "noaa", hours: 72 },
    });
    assert.match(live, /72 h live/);
  });
});

describe("hashedPackCount", () => {
  it("counts stale verified SST as hashed, not a miss", async () => {
    const { manifest } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const evidence = manifest.layers.map((l) => ({
      id: l.id,
      present: true,
      hashExpected: l.hash,
      hashActual: l.hash,
      updatedAt: l.id === "sst" ? "2026-08-19T06:00:00.000Z" : l.updatedAt,
      hoursCovered: l.hours || 72,
      cycleAt: START,
    }));
    const ready = evaluateReadyForOffshore({
      hours: 72,
      start: START,
      now: "2026-08-20T12:00:00.000Z",
      layers: evidence,
    });
    const rows = tripPackLayersFromReady(manifest, ready);
    const sst = rows.find((r) => r.id === "sst");
    assert.equal(sst?.status, "stale");
    assert.equal(sst?.verified, true);
    const count = hashedPackCount(rows);
    assert.equal(count.total, 13);
    assert.equal(count.hashed, 13);
    assert.equal(count.stale, 1);
    assert.equal(rows.filter((r) => r.status === "ready").length, 12);
  });

  it("does not count a real hash miss as hashed", async () => {
    const { manifest } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const evidence = manifest.layers.map((l) => ({
      id: l.id,
      present: true,
      hashExpected: l.hash,
      hashActual: l.id === "sst" ? "0".repeat(64) : l.hash,
      updatedAt: l.updatedAt,
      hoursCovered: l.hours || 72,
      cycleAt: START,
    }));
    const ready = evaluateReadyForOffshore({
      hours: 72,
      start: START,
      now: START,
      layers: evidence,
    });
    const rows = tripPackLayersFromReady(manifest, ready);
    const sst = rows.find((r) => r.id === "sst");
    assert.equal(sst?.verified, false);
    const count = hashedPackCount(rows);
    assert.equal(count.hashed, 12);
    assert.equal(count.total, 13);
    assert.equal(count.stale, 0);
    assert.deepEqual(count.misses, ["sst"]);
  });

  it("counts verified hour-0 GFS cover < 72 h as hashed and stale", async () => {
    const { manifest } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const evidence = manifest.layers.map((l) => ({
      id: l.id,
      present: true,
      hashExpected: l.hash,
      hashActual: l.hash,
      updatedAt: l.id === "sst" ? "2026-08-19T06:00:00.000Z" : l.updatedAt,
      hoursCovered: l.id === "wind" || l.id === "waves" ? 1 : l.hours || 72,
      cycleAt: START,
    }));
    const ready = evaluateReadyForOffshore({
      hours: 72,
      start: START,
      now: "2026-08-20T12:00:00.000Z",
      layers: evidence,
    });
    const rows = tripPackLayersFromReady(manifest, ready);
    const wind = rows.find((r) => r.id === "wind");
    const waves = rows.find((r) => r.id === "waves");
    const sst = rows.find((r) => r.id === "sst");
    assert.equal(wind?.verified, true);
    assert.equal(wind?.status, "stale");
    assert.equal(waves?.verified, true);
    assert.equal(waves?.status, "stale");
    assert.equal(sst?.verified, true);
    assert.equal(sst?.status, "stale");
    const count = hashedPackCount(rows);
    assert.equal(count.total, 13);
    assert.equal(count.hashed, 13);
    assert.equal(count.stale, 3);
    assert.deepEqual(count.misses, []);
  });
});

describe("helm Packs production copy", () => {
  it("does not call the default dock pack fixtures", async () => {
    const packsSrc = await readFile(
      fileURLToPath(new URL("../src/components/panels/PacksPanel.tsx", import.meta.url)),
      "utf8",
    );
    const onboard = await readFile(
      fileURLToPath(new URL("../src/components/ahanu/Onboarding.tsx", import.meta.url)),
      "utf8",
    );
    assert.doesNotMatch(packsSrc, /Default download is hashed fixtures/);
    assert.doesNotMatch(packsSrc, /Live NOAA can land/);
    assert.doesNotMatch(packsSrc, /Failed fetches stay fixture/);
    assert.match(packsSrc, /Download 72h on marina Wi-Fi hits api\.ahanu\.dev live NOAA, ENC, and/);
    assert.match(packsSrc, /Live NOAA is preview-only \(\?live=1\), not the live path/);
    assert.match(packsSrc, /A missed layer \(AIS\) is a miss — do not call the whole pack fixtures/);
    assert.match(packsSrc, /Preview only \(\?live=1\)/);
    assert.match(packsSrc, /api\.ahanu\.dev live NOAA/);
    assert.doesNotMatch(onboard, /hashed fixtures/);
    assert.doesNotMatch(onboard, /Default download is hashed/);
    assert.match(onboard, /marina Wi-Fi/);
  });
});
