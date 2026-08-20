import "./register-alias.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";

const { parseNcep, ncepToPacked, encodeHour0Sample, encodeHourSample, sampleNcep, MS_TO_KT, M_TO_FT } = await import(
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

describe("paced GFS-Wave series", () => {
  const STEPS = [0, 3, 6];

  function mockSeriesFetch(okHours: number[], tracker?: { urls: string[] }) {
    return async (url: string) => {
      tracker?.urls.push(url);
      if (!url.includes("filter_gfswave")) return new Response("no", { status: 404 });
      const m = url.match(/\.f(\d{3})\.grib2/);
      const hour = m ? Number(m[1]) : -1;
      if (!okHours.includes(hour)) return new Response("missing", { status: 404 });
      return new Response(encodeHourSample(hour, 5 + hour / 3, 1 + hour / 12), { status: 200 });
    };
  }

  it("returns no files unless enabled", async () => {
    const { fetchGfsWaveSeries } = await import("../src/lib/ahanu/noaa-gfs.ts");
    const tracker = { urls: [] as string[] };
    const rows = await fetchGfsWaveSeries({
      bbox: POINT_JUDITH_CANYON_BBOX,
      ymd: "20260820",
      cc: "12",
      hours: STEPS,
      enabled: false,
      fetchImpl: mockSeriesFetch(STEPS, tracker),
    });
    assert.deepEqual(rows, []);
    assert.deepEqual(tracker.urls, []);
  });

  it("gfsWaveSeriesEnabled is off without a flag or env", async () => {
    const { gfsWaveSeriesEnabled } = await import("../src/lib/ahanu/noaa-gfs.ts");
    assert.equal(gfsWaveSeriesEnabled(false, { AHANU_GFS_WAVE_SERIES: "1" }), false);
    assert.equal(gfsWaveSeriesEnabled(undefined, { AHANU_GFS_WAVE_SERIES: "" }), false);
    assert.equal(gfsWaveSeriesEnabled(true), true);
    assert.equal(gfsWaveSeriesEnabled(undefined, { AHANU_GFS_WAVE_SERIES: "1" }), true);
    assert.equal(gfsWaveSeriesEnabled("1"), true);
  });

  it("enabled mocked 3 steps builds a short series and paces", async () => {
    const { fetchGfsWaveSeries, assembleGfsWaveSeries, GFS_WAVE_PACE_MS } = await import(
      "../src/lib/ahanu/noaa-gfs.ts"
    );
    const sleeps: number[] = [];
    const tracker = { urls: [] as string[] };
    const rows = await fetchGfsWaveSeries({
      bbox: POINT_JUDITH_CANYON_BBOX,
      ymd: "20260820",
      cc: "12",
      hours: STEPS,
      enabled: true,
      paceMs: GFS_WAVE_PACE_MS,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetchImpl: mockSeriesFetch(STEPS, tracker),
    });
    assert.deepEqual(rows.map((r) => r.hour), STEPS);
    assert.equal(tracker.urls.length, 3);
    assert.ok(tracker.urls.every((u) => u.includes("f000") || u.includes("f003") || u.includes("f006")));
    assert.ok(!tracker.urls.some((u) => u.includes("f072")));
    assert.deepEqual(sleeps, [10_000, 10_000]);
    const assembled = assembleGfsWaveSeries(rows, STEPS);
    assert.equal(assembled.complete, true);
    assert.equal(assembled.hoursCovered, 6);
    assert.deepEqual(assembled.windKt?.hours, STEPS);
    assert.equal(assembled.windKt?.source, "noaa");
    assert.equal(assembled.windKt?.hoursCovered, 6);
    assert.equal(assembled.waveFt?.hoursCovered, 6);
    assert.ok((assembled.windKt?.note ?? "").includes("not a 72 h"));
  });

  it("one failed step does not claim 72 h", async () => {
    const { fetchGfsWaveSeries, assembleGfsWaveSeries, gfsWaveSeriesHours } = await import(
      "../src/lib/ahanu/noaa-gfs.ts"
    );
    const wanted = gfsWaveSeriesHours();
    assert.equal(wanted.length, 25);
    assert.equal(wanted[wanted.length - 1], 72);
    const rows = await fetchGfsWaveSeries({
      bbox: POINT_JUDITH_CANYON_BBOX,
      ymd: "20260820",
      cc: "12",
      hours: STEPS,
      enabled: true,
      paceMs: 0,
      fetchImpl: mockSeriesFetch([0, 6]),
    });
    assert.deepEqual(rows.map((r) => r.hour), [0, 6]);
    const assembled = assembleGfsWaveSeries(rows, wanted);
    assert.equal(assembled.complete, false);
    assert.equal(assembled.hoursCovered, 1);
    assert.notEqual(assembled.hoursCovered, 72);
    assert.ok((assembled.windKt?.note ?? "").includes("not a 72 h"));
    const pack = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      timeoutMs: 1000,
      gfsWaveSeries: { enabled: true, hours: STEPS, paceMs: 0, ymd: "20260820", cc: "12" },
      fetchImpl: mockSeriesFetch([0, 6]),
    });
    const wind = pack.manifest.layers.find((l) => l.id === "wind")!;
    const waves = pack.manifest.layers.find((l) => l.id === "waves")!;
    assert.equal(wind.source, "noaa");
    assert.equal(waves.source, "noaa");
    assert.equal(wind.hours, 1);
    assert.equal(waves.hours, 1);
    assert.equal(pack.manifest.readyForOffshore, false);
    const ev = pack.manifest.layers.map((l) => ({
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
    assert.ok(ready.failures.some((f) => f.includes("wind") && !f.includes("72 h <")));
  });

  it("enabled 3-step pack is noaa with honest hours, not 72 h ready", async () => {
    const pack = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      timeoutMs: 1000,
      gfsWaveSeries: { enabled: true, hours: STEPS, paceMs: 0, ymd: "20260820", cc: "12" },
      fetchImpl: mockSeriesFetch(STEPS),
    });
    const wind = pack.manifest.layers.find((l) => l.id === "wind")!;
    const waves = pack.manifest.layers.find((l) => l.id === "waves")!;
    assert.equal(wind.source, "noaa");
    assert.equal(waves.source, "noaa");
    assert.equal(wind.hours, 6);
    assert.equal(waves.hours, 6);
    assert.notEqual(wind.hours, 72);
    assert.equal(pack.manifest.readyForOffshore, false);
    const body = parseLayerBody(pack.bodies.wind!) as {
      hours?: number[];
      hoursCovered?: number;
      source?: string;
    };
    assert.deepEqual(body.hours, STEPS);
    assert.equal(body.hoursCovered, 6);
    assert.equal(body.source, "noaa");
    const nomads = pack.manifest.sources.find((s) => s.id === "nomads-gfswave");
    assert.ok(nomads?.name.includes("not 72 h ready"));
  });

  it("mocked full 25-step assemble claims 72 h", async () => {
    const { assembleGfsWaveSeries, gfsWaveSeriesHours } = await import("../src/lib/ahanu/noaa-gfs.ts");
    const wanted = gfsWaveSeriesHours();
    const files = wanted.map((hour) => ({ hour, bytes: encodeHourSample(hour) }));
    const assembled = assembleGfsWaveSeries(files, wanted);
    assert.equal(assembled.complete, true);
    assert.equal(assembled.hoursCovered, 72);
    assert.equal(assembled.windKt?.hoursCovered, 72);
    assert.equal(assembled.windKt?.source, "noaa");
    assert.equal(assembled.windKt?.hours.length, 25);
    assert.ok((assembled.windKt?.note ?? "").includes("f000"));
  });

  it("enabled pack with mocked f000-f072 stamps 72 h noaa", async () => {
    const { gfsWaveSeriesHours } = await import("../src/lib/ahanu/noaa-gfs.ts");
    const wanted = gfsWaveSeriesHours();
    const pack = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      timeoutMs: 1000,
      gfsWaveSeries: { enabled: true, hours: wanted, paceMs: 0, ymd: "20260820", cc: "12" },
      fetchImpl: mockSeriesFetch(wanted),
    });
    const wind = pack.manifest.layers.find((l) => l.id === "wind")!;
    const waves = pack.manifest.layers.find((l) => l.id === "waves")!;
    assert.equal(wind.source, "noaa");
    assert.equal(waves.source, "noaa");
    assert.equal(wind.hours, 72);
    assert.equal(waves.hours, 72);
    const nomads = pack.manifest.sources.find((s) => s.id === "nomads-gfswave");
    assert.ok(nomads?.name.includes("72 h"));
  });

  it("tryLive without series flag does not fetch f003–f072", async () => {
    const { tryLiveNoaa } = await import("../src/lib/ahanu/noaa-live.ts");
    const tracker = { urls: [] as string[] };
    await tryLiveNoaa({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      skipCache: true,
      fetchImpl: mockSeriesFetch(STEPS, tracker),
    });
    const gfsUrls = tracker.urls.filter((u) => u.includes("filter_gfswave"));
    assert.ok(gfsUrls.length >= 1);
    assert.ok(gfsUrls.every((u) => u.includes("f000")));
    assert.ok(!gfsUrls.some((u) => u.includes("f003") || u.includes("f072")));
  });
});
