import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const {
  DEVICE_TOKEN_KEY,
  clearDeviceToken,
  deviceToken,
  deviceTokenStatus,
  saveDeviceToken,
  syncCatch,
} = await import("../src/lib/ahanu/catch-sync.ts");

const rec = {
  id: "catch_test_1",
  species: "bigeye" as const,
  lat: 39.91,
  lon: -69.62,
  at: "2026-08-20T21:40:00.000Z",
  released: false,
  synced: false,
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    map,
  };
}

describe("syncCatch", () => {
  it("returns synced:false when fetch throws (offline)", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const next = await syncCatch(rec, { base: "http://packs.test" });
    assert.equal(next.synced, false);
    assert.equal(next.id, rec.id);
  });

  it("returns synced:false on 401", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })) as typeof fetch;
    const next = await syncCatch(rec, { base: "http://packs.test" });
    assert.equal(next.synced, false);
  });

  it("returns synced:true only when the worker says so", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, catch: { ...rec, synced: true } }), {
        status: 201,
      })) as typeof fetch;
    const next = await syncCatch(rec, { token: "dock-token", base: "http://packs.test" });
    assert.equal(next.synced, true);
  });
});

describe("device token persist", () => {
  it("reads the dedicated localStorage key", () => {
    const store = memoryStorage({ [DEVICE_TOKEN_KEY]: "  dock-token  " });
    assert.equal(DEVICE_TOKEN_KEY, "ahanu-device-token");
    assert.equal(deviceToken(store), "dock-token");
    assert.equal(deviceTokenStatus(store), "Sync on");
  });

  it("saves a typed token and clears it", () => {
    const store = memoryStorage();
    assert.equal(deviceTokenStatus(store), "Local only (no device token)");
    assert.equal(saveDeviceToken(" skipper-set ", store), "skipper-set");
    assert.equal(store.getItem(DEVICE_TOKEN_KEY), "skipper-set");
    assert.equal(deviceToken(store), "skipper-set");
    assert.equal(deviceTokenStatus(store), "Sync on");
    clearDeviceToken(store);
    assert.equal(store.getItem(DEVICE_TOKEN_KEY), null);
    assert.equal(deviceToken(store), undefined);
    assert.equal(deviceTokenStatus(store), "Local only (no device token)");
  });

  it("issues a UUID when Save is blank", () => {
    const store = memoryStorage();
    const minted = saveDeviceToken("   ", store);
    assert.match(
      minted,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.equal(store.getItem(DEVICE_TOKEN_KEY), minted);
    assert.equal(deviceTokenStatus(store), "Sync on");
  });
});
