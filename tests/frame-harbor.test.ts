import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (typeof globalThis.localStorage === "undefined") {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    clear: () => {
      map.clear();
    },
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

const {
  FRAME_HARBOR_FIT,
  FRAME_HARBOR_LABEL,
  FRAME_HARBOR_MAX_ZOOM,
  GALILEE_DOCK,
  HARBOR_FRAME_BAY_CELL,
  HARBOR_FRAME_CELL,
  HARBOR_FRAME_INLET,
  HARBOR_FRAME_UNION,
  applyFrameHarbor,
  bboxContainsLonLat,
  bboxToFrameHarbor,
  harborFrameOf,
  harborFootprints,
  isHarborScaleBbox,
} = await import("../src/lib/ahanu/frame-harbor.ts");
const { POINT_JUDITH_CANYON_BBOX, POINT_JUDITH_HARBOR_BBOX, PLOTTER_MAX_ZOOM } =
  await import("../src/lib/ahanu/constants.ts");
const { CAMERA_KEY, writePersistedCamera, readPersistedCamera } =
  await import("../src/lib/ahanu/plotter-camera.ts");
const { FOLLOW_KEY } = await import("../src/lib/ahanu/follow-camera.ts");
const { useAhanu } = await import("../src/lib/ahanu/store.ts");
const { extractS57FromDot000 } = await import("../src/lib/ahanu/s57-extract.ts");

const CHART_MAP = fileURLToPath(
  new URL("../src/components/chartplotter/ChartMap.tsx", import.meta.url),
);
const APP_SHELL = fileURLToPath(new URL("../src/components/ahanu/AppShell.tsx", import.meta.url));
const PACKS = fileURLToPath(new URL("../src/components/panels/PacksPanel.tsx", import.meta.url));
const SETTINGS = fileURLToPath(new URL("../src/components/panels/SettingsPanel.tsx", import.meta.url));
const STORE = fileURLToPath(new URL("../src/lib/ahanu/store.ts", import.meta.url));

const US5PVDCB = { west: -71.55, south: 41.4, east: -71.475, north: 41.475 };
const US5PVDBB = { west: -71.55, south: 41.325, east: -71.475, north: 41.4 };
const US5PVDDD = { west: -71.4, south: 41.475, east: -71.325, north: 41.55 };
const HARBOR_INLET = { west: -71.55, south: 41.325, east: -71.475, north: 41.475 };

function assertContainsGalilee(bbox: { west: number; south: number; east: number; north: number }) {
  assert.equal(GALILEE_DOCK.lon, -71.51);
  assert.equal(GALILEE_DOCK.lat, 41.3615);
  assert.ok(bboxContainsLonLat(bbox, GALILEE_DOCK.lon, GALILEE_DOCK.lat), "Galilee dock must sit inside the framed box");
  assert.ok(bbox.south <= 41.3615 && bbox.north >= 41.3615);
  assert.ok(bbox.west <= -71.51 && bbox.east >= -71.51);
}

describe("Frame harbor bbox", () => {
  it("labels the helm control Frame harbor", () => {
    assert.equal(FRAME_HARBOR_LABEL, "Frame harbor");
    assert.equal(HARBOR_FRAME_CELL, "US5PVDCB");
    assert.equal(HARBOR_FRAME_INLET, "US5PVDBB");
    assert.deepEqual([...HARBOR_FRAME_UNION], ["US5PVDCB", "US5PVDBB"]);
    assert.equal(HARBOR_FRAME_BAY_CELL, "US5PVDDD");
  });

  it("uses the documented US5PVDBB / PJ harbor box when nothing is packed", () => {
    assert.deepEqual(POINT_JUDITH_HARBOR_BBOX, US5PVDBB);
    assert.deepEqual(bboxToFrameHarbor(null), { ...POINT_JUDITH_HARBOR_BBOX });
    assert.deepEqual(bboxToFrameHarbor(undefined), { ...POINT_JUDITH_HARBOR_BBOX });
    assert.deepEqual(bboxToFrameHarbor({}), { ...POINT_JUDITH_HARBOR_BBOX });
    const framed = harborFrameOf(null);
    assert.equal(framed.source, "pj-harbor-box");
    assert.deepEqual(framed.cellIds, []);
    assert.notDeepEqual(framed.bbox, { ...POINT_JUDITH_CANYON_BBOX });
    assertContainsGalilee(framed.bbox);
    assert.ok(framed.bbox.south <= 41.325 && framed.bbox.north >= 41.4);
  });

  it("unions packed official US5PVDCB+US5PVDBB so Galilee and the inlet stay in view", () => {
    const framed = harborFrameOf({
      extract: {
        cells: [
          { cellId: "US5PVDCB", bounds: US5PVDCB },
          { cellId: "US5PVDBB", bounds: US5PVDBB },
          { cellId: "US5PVDDD", bounds: US5PVDDD },
        ],
      },
      cells: [
        { id: "US5PVDCB", ...US5PVDCB },
        { id: "US5PVDBB", ...US5PVDBB },
      ],
    });
    assert.equal(framed.source, "harbor-union");
    assert.deepEqual(framed.cellIds, ["US5PVDCB", "US5PVDBB"]);
    assert.deepEqual(framed.bbox, HARBOR_INLET);
    assert.ok(isHarborScaleBbox(framed.bbox));
    assert.ok(framed.bbox.north - framed.bbox.south < 0.2);
    assert.ok(framed.bbox.east - framed.bbox.west < 0.2);
    assertContainsGalilee(framed.bbox);
    assert.equal(bboxContainsLonLat(US5PVDCB, GALILEE_DOCK.lon, GALILEE_DOCK.lat), false);
    assert.ok(!isHarborScaleBbox({ west: -71.55, south: 41.325, east: -71.325, north: 41.55 }));
  });

  it("uses packed US5PVDBB when US5PVDCB is missing and omits US5PVDDD Bay pull", () => {
    const framed = harborFrameOf({
      extract: {
        cells: [
          { cellId: "US5PVDBB", bounds: US5PVDBB },
          { cellId: "US5PVDDD", bounds: US5PVDDD },
        ],
      },
    });
    assert.equal(framed.source, "harbor-union");
    assert.deepEqual(framed.cellIds, ["US5PVDBB"]);
    assert.deepEqual(framed.bbox, US5PVDBB);
    assertContainsGalilee(framed.bbox);
  });

  it("includes US5PVDDD only when the union stays harbor-scale", () => {
    const smallBay = { west: -71.475, south: 41.45, east: -71.45, north: 41.475 };
    const framed = harborFrameOf({
      extract: {
        cells: [
          { cellId: "US5PVDCB", bounds: US5PVDCB },
          { cellId: "US5PVDBB", bounds: US5PVDBB },
          { cellId: "US5PVDDD", bounds: smallBay },
        ],
      },
    });
    assert.equal(framed.source, "harbor-union");
    assert.deepEqual(framed.cellIds, ["US5PVDCB", "US5PVDBB", "US5PVDDD"]);
    assert.deepEqual(framed.bbox, { west: -71.55, south: 41.325, east: -71.45, north: 41.475 });
    assert.ok(isHarborScaleBbox(framed.bbox));
    assertContainsGalilee(framed.bbox);
  });

  it("reads pack catalog boxes when extract has no bounds", () => {
    const framed = harborFrameOf({
      cells: [{ id: "US5PVDCB", ...US5PVDCB }],
    });
    assert.equal(framed.source, "US5PVDCB");
    assert.deepEqual(framed.bbox, US5PVDCB);
  });

  it("reads enc-s57-cell polygons when cell.bounds is missing", () => {
    const framed = harborFrameOf({
      extract: {
        features: [
          {
            type: "Feature",
            properties: { id: "US5PVDCB", kind: "enc-s57-cell" },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [US5PVDCB.west, US5PVDCB.south],
                  [US5PVDCB.east, US5PVDCB.south],
                  [US5PVDCB.east, US5PVDCB.north],
                  [US5PVDCB.west, US5PVDCB.north],
                  [US5PVDCB.west, US5PVDCB.south],
                ],
              ],
            },
          },
        ],
      },
    });
    assert.equal(framed.source, "US5PVDCB");
    assert.deepEqual(framed.bbox, US5PVDCB);
  });

  it("extract bounds win over a stale pack catalog box", () => {
    const prints = harborFootprints({
      extract: { cells: [{ cellId: "US5PVDCB", bounds: US5PVDCB }] },
      cells: [{ id: "US5PVDCB", west: -72.8, south: 39.4, east: -68.8, north: 41.5 }],
    });
    assert.deepEqual(prints.get("US5PVDCB"), US5PVDCB);
  });

  it("ignores canyon-scale leftovers and unused cells", () => {
    const framed = harborFrameOf({
      cells: [
        { id: "US3MA1AC", west: -72.8, south: 39.4, east: -68.8, north: 41.5 },
        { id: "US5NY2GL", west: -72.0, south: 41.04, east: -71.9, north: 41.09 },
      ],
    });
    assert.equal(framed.source, "pj-harbor-box");
    assert.deepEqual(framed.bbox, { ...POINT_JUDITH_HARBOR_BBOX });
  });

  it("frames official US5PVDCB.000 + US5PVDBB.000 extract union, not the trip box", () => {
    const harbor = extractS57FromDot000(
      new Uint8Array(readFileSync(new URL("./fixtures/US5PVDCB.000", import.meta.url))),
      "US5PVDCB",
    );
    const inlet = extractS57FromDot000(
      new Uint8Array(readFileSync(new URL("./fixtures/US5PVDBB.000", import.meta.url))),
      "US5PVDBB",
    );
    assert.ok(harbor?.bounds);
    assert.ok(inlet?.bounds);
    assert.deepEqual(harbor.bounds, US5PVDCB);
    assert.deepEqual(inlet.bounds, US5PVDBB);
    const framed = harborFrameOf({ extract: { cells: [harbor, inlet] } });
    assert.equal(framed.source, "harbor-union");
    assert.deepEqual(framed.cellIds, ["US5PVDCB", "US5PVDBB"]);
    assert.deepEqual(framed.bbox, HARBOR_INLET);
    assertContainsGalilee(framed.bbox);
    assert.notDeepEqual(framed.bbox, { ...POINT_JUDITH_CANYON_BBOX });
    assert.notDeepEqual(framed.bbox, US5PVDCB);
  });

  it("fitBounds the harbor box at z12–14 on the existing plotter", () => {
    const calls: unknown[] = [];
    const map = {
      fitBounds: (bounds: unknown, opts: unknown) => {
        calls.push({ bounds, opts });
      },
    };
    const framed = applyFrameHarbor(map, {
      extract: {
        cells: [
          { cellId: "US5PVDCB", bounds: US5PVDCB },
          { cellId: "US5PVDBB", bounds: US5PVDBB },
        ],
      },
    });
    assert.equal(framed.source, "harbor-union");
    assertContainsGalilee(framed.bbox);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      bounds: [
        [HARBOR_INLET.west, HARBOR_INLET.south],
        [HARBOR_INLET.east, HARBOR_INLET.north],
      ],
      opts: { ...FRAME_HARBOR_FIT },
    });
    assert.equal(FRAME_HARBOR_FIT.maxZoom, FRAME_HARBOR_MAX_ZOOM);
    assert.equal(FRAME_HARBOR_MAX_ZOOM, 14);
    assert.ok(FRAME_HARBOR_MAX_ZOOM >= 12 && FRAME_HARBOR_MAX_ZOOM <= 14);
    assert.ok(FRAME_HARBOR_MAX_ZOOM < PLOTTER_MAX_ZOOM);
    assert.equal(FRAME_HARBOR_FIT.essential, true);
  });
});

describe("Frame harbor store", () => {
  afterEach(() => {
    globalThis.localStorage.removeItem(FOLLOW_KEY);
    useAhanu.setState({
      followShip: true,
      framePackSeq: 0,
      frameHarborSeq: 0,
      replayT: null,
      packManifest: null,
    });
  });

  it("drops Follow the same way a skipper pan does and bumps the harbor seq", () => {
    useAhanu.getState().setFollow(true);
    assert.equal(useAhanu.getState().followShip, true);
    assert.equal(useAhanu.getState().frameHarborSeq, 0);
    useAhanu.getState().frameHarbor();
    assert.equal(useAhanu.getState().followShip, false);
    assert.equal(globalThis.localStorage.getItem(FOLLOW_KEY), "0");
    assert.equal(useAhanu.getState().frameHarborSeq, 1);
    useAhanu.getState().frameHarbor();
    assert.equal(useAhanu.getState().followShip, false);
    assert.equal(useAhanu.getState().frameHarborSeq, 2);
    assert.equal(useAhanu.getState().framePackSeq, 0);
  });

  it("does not write ahanu-camera itself — moveend persist stays the writer", () => {
    writePersistedCamera(
      { lng: -71.48, lat: 41.36, zoom: 13, bearing: 0, pitch: 0 },
      {
        setItem: (k, v) => {
          assert.equal(k, CAMERA_KEY);
          globalThis.localStorage.setItem(k, v);
        },
      },
    );
    assert.ok(readPersistedCamera());
    const before = globalThis.localStorage.getItem(CAMERA_KEY);
    useAhanu.getState().frameHarbor();
    assert.equal(useAhanu.getState().followShip, false);
    assert.equal(globalThis.localStorage.getItem(CAMERA_KEY), before);
  });
});

describe("Frame harbor helm wiring", () => {
  it("ChartMap frames harbor on seq and persists the view on moveend", async () => {
    const src = await readFile(CHART_MAP, "utf8");
    assert.match(src, /applyFrameHarbor/);
    assert.match(src, /frameHarborSeq/);
    assert.match(src, /applyFrameHarbor\(map, getPackedOcean\(\)\?\.enc\)/);
    assert.match(src, /map\.on\("moveend"/);
    assert.match(src, /createDebouncedCameraPersist/);
    assert.match(src, /data-map="ahanu"/);
    const maps = src.match(/new maplibregl\.Map\(/g) ?? [];
    assert.equal(maps.length, 1, "must not invent a second map");
    assert.doesNotMatch(src, /ECDIS/);
  });

  it("plotter and Packs expose Frame harbor next to Frame pack", async () => {
    const shell = await readFile(APP_SHELL, "utf8");
    const packs = await readFile(PACKS, "utf8");
    const settings = await readFile(SETTINGS, "utf8");
    const store = await readFile(STORE, "utf8");
    assert.match(shell, /title="Frame pack"/);
    assert.match(shell, /title="Frame harbor"/);
    assert.match(shell, /onClick=\{frameHarbor\}/);
    assert.match(packs, /Frame harbor/);
    assert.match(packs, /onClick=\{frameHarbor\}/);
    assert.match(settings, /Frame harbor drops Follow/);
    assert.match(store, /followAfterSkipperMapMove/);
    assert.match(store, /frameHarborSeq: s\.frameHarborSeq \+ 1/);
    assert.match(store, /frameHarborSeq: 0/);
    assert.doesNotMatch(store, /ECDIS/);
  });
});
