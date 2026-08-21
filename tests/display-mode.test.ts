import "./register-alias.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  DEFAULT_DISPLAY_MODE,
  DISPLAY_MODE_KEY,
  STORE_PERSIST_KEY,
  applyDisplayMode,
  applyPersistedDisplayMode,
  parseDisplayMode,
  readPersistedDisplayMode,
  writePersistedDisplayMode,
} = await import("../src/lib/ahanu/display-mode.ts");

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

describe("displayMode persist", () => {
  it("defaults to night-bridge", () => {
    assert.equal(DEFAULT_DISPLAY_MODE, "night");
    assert.equal(parseDisplayMode(undefined), "night");
    assert.equal(parseDisplayMode("daylight"), "night");
    assert.equal(readPersistedDisplayMode(memoryStorage()), "night");
  });

  it("round-trips a skipper-chosen helm", () => {
    const store = memoryStorage();
    writePersistedDisplayMode("pure-black", store);
    assert.equal(store.getItem(DISPLAY_MODE_KEY), "pure-black");
    assert.equal(readPersistedDisplayMode(store), "pure-black");
  });

  it("reads displayMode from the zustand persist blob", () => {
    const store = memoryStorage({
      [STORE_PERSIST_KEY]: JSON.stringify({ state: { displayMode: "high-contrast" }, version: 0 }),
    });
    assert.equal(readPersistedDisplayMode(store), "high-contrast");
  });

  it("prefers the dedicated key over a stale persist blob", () => {
    const store = memoryStorage({
      [DISPLAY_MODE_KEY]: "day",
      [STORE_PERSIST_KEY]: JSON.stringify({ state: { displayMode: "night" }, version: 0 }),
    });
    assert.equal(readPersistedDisplayMode(store), "day");
  });

  it("applies data-mode on the root before paint", () => {
    const root = { dataset: {} as DOMStringMap };
    assert.equal(applyDisplayMode("day", root), "day");
    assert.equal(root.dataset.mode, "day");
    const store = memoryStorage({ [DISPLAY_MODE_KEY]: "pure-black" });
    const boot = { dataset: {} as DOMStringMap };
    assert.equal(applyPersistedDisplayMode(store), "pure-black");
    applyDisplayMode(readPersistedDisplayMode(store), boot);
    assert.equal(boot.dataset.mode, "pure-black");
  });

  it("rejects garbage in storage", () => {
    const store = memoryStorage({
      [DISPLAY_MODE_KEY]: "sunset",
      [STORE_PERSIST_KEY]: "not-json",
    });
    assert.equal(readPersistedDisplayMode(store), "night");
  });
});
