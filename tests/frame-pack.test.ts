import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { readFile } from "node:fs/promises";
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
  FRAME_PACK_FIT,
  FRAME_PACK_LABEL,
  applyFramePack,
  bboxToFrame,
  fitBoundsFromBbox,
  parsePackBbox,
} = await import("../src/lib/ahanu/frame-pack.ts");
const { POINT_JUDITH_CANYON_BBOX, PLOTTER_MAX_ZOOM } =
  await import("../src/lib/ahanu/constants.ts");
const { CAMERA_KEY, writePersistedCamera, readPersistedCamera } =
  await import("../src/lib/ahanu/plotter-camera.ts");
const { FOLLOW_KEY } = await import("../src/lib/ahanu/follow-camera.ts");
const { useAhanu } = await import("../src/lib/ahanu/store.ts");

const CHART_MAP = fileURLToPath(
  new URL("../src/components/chartplotter/ChartMap.tsx", import.meta.url),
);
const APP_SHELL = fileURLToPath(new URL("../src/components/ahanu/AppShell.tsx", import.meta.url));
const PACKS = fileURLToPath(new URL("../src/components/panels/PacksPanel.tsx", import.meta.url));
const STORE = fileURLToPath(new URL("../src/lib/ahanu/store.ts", import.meta.url));

const CUSTOM = { west: -71.6, south: 41.2, east: -71.3, north: 41.45 };

describe("Frame pack bbox", () => {
  it("labels the helm control Frame pack", () => {
    assert.equal(FRAME_PACK_LABEL, "Frame pack");
  });

  it("frames POINT_JUDITH_CANYON_BBOX when no pack is loaded", () => {
    assert.deepEqual(bboxToFrame(null), { ...POINT_JUDITH_CANYON_BBOX });
    assert.deepEqual(bboxToFrame(undefined), { ...POINT_JUDITH_CANYON_BBOX });
    assert.deepEqual(bboxToFrame({}), { ...POINT_JUDITH_CANYON_BBOX });
    assert.deepEqual(bboxToFrame({ bbox: null }), { ...POINT_JUDITH_CANYON_BBOX });
  });

  it("frames the downloaded pack west/south/east/north", () => {
    assert.deepEqual(bboxToFrame({ bbox: CUSTOM }), CUSTOM);
    assert.deepEqual(parsePackBbox(CUSTOM), CUSTOM);
  });

  it("rejects garbage bbox and falls back to the PJ box", () => {
    assert.equal(parsePackBbox(undefined), null);
    assert.equal(parsePackBbox("not-json"), null);
    assert.equal(parsePackBbox({ west: -71, south: 41, east: -72, north: 42 }), null);
    assert.equal(parsePackBbox({ west: -71, south: 42, east: -70, north: 41 }), null);
    assert.equal(parsePackBbox({ west: -200, south: 39, east: -68, north: 41 }), null);
    assert.equal(parsePackBbox({ west: -72, south: 39, east: -68 }), null);
    assert.deepEqual(bboxToFrame({ bbox: { west: "east", south: 39, east: -68, north: 41 } }), {
      ...POINT_JUDITH_CANYON_BBOX,
    });
  });

  it("builds MapLibre fitBounds corners from the pack box", () => {
    assert.deepEqual(fitBoundsFromBbox(POINT_JUDITH_CANYON_BBOX), [
      [POINT_JUDITH_CANYON_BBOX.west, POINT_JUDITH_CANYON_BBOX.south],
      [POINT_JUDITH_CANYON_BBOX.east, POINT_JUDITH_CANYON_BBOX.north],
    ]);
    assert.deepEqual(fitBoundsFromBbox(CUSTOM), [
      [CUSTOM.west, CUSTOM.south],
      [CUSTOM.east, CUSTOM.north],
    ]);
    assert.equal(FRAME_PACK_FIT.maxZoom, PLOTTER_MAX_ZOOM);
    assert.equal(FRAME_PACK_FIT.essential, true);
  });

  it("fitBounds the pack box on the existing plotter", () => {
    const calls: unknown[] = [];
    const map = {
      fitBounds: (bounds: unknown, opts: unknown) => {
        calls.push({ bounds, opts });
      },
    };
    const framed = applyFramePack(map, { bbox: CUSTOM });
    assert.deepEqual(framed, CUSTOM);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      bounds: [
        [CUSTOM.west, CUSTOM.south],
        [CUSTOM.east, CUSTOM.north],
      ],
      opts: { ...FRAME_PACK_FIT },
    });
  });

  it("fitBounds the PJ box when there is no pack", () => {
    const calls: unknown[] = [];
    const map = { fitBounds: (bounds: unknown) => calls.push(bounds) };
    applyFramePack(map, null);
    assert.deepEqual(calls[0], [
      [POINT_JUDITH_CANYON_BBOX.west, POINT_JUDITH_CANYON_BBOX.south],
      [POINT_JUDITH_CANYON_BBOX.east, POINT_JUDITH_CANYON_BBOX.north],
    ]);
  });
});

describe("Frame pack store", () => {
  afterEach(() => {
    globalThis.localStorage.removeItem(FOLLOW_KEY);
    useAhanu.setState({ followShip: true, framePackSeq: 0, replayT: null, packManifest: null });
  });

  it("drops Follow the same way a skipper pan does and bumps the frame seq", () => {
    useAhanu.getState().setFollow(true);
    assert.equal(useAhanu.getState().followShip, true);
    assert.equal(useAhanu.getState().framePackSeq, 0);
    useAhanu.getState().framePack();
    assert.equal(useAhanu.getState().followShip, false);
    assert.equal(globalThis.localStorage.getItem(FOLLOW_KEY), "0");
    assert.equal(useAhanu.getState().framePackSeq, 1);
    useAhanu.getState().framePack();
    assert.equal(useAhanu.getState().followShip, false);
    assert.equal(useAhanu.getState().framePackSeq, 2);
  });

  it("does not write ahanu-camera itself — moveend persist stays the writer", () => {
    const store = {
      getItem: (k: string) => (k === CAMERA_KEY ? null : null),
      setItem: () => {
        throw new Error("framePack must not write ahanu-camera");
      },
    };
    writePersistedCamera(
      { lng: -71.48, lat: 41.36, zoom: 15, bearing: 0, pitch: 0 },
      {
        setItem: (k, v) => {
          assert.equal(k, CAMERA_KEY);
          globalThis.localStorage.setItem(k, v);
        },
      },
    );
    assert.ok(readPersistedCamera());
    useAhanu.getState().framePack();
    assert.equal(useAhanu.getState().followShip, false);
    void store;
  });
});

describe("Frame pack helm wiring", () => {
  it("ChartMap frames on seq and persists the view on moveend", async () => {
    const src = await readFile(CHART_MAP, "utf8");
    assert.match(src, /applyFramePack/);
    assert.match(src, /framePackSeq/);
    assert.match(src, /applyFramePack\(map, useAhanu\.getState\(\)\.packManifest\)/);
    assert.match(src, /map\.on\("moveend"/);
    assert.match(src, /createDebouncedCameraPersist/);
    assert.match(src, /data-map="ahanu"/);
    const maps = src.match(/new maplibregl\.Map\(/g) ?? [];
    assert.equal(maps.length, 1, "must not invent a second map");
    assert.doesNotMatch(src, /ECDIS/);
  });

  it("plotter and Packs expose Frame pack", async () => {
    const shell = await readFile(APP_SHELL, "utf8");
    const packs = await readFile(PACKS, "utf8");
    const store = await readFile(STORE, "utf8");
    assert.match(shell, /title="Frame pack"/);
    assert.match(shell, /onClick=\{framePack\}/);
    assert.match(packs, /Frame pack/);
    assert.match(packs, /onClick=\{framePack\}/);
    assert.match(store, /followAfterSkipperMapMove/);
    assert.match(store, /framePackSeq: s\.framePackSeq \+ 1/);
    assert.match(store, /framePackSeq: 0/);
    assert.doesNotMatch(store, /ECDIS/);
  });
});
