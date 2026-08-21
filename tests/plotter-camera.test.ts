import "./register-alias.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { DEFAULT_CENTER, DEFAULT_ZOOM, POINT_JUDITH } from "../src/lib/ahanu/constants.ts";

const {
  CAMERA_KEY,
  CAMERA_PERSIST_MS,
  DEFAULT_CAMERA,
  cameraForChartLoad,
  createDebouncedCameraPersist,
  jumpToPersistedCamera,
  parseCamera,
  readPersistedCamera,
  writePersistedCamera,
} = await import("../src/lib/ahanu/plotter-camera.ts");

const CHART_MAP = fileURLToPath(new URL("../src/components/chartplotter/ChartMap.tsx", import.meta.url));

const HARBOR = {
  lng: POINT_JUDITH.lon,
  lat: POINT_JUDITH.lat,
  zoom: 15.2,
  bearing: 12,
  pitch: 8,
};

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    map,
  };
}

describe("plotter camera persist", () => {
  it("uses the dedicated ahanu-camera key and Veatch default", () => {
    assert.equal(CAMERA_KEY, "ahanu-camera");
    assert.equal(DEFAULT_CAMERA.lng, DEFAULT_CENTER.lon);
    assert.equal(DEFAULT_CAMERA.lat, DEFAULT_CENTER.lat);
    assert.equal(DEFAULT_CAMERA.zoom, DEFAULT_ZOOM);
    assert.equal(DEFAULT_CAMERA.bearing, 0);
    assert.equal(DEFAULT_CAMERA.pitch, 0);
    assert.equal(readPersistedCamera(memoryStorage()), null);
    assert.deepEqual(cameraForChartLoad({ follow: false, ownship: { lon: -69.7, lat: 39.9 } }), DEFAULT_CAMERA);
  });

  it("round-trips harbor center, zoom, bearing, and pitch", () => {
    const store = memoryStorage();
    writePersistedCamera(HARBOR, store);
    const raw = JSON.parse(store.getItem(CAMERA_KEY)!);
    assert.equal(raw.lng, HARBOR.lng);
    assert.equal(raw.lat, HARBOR.lat);
    assert.equal(raw.zoom, HARBOR.zoom);
    assert.equal(raw.bearing, HARBOR.bearing);
    assert.equal(raw.pitch, HARBOR.pitch);
    assert.deepEqual(readPersistedCamera(store), HARBOR);
  });

  it("accepts lon as lng and defaults missing bearing/pitch to 0", () => {
    const parsed = parseCamera({ lon: -71.48, lat: 41.36, zoom: 15 });
    assert.equal(parsed?.lng, -71.48);
    assert.equal(parsed?.lat, 41.36);
    assert.equal(parsed?.zoom, 15);
    assert.equal(parsed?.bearing, 0);
    assert.equal(parsed?.pitch, 0);
  });

  it("rejects missing, garbage, and out-of-range cameras", () => {
    assert.equal(parseCamera(undefined), null);
    assert.equal(parseCamera("not-json"), null);
    assert.equal(parseCamera({ lng: "east", lat: 41, zoom: 12 }), null);
    assert.equal(parseCamera({ lng: -71.48, lat: 41.36 }), null);
    assert.equal(parseCamera({ lng: -200, lat: 41.36, zoom: 12 }), null);
    assert.equal(parseCamera({ lng: -71.48, lat: 99, zoom: 12 }), null);
    assert.equal(parseCamera({ lng: -71.48, lat: 41.36, zoom: 99 }), null);
    assert.equal(parseCamera({ lng: NaN, lat: 41.36, zoom: 12 }), null);
    const store = memoryStorage({ [CAMERA_KEY]: "maybe" });
    assert.equal(readPersistedCamera(store), null);
    writePersistedCamera({ lng: "nope", lat: 41, zoom: 12 }, store);
    assert.equal(store.getItem(CAMERA_KEY), "maybe");
  });

  it("debounces moveend writes and keeps the last view", async () => {
    const store = memoryStorage();
    const persist = createDebouncedCameraPersist(20, store);
    persist({ ...HARBOR, zoom: 14 });
    persist(HARBOR);
    assert.equal(store.getItem(CAMERA_KEY), null);
    await delay(50);
    assert.deepEqual(readPersistedCamera(store), HARBOR);
    persist({ ...HARBOR, zoom: 13 });
    persist.flush();
    assert.equal(readPersistedCamera(store)?.zoom, 13);
    assert.equal(CAMERA_PERSIST_MS, 250);
  });
});

describe("plotter camera Follow interaction", () => {
  it("Follow off hydrates the stored harbor view", () => {
    const cam = cameraForChartLoad({
      follow: false,
      ownship: { lon: -69.695, lat: 39.905 },
      stored: HARBOR,
    });
    assert.deepEqual(cam, HARBOR);
  });

  it("Follow on keeps ownship center and stored zoom", () => {
    const cam = cameraForChartLoad({
      follow: true,
      ownship: { lon: -69.695, lat: 39.905 },
      stored: HARBOR,
    });
    assert.equal(cam.lng, -69.695);
    assert.equal(cam.lat, 39.905);
    assert.equal(cam.zoom, HARBOR.zoom);
    assert.equal(cam.bearing, HARBOR.bearing);
    assert.equal(cam.pitch, HARBOR.pitch);
  });

  it("Follow on with no stored camera uses Veatch zoom", () => {
    const cam = cameraForChartLoad({
      follow: true,
      ownship: { lon: -69.695, lat: 39.905 },
      stored: null,
    });
    assert.equal(cam.lng, -69.695);
    assert.equal(cam.lat, 39.905);
    assert.equal(cam.zoom, DEFAULT_ZOOM);
  });

  it("jumpTo hydrates only when Follow is off and a camera exists", () => {
    const jumped: unknown[] = [];
    const map = { jumpTo: (c: unknown) => jumped.push(c) };
    assert.equal(jumpToPersistedCamera(map, false, null), false);
    assert.equal(jumped.length, 0);
    assert.equal(jumpToPersistedCamera(map, true, HARBOR), false);
    assert.equal(jumped.length, 0);
    assert.equal(jumpToPersistedCamera(map, false, HARBOR), true);
    assert.deepEqual(jumped[0], {
      center: [HARBOR.lng, HARBOR.lat],
      zoom: HARBOR.zoom,
      bearing: HARBOR.bearing,
      pitch: HARBOR.pitch,
    });
  });
});

describe("ChartMap camera hydrate", () => {
  it("hydrates persisted camera before Follow easeTo and persists moveend", async () => {
    const src = await readFile(CHART_MAP, "utf8");
    assert.match(src, /cameraForChartLoad/);
    assert.match(src, /readPersistedCamera/);
    assert.match(src, /jumpToPersistedCamera/);
    assert.match(src, /createDebouncedCameraPersist/);
    assert.match(src, /map\.on\("moveend"/);
    assert.match(src, /center: \[bootCam\.lng, bootCam\.lat\]/);
    assert.match(src, /zoom: bootCam\.zoom/);
    assert.match(src, /bearing: bootCam\.bearing/);
    assert.match(src, /pitch: bootCam\.pitch/);
    const jumpAt = src.indexOf("jumpToPersistedCamera(");
    const easeAt = src.indexOf("map.easeTo({ center: [vessel.lon, vessel.lat]");
    assert.ok(jumpAt >= 0 && easeAt > jumpAt, "load hydrate must sit before Follow easeTo");
    const bootAt = src.indexOf("cameraForChartLoad({");
    assert.ok(bootAt >= 0 && bootAt < jumpAt, "constructor hydrate must precede load jumpTo");
  });
});
