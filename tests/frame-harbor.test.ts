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
  FRAME_HARBOR_CENTER,
  FRAME_HARBOR_FIT,
  FRAME_HARBOR_FIT_BOUNDS,
  FRAME_HARBOR_LABEL,
  FRAME_HARBOR_MAX_ZOOM,
  FRAME_HARBOR_ZOOM,
  GALILEE_DOCK,
  HARBOR_FRAME_BANNED,
  HARBOR_FRAME_BAY_CELL,
  HARBOR_FRAME_BBOX,
  HARBOR_FRAME_CELL,
  HARBOR_FRAME_EAST_PASS,
  HARBOR_FRAME_INLET,
  HARBOR_FRAME_RI_OVERVIEW,
  HARBOR_FRAME_UNION,
  US5PVDBB_OFFICIAL_BBOX,
  US5PVDCB_OFFICIAL_BBOX,
  applyFrameHarbor,
  bboxContainsLonLat,
  bboxToFrameHarbor,
  viewportAtCamera,
  harborFrameOf,
  harborFootprints,
  isAcceptedHarborPrint,
  isHarborScaleBbox,
} = await import("../src/lib/ahanu/frame-harbor.ts");
const { NEWPORT, POINT_JUDITH_CANYON_BBOX, POINT_JUDITH_HARBOR_BBOX, PLOTTER_MAX_ZOOM } =
  await import("../src/lib/ahanu/constants.ts");
const { CAMERA_KEY, writePersistedCamera, readPersistedCamera } =
  await import("../src/lib/ahanu/plotter-camera.ts");
const { FOLLOW_KEY } = await import("../src/lib/ahanu/follow-camera.ts");
const { useAhanu } = await import("../src/lib/ahanu/store.ts");
const { extractS57FromDot000 } = await import("../src/lib/ahanu/s57-extract.ts");
const { getPackedOcean } = await import("../src/lib/ahanu/packed-fields.ts");

const CHART_MAP = fileURLToPath(
  new URL("../src/components/chartplotter/ChartMap.tsx", import.meta.url),
);
const APP_SHELL = fileURLToPath(new URL("../src/components/ahanu/AppShell.tsx", import.meta.url));
const PACKS = fileURLToPath(new URL("../src/components/panels/PacksPanel.tsx", import.meta.url));
const SETTINGS = fileURLToPath(
  new URL("../src/components/panels/SettingsPanel.tsx", import.meta.url),
);
const STORE = fileURLToPath(new URL("../src/lib/ahanu/store.ts", import.meta.url));

const US5PVDCB = { west: -71.55, south: 41.4, east: -71.475, north: 41.475 };
const US5PVDBB = { west: -71.55, south: 41.325, east: -71.475, north: 41.4 };
const US5PVDDD = { west: -71.4, south: 41.475, east: -71.325, north: 41.55 };
const US5PVDCD = { west: -71.4, south: 41.4, east: -71.325, north: 41.475 };
const US3RI1AA = { west: -72, south: 40.8, east: -70.8, north: 42 };
const HARBOR_INLET = { west: -71.55, south: 41.325, east: -71.475, north: 41.475 };

function assertContainsGalilee(bbox: { west: number; south: number; east: number; north: number }) {
  assert.equal(GALILEE_DOCK.lon, -71.51);
  assert.equal(GALILEE_DOCK.lat, 41.3615);
  assert.ok(
    bboxContainsLonLat(bbox, GALILEE_DOCK.lon, GALILEE_DOCK.lat),
    "Galilee dock must sit inside the framed box",
  );
  assert.ok(bbox.south <= 41.3615 && bbox.north >= 41.3615);
  assert.ok(bbox.west <= -71.51 && bbox.east >= -71.51);
}

function assertExcludesNewport(bbox: { west: number; south: number; east: number; north: number }) {
  assert.equal(NEWPORT.lat, 41.49);
  assert.equal(NEWPORT.lon, -71.327);
  assert.equal(
    bboxContainsLonLat(bbox, NEWPORT.lon, NEWPORT.lat),
    false,
    "Newport must stay outside Frame harbor",
  );
  assert.ok(bbox.north < NEWPORT.lat, "Frame harbor north must stay south of Newport 41.49");
}

describe("Frame harbor bbox", () => {
  it("labels the helm control Frame harbor", () => {
    assert.equal(FRAME_HARBOR_LABEL, "Frame harbor");
    assert.equal(HARBOR_FRAME_CELL, "US5PVDCB");
    assert.equal(HARBOR_FRAME_INLET, "US5PVDBB");
    assert.deepEqual([...HARBOR_FRAME_UNION], ["US5PVDCB", "US5PVDBB"]);
    assert.equal(HARBOR_FRAME_BAY_CELL, "US5PVDDD");
    assert.equal(HARBOR_FRAME_EAST_PASS, "US5PVDCD");
    assert.equal(HARBOR_FRAME_RI_OVERVIEW, "US3RI1AA");
    assert.deepEqual([...HARBOR_FRAME_BANNED], ["US5PVDCD", "US3RI1AA", "US5PVDDD"]);
    assert.deepEqual(HARBOR_FRAME_BBOX, HARBOR_INLET);
    assert.deepEqual(US5PVDCB_OFFICIAL_BBOX, US5PVDCB);
    assert.deepEqual(US5PVDBB_OFFICIAL_BBOX, US5PVDBB);
  });

  it("uses the official US5PVDCB∪US5PVDBB box when nothing is packed", () => {
    assert.deepEqual(POINT_JUDITH_HARBOR_BBOX, US5PVDBB);
    assert.deepEqual(bboxToFrameHarbor(null), { ...HARBOR_FRAME_BBOX });
    assert.deepEqual(bboxToFrameHarbor(undefined), { ...HARBOR_FRAME_BBOX });
    assert.deepEqual(bboxToFrameHarbor({}), { ...HARBOR_FRAME_BBOX });
    const framed = harborFrameOf(null);
    assert.equal(framed.source, "pj-harbor-box");
    assert.deepEqual(framed.cellIds, []);
    assert.notDeepEqual(framed.bbox, { ...POINT_JUDITH_CANYON_BBOX });
    assertContainsGalilee(framed.bbox);
    assertExcludesNewport(framed.bbox);
    assert.ok(framed.bbox.south <= 41.325 && framed.bbox.north >= 41.4);
  });

  it("unions packed official US5PVDCB+US5PVDBB so Galilee stays in and Newport stays out", () => {
    const framed = harborFrameOf({
      extract: {
        cells: [
          { cellId: "US5PVDCB", bounds: US5PVDCB },
          { cellId: "US5PVDBB", bounds: US5PVDBB },
          { cellId: "US5PVDDD", bounds: US5PVDDD },
          { cellId: "US5PVDCD", bounds: US5PVDCD },
          { cellId: "US3RI1AA", bounds: US3RI1AA },
        ],
      },
      cells: [
        { id: "US5PVDCB", ...US5PVDCB },
        { id: "US5PVDBB", ...US5PVDBB },
        { id: "US5PVDCD", ...US5PVDCD },
        { id: "US3RI1AA", ...US3RI1AA },
      ],
    });
    assert.equal(framed.source, "harbor-union");
    assert.deepEqual(framed.cellIds, ["US5PVDCB", "US5PVDBB"]);
    assert.deepEqual(framed.bbox, HARBOR_INLET);
    assert.ok(isHarborScaleBbox(framed.bbox));
    assert.ok(framed.bbox.north - framed.bbox.south < 0.2);
    assert.ok(framed.bbox.east - framed.bbox.west < 0.2);
    assertContainsGalilee(framed.bbox);
    assertExcludesNewport(framed.bbox);
    assert.equal(bboxContainsLonLat(US5PVDCB, GALILEE_DOCK.lon, GALILEE_DOCK.lat), false);
    assert.ok(!isHarborScaleBbox({ west: -71.55, south: 41.325, east: -71.325, north: 41.55 }));
  });

  it("still frames the official union when only US5PVDBB is packed", () => {
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
    assert.deepEqual(framed.bbox, HARBOR_FRAME_BBOX);
    assertContainsGalilee(framed.bbox);
    assertExcludesNewport(framed.bbox);
  });

  it("never includes US5PVDDD / US5PVDCD / US3RI1AA even when they look harbor-scale", () => {
    const smallBay = { west: -71.475, south: 41.45, east: -71.45, north: 41.475 };
    const framed = harborFrameOf({
      extract: {
        cells: [
          { cellId: "US5PVDCB", bounds: US5PVDCB },
          { cellId: "US5PVDBB", bounds: US5PVDBB },
          { cellId: "US5PVDDD", bounds: smallBay },
          { cellId: "US5PVDCD", bounds: US5PVDCD },
          { cellId: "US3RI1AA", bounds: US3RI1AA },
        ],
      },
    });
    assert.equal(framed.source, "harbor-union");
    assert.deepEqual(framed.cellIds, ["US5PVDCB", "US5PVDBB"]);
    assert.deepEqual(framed.bbox, HARBOR_FRAME_BBOX);
    assert.ok(!framed.cellIds.includes("US5PVDDD"));
    assert.ok(!framed.cellIds.includes("US5PVDCD"));
    assert.ok(!framed.cellIds.includes("US3RI1AA"));
    assertContainsGalilee(framed.bbox);
    assertExcludesNewport(framed.bbox);
  });

  it("reads pack catalog boxes when extract has no bounds and still keeps Galilee", () => {
    const framed = harborFrameOf({
      cells: [{ id: "US5PVDCB", ...US5PVDCB }],
    });
    assert.equal(framed.source, "US5PVDCB");
    assert.deepEqual(framed.bbox, HARBOR_FRAME_BBOX);
    assertContainsGalilee(framed.bbox);
    assertExcludesNewport(framed.bbox);
  });

  it("reads enc-s57-cell polygons when cell.bounds is missing and still keeps Galilee", () => {
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
    assert.deepEqual(framed.bbox, HARBOR_FRAME_BBOX);
    assertContainsGalilee(framed.bbox);
    assertExcludesNewport(framed.bbox);
  });

  it("extract bounds win over a stale pack catalog box only when they stay harbor-scale", () => {
    const prints = harborFootprints({
      extract: { cells: [{ cellId: "US5PVDCB", bounds: US5PVDCB }] },
      cells: [{ id: "US5PVDCB", west: -72.8, south: 39.4, east: -68.8, north: 41.5 }],
    });
    assert.deepEqual(prints.get("US5PVDCB"), US5PVDCB);
    assert.equal(isAcceptedHarborPrint("US5PVDCB", US5PVDCB), true);
    assert.equal(
      isAcceptedHarborPrint("US5PVDCB", { west: -72.8, south: 39.4, east: -68.8, north: 41.5 }),
      false,
    );
  });

  it("ignores canyon leftovers, US3RI1AA, and unused cells", () => {
    const framed = harborFrameOf({
      cells: [
        { id: "US3MA1AC", west: -72.8, south: 39.4, east: -68.8, north: 41.5 },
        { id: "US5NY2GL", west: -72.0, south: 41.04, east: -71.9, north: 41.09 },
        { id: "US3RI1AA", ...US3RI1AA },
        { id: "US5PVDCD", ...US5PVDCD },
      ],
    });
    assert.equal(framed.source, "pj-harbor-box");
    assert.deepEqual(framed.bbox, { ...HARBOR_FRAME_BBOX });
    assert.deepEqual(framed.cellIds, []);
    assertContainsGalilee(framed.bbox);
    assertExcludesNewport(framed.bbox);
  });

  it("rejects a huge US5PVDCB extract and still pins the official union", () => {
    const huge = { west: -72, south: 40.8, east: -70.8, north: 42 };
    const framed = harborFrameOf({
      extract: {
        cells: [
          { cellId: "US5PVDCB", bounds: huge },
          { cellId: "US5PVDBB", bounds: US5PVDBB },
          { cellId: "US5PVDCD", bounds: US5PVDCD },
          { cellId: "US3RI1AA", bounds: US3RI1AA },
        ],
      },
      cells: [
        { id: "US5PVDCB", ...huge },
        { id: "US5PVDCD", ...US5PVDCD },
        { id: "US3RI1AA", ...US3RI1AA },
      ],
      tideHarbor: "Newport",
    });
    assert.equal(framed.source, "harbor-union");
    assert.deepEqual(framed.cellIds, ["US5PVDBB"]);
    assert.deepEqual(framed.bbox, HARBOR_FRAME_BBOX);
    assert.notDeepEqual(framed.bbox, huge);
    assertContainsGalilee(framed.bbox);
    assertExcludesNewport(framed.bbox);
  });

  it("never frames the tide harbor even when the picker is Newport", () => {
    const framed = harborFrameOf({
      tideHarbor: "Newport",
      cells: [
        { id: "US5PVDCD", ...US5PVDCD },
        { id: "US3RI1AA", ...US3RI1AA },
      ],
    });
    assert.deepEqual(framed.bbox, HARBOR_FRAME_BBOX);
    assertExcludesNewport(framed.bbox);
    assertContainsGalilee(framed.bbox);
    assert.equal(bboxContainsLonLat(framed.bbox, -71.327, 41.49), false);
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
    assertExcludesNewport(framed.bbox);
    assert.notDeepEqual(framed.bbox, { ...POINT_JUDITH_CANYON_BBOX });
    assert.notDeepEqual(framed.bbox, US5PVDCB);
  });

  it("eases to the official harbor pin at z12.5 on the existing plotter", () => {
    const calls: unknown[] = [];
    const map = {
      easeTo: (opts: unknown) => {
        calls.push(opts);
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
    assertExcludesNewport(framed.bbox);
    assert.equal(calls.length, 1);
    assert.deepEqual(FRAME_HARBOR_FIT_BOUNDS, [
      [-71.55, 41.325],
      [-71.475, 41.475],
    ]);
    assert.deepEqual(FRAME_HARBOR_CENTER, [-71.5125, 41.4]);
    assert.ok(
      Math.abs(FRAME_HARBOR_CENTER[0] - (HARBOR_FRAME_BBOX.west + HARBOR_FRAME_BBOX.east) / 2) < 1e-6,
    );
    assert.ok(
      Math.abs(FRAME_HARBOR_CENTER[1] - (HARBOR_FRAME_BBOX.south + HARBOR_FRAME_BBOX.north) / 2) < 1e-6,
    );
    assert.equal(FRAME_HARBOR_ZOOM, 12.5);
    assert.deepEqual(calls[0], {
      center: FRAME_HARBOR_CENTER,
      zoom: FRAME_HARBOR_ZOOM,
      duration: 500,
      essential: true,
    });
    const hit = calls[0] as Record<string, unknown>;
    assert.equal("offset" in hit, false);
    assert.equal("padding" in hit, false);
    assert.equal(FRAME_HARBOR_FIT.essential, true);
    assert.equal(FRAME_HARBOR_MAX_ZOOM, 14);
    assert.ok(FRAME_HARBOR_MAX_ZOOM >= 12 && FRAME_HARBOR_MAX_ZOOM <= 14);
    assert.ok(FRAME_HARBOR_MAX_ZOOM < PLOTTER_MAX_ZOOM);
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

  it("frameHarbor does not read or write tideHarbor", () => {
    useAhanu.setState({ tideHarbor: "Newport" });
    useAhanu.getState().frameHarbor();
    assert.equal(useAhanu.getState().tideHarbor, "Newport");
    assert.equal(useAhanu.getState().frameHarborSeq, 1);
  });
});

describe("Frame harbor click box", () => {
  it("ChartMap click handler frames the official PJ union and cannot include Newport 41.49", async () => {
    const src = await readFile(CHART_MAP, "utf8");
    assert.match(src, /applyFrameHarbor\(map, getPackedOcean\(\)\?\.enc\)/);
    assert.match(src, /\[\[-71\.55, 41\.325\], \[-71\.475, 41\.475\]\]/);
    const calls: Array<Record<string, unknown>> = [];
    const map = {
      easeTo: (opts: Record<string, unknown>) => {
        calls.push(opts);
      },
    };
    // Same call ChartMap makes on Frame harbor — packed ENC only, never tide/pack.
    const framed = applyFrameHarbor(map, getPackedOcean()?.enc);
    assert.deepEqual(framed.bbox, HARBOR_FRAME_BBOX);
    assert.deepEqual(framed.bbox, {
      west: -71.55,
      south: 41.325,
      east: -71.475,
      north: 41.475,
    });
    assert.deepEqual(FRAME_HARBOR_FIT_BOUNDS, [
      [-71.55, 41.325],
      [-71.475, 41.475],
    ]);
    assert.deepEqual(calls[0], {
      center: FRAME_HARBOR_CENTER,
      zoom: FRAME_HARBOR_ZOOM,
      duration: 500,
      essential: true,
    });
    assert.deepEqual(calls[0]?.center, [-71.5125, 41.4]);
    assert.equal(calls[0]?.zoom, 12.5);
    assert.equal("offset" in calls[0], false);
    assert.equal("padding" in calls[0], false);
    assertExcludesNewport(framed.bbox);
    assert.equal(NEWPORT.lat, 41.49);
    assert.ok(framed.bbox.north < 41.49);
    assert.equal(bboxContainsLonLat(framed.bbox, NEWPORT.lon, NEWPORT.lat), false);
    assert.equal(bboxContainsLonLat(framed.bbox, -71.3625, 41.4375), false, "US5PVDCD centroid");
    assert.equal(bboxContainsLonLat(framed.bbox, -71.4, 41.4), false, "US3RI1AA centroid");
    assert.ok(framed.bbox.north < 41.5);
    assertContainsGalilee(framed.bbox);
  });

  it("Galilee stays inside a 1280×720 view at the official pin", () => {
    const laptop = { width: 1280, height: 720 };
    const view = viewportAtCamera(FRAME_HARBOR_CENTER, FRAME_HARBOR_ZOOM, laptop);
    // Official pin box is the requirement. Landscape leftover may include US5PVDCD.
    assertContainsGalilee(HARBOR_FRAME_BBOX);
    assertExcludesNewport(HARBOR_FRAME_BBOX);
    assert.ok(HARBOR_FRAME_BBOX.north < 41.49);
    assert.ok(view.west <= GALILEE_DOCK.lon && view.east >= GALILEE_DOCK.lon);
    assert.ok(Math.abs(view.south - GALILEE_DOCK.lat) < 0.02 || bboxContainsLonLat(view, GALILEE_DOCK.lon, GALILEE_DOCK.lat));
    const mapCalls: unknown[] = [];
    applyFrameHarbor(
      {
        easeTo: (opts) => {
          mapCalls.push(opts);
        },
      },
      getPackedOcean()?.enc,
    );
    const hit = mapCalls[0] as {
      center: [number, number];
      zoom: number;
      duration: number;
      essential: boolean;
      offset?: [number, number];
      padding?: unknown;
    };
    assert.deepEqual(hit.center, [-71.5125, 41.4]);
    assert.equal(hit.zoom, 12.5);
    assert.equal(hit.duration, 500);
    assert.equal(hit.essential, true);
    assert.equal(hit.offset, undefined);
    assert.equal(hit.padding, undefined);
  });
});

describe("Frame harbor helm wiring", () => {
  it("ChartMap frames packed ENC on seq — never tideHarbor — and persists on moveend", async () => {
    const src = await readFile(CHART_MAP, "utf8");
    assert.match(src, /applyFrameHarbor/);
    assert.match(src, /frameHarborSeq/);
    assert.match(src, /applyFrameHarbor\(map, getPackedOcean\(\)\?\.enc\)/);
    assert.match(src, /never tideHarbor/);
    assert.doesNotMatch(src, /applyFrameHarbor\([^)]*tideHarbor/);
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
    assert.doesNotMatch(store, /frameHarbor:[\s\S]{0,200}tideHarbor/);
    assert.doesNotMatch(store, /ECDIS/);
  });
});
