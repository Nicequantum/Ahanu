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
