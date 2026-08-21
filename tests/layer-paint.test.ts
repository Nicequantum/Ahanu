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
const { VEATCH_HEAD, REGION, LAYER_META } = await import("../src/lib/ahanu/constants.ts");

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
  it("ocean/weather/AIS are synthetic; other chart/ops are local", () => {
    assert.equal(layerPaintSource("sst"), "synthetic");
    assert.equal(layerPaintSource("chlorophyll"), "synthetic");
    assert.equal(layerPaintSource("altimetry"), "synthetic");
    assert.equal(layerPaintSource("wind"), "synthetic");
    assert.equal(layerPaintSource("waves"), "synthetic");
    assert.equal(layerPaintSource("temp_breaks"), "synthetic");
    assert.equal(layerPaintSource("chl_edges"), "synthetic");
    assert.equal(layerPaintSource("habitat"), "synthetic");
    assert.equal(layerPaintSource("bathymetry"), "local");
    assert.equal(layerPaintSource("contours"), "local");
    assert.equal(layerPaintSource("canyons"), "local");
    assert.equal(layerPaintSource("hms_zones"), "local");
    assert.equal(layerPaintSource("buoys"), "local");
    assert.equal(layerPaintSource("ais"), "synthetic");
    assert.equal(LAYER_META.ais.label, "AIS demo — not live traffic");
    assert.equal(LAYER_META.enc.label, "ENC catalog (aid)");
    assert.equal(layerPaintSource("enc"), "local");
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
    assert.equal(layerPaintSource("bathymetry"), "fixture");
    assert.equal(layerPaintSource("contours"), "fixture");
    assert.equal(layerPaintSource("canyons"), "fixture");
    assert.equal(layerPaintSource("hms_zones"), "fixture");
    assert.equal(layerPaintSource("buoys"), "fixture");
    assert.equal(layerPaintSource("enc"), "fixture");
    assert.equal(layerPaintSource("ais"), "missing");
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

const {
  canyonsForChart,
  canyonHeadsForLabels,
  contoursForChart,
  hmsForChart,
  buoysForChart,
  packedEncCells,
  encCatalogFeatures,
  encAidsForChart,
  encCatalogForChart,
  encCellHasBounds,
  encCoastForChart,
  encDepthAreasForChart,
  encForChart,
  encHazardsForChart,
  encHelmLabel,
  encPackRowLabel,
  encSoundingsForChart,
  packedEncOfficial,
} = await import("../src/lib/ahanu/packed-chart.ts");

describe("packed chart layers", () => {
  it("uses packed canyons / contours / HMS / buoys when present", async () => {
    await loadFixture();
    const canyons = canyonsForChart();
    assert.ok(canyons.features.length > 0);
    assert.ok(canyons.features.some((f) => (f.properties as { name?: string })?.name === "Veatch"));
    assert.ok(
      canyons.features.some((f) => (f.properties as { kind?: string })?.kind === "axis"),
      "fixture axes still paint when present",
    );
    assert.ok(canyonHeadsForLabels().some((h) => h.name === "Veatch"));
    const contours = contoursForChart();
    assert.ok(contours.c100.features.length >= 1);
    assert.equal(
      contours.c200.features.length,
      0,
      "packed fixture has 100fm only — do not invent 200fm",
    );
    assert.ok(hmsForChart().features.length >= 1);
    const buoys = buoysForChart();
    assert.ok(buoys.some((b) => b.id === "44097"));
    assert.ok(packedEncCells().some((c) => c.id === "US5RI10M"));
    assert.ok(packedEncCells().some((c) => c.id === "US5RI10M" && encCellHasBounds(c)));
    const encBoxes = encCatalogForChart();
    assert.ok(encBoxes.features.length >= 1, "fixture cells with bounds should paint");
    assert.ok(encBoxes.features.some((f) => (f.properties as { id?: string })?.id === "US5RI10M"));
  });

  it("missing canyons/contours/HMS/buoys stay empty — no seed fallback", async () => {
    await loadFixture(["canyons", "contours", "hms_zones", "buoys"]);
    assert.equal(layerPaintSource("canyons"), "missing");
    assert.equal(layerPaintSource("contours"), "missing");
    assert.equal(layerPaintSource("hms_zones"), "missing");
    assert.equal(layerPaintSource("buoys"), "missing");
    assert.equal(canyonsForChart().features.length, 0);
    assert.equal(contoursForChart().c100.features.length, 0);
    assert.equal(hmsForChart().features.length, 0);
    assert.equal(buoysForChart().length, 0);
  });

  it("packed bathymetry uses the pack bbox", async () => {
    await loadFixture();
    const img = fieldImage("depth", 0, 16, 10);
    assert.ok(img);
    assert.equal(img.source, "fixture");
    assert.equal(img.bbox.west, POINT_JUDITH_CANYON_BBOX.west);
    assert.equal(img.bbox.east, POINT_JUDITH_CANYON_BBOX.east);
  });

  it("missing bathymetry does not paint the local model", async () => {
    await loadFixture(["bathymetry"]);
    assert.equal(layerPaintSource("bathymetry"), "missing");
    assert.equal(fieldImage("depth", 0, 8, 6), null);
  });
});

describe("live SST daily paint", () => {
  it("marks packed noaa and samples the daily field past hour 0", async () => {
    const { encodeLayerBody } = await import("../src/lib/ahanu/pack-fixtures.ts");
    const { sampleCsvForTests, parseErddapSstCsv, sstTableToPacked, SST_ENDPOINTS } =
      await import("../src/lib/ahanu/noaa-sst.ts");
    const table = parseErddapSstCsv(sampleCsvForTests())!;
    const grid = sstTableToPacked(table, SST_ENDPOINTS[0]!, POINT_JUDITH_CANYON_BBOX)!;
    const { bodies } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    bodies.sst = encodeLayerBody(grid);
    setPackedOcean(packedOceanFromBodies(bodies));
    assert.equal(layerPaintSource("sst"), "packed");
    const at0 = samplePackedKind("sst", 40.0, -71.6, 0);
    const at36 = samplePackedKind("sst", 40.0, -71.6, 36);
    assert.ok(at0 != null);
    assert.equal(at36, at0);
    const img = fieldImage("sst", 12, 8, 6);
    assert.ok(img);
    assert.equal(img.source, "packed");
  });
});

describe("live chlorophyll daily paint", () => {
  it("marks packed noaa and samples the daily field past hour 0", async () => {
    const { encodeLayerBody } = await import("../src/lib/ahanu/pack-fixtures.ts");
    const { sampleChlCsvForTests, parseErddapChlCsv, chlTableToPacked, CHL_ENDPOINTS } =
      await import("../src/lib/ahanu/noaa-chl.ts");
    const table = parseErddapChlCsv(sampleChlCsvForTests())!;
    const grid = chlTableToPacked(table, CHL_ENDPOINTS[0]!, POINT_JUDITH_CANYON_BBOX)!;
    const { bodies } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    bodies.chlorophyll = encodeLayerBody(grid);
    setPackedOcean(packedOceanFromBodies(bodies));
    assert.equal(layerPaintSource("chlorophyll"), "packed");
    const at0 = samplePackedKind("chl", 40.0, -71.6, 0);
    const at36 = samplePackedKind("chl", 40.0, -71.6, 36);
    assert.ok(at0 != null);
    assert.equal(at36, at0);
    const img = fieldImage("chl", 12, 8, 6);
    assert.ok(img);
    assert.equal(img.source, "packed");
  });
});

describe("live SSH daily paint", () => {
  it("marks packed noaa and samples the daily field past hour 0", async () => {
    const { encodeLayerBody } = await import("../src/lib/ahanu/pack-fixtures.ts");
    const { sampleSshCsvForTests, parseErddapSshCsv, sshTableToPacked, SSH_ENDPOINTS } =
      await import("../src/lib/ahanu/noaa-ssh.ts");
    const table = parseErddapSshCsv(sampleSshCsvForTests())!;
    const grid = sshTableToPacked(table, SSH_ENDPOINTS[0]!, POINT_JUDITH_CANYON_BBOX)!;
    const { bodies } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    bodies.altimetry = encodeLayerBody(grid);
    setPackedOcean(packedOceanFromBodies(bodies));
    assert.equal(layerPaintSource("altimetry"), "packed");
    const at0 = samplePackedKind("ssh", 40.125, -71.625, 0);
    const at36 = samplePackedKind("ssh", 40.125, -71.625, 36);
    assert.ok(at0 != null);
    assert.equal(at36, at0);
    const img = fieldImage("ssh", 12, 8, 6);
    assert.ok(img);
    assert.equal(img.source, "packed");
  });
});

describe("live HMS closed-area paint", () => {
  it("marks packed noaa and paints the reminder polygons", async () => {
    const { encodeLayerBody } = await import("../src/lib/ahanu/pack-fixtures.ts");
    const { sampleHmsKmlForTests, parseKmlPolygons, hmsToPackedJson, HMS_REMINDER_NOTE } =
      await import("../src/lib/ahanu/noaa-hms.ts");
    const { hmsForChart } = await import("../src/lib/ahanu/packed-chart.ts");
    const feats = parseKmlPolygons(sampleHmsKmlForTests());
    const body = hmsToPackedJson(feats, HMS_REMINDER_NOTE);
    const { bodies } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    bodies.hms_zones = encodeLayerBody(body);
    setPackedOcean(packedOceanFromBodies(bodies));
    assert.equal(layerPaintSource("hms_zones"), "packed");
    const geo = hmsForChart();
    assert.ok(geo.features.length >= 1);
    assert.equal((geo.features[0]!.properties as { legal?: boolean })?.legal, false);
    assert.equal((geo as { legal?: boolean }).legal, false);
  });
});

describe("live bathymetry paint", () => {
  it("marks packed noaa and paints canyon walls plus 100/200-fm contours", async () => {
    const { encodeLayerBody } = await import("../src/lib/ahanu/pack-fixtures.ts");
    const {
      sampleBathyCsvForTests,
      parseErddapBathyCsv,
      bathyTableToPacked,
      contoursFromDepthGrid,
      BATHY_ENDPOINTS,
    } = await import("../src/lib/ahanu/noaa-bathy.ts");
    const { contoursForChart } = await import("../src/lib/ahanu/packed-chart.ts");
    const table = parseErddapBathyCsv(sampleBathyCsvForTests())!;
    const grid = bathyTableToPacked(table, BATHY_ENDPOINTS[0]!, POINT_JUDITH_CANYON_BBOX)!;
    const contours = contoursFromDepthGrid(grid)!;
    const { bodies } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    bodies.bathymetry = encodeLayerBody(grid);
    bodies.contours = encodeLayerBody(contours);
    setPackedOcean(packedOceanFromBodies(bodies));
    assert.equal(layerPaintSource("bathymetry"), "packed");
    assert.equal(layerPaintSource("contours"), "packed");
    const atVeatch = samplePackedKind("depth", 40.0, -70.4, 0);
    assert.ok(atVeatch != null && atVeatch > 180, `expected canyon wall, got ${atVeatch}`);
    const img = fieldImage("depth", 0, 8, 6);
    assert.ok(img);
    assert.equal(img.source, "packed");
    const split = contoursForChart();
    assert.ok(split.c100.features.length >= 1);
    assert.ok(split.c200.features.length >= 1, "200 fm should paint when the live grid crosses 366 m");
  });
});


describe("live canyon heads paint", () => {
  it("paints packed NOAA named kind:head points and labels — no invented axes", async () => {
    const { encodeLayerBody } = await import("../src/lib/ahanu/pack-fixtures.ts");
    const {
      sampleCanyonsGeojsonForTests,
      parseCanyonGazetteer,
      clipCanyonFeatures,
      canyonsToPackedJson,
      CANYON_AID_NOTE,
    } = await import("../src/lib/ahanu/noaa-canyons.ts");
    const feats = clipCanyonFeatures(parseCanyonGazetteer(sampleCanyonsGeojsonForTests()), POINT_JUDITH_CANYON_BBOX);
    const body = canyonsToPackedJson(feats, CANYON_AID_NOTE);
    const { bodies } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    bodies.canyons = encodeLayerBody(body);
    setPackedOcean(packedOceanFromBodies(bodies));
    assert.equal(layerPaintSource("canyons"), "packed");
    const geo = canyonsForChart();
    const heads = geo.features.filter(
      (f) => f.geometry?.type === "Point" && (f.properties as { kind?: string } | null)?.kind === "head",
    );
    const axes = geo.features.filter((f) => (f.properties as { kind?: string } | null)?.kind === "axis");
    assert.equal(axes.length, 0, "live pack is heads only — do not invent axes");
    const names = heads.map((f) => String((f.properties as { name?: string } | null)?.name ?? ""));
    assert.ok(names.includes("Veatch"));
    assert.ok(names.includes("Atlantis"));
    assert.ok(names.includes("Hydrographer"));
    assert.ok(names.includes("Hudson"));
    assert.ok(!names.includes("Norfolk"), "out-of-box heads stay out");
    const veatch = heads.find((f) => (f.properties as { name?: string } | null)?.name === "Veatch");
    assert.ok(veatch);
    assert.deepEqual((veatch.geometry as GeoJSON.Point).coordinates, [-69.6, 39.866667]);
    const atlantis = heads.find((f) => (f.properties as { name?: string } | null)?.name === "Atlantis");
    assert.ok(atlantis);
    assert.deepEqual((atlantis.geometry as GeoJSON.Point).coordinates, [-70.2, 39.866667]);
    const hydro = heads.find((f) => (f.properties as { name?: string } | null)?.name === "Hydrographer");
    assert.ok(hydro);
    assert.deepEqual((hydro.geometry as GeoJSON.Point).coordinates, [-69.05, 40.2]);
    const labels = canyonHeadsForLabels();
    assert.ok(labels.some((h) => h.name === "Veatch" && h.lon === -69.6 && h.lat === 39.866667));
    assert.ok(labels.some((h) => h.name === "Atlantis" && h.lon === -70.2 && h.lat === 39.866667));
    assert.ok(labels.some((h) => h.name === "Hydrographer" && h.lon === -69.05 && h.lat === 40.2));
    assert.equal(labels.length, heads.length);
  });

  it("empty live canyons stay empty — no invented points", async () => {
    const { encodeLayerBody } = await import("../src/lib/ahanu/pack-fixtures.ts");
    const { canyonsToPackedJson, CANYON_AID_NOTE } = await import("../src/lib/ahanu/noaa-canyons.ts");
    const { bodies } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    bodies.canyons = encodeLayerBody(canyonsToPackedJson([], CANYON_AID_NOTE));
    setPackedOcean(packedOceanFromBodies(bodies));
    assert.equal(canyonsForChart().features.length, 0);
    assert.equal(canyonHeadsForLabels().length, 0);
  });
});

describe("ENC catalog aid overlay", () => {
  it("cells with west/south/east/north become overlay features", () => {
    const geo = encCatalogFeatures([
      { id: "US5RI10M", usage: 5, name: "Point Judith / Galilee", west: -71.55, south: 41.34, east: -71.45, north: 41.4 },
      { id: "US5NONE", usage: 5, name: "no box" },
    ]);
    assert.equal(geo.features.length, 1);
    const f = geo.features[0]!;
    assert.equal(f.geometry.type, "Polygon");
    assert.equal((f.properties as { id?: string })?.id, "US5RI10M");
    assert.equal((f.properties as { legal?: boolean })?.legal, false);
    assert.equal((f.properties as { kind?: string })?.kind, "enc-catalog");
    const ring = (f.geometry as GeoJSON.Polygon).coordinates[0]!;
    assert.deepEqual(ring[0], [-71.55, 41.34]);
    assert.deepEqual(ring[2], [-71.45, 41.4]);
  });

  it("empty or missing catalog stays empty", async () => {
    assert.equal(encCatalogFeatures([]).features.length, 0);
    clearPackedOcean();
    assert.equal(encCatalogForChart().features.length, 0);
    await loadFixture(["enc"]);
    assert.equal(layerPaintSource("enc"), "missing");
    assert.equal(packedEncCells().length, 0);
    assert.equal(encCatalogForChart().features.length, 0);
  });

  it("cells without usable bounds do not paint", () => {
    const geo = encCatalogFeatures([
      { id: "US5BAD1", usage: 5, name: "inverted", west: -70, south: 41, east: -71, north: 42 },
      { id: "US5BAD2", usage: 5, name: "nan", west: Number.NaN, south: 41, east: -71, north: 42 },
    ]);
    assert.equal(geo.features.length, 0);
  });
});


describe("ENC official S-57 helm", () => {
  it("no-pack helm label stays catalog aid", () => {
    assert.equal(encHelmLabel(), "ENC catalog (aid)");
    assert.equal(encPackRowLabel("NOAA ENC (catalog or S-57)"), "NOAA ENC (catalog aid)");
  });

  it("labels official S-57 and paints those cell boxes only", async () => {
    const { encodeLayerBody } = await import("../src/lib/ahanu/pack-fixtures.ts");
    const { encToPackedJson } = await import("../src/lib/ahanu/noaa-enc.ts");
    const packed = encToPackedJson(
      POINT_JUDITH_CANYON_BBOX,
      [
        {
          id: "US5PVDBB",
          usage: 5,
          name: "Point Judith Harbor",
          west: -71.55,
          south: 41.325,
          east: -71.475,
          north: 41.4,
        },
        {
          id: "US3NY01M",
          usage: 3,
          name: "Approaches to New York",
          west: -74.0,
          south: 38.8,
          east: -69.2,
          north: 41.5,
        },
      ],
      {
        catalogUrl: "https://charts.noaa.gov/ENCs/ENCProdCat.xml",
        officialS57: [
          {
            id: "US5PVDBB",
            official: true,
            encoding: "s-57",
            iso8211: true,
            catalog031: true,
            file000: "US5PVDBB.000",
            file000Bytes: 417929,
            leader: "015823LE1 0900201 ! 3404",
            zipBytes: 114301,
            zipSha256: "abc",
            zipBase64: "UEsD",
          },
        ],
      },
    );
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const bodies = { ...fixture.bodies, enc: encodeLayerBody(packed) };
    setPackedOcean(packedOceanFromBodies(bodies, "noaa"));
    assert.equal(packedEncOfficial(), true);
    assert.equal(encHelmLabel("noaa"), "ENC official S-57 · NOAA");
    assert.equal(encPackRowLabel("NOAA ENC (catalog or S-57)"), "NOAA ENC (official S-57)");
    const geo = encCatalogForChart();
    assert.equal(geo.features.length, 1);
    assert.equal((geo.features[0]!.properties as { id?: string })?.id, "US5PVDBB");
    assert.equal((geo.features[0]!.properties as { kind?: string })?.kind, "enc-s57");
    assert.equal(encForChart().features.length, 1, "unparseable zip falls back to catalog boxes");
    assert.equal(encAidsForChart().features.length, 0, "do not invent aids from a stub zip");
    assert.equal(encSoundingsForChart().features.length, 0);
  });

  it("paints S-57 extract from packed official zip bytes", async () => {
    const { encodeLayerBody } = await import("../src/lib/ahanu/pack-fixtures.ts");
    const { encToPackedJson, makeStoredZip, bytesToBase64, isIso8211 } = await import("../src/lib/ahanu/noaa-enc.ts");
    const { sampleS57ExtractDot000, applyOfficialS57Extract } = await import("../src/lib/ahanu/s57-extract.ts");
    const dot = sampleS57ExtractDot000("US5TESTA");
    assert.equal(isIso8211(dot), true);
    const zip = makeStoredZip([
      { name: "ENC_ROOT/US5TESTA/US5TESTA.000", data: dot },
      { name: "ENC_ROOT/CATALOG.031", data: new TextEncoder().encode("002623LE1 0900073   66040000000019000000") },
    ]);
    const packed = encToPackedJson(
      POINT_JUDITH_CANYON_BBOX,
      [
        {
          id: "US5TESTA",
          usage: 5,
          name: "Test Harbor",
          west: -71.6,
          south: 41.3,
          east: -71.4,
          north: 41.4,
        },
      ],
      {
        catalogUrl: "https://charts.noaa.gov/ENCs/ENCProdCat.xml",
        officialS57: [
          {
            id: "US5TESTA",
            official: true,
            encoding: "s-57",
            iso8211: true,
            catalog031: true,
            file000: "US5TESTA.000",
            file000Bytes: dot.byteLength,
            leader: new TextDecoder("latin1").decode(dot.subarray(0, 24)),
            zipBytes: zip.byteLength,
            zipSha256: "test",
            zipBase64: bytesToBase64(zip),
          },
        ],
      },
    );
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const bodies = { ...fixture.bodies, enc: encodeLayerBody(packed) };
    const ocean = packedOceanFromBodies(bodies, "noaa");
    await applyOfficialS57Extract(ocean.enc);
    setPackedOcean(ocean);
    assert.equal(packedEncOfficial(), true);
    assert.equal(encPackRowLabel(), "NOAA ENC (official S-57)");
    const cells = encForChart();
    assert.equal(cells.features.length, 1);
    assert.equal((cells.features[0]!.properties as { kind?: string })?.kind, "enc-s57-cell");
    assert.match(String((cells.features[0]!.properties as { extract?: string })?.extract), /S-57 extract/i);
    const ring = (cells.features[0]!.geometry as GeoJSON.Polygon).coordinates[0]!;
    const west = Math.min(...ring.map((p) => p[0]!));
    const east = Math.max(...ring.map((p) => p[0]!));
    const south = Math.min(...ring.map((p) => p[1]!));
    const north = Math.max(...ring.map((p) => p[1]!));
    assert.ok(west <= -71.516 && east >= -71.51);
    assert.ok(south <= 41.35 && north >= 41.385);
    const aids = encAidsForChart();
    assert.equal(aids.features.length, 2);
    assert.ok(aids.features.some((f) => (f.properties as { kind?: string })?.kind === "enc-s57-light"));
    assert.ok(aids.features.some((f) => (f.properties as { name?: string })?.name === "Test Channel Buoy 7"));
    const light = aids.features.find((f) => (f.properties as { kind?: string })?.kind === "enc-s57-light")!;
    const [lon, lat] = (light.geometry as GeoJSON.Point).coordinates;
    assert.ok(Math.abs(lon - -71.5147222) < 1e-5);
    assert.ok(Math.abs(lat - 41.3656111) < 1e-5);
    const snd = encSoundingsForChart();
    assert.equal(snd.features.length, 1);
    assert.equal((snd.features[0]!.properties as { depthM?: number })?.depthM, 12.6);
    assert.equal((snd.features[0]!.properties as { kind?: string })?.kind, "enc-s57-sounding");
    const coast = encCoastForChart();
    assert.equal(coast.features.length, 1);
    assert.equal((coast.features[0]!.properties as { kind?: string })?.kind, "enc-s57-coastline");
    assert.match(String((coast.features[0]!.properties as { extract?: string })?.extract), /S-57 extract/i);
    const depare = encDepthAreasForChart();
    assert.equal(depare.features.length, 1);
    assert.equal((depare.features[0]!.properties as { drval1?: number })?.drval1, 0);
    const hazards = encHazardsForChart();
    assert.ok(hazards.features.some((f) => (f.properties as { kind?: string })?.kind === "enc-s57-wreck"));
  });
});

const { ENC_PAINT_LAYERS, ENC_STROKE_LAYERS, applyEncLayerPaint, encLayerPaint } = await import("../src/lib/ahanu/enc-paint.ts");
const { DEFAULT_LAYERS } = await import("../src/lib/ahanu/constants.ts");

describe("encLayerPaint — skipper toggle", () => {
  it("toggle on → every ENC paint opacity > 0 at the slider", () => {
    const paint = encLayerPaint(true, 0.95);
    for (const id of ENC_PAINT_LAYERS) {
      assert.ok(paint[id].opacity > 0, `${id} should paint when ENC is on`);
    }
    assert.equal(paint.enc.opacity, 0.95);
    assert.ok(paint["enc-outline"].opacity > 0);
    assert.ok(paint["enc-aids"].opacity > 0);
    assert.ok(paint["enc-soundings"].opacity > 0);
    assert.ok(paint["enc-coast"].opacity > 0);
    assert.ok(paint["enc-depth-areas"].opacity > 0);
    assert.ok(paint["enc-hazards"].opacity > 0);
  });

  it("toggle off → every ENC paint opacity 0 even at a high slider", () => {
    const paint = encLayerPaint(false, 0.95);
    for (const id of ENC_PAINT_LAYERS) {
      assert.equal(paint[id].opacity, 0, `${id} must stay 0 when ENC is off`);
    }
  });

  it("toggle off → circle-stroke-opacity is 0 (default MapLibre stroke is 1)", () => {
    const off = encLayerPaint(false, 0.95);
    for (const id of ENC_STROKE_LAYERS) {
      assert.equal(off[id].stroke?.prop, "circle-stroke-opacity", `${id} must own stroke paint`);
      assert.equal(off[id].stroke?.opacity, 0, `${id} stroke must be 0 when ENC is off`);
    }
    const on = encLayerPaint(true, 0.32);
    for (const id of ENC_STROKE_LAYERS) {
      assert.ok((on[id].stroke?.opacity ?? 0) > 0, `${id} stroke should paint when ENC is on`);
    }
    assert.equal(off["enc-soundings"].stroke, undefined, "soundings have no stroke-width");
  });

  it("default helm ENC (on, 0.32) paints; does not stay at the old addLayer 0", () => {
    const d = DEFAULT_LAYERS.enc;
    assert.equal(d.visible, true);
    const paint = encLayerPaint(d.visible, d.opacity);
    assert.equal(paint.enc.opacity, 0.32);
    for (const id of ENC_PAINT_LAYERS) {
      assert.ok(paint[id].opacity > 0, `${id} default on must not be 0`);
    }
  });

  it("applyEncLayerPaint writes on/off onto existing layers only", () => {
    const set: Record<string, Record<string, number>> = {};
    const layers = new Set(["enc", "enc-outline", "enc-aids", "enc-soundings"]);
    const map = {
      getLayer: (id: string) => (layers.has(id) ? {} : undefined),
      setPaintProperty: (id: string, prop: string, value: number) => {
        set[id] = { ...(set[id] ?? {}), [prop]: value };
      },
    };
    applyEncLayerPaint(map, true, 0.95);
    assert.equal(set.enc?.["fill-opacity"], 0.95);
    assert.ok((set["enc-outline"]?.["line-opacity"] ?? 0) > 0);
    assert.ok((set["enc-aids"]?.["circle-opacity"] ?? 0) > 0);
    assert.ok((set["enc-aids"]?.["circle-stroke-opacity"] ?? 0) > 0);
    assert.ok((set["enc-soundings"]?.["circle-opacity"] ?? 0) > 0);
    assert.equal(set["enc-coast"], undefined, "missing layer is not invented");
    applyEncLayerPaint(map, false, 0.95);
    assert.equal(set.enc?.["fill-opacity"], 0);
    assert.equal(set["enc-outline"]?.["line-opacity"], 0);
    assert.equal(set["enc-aids"]?.["circle-opacity"], 0);
    assert.equal(set["enc-aids"]?.["circle-stroke-opacity"], 0);
    assert.equal(set["enc-soundings"]?.["circle-opacity"], 0);
  });
});

const { HMS_PAINT_LAYERS, applyHmsLayerPaint, hmsLayerPaint } = await import("../src/lib/ahanu/hms-paint.ts");

describe("hmsLayerPaint — skipper toggle", () => {
  it("toggle on → fill and outline paint at the slider", () => {
    const paint = hmsLayerPaint(true, 0.35);
    assert.equal(paint.hms.opacity, 0.35);
    assert.equal(paint.hms.prop, "fill-opacity");
    assert.equal(paint["hms-outline"].opacity, 0.7);
    assert.equal(paint["hms-outline"].prop, "line-opacity");
    for (const id of HMS_PAINT_LAYERS) {
      assert.ok(paint[id].opacity > 0, `${id} should paint when HMS is on`);
    }
  });

  it("toggle off → fill and outline stay 0 even at a high slider", () => {
    const paint = hmsLayerPaint(false, 0.95);
    for (const id of HMS_PAINT_LAYERS) {
      assert.equal(paint[id].opacity, 0, `${id} must stay 0 when HMS is off`);
    }
  });

  it("default helm HMS (off, 0.35) stays 0; on at slider does not stay at the old addLayer 0", () => {
    const d = DEFAULT_LAYERS.hms_zones;
    assert.equal(d.visible, false);
    assert.equal(d.opacity, 0.35);
    const off = hmsLayerPaint(d.visible, d.opacity);
    assert.equal(off.hms.opacity, 0);
    assert.equal(off["hms-outline"].opacity, 0);
    const on = hmsLayerPaint(true, d.opacity);
    assert.equal(on.hms.opacity, 0.35);
    assert.ok(on["hms-outline"].opacity > 0);
  });

  it("applyHmsLayerPaint writes on/off onto existing layers only", () => {
    const set: Record<string, Record<string, number>> = {};
    const layers = new Set(["hms"]);
    const map = {
      getLayer: (id: string) => (layers.has(id) ? {} : undefined),
      setPaintProperty: (id: string, prop: string, value: number) => {
        set[id] = { ...(set[id] ?? {}), [prop]: value };
      },
    };
    applyHmsLayerPaint(map, true, 0.35);
    assert.equal(set.hms?.["fill-opacity"], 0.35);
    assert.equal(set["hms-outline"], undefined, "missing layer is not invented");
    applyHmsLayerPaint(map, false, 0.35);
    assert.equal(set.hms?.["fill-opacity"], 0);
  });
});
