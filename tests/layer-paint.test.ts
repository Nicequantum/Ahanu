import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const { buildFixturePack, POINT_JUDITH_CANYON_BBOX } = await import("../src/lib/ahanu/pack.ts");
const {
  packedOceanFromBodies,
  setPackedOcean,
  clearPackedOcean,
  samplePacked,
  samplePackedKind,
  packedGridFeatures,
} = await import("../src/lib/ahanu/packed-fields.ts");
const { layerPaintSource } = await import("../src/lib/ahanu/layer-status.ts");
const { fieldImage, buildPackedRaster } = await import("../src/lib/ahanu/rasters.ts");
const { colorizeSst } = await import("../src/lib/ahanu/ocean.ts");
const { gribAt } = await import("../src/lib/ahanu/grib.ts");
const { windBarbGeo, waveFieldGeo } = await import("../src/lib/ahanu/wind-field.ts");
const { VEATCH_HEAD, REGION } = await import("../src/lib/ahanu/constants.ts");

const START = "2026-08-20T12:00:00.000Z";

afterEach(() => {
  clearPackedOcean();
});

async function loadFixture(omit: string[] = []) {
  const { bodies } = await buildFixturePack({
    bbox: POINT_JUDITH_CANYON_BBOX,
    start: START,
    hours: 72,
    createdAt: START,
  });
  for (const id of omit) delete bodies[id];
  setPackedOcean(packedOceanFromBodies(bodies));
  return bodies;
}

describe("layerPaintSource — no pack", () => {
  it("ocean/weather layers are synthetic; chart/ops are local", () => {
    assert.equal(layerPaintSource("sst"), "synthetic");
    assert.equal(layerPaintSource("chlorophyll"), "synthetic");
    assert.equal(layerPaintSource("altimetry"), "synthetic");
    assert.equal(layerPaintSource("wind"), "synthetic");
    assert.equal(layerPaintSource("waves"), "synthetic");
    assert.equal(layerPaintSource("temp_breaks"), "synthetic");
    assert.equal(layerPaintSource("chl_edges"), "synthetic");
    assert.equal(layerPaintSource("habitat"), "synthetic");
    assert.equal(layerPaintSource("bathymetry"), "local");
    assert.equal(layerPaintSource("canyons"), "local");
    assert.equal(layerPaintSource("ais"), "local");
  });
});

describe("layerPaintSource — fixture pack", () => {
  it("paints SST/chl/SSH/wind/wave as fixture, not synthetic", async () => {
    await loadFixture();
    assert.equal(layerPaintSource("sst"), "fixture");
    assert.equal(layerPaintSource("chlorophyll"), "fixture");
    assert.equal(layerPaintSource("altimetry"), "fixture");
    assert.equal(layerPaintSource("wind"), "fixture");
    assert.equal(layerPaintSource("waves"), "fixture");
    assert.equal(layerPaintSource("temp_breaks"), "derived");
    assert.equal(layerPaintSource("chl_edges"), "derived");
    assert.equal(layerPaintSource("habitat"), "derived");
    assert.equal(layerPaintSource("bathymetry"), "local");
  });

  it("missing chlorophyll stays missing — no synthetic fallback", async () => {
    await loadFixture(["chlorophyll"]);
    assert.equal(layerPaintSource("chlorophyll"), "missing");
    assert.equal(layerPaintSource("chl_edges"), "missing");
    assert.equal(layerPaintSource("sst"), "fixture");
    assert.equal(fieldImage("chl", 0, 8, 6), null);
  });

  it("r2 source is labeled packed", async () => {
    const { bodies } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    setPackedOcean(packedOceanFromBodies(bodies, "r2"));
    assert.equal(layerPaintSource("sst"), "packed");
    assert.equal(layerPaintSource("wind"), "packed");
  });
});

describe("fieldImage — packed bbox", () => {
  it("uses the pack bbox, not the Northeast operating box", async () => {
    await loadFixture();
    const img = fieldImage("sst", 0, 16, 10);
    assert.ok(img);
    assert.equal(img.source, "fixture");
    assert.equal(img.bbox.west, POINT_JUDITH_CANYON_BBOX.west);
    assert.equal(img.bbox.east, POINT_JUDITH_CANYON_BBOX.east);
    assert.equal(img.bbox.south, POINT_JUDITH_CANYON_BBOX.south);
    assert.equal(img.bbox.north, POINT_JUDITH_CANYON_BBOX.north);
    assert.notEqual(img.bbox.west, REGION.west);
    assert.equal(img.url, null, "no canvas in Node — url stays null");
  });

  it("without a pack, SST is synthetic over REGION", () => {
    const img = fieldImage("sst", 0, 8, 6);
    assert.ok(img);
    assert.equal(img.source, "synthetic");
    assert.equal(img.bbox.west, REGION.west);
  });
});

describe("buildPackedRaster", () => {
  it("pixels match colorizeSst of the packed sample", async () => {
    await loadFixture();
    const ocean = (await import("../src/lib/ahanu/packed-fields.ts")).getPackedOcean();
    assert.ok(ocean?.sst);
    const grid = ocean.sst;
    const raster = buildPackedRaster(grid, 0, colorizeSst, grid.nx, grid.ny);
    const x = Math.floor(grid.nx / 2);
    const y = Math.floor(grid.ny / 2);
    const lon = grid.bbox.west + ((grid.bbox.east - grid.bbox.west) * x) / (grid.nx - 1);
    const lat = grid.bbox.north - ((grid.bbox.north - grid.bbox.south) * y) / (grid.ny - 1);
    const v = samplePacked(grid, lat, lon, 0);
    assert.ok(v != null);
    const [r, g, b, a] = colorizeSst(v);
    const i = (y * raster.width + x) * 4;
    assert.equal(raster.data[i], r);
    assert.equal(raster.data[i + 1], g);
    assert.equal(raster.data[i + 2], b);
    assert.equal(raster.data[i + 3], a);
  });
});

describe("wind / wave paint from packed grids", () => {
  it("barbs stay inside the pack bbox and use packed knots", async () => {
    await loadFixture();
    const geo = windBarbGeo(0);
    assert.ok(geo.features.length > 0);
    for (const f of geo.features) {
      assert.equal(f.geometry.type, "Point");
      const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
      assert.ok(lon >= POINT_JUDITH_CANYON_BBOX.west && lon <= POINT_JUDITH_CANYON_BBOX.east);
      assert.ok(lat >= POINT_JUDITH_CANYON_BBOX.south && lat <= POINT_JUDITH_CANYON_BBOX.north);
      const packed = samplePackedKind("windKt", lat, lon, 0);
      assert.ok(packed != null);
      assert.equal(f.properties?.windKt, packed);
    }
  });

  it("missing wind paints nothing (no synthetic barbs)", async () => {
    await loadFixture(["wind"]);
    assert.equal(windBarbGeo(0).features.length, 0);
    assert.equal(layerPaintSource("wind"), "missing");
  });

  it("wave field uses packed feet", async () => {
    await loadFixture();
    const geo = waveFieldGeo(36);
    assert.ok(geo.features.length > 0);
    const f = geo.features[0]!;
    const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
    assert.equal(f.properties?.waveFt, samplePackedKind("waveFt", lat, lon, 36));
  });
});

describe("gribAt — packed fields independently", () => {
  it("uses packed wind even when waves are absent", async () => {
    await loadFixture(["waves"]);
    const packed = samplePackedKind("windKt", VEATCH_HEAD.lat, VEATCH_HEAD.lon, 0);
    assert.ok(packed != null);
    const g = gribAt(VEATCH_HEAD.lat, VEATCH_HEAD.lon, 0);
    assert.equal(g.windKt, packed);
    assert.ok(Number.isFinite(g.waveFt), "wave falls back to synthetic for scoring only");
    assert.equal(layerPaintSource("waves"), "missing");
  });
});

describe("packedGridFeatures", () => {
  it("emits one point per cell and does not invent outside the grid", async () => {
    await loadFixture();
    const ocean = (await import("../src/lib/ahanu/packed-fields.ts")).getPackedOcean();
    assert.ok(ocean?.sst);
    const geo = packedGridFeatures(ocean.sst, 0, (v) => ({ v }));
    assert.equal(geo.features.length, ocean.sst.nx * ocean.sst.ny);
  });
});
