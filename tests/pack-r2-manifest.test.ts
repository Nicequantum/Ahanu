import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const { resolvePackManifest, persistBuiltPack, packManifestR2Key, loadPersistedManifest } =
  await import("../cloudflare/src/ingest/run.ts");
const { layerBody } = await import("../cloudflare/src/layer-body.ts");
const worker = (await import("../cloudflare/src/index.ts")).default;
const { buildTripPack, packIdFor, peekBuiltPack, resetBuiltPackCache, sha256Hex, POINT_JUDITH_CANYON_BBOX } =
  await import("../src/lib/ahanu/pack.ts");
const { resetLiveNoaaCache } = await import("../src/lib/ahanu/noaa-live.ts");

afterEach(() => {
  resetLiveNoaaCache();
  resetBuiltPackCache();
});

const START = "2026-08-20T18:00:00.000Z";
const HOURS = 72;
const Q =
  "west=-72.8&south=39.4&east=-68.8&north=41.5&hours=72&start=2026-08-20T18:00:00.000Z";

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

describe("GET /api/packs R2 manifest", () => {
  it("serves last persist without calling NOAA after isolate miss", async () => {
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
    assert.ok(store.has(packManifestR2Key(built.manifest.packId)));

    resetBuiltPackCache();
    resetLiveNoaaCache();
    assert.equal(peekBuiltPack({ bbox: POINT_JUDITH_CANYON_BBOX, start: START, hours: HOURS }), undefined);

    let fetches = 0;
    const hit = await resolvePackManifest(env, {
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      fetchImpl: async (url) => {
        fetches += 1;
        return ndbcFetch(NDBC_N1)(url);
      },
    });
    assert.equal(hit.source, "r2");
    assert.equal(fetches, 0, "R2 manifest hit must not rebuild NOAA");
    assert.equal(hit.manifest.packId, built.manifest.packId);
    assert.equal(hit.built, undefined);
    for (const rec of built.manifest.layers) {
      const served = hit.manifest.layers.find((l) => l.id === rec.id);
      assert.ok(served, rec.id);
      assert.equal(served.hash, rec.hash, rec.id);
    }
  });

  it("skipCache bypasses a stored R2 manifest and rebuilds", async () => {
    const { env } = mockEnv();
    const first = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      tryLive: true,
      skipCache: true,
      timeoutMs: 50,
      fetchImpl: ndbcFetch(NDBC_N),
    });
    await persistBuiltPack(env, first);
    const firstBuoys = first.manifest.layers.find((l) => l.id === "buoys");
    assert.ok(firstBuoys);

    resetBuiltPackCache();
    resetLiveNoaaCache();

    let fetches = 0;
    const bypass = await resolvePackManifest(env, {
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      skipCache: true,
      fetchImpl: async (url) => {
        fetches += 1;
        return ndbcFetch(NDBC_N1)(url);
      },
      timeoutMs: 50,
    });
    assert.equal(bypass.source, "live");
    assert.ok(fetches > 0, "skipCache must call NOAA");
    assert.ok(bypass.built);
    const nextBuoys = bypass.manifest.layers.find((l) => l.id === "buoys");
    assert.ok(nextBuoys);
    assert.notEqual(nextBuoys.hash, firstBuoys.hash, "new NDBC snapshot must re-hash");
  });

  it("explicit packId hits R2 even when bbox/start would compute the same window", async () => {
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
    const expectId = await packIdFor(POINT_JUDITH_CANYON_BBOX, START, HOURS);
    assert.equal(built.manifest.packId, expectId);

    resetBuiltPackCache();
    resetLiveNoaaCache();

    let fetches = 0;
    const hit = await resolvePackManifest(env, {
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      packId: built.manifest.packId,
      fetchImpl: async (url) => {
        fetches += 1;
        return ndbcFetch(NDBC_N1)(url);
      },
    });
    assert.equal(hit.source, "r2");
    assert.equal(fetches, 0);
    assert.equal(hit.manifest.packId, built.manifest.packId);
  });

  it("worker GET /api/packs serves R2 hashes; objects still match", async () => {
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
    assert.ok(store.has(packManifestR2Key(built.manifest.packId)));

    resetBuiltPackCache();
    resetLiveNoaaCache();

    const res = await worker.fetch(new Request(`http://ahanu.test/api/packs?${Q}`), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("X-Ahanu-Source"), "r2");
    const man = (await res.json()) as { packId: string; layers: { id: string; hash: string }[] };
    assert.equal(man.packId, built.manifest.packId);
    const buoys = man.layers.find((l) => l.id === "buoys");
    const want = built.manifest.layers.find((l) => l.id === "buoys");
    assert.ok(buoys && want);
    assert.equal(buoys.hash, want.hash);

    const obj = await layerBody(env, POINT_JUDITH_CANYON_BBOX, START, HOURS, "buoys", {
      packId: man.packId,
      hash: buoys.hash,
      fetchImpl: async () => {
        throw new Error("objects must not rebuild NOAA for served manifest hash");
      },
    });
    assert.ok(obj);
    assert.equal(obj.source, "r2");
    assert.equal(obj.hash, buoys.hash);
    assert.equal(await sha256Hex(obj.body), buoys.hash);
  });

  it("loadPersistedManifest rejects a corrupt or foreign packId body", async () => {
    const { env, store } = mockEnv();
    store.set(packManifestR2Key("deadbeefdeadbeef"), "{\"packId\":\"other\",\"version\":1,\"layers\":[]}");
    assert.equal(await loadPersistedManifest(env, "deadbeefdeadbeef"), null);
    store.set(packManifestR2Key("deadbeefdeadbeef"), "not-json");
    assert.equal(await loadPersistedManifest(env, "deadbeefdeadbeef"), null);
  });
});
