import "./register-alias.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  haversineNm,
  destination,
  initialBearing,
  pathLengthNm,
  compass,
  formatLat,
  formatLon,
  formatCoord,
  metersToFathoms,
  metersToFeet,
  alongTrack,
  toRad,
  toDeg,
} = await import("../src/lib/ahanu/geo.ts");
const { POINT_JUDITH, VEATCH_HEAD } = await import("../src/lib/ahanu/constants.ts");

const PJ = { lat: 41.3615, lon: -71.4814 };
const VEATCH = { lat: 39.9, lon: -69.62 };

describe("haversineNm", () => {
  it("Point Judith to Veatch is about 120–140 nm", () => {
    const nm = haversineNm(PJ, VEATCH);
    assert.ok(Number.isFinite(nm), `distance must be finite, got ${nm}`);
    assert.ok(nm >= 120 && nm <= 140, `expected 120–140 nm, got ${nm}`);
  });

  it("matches the named constants", () => {
    const nm = haversineNm(POINT_JUDITH, VEATCH_HEAD);
    assert.ok(nm >= 120 && nm <= 140, `constants path ${nm} nm`);
    assert.equal(haversineNm(PJ, VEATCH), nm);
  });

  it("is zero for coincident points and symmetric", () => {
    assert.equal(haversineNm(PJ, PJ), 0);
    const ab = haversineNm(PJ, VEATCH);
    const ba = haversineNm(VEATCH, PJ);
    assert.ok(Math.abs(ab - ba) < 1e-9);
  });
});

describe("destination", () => {
  it("60 nm due north from 40N 70W is ~41N", () => {
    const p = destination({ lat: 40, lon: -70 }, 0, 60);
    assert.ok(Math.abs(p.lat - 41) < 0.02, `lat ${p.lat} should be ~41`);
    assert.ok(Math.abs(p.lon - -70) < 0.05, `lon ${p.lon} should stay ~70W`);
  });

  it("round-trips with haversineNm along a bearing", () => {
    const start = { lat: 40, lon: -70 };
    const end = destination(start, 90, 30);
    assert.ok(Math.abs(haversineNm(start, end) - 30) < 0.05);
  });
});

describe("initialBearing", () => {
  it("due east is ~90°", () => {
    const brg = initialBearing({ lat: 40, lon: -70 }, { lat: 40, lon: -69 });
    assert.ok(Math.abs(brg - 90) < 2, `east bearing ${brg} should be ~90`);
  });

  it("due north is ~0°", () => {
    const brg = initialBearing({ lat: 40, lon: -70 }, { lat: 41, lon: -70 });
    assert.ok(brg < 2 || brg > 358, `north bearing ${brg}`);
  });
});

describe("pathLengthNm", () => {
  it("two identical points sum to 0", () => {
    assert.equal(pathLengthNm([PJ, PJ]), 0);
    assert.equal(pathLengthNm([VEATCH]), 0);
    assert.equal(pathLengthNm([]), 0);
  });

  it("PJ → Veatch equals the direct haversine", () => {
    const direct = haversineNm(PJ, VEATCH);
    assert.ok(Math.abs(pathLengthNm([PJ, VEATCH]) - direct) < 1e-9);
  });
});

describe("compass", () => {
  it('compass(0) is "N"', () => {
    assert.equal(compass(0), "N");
  });

  it("maps the cardinals and wraps 360", () => {
    assert.equal(compass(90), "E");
    assert.equal(compass(180), "S");
    assert.equal(compass(270), "W");
    assert.equal(compass(360), "N");
    assert.equal(compass(-90), "W");
  });
});

describe("formatLat / formatLon", () => {
  it("uses N/S and E/W hemispheres", () => {
    assert.ok(formatLat(41.3615).endsWith("N"), formatLat(41.3615));
    assert.ok(formatLat(-33.9).endsWith("S"), formatLat(-33.9));
    assert.ok(formatLon(-71.4814).endsWith("W"), formatLon(-71.4814));
    assert.ok(formatLon(18.4).endsWith("E"), formatLon(18.4));
    assert.match(formatLat(0), /N$/);
    assert.match(formatLon(0), /E$/);
  });

  it("formatCoord joins lat and lon", () => {
    const s = formatCoord(PJ);
    assert.match(s, /N/);
    assert.match(s, /W/);
  });
});

describe("metersToFathoms", () => {
  it("183 m is about 100 fathoms", () => {
    const fm = metersToFathoms(183);
    assert.ok(Math.abs(fm - 100) < 1, `183 m → ${fm} fm, expected ~100`);
  });

  it("is a linear scale (1.8288 m per fathom)", () => {
    assert.ok(Math.abs(metersToFathoms(1.8288) - 1) < 1e-9);
    assert.equal(metersToFathoms(0), 0);
  });
});

describe("related helpers", () => {
  it("toRad / toDeg invert", () => {
    assert.ok(Math.abs(toDeg(toRad(180)) - 180) < 1e-10);
  });

  it("alongTrack t=0 and t=1 recover endpoints", () => {
    const a = alongTrack(PJ, VEATCH, 0);
    const b = alongTrack(PJ, VEATCH, 1);
    assert.ok(Math.abs(a.lat - PJ.lat) < 1e-6);
    assert.ok(Math.abs(b.lat - VEATCH.lat) < 1e-3);
  });

  it("metersToFeet(1) is ~3.28084", () => {
    assert.ok(Math.abs(metersToFeet(1) - 3.28084) < 1e-6);
  });
});
