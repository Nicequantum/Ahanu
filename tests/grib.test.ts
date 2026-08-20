import "./register-alias.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { gribAt, scoreGoNoGo, forecastSeries, routeWeather } = await import(
  "../src/lib/ahanu/grib.ts"
);
const { POINT_JUDITH, VEATCH_HEAD, DEFAULT_BOAT, FORECAST_HOURS } = await import(
  "../src/lib/ahanu/constants.ts"
);

const GO = new Set(["go", "caution", "no-go"]);

function assertFiniteGrib(g: {
  windKt: number;
  waveFt: number;
  swellFt: number;
  gustKt: number;
  periodS: number;
  pressureMb: number;
}) {
  for (const [k, v] of Object.entries(g)) {
    assert.ok(Number.isFinite(v), `${k} not finite: ${v}`);
  }
}

describe("gribAt — Veatch front", () => {
  it("hour 36 is windier and lumpier than hour 0", () => {
    const h0 = gribAt(VEATCH_HEAD.lat, VEATCH_HEAD.lon, 0);
    const h36 = gribAt(VEATCH_HEAD.lat, VEATCH_HEAD.lon, 36);
    assertFiniteGrib(h0);
    assertFiniteGrib(h36);
    assert.ok(
      h36.windKt > h0.windKt,
      `hour 36 wind ${h36.windKt} must exceed hour 0 ${h0.windKt}`,
    );
    assert.ok(
      h36.waveFt > h0.waveFt,
      `hour 36 waves ${h36.waveFt} must exceed hour 0 ${h0.waveFt}`,
    );
    assert.ok(
      h36.swellFt > h0.swellFt,
      `hour 36 swell ${h36.swellFt} must exceed hour 0 ${h0.swellFt}`,
    );
    assert.ok(h36.gustKt > h0.gustKt, "front gusts harder");
  });

  it("is deterministic", () => {
    const a = gribAt(VEATCH_HEAD.lat, VEATCH_HEAD.lon, 12);
    const b = gribAt(VEATCH_HEAD.lat, VEATCH_HEAD.lon, 12);
    assert.deepEqual(a, b);
  });
});

describe("scoreGoNoGo", () => {
  it('8 kt / 3 ft on DEFAULT_BOAT is "go"', () => {
    assert.equal(scoreGoNoGo(8, 3, DEFAULT_BOAT), "go");
  });

  it('40 kt / 12 ft on DEFAULT_BOAT is "no-go"', () => {
    assert.equal(scoreGoNoGo(40, 12, DEFAULT_BOAT), "no-go");
  });

  it("warns in the 80–100% band", () => {
    // maxWind 24, maxWave 7 → 0.8 * 24 = 19.2 kt still go; 0.9 * 24 = 21.6 caution
    assert.equal(scoreGoNoGo(21.6, 1, DEFAULT_BOAT), "caution");
    assert.equal(scoreGoNoGo(24, 1, DEFAULT_BOAT), "no-go");
  });
});

describe("forecastSeries", () => {
  it("covers 72 h in 3 h steps", () => {
    const series = forecastSeries(VEATCH_HEAD.lat, VEATCH_HEAD.lon);
    assert.ok(series.length >= 2);
    assert.equal(series[0]!.hour, 0);
    assert.equal(series.at(-1)!.hour, FORECAST_HOURS);
    assert.equal(FORECAST_HOURS, 72);
    assert.equal(series.length, 72 / 3 + 1);

    for (let i = 0; i < series.length; i++) {
      assert.equal(series[i]!.hour, i * 3);
      assert.ok(GO.has(series[i]!.go), `unexpected go ${series[i]!.go}`);
      assert.ok(Number.isFinite(series[i]!.windKt));
      assert.ok(Number.isFinite(series[i]!.waveFt));
    }
  });
});

describe("routeWeather PJ → Veatch", () => {
  it("has nm > 100 and overall in go/caution/no-go", () => {
    const rw = routeWeather(
      [POINT_JUDITH, VEATCH_HEAD],
      DEFAULT_BOAT.cruiseKt,
      0,
      DEFAULT_BOAT,
    );
    assert.ok(rw.nm > 100, `route nm ${rw.nm} should be > 100`);
    assert.ok(GO.has(rw.overall), `overall ${rw.overall}`);
    assert.ok(rw.legs.length >= 1);
    assert.ok(rw.hours > 0);
    for (const leg of rw.legs) {
      assert.ok(GO.has(leg.go));
      assert.ok(leg.nm > 0);
    }
  });

  it("empty / single-point routes do not throw", () => {
    const empty = routeWeather([], 21, 0, DEFAULT_BOAT);
    assert.equal(empty.nm, 0);
    assert.ok(GO.has(empty.overall));
    const one = routeWeather([VEATCH_HEAD], 21, 0, DEFAULT_BOAT);
    assert.equal(one.nm, 0);
    assert.ok(GO.has(one.overall));
  });
});
