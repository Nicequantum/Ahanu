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
  it("paints hour-0 live onto fixture hours 3–72 and does not fail Ready 1h<72h", async () => {
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
    assert.equal(wind.hours, 72);
    assert.equal(waves.hours, 72);
    assert.notEqual(wind.hash, fixture.manifest.layers.find((l) => l.id === "wind")!.hash);
    const body = parseLayerBody(live.bodies.wind!) as {
      hours?: number[];
      hoursCovered?: number;
      live?: boolean;
      source?: string;
      fixture?: boolean;
      note?: string;
      values?: number[][];
    };
    const fixBody = parseLayerBody(fixture.bodies.wind!) as { hours?: number[]; values?: number[][] };
    assert.deepEqual(body.hours, fixBody.hours);
    assert.equal(body.hoursCovered, 72);
    assert.equal(body.live, true);
    assert.equal(body.source, "noaa");
    assert.equal(body.fixture, true);
    assert.match(body.note ?? "", /hour-0 live/);
    assert.match(body.note ?? "", /fixture/);
    assert.ok(!(body.note ?? "").includes("f000–f072"));
    assert.notDeepEqual(body.values?.[0], fixBody.values?.[0]);
    for (let i = 1; i < (fixBody.hours?.length ?? 0); i++) {
      assert.deepEqual(body.values?.[i], fixBody.values?.[i], `hour ${fixBody.hours?.[i]}`);
    }
    const nomads = live.manifest.sources.find((s) => s.id === "nomads-gfswave");
    assert.ok(nomads?.name.includes("hour-0 live"));
    assert.ok(nomads?.name.includes("fixture"));
    assert.ok(!nomads?.name.includes("f000–f072 / 3 h"));
    assert.ok((live.manifest.liveErrors ?? []).some((e) => e.includes("hour-0 live") && e.includes("fixture")));
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
    assert.ok(!ready.failures.some((f) => /covers 1 h/.test(f)));
    assert.ok(!ready.failures.some((f) => f.includes("wind") && f.includes("1 h")));
    assert.ok(!ready.failures.some((f) => f.includes("waves") && f.includes("1 h")));
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
    assert.equal(wind.hours, 72);
    assert.equal(waves.hours, 72);
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
    assert.ok(!ready.failures.some((f) => /covers 1 h/.test(f)));
    const windBody = parseLayerBody(pack.bodies.wind!) as { note?: string; hoursCovered?: number };
    assert.equal(windBody.hoursCovered, 72);
    assert.match(windBody.note ?? "", /fixture/);
    assert.ok(!(windBody.note ?? "").includes("f000–f072 / 3 h"));
  });

  it("enabled 3-step pack paints those hours live and keeps a fixture tail", async () => {
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
    assert.equal(wind.hours, 72);
    assert.equal(waves.hours, 72);
    const body = parseLayerBody(pack.bodies.wind!) as {
      hours?: number[];
      hoursCovered?: number;
      source?: string;
      fixture?: boolean;
      note?: string;
      values?: number[][];
    };
    assert.ok(body.hours && body.hours[0] === 0 && body.hours.includes(72));
    assert.equal(body.hoursCovered, 72);
    assert.equal(body.source, "noaa");
    assert.equal(body.fixture, true);
    assert.match(body.note ?? "", /hours 0,3,6 live/);
    assert.match(body.note ?? "", /fixture/);
    assert.ok(!(body.note ?? "").includes("f000–f072 / 3 h"));
    const nomads = pack.manifest.sources.find((s) => s.id === "nomads-gfswave");
    assert.ok(nomads?.name.includes("not 72 h ready") || (body.note ?? "").includes("fixture"));
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
    assert.ok(!ready.failures.some((f) => /covers 6 h/.test(f)));
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

  it("workerGfsWaveSeriesFlag is on unless env is 0", async () => {
    const { workerGfsWaveSeriesFlag } = await import("../src/lib/ahanu/noaa-gfs.ts");
    assert.deepEqual(workerGfsWaveSeriesFlag(), { enabled: true, paceMs: 0, budgetMs: 25_000 });
    assert.equal(workerGfsWaveSeriesFlag({ GFS_WAVE_SERIES: "0" }), false);
    assert.equal(workerGfsWaveSeriesFlag({ AHANU_GFS_WAVE_SERIES: "off" }), false);
    const on = workerGfsWaveSeriesFlag({ GFS_WAVE_SERIES: "1" });
    assert.notEqual(on, false);
    if (on) assert.equal(on.paceMs, 0);
  });

  it("budgetMs stops the series and keeps the live prefix", async () => {
    const { fetchGfsWaveSeries } = await import("../src/lib/ahanu/noaa-gfs.ts");
    const wanted = [0, 3, 6, 9, 12];
    const base = mockSeriesFetch(wanted);
    const rows = await fetchGfsWaveSeries({
      bbox: POINT_JUDITH_CANYON_BBOX,
      ymd: "20260820",
      cc: "12",
      hours: wanted,
      enabled: true,
      paceMs: 0,
      budgetMs: 25,
      fetchImpl: async (url) => {
        await new Promise((r) => setTimeout(r, 20));
        return base(url);
      },
    });
    assert.ok(rows.length >= 1);
    assert.ok(rows.length < wanted.length);
    assert.ok(rows.every((r) => r.hour <= 6));
  });

  it("mergeLiveHoursIntoFixture paints 0,3,6 and leaves later fixture hours", async () => {
    const { mergeLiveHoursIntoFixture, gfsLiveHoursNote } = await import("../src/lib/ahanu/noaa-gfs.ts");
    const { assembleGfsWaveSeries } = await import("../src/lib/ahanu/noaa-gfs.ts");
    const files = STEPS.map((hour) => ({ hour, bytes: encodeHourSample(hour, 5 + hour, 1 + hour / 6) }));
    const assembled = assembleGfsWaveSeries(files, STEPS);
    assert.ok(assembled.windKt);
    const fixturePack = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const fix = parseLayerBody(fixturePack.bodies.wind!) as {
      kind: "grid";
      layer: string;
      bbox: typeof POINT_JUDITH_CANYON_BBOX;
      nx: number;
      ny: number;
      hours: number[];
      hoursCovered: number;
      unit: string;
      values: number[][];
    };
    const note = gfsLiveHoursNote(STEPS, 72);
    const merged = mergeLiveHoursIntoFixture(assembled.windKt!, fix, note);
    assert.equal(merged.hoursCovered, 72);
    assert.equal(merged.fixture, true);
    assert.equal(merged.source, "noaa");
    assert.match(merged.note ?? "", /0,3,6 live/);
    assert.notDeepEqual(merged.values[0], fix.values[0]);
    const i3 = merged.hours.indexOf(3);
    const i9 = merged.hours.indexOf(9);
    assert.ok(i3 >= 0 && i9 >= 0);
    assert.notDeepEqual(merged.values[i3], fix.values[i3]);
    assert.deepEqual(merged.values[i9], fix.values[i9]);
  });

  function mockCycleFetch(ok: Record<string, number[]>, tracker?: { urls: string[] }) {
    return async (url: string) => {
      tracker?.urls.push(url);
      if (!url.includes("filter_gfswave")) return new Response("no", { status: 404 });
      const file = url.match(/gfswave\.t(\d{2})z\.atlocn\.0p16\.f(\d{3})\.grib2/);
      const dir = decodeURIComponent(url).match(/\/gfs\.(\d{8})\/(\d{2})\//);
      if (!file || !dir) return new Response("bad", { status: 404 });
      const key = `${dir[1]}${dir[2]}`;
      const hour = Number(file[2]);
      if (!ok[key]?.includes(hour)) return new Response("missing", { status: 404 });
      return new Response(encodeHourSample(hour, 5 + hour / 3, 1 + hour / 12), { status: 200 });
    };
  }

  it("picks a complete previous cycle over an incomplete newer 00z", async () => {
    const { pickGfsWaveSeriesCycle, gfsWaveSeriesHours, gfsLiveHoursNote } = await import(
      "../src/lib/ahanu/noaa-gfs.ts"
    );
    const { tryLiveNoaa } = await import("../src/lib/ahanu/noaa-live.ts");
    const wanted = gfsWaveSeriesHours();
    const pick = pickGfsWaveSeriesCycle(
      [
        { ymd: "20260821", cc: "00", hasHorizon: false, prefixHours: 27 },
        { ymd: "20260820", cc: "18", hasHorizon: true, prefixHours: 72 },
        { ymd: "20260820", cc: "12", hasHorizon: true, prefixHours: 72 },
      ],
      72,
    );
    assert.equal(pick?.ymd, "20260820");
    assert.equal(pick?.cc, "18");
    const now = new Date("2026-08-21T03:00:00.000Z");
    const byCycle: Record<string, number[]> = {
      "2026082100": wanted.filter((h) => h <= 27),
      "2026082018": wanted,
      "2026082012": wanted,
      "2026082006": wanted,
    };
    const tracker = { urls: [] as string[] };
    const live = await tryLiveNoaa({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      skipCache: true,
      now,
      gfsWaveSeries: { enabled: true, hours: wanted, paceMs: 0 },
      fetchImpl: mockCycleFetch(byCycle, tracker),
    });
    assert.equal(live.gfsWaveSeries?.complete, true);
    assert.equal(live.gfsWaveSeries?.hoursCovered, 72);
    assert.equal(live.gfsWaveSeries?.cycle?.ymd, "20260820");
    assert.equal(live.gfsWaveSeries?.cycle?.cc, "18");
    const z00 = tracker.urls.filter((u) => decodeURIComponent(u).includes("/gfs.20260821/00/"));
    assert.ok(z00.length >= 1);
    assert.ok(z00.every((u) => u.includes("f072")), "00z should only be horizon-probed");
    const pack = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      timeoutMs: 1000,
      skipCache: true,
      now,
      gfsWaveSeries: { enabled: true, hours: wanted, paceMs: 0 },
      fetchImpl: mockCycleFetch(byCycle),
    });
    const wind = pack.manifest.layers.find((l) => l.id === "wind")!;
    assert.equal(wind.source, "noaa");
    const body = parseLayerBody(pack.bodies.wind!) as { fixture?: boolean; hours?: number[]; note?: string };
    assert.equal(body.fixture, false);
    assert.deepEqual(body.hours, wanted);
    assert.ok(!(pack.manifest.liveErrors ?? []).some((e) => e.includes("fixture")));
    assert.match(gfsLiveHoursNote(wanted, 72, { ymd: "20260820", cc: "18" }), /20260820 18z hours 0–72 live/);
  });

  it("picks the newest cycle when every candidate has the horizon", async () => {
    const { pickGfsWaveSeriesCycle, gfsWaveSeriesHours } = await import("../src/lib/ahanu/noaa-gfs.ts");
    const { tryLiveNoaa } = await import("../src/lib/ahanu/noaa-live.ts");
    const wanted = gfsWaveSeriesHours();
    const pick = pickGfsWaveSeriesCycle(
      [
        { ymd: "20260821", cc: "00", hasHorizon: true, prefixHours: 72 },
        { ymd: "20260820", cc: "18", hasHorizon: true, prefixHours: 72 },
      ],
      72,
    );
    assert.equal(pick?.cc, "00");
    const now = new Date("2026-08-21T03:00:00.000Z");
    const byCycle: Record<string, number[]> = {
      "2026082100": wanted,
      "2026082018": wanted,
      "2026082012": wanted,
      "2026082006": wanted,
    };
    const tracker = { urls: [] as string[] };
    const live = await tryLiveNoaa({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      skipCache: true,
      now,
      gfsWaveSeries: { enabled: true, hours: wanted, paceMs: 0 },
      fetchImpl: mockCycleFetch(byCycle, tracker),
    });
    assert.equal(live.gfsWaveSeries?.complete, true);
    assert.equal(live.gfsWaveSeries?.cycle?.ymd, "20260821");
    assert.equal(live.gfsWaveSeries?.cycle?.cc, "00");
    const z18 = tracker.urls.filter((u) => decodeURIComponent(u).includes("/gfs.20260820/18/"));
    assert.equal(z18.length, 0, "should not probe older cycles after newest horizon hits");
  });

  it("picks the best prefix and names the fixture tail when every cycle is incomplete", async () => {
    const { pickGfsWaveSeriesCycle, gfsWaveSeriesHours, gfsLiveHoursNote } = await import(
      "../src/lib/ahanu/noaa-gfs.ts"
    );
    const wanted = gfsWaveSeriesHours();
    const pick = pickGfsWaveSeriesCycle(
      [
        { ymd: "20260821", cc: "00", hasHorizon: false, prefixHours: 27 },
        { ymd: "20260820", cc: "18", hasHorizon: false, prefixHours: 54 },
        { ymd: "20260820", cc: "12", hasHorizon: false, prefixHours: 36 },
        { ymd: "20260820", cc: "06", hasHorizon: false, prefixHours: 18 },
      ],
      72,
    );
    assert.equal(pick?.ymd, "20260820");
    assert.equal(pick?.cc, "18");
    assert.equal(pick?.prefixHours, 54);
    const now = new Date("2026-08-21T03:00:00.000Z");
    const byCycle: Record<string, number[]> = {
      "2026082100": wanted.filter((h) => h <= 27),
      "2026082018": wanted.filter((h) => h <= 54),
      "2026082012": wanted.filter((h) => h <= 36),
      "2026082006": wanted.filter((h) => h <= 18),
    };
    const pack = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      timeoutMs: 1000,
      skipCache: true,
      now,
      gfsWaveSeries: { enabled: true, hours: wanted, paceMs: 0 },
      fetchImpl: mockCycleFetch(byCycle),
    });
    const note = (pack.manifest.liveErrors ?? []).find((e) => e.startsWith("gfs:")) ?? "";
    assert.match(note, /20260820 18z/);
    assert.match(note, /hours 0–54 live/);
    assert.match(note, /remaining hours through 72 fixture/);
    const body = parseLayerBody(pack.bodies.wind!) as { fixture?: boolean; note?: string };
    assert.equal(body.fixture, true);
    assert.match(body.note ?? "", /20260820 18z/);
    assert.match(body.note ?? "", /0–54 live/);
    assert.ok(!(body.note ?? "").includes("f000–f072 / 3 h"));
    assert.match(gfsLiveHoursNote(wanted.filter((h) => h <= 54), 72, { ymd: "20260820", cc: "18" }), /20260820 18z hours 0–54 live/);
  });
});
