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
  DEFAULT_FOLLOW,
  FOLLOW_KEY,
  followAfterReplayExit,
  followAfterSkipperMapMove,
  isUserPlotterGesture,
  parseFollow,
  readPersistedFollow,
  shouldRecenterOnOwnship,
  writePersistedFollow,
} = await import("../src/lib/ahanu/follow-camera.ts");
const { STORE_PERSIST_KEY } = await import("../src/lib/ahanu/display-mode.ts");
const { useAhanu } = await import("../src/lib/ahanu/store.ts");

const CHART_MAP = fileURLToPath(new URL("../src/components/chartplotter/ChartMap.tsx", import.meta.url));
const STORE = fileURLToPath(new URL("../src/lib/ahanu/store.ts", import.meta.url));

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

describe("Follow camera", () => {
  it("recenters only while Follow is armed and replay is off", () => {
    assert.equal(shouldRecenterOnOwnship(true, null), true);
    assert.equal(shouldRecenterOnOwnship(false, null), false);
    assert.equal(shouldRecenterOnOwnship(true, 0), false);
    assert.equal(shouldRecenterOnOwnship(true, 0.4), false);
    assert.equal(shouldRecenterOnOwnship(false, 0.4), false);
  });

  it("treats MapLibre originalEvent as a skipper gesture, not Follow easeTo", () => {
    assert.equal(isUserPlotterGesture({ originalEvent: { type: "pointerdown" } }), true);
    assert.equal(isUserPlotterGesture({ originalEvent: { type: "wheel" } }), true);
    assert.equal(isUserPlotterGesture({}), false);
    assert.equal(isUserPlotterGesture({ originalEvent: undefined }), false);
    assert.equal(isUserPlotterGesture(null), false);
    assert.equal(isUserPlotterGesture(undefined), false);
  });

  it("drops Follow after a skipper map move until the next Follow tap", () => {
    assert.equal(followAfterSkipperMapMove(), false);
    let follow = true;
    const setFollow = (v: boolean) => {
      follow = v;
    };
    if (isUserPlotterGesture({ originalEvent: { type: "pointerdown" } })) {
      setFollow(followAfterSkipperMapMove());
    }
    assert.equal(follow, false);
    assert.equal(shouldRecenterOnOwnship(follow, null), false);
    follow = true;
    assert.equal(shouldRecenterOnOwnship(follow, null), true);
  });

  it("ChartMap drops Follow on pan/zoom and never gates the ownship mark", async () => {
    const src = await readFile(CHART_MAP, "utf8");
    assert.match(src, /shouldRecenterOnOwnship\(follow, replayT\) && map/);
    assert.match(src, /map\.on\("dragstart"/);
    assert.match(src, /map\.on\("zoomstart"/);
    assert.match(src, /isUserPlotterGesture/);
    assert.match(src, /setFollow\(followAfterSkipperMapMove\(\)\)/);
    const markAt = src.indexOf("shipRef.current?.setLngLat");
    const easeAt = src.indexOf("shouldRecenterOnOwnship(follow, replayT) && map");
    assert.ok(markAt >= 0 && easeAt > markAt, "ownship marker must update before the Follow camera gate");
    const markBlock = src.slice(markAt, easeAt);
    assert.doesNotMatch(markBlock, /follow/, "ownship setLngLat must not sit behind Follow");
    assert.match(src, /el\.style\.transform = `rotate\(\$\{vessel\.heading\}deg\)`/);
  });
});

describe("Follow persist", () => {
  it("defaults ON on a first visit", () => {
    assert.equal(FOLLOW_KEY, "ahanu-follow");
    assert.equal(DEFAULT_FOLLOW, true);
    assert.equal(parseFollow(undefined), true);
    assert.equal(parseFollow("maybe"), true);
    assert.equal(readPersistedFollow(memoryStorage()), true);
  });

  it("round-trips a skipper Follow drop so reload stays off", () => {
    const store = memoryStorage();
    writePersistedFollow(false, store);
    assert.equal(store.getItem(FOLLOW_KEY), "0");
    assert.equal(readPersistedFollow(store), false);
    writePersistedFollow(true, store);
    assert.equal(store.getItem(FOLLOW_KEY), "1");
    assert.equal(readPersistedFollow(store), true);
  });

  it("reads followShip from the zustand persist blob", () => {
    const store = memoryStorage({
      [STORE_PERSIST_KEY]: JSON.stringify({ state: { followShip: false }, version: 0 }),
    });
    assert.equal(readPersistedFollow(store), false);
  });

  it("prefers the dedicated key over a stale persist blob", () => {
    const store = memoryStorage({
      [FOLLOW_KEY]: "0",
      [STORE_PERSIST_KEY]: JSON.stringify({ state: { followShip: true }, version: 0 }),
    });
    assert.equal(readPersistedFollow(store), false);
  });

  it("rejects garbage in storage as ON", () => {
    const store = memoryStorage({
      [FOLLOW_KEY]: "maybe",
      [STORE_PERSIST_KEY]: "not-json",
    });
    assert.equal(readPersistedFollow(store), true);
  });

  it("exiting replay restores persisted Follow and does not force ON", () => {
    assert.equal(followAfterReplayExit(false), false);
    assert.equal(followAfterReplayExit(true), true);
  });
});

describe("Follow store hydrate and replay", () => {
  afterEach(() => {
    globalThis.localStorage.removeItem(FOLLOW_KEY);
    useAhanu.setState({ followShip: true, replayT: null });
  });

  it("setFollow writes the dedicated key", () => {
    useAhanu.getState().setFollow(false);
    assert.equal(globalThis.localStorage.getItem(FOLLOW_KEY), "0");
    assert.equal(useAhanu.getState().followShip, false);
    useAhanu.getState().setFollow(true);
    assert.equal(globalThis.localStorage.getItem(FOLLOW_KEY), "1");
    assert.equal(useAhanu.getState().followShip, true);
  });

  it("exiting replay restores a dropped Follow instead of forcing ON", () => {
    useAhanu.getState().setFollow(false);
    useAhanu.getState().setReplayT(0);
    assert.equal(useAhanu.getState().replayT, 0);
    assert.equal(useAhanu.getState().followShip, false);
    assert.equal(globalThis.localStorage.getItem(FOLLOW_KEY), "0");
    useAhanu.getState().setReplayT(null);
    assert.equal(useAhanu.getState().replayT, null);
    assert.equal(useAhanu.getState().followShip, false);
    assert.equal(shouldRecenterOnOwnship(useAhanu.getState().followShip, null), false);
  });

  it("exiting replay restores persisted ON when Follow was armed", () => {
    useAhanu.getState().setFollow(true);
    useAhanu.getState().setReplayT(0.4);
    assert.equal(useAhanu.getState().followShip, true);
    useAhanu.getState().setReplayT(null);
    assert.equal(useAhanu.getState().followShip, true);
  });

  it("store hydrates Follow from the dedicated key and restores it on replay exit", async () => {
    const src = await readFile(STORE, "utf8");
    assert.match(src, /followShip: readPersistedFollow\(\)/);
    assert.match(src, /writePersistedFollow\(followShip\)/);
    assert.match(src, /followAfterReplayExit\(readPersistedFollow\(\)\)/);
    assert.doesNotMatch(src, /followShip: replayT == null/);
    assert.match(src, /followShip: s\.followShip/);
  });
});
