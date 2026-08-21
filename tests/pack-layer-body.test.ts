import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const { layerBody } = await import("../cloudflare/src/layer-body.ts");
const { persistBuiltPack, latestLayerR2Key, packManifestR2Key } = await import("../cloudflare/src/ingest/run.ts");
const { buildTripPack, peekBuiltPack, resetBuiltPackCache, sha256Hex, POINT_JUDITH_CANYON_BBOX } =
  await import("../src/lib/ahanu/pack.ts");
const { resetLiveNoaaCache } = await import("../src/lib/ahanu/noaa-live.ts");

afterEach(() => {
  resetLiveNoaaCache();
  resetBuiltPackCache();
});

const START = "2026-08-20T18:00:00.000Z";
const HOURS = 72;

const NDBC_N = `#STN LAT LON YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES PTDY ATMP WTMP DEWP VIS TIDE
44097 40.967 -71.126 26 08 20 16 40 210 5.2 6.8 1.0 8 5.4 200 1016.5 +0.0 22.1 21.8 MM MM MM
`;
const NDBC_N1 = `#STN LAT LON YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES PTDY ATMP WTMP DEWP VIS TIDE
44097 40.967 -71.126 26 08 20 16 50 220 7.1 8.4 1.3 9 5.8 210 1015.8 -0.4 22.0 21.6 MM MM MM
`;

function ndbcFetch(text: string): (url: string) => Promise<Response> {
  return (url: string) => {
    if (url.includes("latest_obs")) return Promise.resolve(new Response(text, { status: 200 }));
    return Promise.resolve(new Response("no", { status: 404 }));
  };
}

function mockEnv() {
  const store = new Map<string, string>();
  return {
    store,
    env: {
      PACKS: {
        put: async (key: string, value: string | ArrayBuffer) => {
          store.set(key, typeof value === "string" ? value : new TextDecoder().decode(value));
        },
        get: async (key: string) => {
          const text = store.get(key);
          return text ? { text: async () => text } : null;
        },
      },
    },
  };
}

describe("layerBody vs pack manifest hash", () => {
  it("reuses the last buildTripPack buoys bytes after skipCache packs", async () => {
    const { env } = mockEnv();
    const built = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      tryLive: true,
      skipCache: true,
      timeoutMs: 50,
      fetchImpl: ndbcFetch(NDBC_N),
    });
    await persistBuiltPack(env, built);
    const rec = built.manifest.layers.find((l) => l.id === "buoys");
    assert.ok(rec);
    assert.equal(rec.source, "noaa");

    let fetches = 0;
    const obj = await layerBody(env, POINT_JUDITH_CANYON_BBOX, START, HOURS, "buoys", {
      fetchImpl: async (url) => {
        fetches += 1;
        return ndbcFetch(NDBC_N1)(url);
      },
    });
    assert.ok(obj);
    assert.equal(fetches, 0, "must not rebuild NOAA when isolate cache has the pack");
    assert.equal(obj.hash, rec.hash);
    assert.equal(await sha256Hex(obj.body), rec.hash);
    assert.ok(obj.body.includes("21.8") || obj.body.includes("5.2"));
  });

  it("serves R2 manifest r2Key after isolate cache miss — no NOAA rebuild", async () => {
    const { env, store } = mockEnv();
    const built = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      tryLive: true,
      skipCache: true,
      timeoutMs: 50,
      fetchImpl: ndbcFetch(NDBC_N),
    });
    await persistBuiltPack(env, built);
    const rec = built.manifest.layers.find((l) => l.id === "buoys");
    assert.ok(rec);
    assert.ok(store.has(rec.r2Key));
    assert.ok(store.has(latestLayerR2Key(built.manifest.packId, "buoys")));
    assert.ok(store.has(packManifestR2Key(built.manifest.packId)));

    resetBuiltPackCache();
    resetLiveNoaaCache();
    assert.equal(peekBuiltPack({ bbox: POINT_JUDITH_CANYON_BBOX, start: START, hours: HOURS }), undefined);

    let fetches = 0;
    const obj = await layerBody(env, POINT_JUDITH_CANYON_BBOX, START, HOURS, "buoys", {
      fetchImpl: async (url) => {
        fetches += 1;
        return ndbcFetch(NDBC_N1)(url);
      },
    });
    assert.ok(obj);
    assert.equal(fetches, 0, "must not rebuild NOAA when R2 has the hashed body");
    assert.equal(obj.hash, rec.hash);
    assert.equal(await sha256Hex(obj.body), rec.hash);
    assert.equal(obj.source, "r2");
  });

  it("rebuilds live only on cache/R2 miss and returns a hash that matches the body", async () => {
    const { env } = mockEnv();
    const obj = await layerBody(env, POINT_JUDITH_CANYON_BBOX, START, HOURS, "buoys", {
      skipCache: true,
      fetchImpl: ndbcFetch(NDBC_N1),
    });
    assert.ok(obj);
    assert.equal(obj.hash, await sha256Hex(obj.body));
    assert.equal(obj.source, "noaa");
    assert.ok(obj.body.includes("21.6") || obj.body.includes("7.1"));
  });
});
