import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const {
  DEVICE_TOKEN_KEY,
  clearDeviceToken,
  deviceToken,
  deviceTokenStatus,
  lastRetryUnsyncedStatus,
  retryUnsyncedCatches,
  retryUnsyncedStatus,
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
if (typeof globalThis.window === "undefined") {
  globalThis.window = globalThis;
}
if (!globalThis.window.localStorage) {
  globalThis.window.localStorage = globalThis.localStorage;
}

const { bindUnsyncedCatchRetry, hydrateAhanuStore, retryUnsyncedCatchesOnce, useAhanu } =
  await import("../src/lib/ahanu/store.ts");

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

describe("retryUnsyncedCatches", () => {
  it("POSTs only synced !== true records, one at a time", async () => {
    const order: string[] = [];
    let inflight = 0;
    let maxInflight = 0;
    globalThis.fetch = (async (_input, init) => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      const body = JSON.parse(String(init?.body)) as { id: string };
      order.push(body.id);
      await new Promise((r) => setTimeout(r, 8));
      inflight -= 1;
      return new Response(JSON.stringify({ ok: true, catch: { ...body, synced: true } }), {
        status: 201,
      });
    }) as typeof fetch;

    const already = { ...rec, id: "already", synced: true };
    const a = { ...rec, id: "a", synced: false };
    const b = { ...rec, id: "b" };
    const result = await retryUnsyncedCatches([already, a, b], {
      token: "dock-token",
      base: "http://packs.test",
    });
    assert.deepEqual(order, ["a", "b"]);
    assert.equal(maxInflight, 1);
    assert.equal(result.attempted, 2);
    assert.equal(result.synced, 2);
    assert.equal(result.failed, 0);
    assert.equal(
      result.records.every((r) => r.synced === true),
      true,
    );
  });

  it("leaves failures local and continues the queue", async () => {
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { id: string };
      if (body.id === "fail") return new Response("no", { status: 500 });
      return new Response(JSON.stringify({ ok: true, catch: { ...body, synced: true } }), {
        status: 201,
      });
    }) as typeof fetch;
    const fail = { ...rec, id: "fail", synced: false };
    const ok = { ...rec, id: "ok", synced: false };
    const result = await retryUnsyncedCatches([fail, ok], {
      token: "dock-token",
      base: "http://packs.test",
    });
    assert.equal(result.attempted, 2);
    assert.equal(result.synced, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.records.find((r) => r.id === "fail")?.synced, false);
    assert.equal(result.records.find((r) => r.id === "ok")?.synced, true);
  });

  it("does not fetch without a token or when everything is already synced", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("no", { status: 500 });
    }) as typeof fetch;
    const pending = { ...rec, synced: false };
    const none = await retryUnsyncedCatches([pending], { base: "http://packs.test" });
    const done = await retryUnsyncedCatches([{ ...rec, synced: true }], {
      token: "dock-token",
      base: "http://packs.test",
    });
    assert.equal(calls, 0);
    assert.equal(none.attempted, 0);
    assert.equal(done.attempted, 0);
  });

  it("formats one quiet status line", () => {
    assert.equal(retryUnsyncedStatus({ attempted: 0, synced: 0, failed: 0 }), "Sync on");
    assert.equal(retryUnsyncedStatus({ attempted: 2, synced: 2, failed: 0 }), "Sync on · 2 synced");
    assert.equal(
      retryUnsyncedStatus({ attempted: 2, synced: 0, failed: 2 }),
      "Sync on · 2 still local",
    );
    assert.equal(
      retryUnsyncedStatus({ attempted: 3, synced: 2, failed: 1 }),
      "Sync on · 2 synced, 1 still local",
    );
  });

  it("exposes the quiet line after a token retry", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, catch: { ...rec, synced: true } }), {
        status: 201,
      })) as typeof fetch;
    const result = await retryUnsyncedCatches([{ ...rec, synced: false }], {
      token: "dock-token",
      base: "http://packs.test",
    });
    assert.equal(lastRetryUnsyncedStatus(), retryUnsyncedStatus(result));
    assert.equal(lastRetryUnsyncedStatus(), "Sync on · 1 synced");
  });
});

describe("hydrateAhanuStore leftover retry", () => {
  const leftover = { ...rec, id: "leftover", synced: false };
  const already = { ...rec, id: "already", synced: true };

  function seedPersist(catches: Array<typeof leftover>) {
    globalThis.localStorage.setItem(
      "ahanu-bridge-v1",
      JSON.stringify({ state: { catches }, version: 0 }),
    );
  }

  it("one pass after persist hydrate when ahanu-device-token is already set", async () => {
    const order: string[] = [];
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { id: string };
      order.push(body.id);
      return new Response(JSON.stringify({ ok: true, catch: { ...body, synced: true } }), {
        status: 201,
      });
    }) as typeof fetch;
    useAhanu.setState({ catches: [], hydrated: false });
    seedPersist([already, leftover]);
    globalThis.localStorage.setItem("ahanu-device-token", "dock-token");
    const result = await hydrateAhanuStore();
    assert.deepEqual(order, ["leftover"]);
    assert.equal(result.attempted, 1);
    assert.equal(result.synced, 1);
    assert.equal(result.failed, 0);
    assert.equal(useAhanu.getState().hydrated, true);
    assert.equal(useAhanu.getState().catches.find((c) => c.id === "leftover")?.synced, true);
    assert.equal(useAhanu.getState().catches.find((c) => c.id === "already")?.synced, true);
    assert.equal(lastRetryUnsyncedStatus(), "Sync on · 1 synced");
  });

  it("does nothing when no device token is present", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("no", { status: 500 });
    }) as typeof fetch;
    useAhanu.setState({ catches: [], hydrated: false });
    seedPersist([leftover]);
    globalThis.localStorage.removeItem("ahanu-device-token");
    const result = await hydrateAhanuStore();
    assert.equal(calls, 0);
    assert.equal(result.attempted, 0);
    assert.equal(useAhanu.getState().catches.find((c) => c.id === "leftover")?.synced, false);
  });
});

describe("visibility / online leftover retry", () => {
  function leftoverWake() {
    return { ...rec, id: "leftover-wake", synced: false as const };
  }

  function fakeTarget(visibilityState = "visible") {
    const et = new EventTarget();
    return Object.assign(et, { visibilityState });
  }

  function seedWake(rec = leftoverWake()) {
    useAhanu.setState({ catches: [rec], hydrated: true });
    return rec;
  }

  afterEach(() => {
    globalThis.localStorage.removeItem("ahanu-device-token");
    useAhanu.setState({ catches: [], hydrated: false });
  });

  it("one pass when the document becomes visible and a token is set", async () => {
    const order: string[] = [];
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { id: string };
      order.push(body.id);
      return new Response(JSON.stringify({ ok: true, catch: { ...body, synced: true } }), {
        status: 201,
      });
    }) as typeof fetch;
    seedWake();
    globalThis.localStorage.setItem("ahanu-device-token", "dock-token");
    const doc = fakeTarget("visible");
    const win = fakeTarget();
    const unbind = bindUnsyncedCatchRetry({ document: doc, window: win });
    doc.dispatchEvent(new Event("visibilitychange"));
    const result = await retryUnsyncedCatchesOnce();
    assert.deepEqual(order, ["leftover-wake"]);
    assert.equal(result.attempted, 1);
    assert.equal(result.synced, 1);
    assert.equal(useAhanu.getState().catches.find((c) => c.id === "leftover-wake")?.synced, true);
    unbind();
  });

  it("does not fetch on hidden visibilitychange or without a token", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("no", { status: 500 });
    }) as typeof fetch;
    seedWake();
    const doc = fakeTarget("hidden");
    const win = fakeTarget();
    const unbind = bindUnsyncedCatchRetry({ document: doc, window: win });
    globalThis.localStorage.setItem("ahanu-device-token", "dock-token");
    doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(calls, 0);
    globalThis.localStorage.removeItem("ahanu-device-token");
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("online"));
    const result = await retryUnsyncedCatchesOnce();
    assert.equal(calls, 0);
    assert.equal(result.attempted, 0);
    assert.equal(useAhanu.getState().catches.find((c) => c.id === "leftover-wake")?.synced, false);
    unbind();
  });

  it("online retries leftovers and overlapping calls share one in-flight pass", async () => {
    let calls = 0;
    let inflight = 0;
    let maxInflight = 0;
    globalThis.fetch = (async (_input, init) => {
      calls += 1;
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      const body = JSON.parse(String(init?.body)) as { id: string };
      await new Promise((r) => setTimeout(r, 20));
      inflight -= 1;
      return new Response(JSON.stringify({ ok: true, catch: { ...body, synced: true } }), {
        status: 201,
      });
    }) as typeof fetch;
    seedWake();
    globalThis.localStorage.setItem("ahanu-device-token", "dock-token");
    const doc = fakeTarget("visible");
    const win = fakeTarget();
    const unbind = bindUnsyncedCatchRetry({ document: doc, window: win });
    win.dispatchEvent(new Event("online"));
    doc.dispatchEvent(new Event("visibilitychange"));
    const a = retryUnsyncedCatchesOnce();
    const b = retryUnsyncedCatchesOnce();
    const [first, second] = await Promise.all([a, b]);
    assert.equal(calls, 1);
    assert.equal(maxInflight, 1);
    assert.equal(first.attempted, 1);
    assert.equal(first.synced, 1);
    assert.equal(second.synced, 1);
    assert.equal(useAhanu.getState().catches.find((c) => c.id === "leftover-wake")?.synced, true);
    unbind();
  });
});
