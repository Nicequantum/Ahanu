import "./register-alias.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { depthM, isLand, contourLines, coastLon, shelfBreakLon, landPolygon } = await import(
  "../src/lib/ahanu/bathymetry.ts"
);
const { POINT_JUDITH, VEATCH_HEAD } = await import("../src/lib/ahanu/constants.ts");

describe("depthM", () => {
  it("Veatch head is on the order of 100–400 m (canyon head)", () => {
    const d = depthM(VEATCH_HEAD.lat, VEATCH_HEAD.lon);
    assert.ok(Number.isFinite(d), `depthM ${d}`);
    assert.ok(
      d >= 100 && d <= 400,
      `Veatch head depth ${d} m, expected ~100–400 m`,
    );
  });

  it("Point Judith is much shallower or land", () => {
    const d = depthM(POINT_JUDITH.lat, POINT_JUDITH.lon);
    const veatch = depthM(VEATCH_HEAD.lat, VEATCH_HEAD.lon);
    assert.ok(Number.isFinite(d));
    assert.ok(
      d < 20 || isLand(POINT_JUDITH.lat, POINT_JUDITH.lon),
      `PJ depth ${d} m should be shallow or land`,
    );
    assert.ok(d < veatch, `PJ ${d} should be shallower than Veatch ${veatch}`);
  });
});

describe("isLand", () => {
  it("is true for inland NY (42, -74)", () => {
    assert.equal(isLand(42, -74), true);
    assert.equal(depthM(42, -74) < 0, true);
  });

  it("is false at Veatch head (open slope)", () => {
    assert.equal(isLand(VEATCH_HEAD.lat, VEATCH_HEAD.lon), false);
  });
});

describe("contourLines", () => {
  it("returns a GeoJSON FeatureCollection", () => {
    const fc = contourLines(183);
    assert.equal(fc.type, "FeatureCollection");
    assert.ok(Array.isArray(fc.features));
    assert.ok(fc.features.length >= 1, "expected some 183 m contour segments");
    const f = fc.features[0]!;
    assert.equal(f.type, "Feature");
    assert.ok(f.geometry);
    assert.ok(
      f.geometry.type === "LineString" || f.geometry.type === "MultiLineString",
    );
  });
});

describe("coast / shelf helpers", () => {
  it("coast is west of the shelf break at 40N", () => {
    const coast = coastLon(40);
    const brk = shelfBreakLon(40);
    assert.ok(coast < brk, `coast ${coast} should be west of break ${brk}`);
  });

  it("landPolygon is a Feature", () => {
    const poly = landPolygon();
    assert.equal(poly.type, "Feature");
    assert.equal(poly.geometry.type, "Polygon");
  });
});
