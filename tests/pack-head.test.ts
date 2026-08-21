import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const { LIVE_REBUILD_LIMIT, resetLiveRebuildLimit, takeLiveRebuildSlot } =
  await import("../cloudflare/src/live-rebuild-limit.ts");
const { headPackManifest, persistBuiltPack, packManifestR2Key, loadPersistedManifest } = await import(
  "../cloudflare/src/ingest/run.ts"
);
const { layerBody } = await import("../cloudflare/src/layer-body.ts");
const worker = (await import("../cloudflare/src/index.ts")).default;
const { buildTripPack, resetBuiltPackCache, POINT_JUDITH_CANYON_BBOX } = await import("../src/lib/ahanu/pack.ts");
const { resetLiveNoaaCache } = await import("../src/lib/ahanu/noaa-live.ts");
const { resetNdbcProbeCache } = await import("../cloudflare/src/ndbc-probe-cache.ts");

afterEach(() => {
  resetLiveNoaaCache();
  resetBuiltPackCache();
  resetLiveRebuildLimit();
  resetNdbcProbeCache();
});

const START = "2026-08-20T18:00:00.000Z";
const HOURS = 72;
const Q =
  "west=-72.8&south=39.4&east=-68.8&north=41.5&hours=72&start=2026-08-20T18:00:00.000Z";

const NDBC = `#STN LAT LON YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES PTDY ATMP WTMP DEWP VIS TIDE
44097 40.967 -71.126 26 08 20 16 40 210 5.2 6.8 1.0 8 5.4 200 1016.5 +0.0 22.1 21.8 MM MM MM
`;

function ndbcFetch(url: string): Promise<Response> {
  if (url.includes("latest_obs")) return Promise.resolve(new Response(NDBC, { status: 200 }));
  return Promise.resolve(new Response("no", { status: 404 }));
}

function sstCsv(iso: string, variable = "analysed_sst"): string {
  const rows = [`time,latitude,longitude,${variable}`, "UTC,degrees_north,degrees_east,degree_C"];
  const lats = [39.4, 40.0, 40.6, 41.2];
  const lons = [-72.8, -71.6, -70.4, -69.2];
  for (const lat of lats) {
    for (const lon of lons) {
      const t = 22.4 - (lat - 39.6) * 0.8 + (lon + 70.6) * 0.1;
      rows.push(`${iso},${lat},${lon},${t.toFixed(2)}`);
    }
  }
  return rows.join("\n") + "\n";
}

function acspoFetch(url: string): Promise<Response> {
  if (url.includes("noaacwLEOACSPOSSTL3SnrtKDaily")) {
    return Promise.resolve(
      new Response(sstCsv("2026-08-20T12:00:00Z", "sea_surface_temperature"), { status: 200 }),
    );
  }
  if (url.includes("latest_obs")) return Promise.resolve(new Response(NDBC, { status: 200 }));
  return Promise.resolve(new Response("no", { status: 404 }));
}

function throwingNoaa(): (url: string) => Promise<Response> {
  return async () => {
    throw new Error("HEAD must not rebuild NOAA");
  };
}

function mockEnv(fetchImpl: (url: string) => Promise<Response> = ndbcFetch) {
  const store = new Map<string, string>();
  return {
    store,
    env: {
      GFS_WAVE_SERIES: "0",
      fetchImpl,
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

const MATCH_HEADERS = [
  "content-type",
  "cache-control",
  "etag",
  "x-ahanu-pack-id",
  "x-ahanu-source",
  "x-ahanu-hash",
  "x-ahanu-ndbc",
  "access-control-allow-methods",
  "x-content-type-options",
  "referrer-policy",
] as const;

function assertHeadMatchesGet(head: Response, get: Response, label: string): void {
  assert.equal(head.status, get.status, `${label} status`);
  for (const key of MATCH_HEADERS) {
    assert.equal(head.headers.get(key), get.headers.get(key), `${label} ${key}`);
  }
}

describe("HEAD GET-only packs routes", () => {
  it("HEAD /api/sources matches GET status/headers and has an empty body", async () => {
    const { env } = mockEnv();
    const get = await worker.fetch(new Request("http://ahanu.test/api/sources"), env);
    const head = await worker.fetch(new Request("http://ahanu.test/api/sources", { method: "HEAD" }), env);
    assert.equal(get.status, 200);
    assertHeadMatchesGet(head, get, "sources");
    assert.equal(await head.text(), "");
    assert.ok((await get.text()).includes('"sources"'));
    assert.ok(head.headers.get("Access-Control-Allow-Methods")?.includes("HEAD"));
  });

  it("HEAD /api/buoys matches GET status/headers and has an empty body", async () => {
    const { env } = mockEnv();
    const warm = await worker.fetch(new Request("http://ahanu.test/api/buoys"), env);
    assert.equal(warm.status, 200);
    const get = await worker.fetch(new Request("http://ahanu.test/api/buoys"), env);
    const head = await worker.fetch(new Request("http://ahanu.test/api/buoys", { method: "HEAD" }), env);
    assert.equal(get.status, 200);
    assertHeadMatchesGet(head, get, "buoys");
    assert.equal(await head.text(), "");
    assert.ok(head.headers.get("X-Ahanu-Ndbc"));
  });

  it("HEAD /api/packs with last R2 matches GET and does not call NOAA", async () => {
    const { env } = mockEnv();
    const built = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      tryLive: true,
      skipCache: true,
      timeoutMs: 50,
      fetchImpl: ndbcFetch,
    });
    await persistBuiltPack(env, built);
    resetBuiltPackCache();
    resetLiveNoaaCache();
    env.fetchImpl = throwingNoaa();

    const get = await worker.fetch(new Request(`http://ahanu.test/api/packs?${Q}`), env);
    const head = await worker.fetch(new Request(`http://ahanu.test/api/packs?${Q}`, { method: "HEAD" }), env);
    assert.equal(get.status, 200);
    assert.equal(get.headers.get("X-Ahanu-Source"), "r2");
    assertHeadMatchesGet(head, get, "packs r2");
    assert.equal(await head.text(), "");
    assert.equal(head.headers.get("X-Ahanu-Pack-Id"), built.manifest.packId);
    assert.equal(head.headers.get("ETag"), `"${built.manifest.packId}"`);
  });

  it("HEAD /api/packs rewrites leftover MUR labels from an ACSPO body without NOAA", async () => {
    const { env, store } = mockEnv(acspoFetch);
    const nowFresh = new Date("2026-08-20T19:00:00.000Z");
    const built = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      createdAt: START,
      tryLive: true,
      skipCache: true,
      now: nowFresh,
      timeoutMs: 50,
      fetchImpl: acspoFetch,
    });
    await persistBuiltPack(env, built);
    const key = packManifestR2Key(built.manifest.packId);
    const stored = JSON.parse(store.get(key)!);
    stored.layers.find((l: { id: string }) => l.id === "sst").label = "SST composite (MUR / CoastWatch)";
    stored.sources = [
      { id: "noaa-sst", name: "SST MUR" },
      { id: "ghrsst-coastwatch-sst", name: "GHRSST / CoastWatch SST" },
    ];
    store.set(key, JSON.stringify(stored));
    resetBuiltPackCache();
    resetLiveNoaaCache();
    env.fetchImpl = throwingNoaa();

    const headed = await headPackManifest(env, {
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
    });
    assert.equal(headed.source, "r2");
    assert.ok(headed.manifest);
    assert.ok(headed.built);
    assert.match(headed.manifest.layers.find((l) => l.id === "sst")?.label ?? "", /ACSPO/);
    assert.match((headed.manifest.sources ?? []).find((s) => s.id === "noaa-sst")?.name ?? "", /ACSPO/);
    assert.doesNotMatch(headed.manifest.layers.find((l) => l.id === "sst")?.label ?? "", /MUR \/ CoastWatch/);
    assert.ok(!(headed.manifest.sources ?? []).some((s) => s.id === "ghrsst-coastwatch-sst"));

    const head = await worker.fetch(new Request(`http://ahanu.test/api/packs?${Q}`, { method: "HEAD" }), env);
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("X-Ahanu-Source"), "r2");
    assert.equal(await head.text(), "");
    const loaded = await loadPersistedManifest(env, built.manifest.packId);
    assert.ok(loaded);
    assert.match(loaded.layers.find((l) => l.id === "sst")?.label ?? "", /ACSPO/);
    assert.match((loaded.sources ?? []).find((s) => s.id === "noaa-sst")?.name ?? "", /ACSPO/);
    assert.doesNotMatch(loaded.layers.find((l) => l.id === "sst")?.label ?? "", /MUR \/ CoastWatch/);
    assert.ok(!(loaded.sources ?? []).some((s) => s.id === "ghrsst-coastwatch-sst"));
  });

  it("HEAD /api/packs?skipCache=1 serves last R2 and does not take a live-rebuild slot", async () => {
    const { env } = mockEnv();
    const built = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      tryLive: true,
      skipCache: true,
      timeoutMs: 50,
      fetchImpl: ndbcFetch,
    });
    await persistBuiltPack(env, built);
    const ip = "203.0.113.91";
    for (let i = 0; i < LIVE_REBUILD_LIMIT; i++) assert.equal(takeLiveRebuildSlot(ip).ok, true);
    env.LIVE_REBUILD = {
      limit: async () => {
        throw new Error("HEAD must not call LIVE_REBUILD");
      },
    };
    resetBuiltPackCache();
    resetLiveNoaaCache();
    env.fetchImpl = throwingNoaa();

    const head = await worker.fetch(
      new Request(`http://ahanu.test/api/packs?${Q}&skipCache=1`, {
        method: "HEAD",
        headers: { "CF-Connecting-IP": ip },
      }),
      env,
    );
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("X-Ahanu-Source"), "r2");
    assert.equal(await head.text(), "");
  });

  it("HEAD /api/packs without a cached manifest is 503 no-rebuild and does not NOAA", async () => {
    const { env } = mockEnv(throwingNoaa());
    let limited = 0;
    env.LIVE_REBUILD = {
      limit: async () => {
        limited += 1;
        return { success: true };
      },
    };
    const ip = "203.0.113.92";
    const headed = await headPackManifest(env, {
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
    });
    assert.equal(headed.source, "no-rebuild");
    assert.equal(headed.manifest, null);

    const head = await worker.fetch(
      new Request(`http://ahanu.test/api/packs?${Q}&skipCache=1`, {
        method: "HEAD",
        headers: { "CF-Connecting-IP": ip },
      }),
      env,
    );
    assert.equal(head.status, 503);
    assert.equal(head.headers.get("X-Ahanu-Source"), "no-rebuild");
    assert.equal(head.headers.get("Cache-Control"), "no-store");
    assert.equal(await head.text(), "");
    assert.equal(limited, 0);
  });

  it("HEAD /api/objects with R2 matches GET headers and has an empty body", async () => {
    const { env } = mockEnv();
    const built = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      tryLive: true,
      skipCache: true,
      timeoutMs: 50,
      fetchImpl: ndbcFetch,
    });
    await persistBuiltPack(env, built);
    const buoys = built.manifest.layers.find((l) => l.id === "buoys");
    assert.ok(buoys);
    resetBuiltPackCache();
    resetLiveNoaaCache();
    env.fetchImpl = throwingNoaa();

    const objQ = `${Q}&layer=buoys&packId=${built.manifest.packId}&hash=${buoys.hash}`;
    const get = await worker.fetch(new Request(`http://ahanu.test/api/objects?${objQ}`), env);
    const head = await worker.fetch(new Request(`http://ahanu.test/api/objects?${objQ}`, { method: "HEAD" }), env);
    assert.equal(get.status, 200);
    assert.equal(get.headers.get("X-Ahanu-Source"), "r2");
    assertHeadMatchesGet(head, get, "objects r2");
    assert.equal(await head.text(), "");
    assert.equal(head.headers.get("X-Ahanu-Hash"), buoys.hash);
    assert.ok((await get.text()).length > 8);
  });

  it("HEAD /api/objects?skipCache=1 without cache is 503 and does not rebuild", async () => {
    const { env } = mockEnv(throwingNoaa());
    let limited = 0;
    env.LIVE_REBUILD = {
      limit: async () => {
        limited += 1;
        return { success: true };
      },
    };
    const miss = await layerBody(env, POINT_JUDITH_CANYON_BBOX, START, HOURS, "buoys", {
      skipCache: true,
      head: true,
      fetchImpl: throwingNoaa(),
      limitLiveRebuild: { ip: "203.0.113.93", limiter: env.LIVE_REBUILD },
    });
    assert.equal(miss, null);

    const head = await worker.fetch(
      new Request(`http://ahanu.test/api/objects?${Q}&layer=buoys&skipCache=1`, {
        method: "HEAD",
        headers: { "CF-Connecting-IP": "203.0.113.93" },
      }),
      env,
    );
    assert.equal(head.status, 503);
    assert.equal(head.headers.get("X-Ahanu-Source"), "no-rebuild");
    assert.equal(await head.text(), "");
    assert.equal(limited, 0);
  });

  it("HEAD /api/packs with bad hours is 400 empty body like GET", async () => {
    const { env } = mockEnv();
    const q = "west=-72.8&south=39.4&east=-68.8&north=41.5&hours=999";
    const get = await worker.fetch(new Request(`http://ahanu.test/api/packs?${q}`), env);
    const head = await worker.fetch(new Request(`http://ahanu.test/api/packs?${q}`, { method: "HEAD" }), env);
    assert.equal(get.status, 400);
    assertHeadMatchesGet(head, get, "packs 400");
    assert.equal(await head.text(), "");
  });

  it("HEAD skipCache does not consume slots that GET skipCache still needs", async () => {
    const { env } = mockEnv();
    const ip = "203.0.113.94";
    for (let i = 0; i < 2; i++) {
      const head = await worker.fetch(
        new Request(`http://ahanu.test/api/packs?${Q}&skipCache=1`, {
          method: "HEAD",
          headers: { "CF-Connecting-IP": ip },
        }),
        env,
      );
      assert.equal(head.status, 503);
      assert.equal(head.headers.get("X-Ahanu-Source"), "no-rebuild");
    }
    const statuses: number[] = [];
    for (let i = 0; i < LIVE_REBUILD_LIMIT + 1; i++) {
      resetBuiltPackCache();
      resetLiveNoaaCache();
      const res = await worker.fetch(
        new Request(`http://ahanu.test/api/packs?${Q}&skipCache=1`, {
          headers: { "CF-Connecting-IP": ip },
        }),
        env,
      );
      statuses.push(res.status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 429]);
  });
});
