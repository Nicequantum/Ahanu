import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const {
  CACHE_NAME,
  LIVE_MAX_AGE_MS,
  isPackPath,
  isLivePackRequest,
  packFetchStrategy,
  isLiveCacheFresh,
  respondToPackRequest,
} = await import("../public/sw-ahanu.js");

const { handlePacksRequest } = await import("../src/lib/ahanu/pack-http.ts");
const { restorePackedSession } = await import("../src/lib/ahanu/pack-client.ts");
const { putObject, saveManifest, resetPackMemory, loadCurrentManifest, bodiesForPack } =
  await import("../src/lib/ahanu/pack-store.ts");
const { buildFixturePack, POINT_JUDITH_CANYON_BBOX } = await import("../src/lib/ahanu/pack.ts");
const { clearPackedOcean, getPackedOcean } = await import("../src/lib/ahanu/packed-fields.ts");

const START = "2026-08-20T12:00:00.000Z";
const ORIGIN = "http://ahanu.test";

function packUrl(path: string, extra = "") {
  return `${ORIGIN}${path}?west=-72.8&south=39.4&east=-68.8&north=41.5&hours=72&start=${START}${extra}`;
}

function createMemoryCaches() {
  const buckets = new Map<string, Map<string, Response>>();
  function bucket(name: string) {
    let map = buckets.get(name);
    if (!map) {
      map = new Map();
      buckets.set(name, map);
    }
    return map;
  }
  function keyOf(req: Request | string) {
    return typeof req === "string" ? req : req.url;
  }
  return {
    open: async (name: string) => {
      const map = bucket(name);
      return {
        match: async (req: Request | string) => {
          const hit = map.get(keyOf(req));
          return hit ? hit.clone() : undefined;
        },
        put: async (req: Request | string, res: Response) => {
          map.set(keyOf(req), res);
        },
      };
    },
    match: async (req: Request | string) => {
      for (const map of buckets.values()) {
        const hit = map.get(keyOf(req));
        if (hit) return hit.clone();
      }
      return undefined;
    },
    keys: async () => [...buckets.keys()],
    _size: (name = CACHE_NAME) => bucket(name).size,
  };
}

describe("SW pack URL strategy", () => {
  it("claims packs and objects, not other GET paths", () => {
    assert.equal(isPackPath("/api/packs"), true);
    assert.equal(isPackPath("/api/objects"), true);
    assert.equal(isPackPath("/api/objects/sst"), true);
    assert.equal(isPackPath("/api/catches"), false);
    assert.equal(isPackPath("/sw-ahanu.js"), false);
  });

  it("treats live=1/true/yes as live; fixture otherwise", () => {
    assert.equal(isLivePackRequest(new URL(packUrl("/api/packs"))), false);
    assert.equal(isLivePackRequest(new URL(packUrl("/api/packs", "&live=1"))), true);
    assert.equal(isLivePackRequest(new URL(packUrl("/api/objects", "&live=true&layer=sst"))), true);
    assert.equal(isLivePackRequest(new URL(packUrl("/api/packs", "&live=yes"))), true);
    assert.equal(isLivePackRequest(new URL(packUrl("/api/packs", "&live=0"))), false);
  });

  it("cache-first for fixture, network-first for live", () => {
    assert.equal(packFetchStrategy(new URL(packUrl("/api/packs"))), "cache-first");
    assert.equal(packFetchStrategy(new URL(packUrl("/api/objects", "&layer=sst"))), "cache-first");
    assert.equal(packFetchStrategy(new URL(packUrl("/api/packs", "&live=1"))), "network-first");
    assert.equal(packFetchStrategy(new URL("http://ahanu.test/api/catches")), null);
  });

  it("live freshness is 30 s, not forever", () => {
    assert.equal(LIVE_MAX_AGE_MS, 30_000);
    const fresh = new Response("ok", { headers: { "X-Ahanu-Cached-At": "1000" } });
    assert.equal(isLiveCacheFresh(fresh, 1000 + 29_000), true);
    assert.equal(isLiveCacheFresh(fresh, 1000 + 31_000), false);
    assert.equal(isLiveCacheFresh(new Response("ok"), 2000), false);
  });
});

describe("respondToPackRequest", () => {
  it("cache-first: fixture object is served from cache after first success", async () => {
    const caches = createMemoryCaches();
    let fetches = 0;
    const url = packUrl("/api/objects", "&layer=sst");
    const env = {
      fetchImpl: async () => {
        fetches += 1;
        return new Response("fixture-sst", { status: 200 });
      },
      cacheStore: caches,
      origin: ORIGIN,
      now: 1_000,
    };
    const first = await respondToPackRequest(new Request(url), env);
    assert.ok(first);
    assert.equal(await first.text(), "fixture-sst");
    assert.equal(fetches, 1);
    const second = await respondToPackRequest(new Request(url), env);
    assert.ok(second);
    assert.equal(await second.text(), "fixture-sst");
    assert.equal(fetches, 1);
    assert.equal(caches._size(), 1);
  });

  it("network-first: live=1 hits the network even when a cache entry exists", async () => {
    const caches = createMemoryCaches();
    const url = packUrl("/api/packs", "&live=1");
    const req = new Request(url);
    await (
      await caches.open(CACHE_NAME)
    ).put(
      req,
      new Response("stale-live", {
        status: 200,
        headers: { "X-Ahanu-Cached-At": "1" },
      }),
    );
    let fetches = 0;
    const res = await respondToPackRequest(req, {
      fetchImpl: async () => {
        fetches += 1;
        return new Response("fresh-live", { status: 200 });
      },
      cacheStore: caches,
      origin: ORIGIN,
      now: 1 + LIVE_MAX_AGE_MS + 1,
    });
    assert.ok(res);
    assert.equal(await res.text(), "fresh-live");
    assert.equal(fetches, 1);
  });

  it("live=1 uses the 30 s stamp only as a freshness hint", async () => {
    const caches = createMemoryCaches();
    const url = packUrl("/api/objects", "&live=1&layer=buoys");
    const req = new Request(url);
    await (
      await caches.open(CACHE_NAME)
    ).put(
      req,
      new Response("recent-live", {
        status: 200,
        headers: { "X-Ahanu-Cached-At": "5000" },
      }),
    );
    let fetches = 0;
    const res = await respondToPackRequest(req, {
      fetchImpl: async () => {
        fetches += 1;
        return new Response("should-not-run", { status: 200 });
      },
      cacheStore: caches,
      origin: ORIGIN,
      now: 5000 + 1_000,
    });
    assert.ok(res);
    assert.equal(await res.text(), "recent-live");
    assert.equal(fetches, 0);
  });

  it("airplane mode: fixture and live fall back to the last successful cache", async () => {
    const caches = createMemoryCaches();
    const fixtureUrl = packUrl("/api/objects", "&layer=wind");
    const liveUrl = packUrl("/api/packs", "&live=1");
    const fixtureReq = new Request(fixtureUrl);
    const liveReq = new Request(liveUrl);
    await respondToPackRequest(fixtureReq, {
      fetchImpl: async () => new Response("cached-wind", { status: 200 }),
      cacheStore: caches,
      origin: ORIGIN,
      now: 10,
    });
    await respondToPackRequest(liveReq, {
      fetchImpl: async () => new Response("cached-live-manifest", { status: 200 }),
      cacheStore: caches,
      origin: ORIGIN,
      now: 10,
    });
    const offline = async () => {
      throw new Error("offline");
    };
    const fixture = await respondToPackRequest(fixtureReq, {
      fetchImpl: offline,
      cacheStore: caches,
      origin: ORIGIN,
      now: 99_999,
    });
    const live = await respondToPackRequest(liveReq, {
      fetchImpl: offline,
      cacheStore: caches,
      origin: ORIGIN,
      now: 99_999,
    });
    assert.equal(await fixture!.text(), "cached-wind");
    assert.equal(await live!.text(), "cached-live-manifest");
  });

  it("does not claim cross-origin pack URLs or non-GET", async () => {
    const caches = createMemoryCaches();
    const env = {
      fetchImpl: async () => new Response("nope", { status: 200 }),
      cacheStore: caches,
      origin: ORIGIN,
    };
    const cross = await respondToPackRequest(new Request("https://other.example/api/packs"), env);
    const post = await respondToPackRequest(
      new Request(packUrl("/api/packs"), { method: "POST" }),
      env,
    );
    assert.equal(cross, null);
    assert.equal(post, null);
    assert.equal(caches._size(), 0);
  });
});

describe("preview pack HTTP cache headers", () => {
  it("fixture packs/objects are day-cacheable; live=1 is 30 s", async () => {
    const q = "west=-72.8&south=39.4&east=-68.8&north=41.5&hours=72&start=2026-08-20T12:00:00.000Z";
    const fix = await handlePacksRequest(new Request(`http://ahanu.test/api/packs?${q}`));
    const live = await handlePacksRequest(new Request(`http://ahanu.test/api/packs?${q}&live=1`), {
      fetchImpl: async () => new Response("no", { status: 404 }),
    });
    const obj = await handlePacksRequest(
      new Request(`http://ahanu.test/api/objects?${q}&layer=sst`),
    );
    assert.equal(fix.headers.get("Cache-Control"), "public, max-age=86400");
    assert.equal(live.headers.get("Cache-Control"), "public, max-age=30");
    assert.equal(obj.headers.get("Cache-Control"), "public, max-age=86400");
  });
});

describe("pack-store restore (IDB / memory source of truth)", () => {
  afterEach(() => {
    resetPackMemory();
    clearPackedOcean();
  });

  it("reload sees the last successful pack without touching the network", async () => {
    resetPackMemory();
    clearPackedOcean();
    const { manifest, bodies } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    for (const layer of manifest.layers) {
      const body = bodies[layer.id];
      assert.ok(body, layer.id);
      await putObject({
        r2Key: layer.r2Key,
        layerId: layer.id,
        packId: manifest.packId,
        hash: layer.hash,
        contentType: layer.contentType,
        body,
        storedAt: START,
      });
    }
    await saveManifest(manifest);
    clearPackedOcean();
    assert.equal(getPackedOcean(), null);

    const restored = await restorePackedSession();
    assert.ok(restored);
    assert.equal(restored.packId, manifest.packId);
    assert.equal((await loadCurrentManifest())?.packId, manifest.packId);
    assert.ok((await bodiesForPack(manifest.packId)).sst);
    assert.ok(getPackedOcean()?.sst, "helm should see packed SST after restore");
  });
});
