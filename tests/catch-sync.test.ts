import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const { syncCatch } = await import("../src/lib/ahanu/catch-sync.ts");

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
