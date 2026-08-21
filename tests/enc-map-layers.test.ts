import "./register-alias.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const { ENC_PAINT_LAYERS, ENC_STROKE_LAYERS, encLayerPaint } = await import("../src/lib/ahanu/enc-paint.ts");
const { PLOTTER_MAX_ZOOM } = await import("../src/lib/ahanu/constants.ts");
const {
  ENC_MAP_LAYERS,
  ENC_MUST_PAINT_ABOVE,
  encMapLayerIds,
  geometryFitsLayer,
  paintPropForLayerType,
} = await import("../src/lib/ahanu/enc-map-layers.ts");
const { bindMaplibreWorkerUrl, MAPLIBRE_WORKER_SPECIFIER } = await import("../src/lib/ahanu/maplibre-worker.ts");
const { setPackedOcean, packedOceanFromBodies, clearPackedOcean } = await import("../src/lib/ahanu/packed-fields.ts");
const { encodeLayerBody } = await import("../src/lib/ahanu/pack-fixtures.ts");
const { encToPackedJson } = await import("../src/lib/ahanu/noaa-enc.ts");
const { POINT_JUDITH_CANYON_BBOX, buildFixturePack } = await import("../src/lib/ahanu/pack.ts");
const {
  encLandPolygons,
  encCoastForChart,
  encShoreForChart,
  encDepthAreasForChart,
  encAidsForChart,
  encSoundingsForChart,
  encHazardsForChart,
} = await import("../src/lib/ahanu/packed-chart.ts");

const CHART_MAP = fileURLToPath(new URL("../src/components/chartplotter/ChartMap.tsx", import.meta.url));

afterEach(() => {
  clearPackedOcean();
});

function parseAddLayers(src: string): { id: string; type: string; source: string; beforeId: string | null; index: number }[] {
  const layers: { id: string; type: string; source: string; beforeId: string | null; index: number }[] = [];
  const re =
    /addLayer\(\{\s*id:\s*(?:"([^"]+)"|id)\s*,\s*type:\s*"(\w+)"\s*,\s*source:\s*(?:"([^"]+)"|id)([\s\S]*?)\}\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const rest = m[4] ?? "";
    const before = /beforeId:\s*"([^"]+)"/.exec(rest);
    layers.push({
      id: m[1] ?? "(raster-loop)",
      type: m[2]!,
      source: m[3] ?? m[1] ?? "(raster-loop)",
      beforeId: before?.[1] ?? null,
      index: m.index,
    });
  }
  return layers;
}

describe("bindMaplibreWorkerUrl", () => {
  it("sets the worker URL and refuses an empty one", () => {
    let set = "";
    bindMaplibreWorkerUrl({ setWorkerUrl: (u) => (set = u) }, "/assets/maplibre-gl-worker.js");
    assert.equal(set, "/assets/maplibre-gl-worker.js");
    assert.throws(() => bindMaplibreWorkerUrl({ setWorkerUrl: () => {} }, "  "), /empty/);
  });
});

describe("ENC map layer contract", () => {
  it("covers every ENC paint layer with matching paint prop", () => {
    assert.deepEqual(encMapLayerIds(), [...ENC_PAINT_LAYERS]);
    for (const spec of ENC_MAP_LAYERS) {
      assert.equal(spec.paintProp, paintPropForLayerType(spec.type), `${spec.id} paint prop`);
      assert.equal(encLayerPaint(true, 0.32)[spec.id].prop, spec.paintProp);
      assert.ok(geometryFitsLayer(spec.type, spec.geometry), `${spec.id} geometry vs type`);
    }
    assert.equal(geometryFitsLayer("fill", "LineString"), false, "LineString must not ride a fill layer");
    assert.equal(geometryFitsLayer("circle", "Polygon"), false, "Polygon must not ride a circle layer");
    assert.equal(geometryFitsLayer("fill", "Polygon"), true);
  });

  it("ChartMap addLayer source/type match the contract and ENC sits above rasters", async () => {
    const src = await readFile(CHART_MAP, "utf8");
    const layers = parseAddLayers(src);
    const byId = new Map(layers.map((l) => [l.id, l]));

    for (const spec of ENC_MAP_LAYERS) {
      const layer = byId.get(spec.id);
      assert.ok(layer, `missing addLayer ${spec.id}`);
      assert.equal(layer.type, spec.type, `${spec.id} wrong layer type — data+opacity would not paint`);
      assert.equal(layer.source, spec.source, `${spec.id} wrong source id`);
    }

    const firstEnc = Math.min(...ENC_MAP_LAYERS.map((s) => byId.get(s.id)!.index));
    for (const id of ENC_MUST_PAINT_ABOVE) {
      const named = src.indexOf(`id: "${id}"`);
      const loop = id === "land" || id === "bathy" ? -1 : src.indexOf('type: "raster"');
      const rasterAt = Math.max(named, loop);
      assert.ok(rasterAt >= 0, `raster ${id} should be added`);
      assert.ok(firstEnc > rasterAt, `${id} would bury ENC if added after it`);
    }

    for (const spec of ENC_MAP_LAYERS) {
      const layer = byId.get(spec.id)!;
      assert.equal(layer.beforeId, null, `${spec.id} beforeId would bury ENC under ${layer.beforeId}`);
    }

    for (const id of ENC_STROKE_LAYERS) {
      const re = new RegExp(`id: "${id}"[\\s\\S]*?circle-stroke-opacity": encPaint\\["${id}"\\]\\.stroke\\?\\.opacity`);
      assert.match(src, re, `${id} addLayer must paint circle-stroke-opacity from ENC paint`);
    }
  });

  it("raises plotter maxZoom past 12.5 so harbor ENC cells are usable", async () => {
    const src = await readFile(CHART_MAP, "utf8");
    assert.ok(PLOTTER_MAX_ZOOM >= 15, `harbor cells need >= 15, got ${PLOTTER_MAX_ZOOM}`);
    assert.ok(PLOTTER_MAX_ZOOM <= 22, "MapLibre default ceiling is 22");
    assert.match(src, /maxZoom:\s*PLOTTER_MAX_ZOOM/);
    assert.doesNotMatch(src, /maxZoom:\s*12\.5/);
    assert.doesNotMatch(src, /maxzoom:\s*12\.5/i);
    assert.match(src, /image overlays \(no native maxzoom\)/);
  });

  it("binds the MapLibre worker before constructing the map", async () => {
    const src = await readFile(CHART_MAP, "utf8");
    assert.match(src, /ensureMaplibreWorker/);
    assert.match(src, /maplibre-worker/);
    const bindAt = src.indexOf("ensureMaplibreWorker(maplibregl)");
    const mapAt = src.indexOf("new maplibregl.Map");
    assert.ok(bindAt >= 0 && mapAt > bindAt, "worker must be bound before new Map or GeoJSON never tiles");
    assert.equal(MAPLIBRE_WORKER_SPECIFIER, "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url");
  });
});

describe("ENC source geometry vs layer type", () => {
  it("drops LineString from fill sources and Polygon from circle sources", async () => {
    const mixed: GeoJSON.Feature[] = [
      {
        type: "Feature",
        properties: { kind: "enc-s57-land" },
        geometry: { type: "LineString", coordinates: [[-71.5, 41.36], [-71.49, 41.37]] },
      },
      {
        type: "Feature",
        properties: { kind: "enc-s57-land" },
        geometry: {
          type: "Polygon",
          coordinates: [[[-71.52, 41.35], [-71.51, 41.35], [-71.51, 41.36], [-71.52, 41.36], [-71.52, 41.35]]],
        },
      },
      {
        type: "Feature",
        properties: { kind: "enc-s57-coastline" },
        geometry: {
          type: "Polygon",
          coordinates: [[[-71.5, 41.35], [-71.49, 41.35], [-71.49, 41.36], [-71.5, 41.36], [-71.5, 41.35]]],
        },
      },
      {
        type: "Feature",
        properties: { kind: "enc-s57-coastline" },
        geometry: { type: "LineString", coordinates: [[-71.49639, 41.37542], [-71.496, 41.376]] },
      },
      {
        type: "Feature",
        properties: { kind: "enc-s57-depth-area" },
        geometry: { type: "LineString", coordinates: [[-71.5, 41.36], [-71.49, 41.36]] },
      },
      {
        type: "Feature",
        properties: { kind: "enc-s57-aid" },
        geometry: {
          type: "Polygon",
          coordinates: [[[-71.5, 41.36], [-71.499, 41.36], [-71.499, 41.361], [-71.5, 41.361], [-71.5, 41.36]]],
        },
      },
      {
        type: "Feature",
        properties: { kind: "enc-s57-aid" },
        geometry: { type: "Point", coordinates: [-71.51, 41.365] },
      },
      {
        type: "Feature",
        properties: { kind: "enc-s57-sounding" },
        geometry: { type: "Point", coordinates: [-71.512, 41.366] },
      },
    ];

    const packed = encToPackedJson(POINT_JUDITH_CANYON_BBOX, [], {
      catalogUrl: "https://charts.noaa.gov/ENCs/ENCProdCat.xml",
    });
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: "2026-08-20T12:00:00.000Z",
      hours: 72,
      createdAt: "2026-08-20T12:00:00.000Z",
    });
    const ocean = packedOceanFromBodies({ ...fixture.bodies, enc: encodeLayerBody(packed) }, "noaa");
    assert.ok(ocean.enc);
    ocean.enc.extract = {
      official: true,
      note: "S-57 extract — not ECDIS",
      cells: [],
      features: mixed,
    };
    setPackedOcean(ocean);

    const land = encLandPolygons();
    assert.equal(land.features.length, 1);
    assert.equal(land.features[0]!.geometry.type, "Polygon");
    const coast = encCoastForChart();
    assert.equal(coast.features.length, 1);
    assert.equal(coast.features[0]!.geometry.type, "LineString");
    assert.equal(encDepthAreasForChart().features.length, 0, "LineString depth area must not enter a fill source");
    const aids = encAidsForChart();
    assert.equal(aids.features.length, 1);
    assert.equal(aids.features[0]!.geometry.type, "Point");
    assert.equal(encSoundingsForChart().features.length, 1);
  });

  it("routes leftover skipper kinds without inventing polygons", async () => {
    const leftover: GeoJSON.Feature[] = [
      {
        type: "Feature",
        properties: { kind: "enc-s57-land", acronym: "LNDRGN" },
        geometry: {
          type: "Polygon",
          coordinates: [[[-71.52, 41.37], [-71.51, 41.37], [-71.51, 41.38], [-71.52, 41.38], [-71.52, 41.37]]],
        },
      },
      {
        type: "Feature",
        properties: { kind: "enc-s57-lake", acronym: "LAKARE" },
        geometry: {
          type: "Polygon",
          coordinates: [[[-71.53, 41.36], [-71.52, 41.36], [-71.52, 41.37], [-71.53, 41.37], [-71.53, 41.36]]],
        },
      },
      {
        type: "Feature",
        properties: { kind: "enc-s57-slope", acronym: "SLOTOP" },
        geometry: { type: "LineString", coordinates: [[-71.5, 41.36], [-71.49, 41.36]] },
      },
      {
        type: "Feature",
        properties: { kind: "enc-s57-seabed", acronym: "SBDARE" },
        geometry: { type: "Point", coordinates: [-71.51, 41.35] },
      },
      {
        type: "Feature",
        properties: { kind: "enc-s57-obstruction", acronym: "UWTROC" },
        geometry: { type: "Point", coordinates: [-71.512, 41.361] },
      },
    ];
    const packed = encToPackedJson(POINT_JUDITH_CANYON_BBOX, [], {
      catalogUrl: "https://charts.noaa.gov/ENCs/ENCProdCat.xml",
    });
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: "2026-08-20T12:00:00.000Z",
      hours: 72,
      createdAt: "2026-08-20T12:00:00.000Z",
    });
    const ocean = packedOceanFromBodies({ ...fixture.bodies, enc: encodeLayerBody(packed) }, "noaa");
    assert.ok(ocean.enc);
    ocean.enc.extract = { official: true, note: "S-57 extract — not ECDIS", cells: [], features: leftover };
    setPackedOcean(ocean);
    assert.equal(encLandPolygons().features.length, 1);
    assert.equal(encDepthAreasForChart().features.length, 1);
    assert.equal((encDepthAreasForChart().features[0]!.properties as { acronym?: string })?.acronym, "LAKARE");
    assert.equal(encShoreForChart().features.length, 1);
    assert.equal((encShoreForChart().features[0]!.properties as { acronym?: string })?.acronym, "SLOTOP");
    const hazards = encHazardsForChart();
    assert.equal(hazards.features.length, 2);
    assert.ok(hazards.features.some((f) => (f.properties as { acronym?: string })?.acronym === "SBDARE"));
    assert.ok(hazards.features.some((f) => (f.properties as { acronym?: string })?.acronym === "UWTROC"));
  });
});
