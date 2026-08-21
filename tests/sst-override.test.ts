import "./register-alias.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  SST_STALE_OVERRIDE_KEY,
  parseSstStaleOverride,
  readPersistedSstStaleOverride,
  writePersistedSstStaleOverride,
} = await import("../src/lib/ahanu/sst-override.ts");
const { STORE_PERSIST_KEY } = await import("../src/lib/ahanu/display-mode.ts");

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

describe("sstStaleOverride persist", () => {
  it("defaults off and never invents an accept", () => {
    assert.equal(SST_STALE_OVERRIDE_KEY, "ahanu-sst-stale-override");
    assert.equal(parseSstStaleOverride(undefined), false);
    assert.equal(parseSstStaleOverride("yes-please"), false);
    assert.equal(readPersistedSstStaleOverride(memoryStorage()), false);
  });

  it("round-trips a skipper Accept", () => {
    const store = memoryStorage();
    writePersistedSstStaleOverride(true, store);
    assert.equal(store.getItem(SST_STALE_OVERRIDE_KEY), "1");
    assert.equal(readPersistedSstStaleOverride(store), true);
    writePersistedSstStaleOverride(false, store);
    assert.equal(store.getItem(SST_STALE_OVERRIDE_KEY), "0");
    assert.equal(readPersistedSstStaleOverride(store), false);
  });

  it("reads sstStaleOverride from the zustand persist blob", () => {
    const store = memoryStorage({
      [STORE_PERSIST_KEY]: JSON.stringify({ state: { sstStaleOverride: true }, version: 0 }),
    });
    assert.equal(readPersistedSstStaleOverride(store), true);
  });

  it("prefers the dedicated key over a stale persist blob", () => {
    const store = memoryStorage({
      [SST_STALE_OVERRIDE_KEY]: "0",
      [STORE_PERSIST_KEY]: JSON.stringify({ state: { sstStaleOverride: true }, version: 0 }),
    });
    assert.equal(readPersistedSstStaleOverride(store), false);
  });

  it("rejects garbage in storage as off", () => {
    const store = memoryStorage({
      [SST_STALE_OVERRIDE_KEY]: "maybe",
      [STORE_PERSIST_KEY]: "not-json",
    });
    assert.equal(readPersistedSstStaleOverride(store), false);
  });
});
