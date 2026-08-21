import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const { tideAt, currentAt, TIDE_STATIONS } = await import("../src/lib/ahanu/tides.ts");
const { POINT_JUDITH, VEATCH_HEAD } = await import("../src/lib/ahanu/constants.ts");

const DATE = new Date(2026, 7, 20, 12, 0, 0);

describe("tideAt", () => {
  it("returns a finite heightFt and a Date nextSlack at Veatch", () => {
    const t = tideAt(VEATCH_HEAD.lat, VEATCH_HEAD.lon, DATE);
    assert.ok(Number.isFinite(t.heightFt), `heightFt ${t.heightFt}`);
    assert.ok(t.nextSlack instanceof Date, "nextSlack must be a Date");
    assert.ok(!Number.isNaN(t.nextSlack.getTime()), "nextSlack must be a valid Date");
    assert.equal(typeof t.rising, "boolean");
    assert.ok(Number.isFinite(t.floodDir));
  });

  it("also works at Point Judith and is deterministic", () => {
    const a = tideAt(POINT_JUDITH.lat, POINT_JUDITH.lon, DATE);
    const b = tideAt(POINT_JUDITH.lat, POINT_JUDITH.lon, DATE);
    assert.ok(Number.isFinite(a.heightFt));
    assert.equal(a.heightFt, b.heightFt);
    assert.equal(a.nextSlack.getTime(), b.nextSlack.getTime());
    assert.ok(a.nextSlack instanceof Date);
  });

  it("nextSlack is at or after the query time", () => {
    const t = tideAt(VEATCH_HEAD.lat, VEATCH_HEAD.lon, DATE);
    assert.ok(
      t.nextSlack.getTime() >= DATE.getTime() - 60_000,
      `nextSlack ${t.nextSlack.toISOString()} before query`,
    );
  });
});

describe("currentAt", () => {
  it("speedKt is >= 0 at Veatch", () => {
    const c = currentAt(VEATCH_HEAD.lat, VEATCH_HEAD.lon, DATE);
    assert.ok(Number.isFinite(c.speedKt));
    assert.ok(c.speedKt >= 0, `speedKt ${c.speedKt}`);
    assert.ok(Number.isFinite(c.dir));
  });

  it("is slack (0 kt) over inland land", () => {
    const c = currentAt(42, -74, DATE);
    assert.equal(c.speedKt, 0);
  });
});

describe("TIDE_STATIONS", () => {
  it("includes the RI / MA / NY harmonics used by the blender", () => {
    assert.ok(TIDE_STATIONS.length >= 3);
    const names = TIDE_STATIONS.map((s) => s.name);
    assert.ok(names.includes("Point Judith"));
    assert.ok(names.includes("Newport"));
  });
});

const { buildFixturePack, POINT_JUDITH_CANYON_BBOX } = await import("../src/lib/ahanu/pack.ts");
const { packedOceanFromBodies, setPackedOcean, clearPackedOcean } = await import(
  "../src/lib/ahanu/packed-fields.ts"
);

describe("packed tides", () => {
  afterEach(() => {
    clearPackedOcean();
  });

  it("samples the packed station series when a pack is loaded", async () => {
    const { bodies } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: "2026-08-20T12:00:00.000Z",
      hours: 72,
      createdAt: "2026-08-20T12:00:00.000Z",
    });
    setPackedOcean(packedOceanFromBodies(bodies));
    const t = tideAt(41.49, -71.327, new Date("2026-08-20T12:00:00.000Z"));
    assert.ok(Number.isFinite(t.heightFt));
    assert.ok(t.nextSlack instanceof Date);
    clearPackedOcean();
  });
});

const { packedTideCurve, classifyPackedHilo, DEFAULT_TIDE_HARBOR } = await import("../src/lib/ahanu/tide-curve.ts");

function tidesBody(payload: unknown): string {
  return JSON.stringify({ kind: "json", layer: "tides", payload });
}

function loadTides(payload: unknown): void {
  setPackedOcean(packedOceanFromBodies({ tides: tidesBody(payload) }));
}

const CRAFTED = {
  id: "8452660",
  name: "Newport",
  lat: 41.49,
  lon: -71.327,
  interval: "h",
  datum: "MLLW",
  series: [
    { at: "2026-08-20T12:00:00.000Z", heightFt: 1.2 },
    { at: "2026-08-20T13:00:00.000Z", heightFt: 2.0 },
    { at: "2026-08-20T14:00:00.000Z", heightFt: 2.8 },
    { at: "2026-08-20T15:00:00.000Z", heightFt: 2.1 },
    { at: "2026-08-20T16:00:00.000Z", heightFt: 1.0 },
    { at: "2026-08-20T17:00:00.000Z", heightFt: 0.2 },
    { at: "2026-08-20T18:00:00.000Z", heightFt: 0.8 },
  ],
  hilo: [
    { at: "2026-08-20T14:00:00.000Z", heightFt: 2.8 },
    { at: "2026-08-20T17:00:00.000Z", heightFt: 0.2 },
    { at: "2026-08-21T02:00:00.000Z", heightFt: 3.1 },
    { at: "2026-08-21T08:00:00.000Z", heightFt: -0.1 },
  ],
};

describe("packedTideCurve", () => {
  afterEach(() => {
    clearPackedOcean();
  });

  it("defaults to Newport and returns packed hourly points plus next high/low", () => {
    loadTides({
      fixture: true,
      start: "2026-08-20T12:00:00.000Z",
      hours: 24,
      harbor: "Point Judith / Newport / Montauk",
      stations: [
        CRAFTED,
        {
          id: "8452944",
          name: "Quonset Point",
          lat: 41.586,
          lon: -71.41,
          interval: "h",
          datum: "MLLW",
          series: [{ at: "2026-08-20T12:00:00.000Z", heightFt: 0.4 }],
          hilo: [],
        },
      ],
    });
    assert.equal(DEFAULT_TIDE_HARBOR, "POINT JUDITH, HARBOR OF REFUGE");
    const curve = packedTideCurve(new Date("2026-08-20T12:30:00.000Z"));
    assert.ok(curve);
    assert.equal(curve.harbor, "Newport");
    assert.equal(curve.stationId, "8452660");
    assert.equal(curve.points.length, 7);
    assert.deepEqual(
      curve.points.map((p) => p.heightFt),
      CRAFTED.series.map((p) => p.heightFt),
    );
    assert.equal(curve.nextHigh?.at, "2026-08-20T14:00:00.000Z");
    assert.equal(curve.nextHigh?.heightFt, 2.8);
    assert.equal(curve.nextHigh?.kind, "high");
    assert.equal(curve.nextLow?.at, "2026-08-20T17:00:00.000Z");
    assert.equal(curve.nextLow?.heightFt, 0.2);
    assert.equal(curve.nextLow?.kind, "low");
  });

  it("uses later packed hi/lo after the first high has passed", () => {
    loadTides({ fixture: true, start: "2026-08-20T12:00:00.000Z", hours: 24, stations: [CRAFTED] });
    const curve = packedTideCurve(new Date("2026-08-20T16:00:00.000Z"));
    assert.ok(curve);
    assert.equal(curve.nextHigh?.at, "2026-08-21T02:00:00.000Z");
    assert.equal(curve.nextHigh?.heightFt, 3.1);
    assert.equal(curve.nextLow?.at, "2026-08-20T17:00:00.000Z");
    assert.equal(curve.nextLow?.heightFt, 0.2);
  });

  it("selects Quonset when asked and does not invent a height", () => {
    loadTides({
      fixture: true,
      start: "2026-08-20T12:00:00.000Z",
      hours: 24,
      stations: [CRAFTED, { ...CRAFTED, id: "8452944", name: "Quonset Point", series: [{ at: "2026-08-20T12:00:00.000Z", heightFt: 0.4 }], hilo: [] }],
    });
    const curve = packedTideCurve(new Date("2026-08-20T12:30:00.000Z"), "Quonset");
    assert.ok(curve);
    assert.equal(curve.harbor, "Quonset Point");
    assert.deepEqual(curve.points, [{ at: "2026-08-20T12:00:00.000Z", heightFt: 0.4 }]);
    assert.equal(curve.nextHigh, null);
    assert.equal(curve.nextLow, null);
  });

  it("paints fixture pack Newport series and live CO-OPS with the same reader", async () => {
    const { bodies } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: "2026-08-20T12:00:00.000Z",
      hours: 72,
      createdAt: "2026-08-20T12:00:00.000Z",
    });
    setPackedOcean(packedOceanFromBodies(bodies));
    const fixture = packedTideCurve(new Date("2026-08-20T12:00:00.000Z"));
    assert.ok(fixture);
    assert.equal(fixture.harbor, "Newport");
    assert.ok(fixture.points.length >= 24);
    assert.equal(fixture.points[0]!.at, "2026-08-20T12:00:00.000Z");
    assert.ok(fixture.nextHigh || fixture.nextLow);
    const packed = (await import("../src/lib/ahanu/packed-fields.ts")).getPackedOcean();
    const newport = packed?.tides?.stations.find((s) => s.name === "Newport");
    assert.ok(newport);
    assert.deepEqual(fixture.points, newport.series);

    loadTides({
      fixture: false,
      live: true,
      source: "coops",
      start: "2026-08-20T12:00:00.000Z",
      hours: 24,
      stations: [CRAFTED],
    });
    const live = packedTideCurve(new Date("2026-08-20T12:30:00.000Z"));
    assert.ok(live);
    assert.equal(live.live, true);
    assert.equal(live.harbor, "Newport");
    assert.equal(live.nextHigh?.heightFt, 2.8);
    assert.equal(live.nextLow?.heightFt, 0.2);
    assert.deepEqual(live.points.map((p) => p.heightFt), CRAFTED.series.map((p) => p.heightFt));
  });

  it("returns null for empty or missing pack and does not invent water levels", () => {
    assert.equal(packedTideCurve(new Date("2026-08-20T12:00:00.000Z")), null);
    setPackedOcean({ source: "fixture" });
    assert.equal(packedTideCurve(new Date("2026-08-20T12:00:00.000Z")), null);
    loadTides({ fixture: true, start: "2026-08-20T12:00:00.000Z", hours: 24, stations: [] });
    assert.equal(packedTideCurve(new Date("2026-08-20T12:00:00.000Z")), null);
    loadTides({
      fixture: true,
      start: "2026-08-20T12:00:00.000Z",
      hours: 24,
      stations: [{ id: "8452660", name: "Newport", lat: 41.49, lon: -71.327, interval: "h", datum: "MLLW", series: [], hilo: [] }],
    });
    assert.equal(packedTideCurve(new Date("2026-08-20T12:00:00.000Z")), null);
    loadTides({
      fixture: true,
      start: "2026-08-20T12:00:00.000Z",
      hours: 24,
      stations: [{
        id: "8452660",
        name: "Newport",
        lat: 41.49,
        lon: -71.327,
        interval: "h",
        datum: "MLLW",
        series: [{ at: "not-a-date", heightFt: Number.NaN }],
        hilo: [{ at: "also-bad", heightFt: Number.POSITIVE_INFINITY }],
      }],
    });
    const empty = packedTideCurve(new Date("2026-08-20T12:00:00.000Z"));
    assert.equal(empty, null);
  });

  it("classifies packed hi/lo from neighbor heights or explicit H/L", () => {
    const fromHeights = classifyPackedHilo([
      { at: "2026-08-20T14:00:00.000Z", heightFt: 2.8 },
      { at: "2026-08-20T17:00:00.000Z", heightFt: 0.2 },
      { at: "2026-08-21T02:00:00.000Z", heightFt: 3.1 },
    ]);
    assert.deepEqual(
      fromHeights.map((e) => e.kind),
      ["high", "low", "high"],
    );
    const typed = classifyPackedHilo([
      { at: "2026-08-20T14:00:00.000Z", heightFt: 1.1, type: "L" },
      { at: "2026-08-20T20:00:00.000Z", heightFt: 3.4, type: "H" },
    ]);
    assert.equal(typed[0]!.kind, "low");
    assert.equal(typed[1]!.kind, "high");
    assert.deepEqual(classifyPackedHilo([]), []);
    assert.deepEqual(classifyPackedHilo([{ at: "2026-08-20T14:00:00.000Z", heightFt: 2.8 }]), []);
  });
});
