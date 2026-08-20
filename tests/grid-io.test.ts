import "./register-alias.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";

const { parseNcep, ncepToPacked, encodeHour0Sample, sampleNcep, MS_TO_KT, M_TO_FT } = await import(
  "../src/lib/ahanu/grid-io.ts"
);
const { isGrib2 } = await import("../src/lib/ahanu/noaa-gfs.ts");
const { buildFixturePack, buildTripPack, evaluateReadyForOffshore, POINT_JUDITH_CANYON_BBOX } = await import(
  "../src/lib/ahanu/pack.ts"
);
const { parseLayerBody, encodeLayerBody } = await import("../src/lib/ahanu/pack-fixtures.ts");
const { packedOceanFromBodies, setPackedOcean, clearPackedOcean, samplePackedKind } = await import(
  "../src/lib/ahanu/packed-fields.ts"
);
const { layerPaintSource } = await import("../src/lib/ahanu/layer-status.ts");

const { resetLiveNoaaCache } = await import("../src/lib/ahanu/noaa-live.ts");

afterEach(() => {
  resetLiveNoaaCache();
  clearPackedOcean();
});

const START = "2026-08-20T12:00:00.000Z";
const GRIB_MIN = new Uint8Array([71, 82, 73, 66, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 16, 55, 55, 55, 55]);

describe("NCEP edition-2 magic", () => {
  it("accepts GRIB head/tail and rejects HTML", () => {
    assert.equal(isGrib2(GRIB_MIN), true);
    assert.equal(isGrib2(encodeHour0Sample()), true);
    assert.equal(isGrib2(new TextEncoder().encode("<html>")), false);
  });
});

describe("parse constant sample bytes", () => {
  it("reads wind, direction, and wave height", () => {
    const parsed = parseNcep(encodeHour0Sample());
    assert.equal(parsed.error, undefined);
    const ids = parsed.fields.map((f) => f.id).sort();
    assert.deepEqual(ids, ["htsgwM", "windDir", "windMs"]);
    const wind = parsed.fields.find((f) => f.id === "windMs")!;
    assert.equal(wind.forecastHour, 0);
    assert.equal(wind.values[0], 5);
    const at = sampleNcep(wind, 41, -72);
    assert.equal(at, 5);
    const packed = ncepToPacked(parsed);
    assert.ok(packed.windKt);
    assert.ok(packed.waveFt);
    assert.deepEqual(packed.windKt.hours, [0]);
    assert.equal(packed.windKt.live, true);
    assert.equal(packed.windKt.source, "noaa");
    assert.equal(packed.windKt.values[0]![0], Math.round(5 * MS_TO_KT * 100) / 100);
    assert.equal(packed.waveFt.values[0]![0], Math.round(1 * M_TO_FT * 100) / 100);
  });

  it("returns an error on empty magic-only bytes", () => {
    const parsed = parseNcep(GRIB_MIN);
    assert.equal(parsed.fields.length, 0);
    assert.ok(parsed.error);
    assert.deepEqual(ncepToPacked(parsed), {});
  });
});

describe("live Atlantic 0p16 sample if present", () => {
  it("parses wind and wave from the dock-side subset", () => {
    let bytes: Uint8Array;
    try {
      bytes = readFileSync("/tmp/gfs.grib2");
    } catch {
      return;
    }
    if (bytes.byteLength < 1000) return;
    const parsed = parseNcep(bytes);
    assert.ok(parsed.fields.some((f) => f.id === "windMs"));
    assert.ok(parsed.fields.some((f) => f.id === "htsgwM"));
    const packed = ncepToPacked(parsed);
    assert.equal(packed.windKt?.hours[0], 0);
    assert.equal(packed.waveFt?.hours[0], 0);
  });
});

describe("hour-0 overlay honesty", () => {
  it("marks wind/wave noaa for hour 0 only and does not stamp 72 h ready", async () => {
    const sample = encodeHour0Sample();
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const live = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      timeoutMs: 1000,
      fetchImpl: async (url: string) => {
        if (url.includes("filter_gfswave") || url.includes("atlocn")) {
          return new Response(sample, { status: 200 });
        }
        return new Response("no", { status: 404 });
      },
    });
    const wind = live.manifest.layers.find((l) => l.id === "wind")!;
    const waves = live.manifest.layers.find((l) => l.id === "waves")!;
    assert.equal(wind.source, "noaa");
    assert.equal(waves.source, "noaa");
    assert.equal(wind.hours, 1);
    assert.equal(waves.hours, 1);
    assert.notEqual(wind.hash, fixture.manifest.layers.find((l) => l.id === "wind")!.hash);
    const body = parseLayerBody(live.bodies.wind!) as { hours?: number[]; live?: boolean; source?: string };
    assert.deepEqual(body.hours, [0]);
    assert.equal(body.live, true);
    assert.equal(body.source, "noaa");
    assert.equal(live.manifest.readyForOffshore, false);
    const ev = live.manifest.layers.map((l) => ({
      id: l.id,
      present: true,
      hashExpected: l.hash,
      hashActual: l.hash,
      updatedAt: l.updatedAt,
      hoursCovered: l.hours,
      cycleAt: START,
    }));
    const ready = evaluateReadyForOffshore({ hours: 72, start: START, now: START, layers: ev });
    assert.equal(ready.ready, false);
    assert.ok(ready.failures.some((f) => f.includes("wind") && f.includes("1 h")));
  });

  it("keeps fixture wind/wave when parse or network fails", async () => {
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const badMagic = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      timeoutMs: 1000,
      fetchImpl: async (url: string) => {
        if (url.includes("filter_gfswave")) return new Response(GRIB_MIN, { status: 200 });
        return new Response("no", { status: 404 });
      },
    });
    assert.equal(badMagic.manifest.layers.find((l) => l.id === "wind")!.source, "fixture");
    assert.equal(badMagic.manifest.layers.find((l) => l.id === "wind")!.hash, fixture.manifest.layers.find((l) => l.id === "wind")!.hash);
    assert.equal(badMagic.manifest.layers.find((l) => l.id === "waves")!.source, "fixture");
    const offline = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    assert.equal(offline.manifest.layers.find((l) => l.id === "wind")!.hash, fixture.manifest.layers.find((l) => l.id === "wind")!.hash);
    assert.equal(offline.manifest.layers.find((l) => l.id === "waves")!.source, "fixture");
  });

  it("paints packed noaa at hour 0 and not at hour 36", async () => {
    const { tryLiveNoaa, resetLiveNoaaCache } = await import("../src/lib/ahanu/noaa-live.ts");
    resetLiveNoaaCache();
    const live = await tryLiveNoaa({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      skipCache: true,
      fetchImpl: async (url: string) => {
        if (url.includes("filter_gfswave")) return new Response(encodeHour0Sample(), { status: 200 });
        return new Response("no", { status: 404 });
      },
    });
    assert.ok(live.gfsWave?.parsed?.windKt);
    const bodies = (await buildFixturePack({ bbox: POINT_JUDITH_CANYON_BBOX, start: START, hours: 72, createdAt: START })).bodies;
    bodies.wind = encodeLayerBody(live.gfsWave!.parsed!.windKt!);
    bodies.waves = encodeLayerBody(live.gfsWave!.parsed!.waveFt!);
    setPackedOcean(packedOceanFromBodies(bodies));
    try {
      assert.equal(layerPaintSource("wind"), "packed");
      assert.ok(samplePackedKind("windKt", 41, -72, 0) != null);
      assert.equal(samplePackedKind("windKt", 41, -72, 36), null);
    } finally {
      clearPackedOcean();
      resetLiveNoaaCache();
    }
  });
});

describe("paced series stays off", () => {
  it("returns no files unless enabled", async () => {
    const { fetchGfsWaveSeries } = await import("../src/lib/ahanu/noaa-gfs.ts");
    const rows = await fetchGfsWaveSeries({
      bbox: POINT_JUDITH_CANYON_BBOX,
      ymd: "20260820",
      cc: "12",
      enabled: false,
      fetchImpl: async () => new Response("no", { status: 500 }),
    });
    assert.deepEqual(rows, []);
  });
});
