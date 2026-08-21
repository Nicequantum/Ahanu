import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const {
  CACHE_NAME,
  LIVE_MAX_AGE_MS,
  PACKS_CUSTOM_ORIGIN,
  PACKS_WORKER_ORIGIN,
  isPackPath,
  isAllowedPackOrigin,
  allowPackOrigin,
  resetPackOrigins,
  applyPacksOriginMessage,
  isLivePackRequest,
  isSkipCachePackRequest,
  packFetchStrategy,
  packNetworkRequest,
  isLiveCacheFresh,
  respondToPackRequest,
} = await import("../public/sw-ahanu.js");

const { handlePacksRequest } = await import("../src/lib/ahanu/pack-http.ts");
const { restorePackedSession } = await import("../src/lib/ahanu/pack-client.ts");
const { hashedPackCount, readyOffshoreBadge } = await import("../src/lib/ahanu/pack.ts");
const { putObject, saveManifest, resetPackMemory, loadCurrentManifest, bodiesForPack, seedObjectMemory } =
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
  afterEach(() => {
    resetPackOrigins();
  });

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
    assert.equal(packFetchStrategy(new URL(packUrl("/api/packs", "&skipCache=1"))), "network-first");
    assert.equal(isSkipCachePackRequest(new URL(packUrl("/api/packs", "&skipCache=true"))), true);
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
  afterEach(() => {
    resetPackOrigins();
  });

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

  it("sea-trial: last successful GET /api/packs is served after the network is gone", async () => {
    const caches = createMemoryCaches();
    const fixtureUrl = packUrl("/api/packs");
    const liveUrl = packUrl("/api/packs", "&live=1");
    const fixtureReq = new Request(fixtureUrl);
    const liveReq = new Request(liveUrl);
    const first = await respondToPackRequest(fixtureReq, {
      fetchImpl: (input: Request) => handlePacksRequest(input instanceof Request ? input : new Request(input)),
      cacheStore: caches,
      origin: ORIGIN,
      now: 10,
    });
    assert.ok(first);
    assert.equal(first.status, 200);
    const fixtureBody = await first.text();
    const fixtureJson = JSON.parse(fixtureBody) as { packId?: string; layers?: unknown[] };
    assert.ok(fixtureJson.packId, "fixture pack GET must return a manifest");
    assert.ok(Array.isArray(fixtureJson.layers) && fixtureJson.layers.length > 0);
    assert.equal(caches._size(), 1);

    const offline = async () => {
      throw new Error("offline");
    };
    const fixtureOffline = await respondToPackRequest(fixtureReq, {
      fetchImpl: offline,
      cacheStore: caches,
      origin: ORIGIN,
      now: 99_999,
    });
    assert.ok(fixtureOffline);
    assert.equal(await fixtureOffline.text(), fixtureBody);

    await respondToPackRequest(liveReq, {
      fetchImpl: async () => new Response("cached-live-manifest", { status: 200 }),
      cacheStore: caches,
      origin: ORIGIN,
      now: 10,
    });
    const liveOffline = await respondToPackRequest(liveReq, {
      fetchImpl: offline,
      cacheStore: caches,
      origin: ORIGIN,
      now: 99_999,
    });
    assert.ok(liveOffline);
    assert.equal(await liveOffline.text(), "cached-live-manifest");
  });

  it("skipCache is network-first even when the 30 s stamp is fresh; offline still last success", async () => {
    const caches = createMemoryCaches();
    const url = packUrl("/api/packs", "&skipCache=1");
    const req = new Request(url);
    await (
      await caches.open(CACHE_NAME)
    ).put(
      req,
      new Response("skip-stale", {
        status: 200,
        headers: { "X-Ahanu-Cached-At": "5000" },
      }),
    );
    let fetches = 0;
    const online = await respondToPackRequest(req, {
      fetchImpl: async () => {
        fetches += 1;
        return new Response("skip-fresh", { status: 200 });
      },
      cacheStore: caches,
      origin: ORIGIN,
      now: 5000 + 1_000,
    });
    assert.ok(online);
    assert.equal(await online.text(), "skip-fresh");
    assert.equal(fetches, 1);

    const offline = await respondToPackRequest(req, {
      fetchImpl: async () => {
        throw new Error("offline");
      },
      cacheStore: caches,
      origin: ORIGIN,
      now: 99_999,
    });
    assert.ok(offline);
    assert.equal(await offline.text(), "skip-fresh");
  });

  it("live=1 HTTP failure falls back to last success and does not overwrite it", async () => {
    const caches = createMemoryCaches();
    const url = packUrl("/api/packs", "&live=1");
    const req = new Request(url);
    await respondToPackRequest(req, {
      fetchImpl: async () => new Response("last-ok-live", { status: 200 }),
      cacheStore: caches,
      origin: ORIGIN,
      now: 10,
    });
    const failed = await respondToPackRequest(req, {
      fetchImpl: async () => new Response("upstream-502", { status: 502 }),
      cacheStore: caches,
      origin: ORIGIN,
      now: 10 + LIVE_MAX_AGE_MS + 1,
    });
    assert.ok(failed);
    assert.equal(await failed.text(), "last-ok-live");
    const again = await respondToPackRequest(req, {
      fetchImpl: async () => {
        throw new Error("offline");
      },
      cacheStore: caches,
      origin: ORIGIN,
      now: 99_999,
    });
    assert.equal(await again!.text(), "last-ok-live");
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

  it("treats the live CF packs origin as an allowlisted pack path and caches it", async () => {
    const url = `${PACKS_WORKER_ORIGIN}/api/packs?west=-72.8&south=39.4&east=-68.8&north=41.5&hours=72&start=${START}`;
    const parsed = new URL(url);
    assert.equal(PACKS_CUSTOM_ORIGIN, "https://api.ahanu.dev");
    assert.equal(PACKS_WORKER_ORIGIN, "https://ahanu-packs.hombre3536.workers.dev");
    assert.equal(isPackPath(parsed.pathname), true);
    assert.equal(isAllowedPackOrigin(parsed.origin, ORIGIN), true);
    assert.equal(isAllowedPackOrigin(PACKS_CUSTOM_ORIGIN, ORIGIN), true);
    assert.equal(isAllowedPackOrigin("https://other.example", ORIGIN), false);
    assert.equal(packFetchStrategy(parsed), "cache-first");
    assert.equal(packFetchStrategy(new URL(`${url}&live=1`)), "network-first");

    const caches = createMemoryCaches();
    let fetches = 0;
    let seenMode: string | undefined;
    const env = {
      fetchImpl: async (input: Request) => {
        fetches += 1;
        seenMode = input.mode;
        return new Response("cf-pack", { status: 200 });
      },
      cacheStore: caches,
      origin: ORIGIN,
      now: 1_000,
    };
    const first = await respondToPackRequest(new Request(url), env);
    assert.ok(first);
    assert.equal(await first.text(), "cf-pack");
    assert.equal(fetches, 1);
    assert.equal(seenMode, "cors");
    assert.equal(caches._size(), 1);

    const offline = await respondToPackRequest(new Request(url), {
      fetchImpl: async () => {
        throw new Error("offline");
      },
      cacheStore: caches,
      origin: ORIGIN,
      now: 99_999,
    });
    assert.ok(offline);
    assert.equal(await offline.text(), "cf-pack");
    assert.equal(fetches, 1);
  });

  it("treats api.ahanu.dev as an allowlisted pack path and caches it", async () => {
    const url = `${PACKS_CUSTOM_ORIGIN}/api/packs?west=-72.8&south=39.4&east=-68.8&north=41.5&hours=72&start=${START}`;
    const parsed = new URL(url);
    assert.equal(isAllowedPackOrigin(parsed.origin, ORIGIN), true);
    assert.equal(packFetchStrategy(parsed), "cache-first");

    const caches = createMemoryCaches();
    let fetches = 0;
    const env = {
      fetchImpl: async (input: Request) => {
        fetches += 1;
        return new Response("custom-pack", { status: 200 });
      },
      cacheStore: caches,
      origin: ORIGIN,
      now: 1_000,
    };
    const first = await respondToPackRequest(new Request(url), env);
    assert.ok(first);
    assert.equal(await first.text(), "custom-pack");
    assert.equal(fetches, 1);
    assert.equal(caches._size(), 1);

    const offline = await respondToPackRequest(new Request(url), {
      fetchImpl: async () => {
        throw new Error("offline");
      },
      cacheStore: caches,
      origin: ORIGIN,
      now: 99_999,
    });
    assert.ok(offline);
    assert.equal(await offline.text(), "custom-pack");
    assert.equal(fetches, 1);
  });

  it("cross-origin pack fetch uses CORS; a CORS failure does not invent a cached body", async () => {
    const url = `${PACKS_WORKER_ORIGIN}/api/objects?west=-72.8&south=39.4&east=-68.8&north=41.5&hours=72&start=${START}&layer=sst`;
    const caches = createMemoryCaches();
    const net = packNetworkRequest(new Request(url), ORIGIN);
    assert.equal(net.mode, "cors");
    assert.equal(net.credentials, "omit");
    const same = packNetworkRequest(new Request(packUrl("/api/packs")), ORIGIN);
    assert.notEqual(same.mode, "no-cors");

    const failed = await respondToPackRequest(new Request(url), {
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch");
      },
      cacheStore: caches,
      origin: ORIGIN,
      now: 1_000,
    });
    assert.ok(failed);
    assert.equal(failed.type, "error");
    assert.equal(caches._size(), 0);
  });

  it("postMessage can allowlist an extra packs origin; arbitrary hosts stay rejected", async () => {
    const extra = "https://packs.example.test";
    assert.equal(isAllowedPackOrigin(extra, ORIGIN), false);
    assert.equal(applyPacksOriginMessage({ type: "ahanu-packs-origin", origin: extra }), extra);
    assert.equal(isAllowedPackOrigin(extra, ORIGIN), true);
    assert.equal(isAllowedPackOrigin("https://evil.example/api/packs", ORIGIN), false);
    assert.equal(allowPackOrigin("ftp://nope.example"), null);

    const caches = createMemoryCaches();
    const url = `${extra}/api/packs?west=-72.8&south=39.4&east=-68.8&north=41.5&hours=72&start=${START}`;
    const res = await respondToPackRequest(new Request(url), {
      fetchImpl: async () => new Response("extra-pack", { status: 200 }),
      cacheStore: caches,
      origin: ORIGIN,
      now: 1_000,
    });
    assert.equal(await res!.text(), "extra-pack");
    assert.equal(caches._size(), 1);
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

    const restored = await restorePackedSession({ now: START });
    assert.ok(restored);
    assert.equal(restored.packId, manifest.packId);
    assert.equal(restored.manifest.packId, manifest.packId);
    assert.equal(restored.layers.length, 12);
    assert.equal(hashedPackCount(restored.layers).hashed, 12);
    assert.notEqual(readyOffshoreBadge(restored.ready).short, "No pack");
    assert.equal((await loadCurrentManifest())?.packId, manifest.packId);
    assert.ok((await bodiesForPack(manifest.packId)).sst);
    assert.ok(getPackedOcean()?.sst, "helm should see packed SST after restore");
  });

  it("returns null when IDB has no current pack (does not invent)", async () => {
    resetPackMemory();
    clearPackedOcean();
    const restored = await restorePackedSession();
    assert.equal(restored, null);
  });

  it("counts stale verified SST as hashed after restore", async () => {
    resetPackMemory();
    clearPackedOcean();
    const { manifest, bodies } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const aged = {
      ...manifest,
      layers: manifest.layers.map((l) =>
        l.id === "sst" ? { ...l, updatedAt: "2026-08-17T12:00:00.000Z" } : l,
      ),
    };
    for (const layer of aged.layers) {
      const body = bodies[layer.id];
      assert.ok(body, layer.id);
      await putObject({
        r2Key: layer.r2Key,
        layerId: layer.id,
        packId: aged.packId,
        hash: layer.hash,
        contentType: layer.contentType,
        body,
        storedAt: START,
      });
    }
    await saveManifest(aged);
    const restored = await restorePackedSession({ now: "2026-08-20T12:00:00.000Z" });
    assert.ok(restored);
    const sst = restored.layers.find((l) => l.id === "sst");
    assert.equal(sst?.verified, true);
    assert.equal(sst?.status, "stale");
    const count = hashedPackCount(restored.layers);
    assert.equal(count.hashed, 12);
    assert.equal(count.total, 12);
    assert.equal(count.stale, 1);
    assert.equal(restored.ready.ready, false);
    assert.notEqual(readyOffshoreBadge(restored.ready).short, "No pack");
  });

  it("re-evaluates Ready with persisted skipper override after restore", async () => {
    resetPackMemory();
    clearPackedOcean();
    const { manifest, bodies } = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const aged = {
      ...manifest,
      layers: manifest.layers.map((l) =>
        l.id === "sst" ? { ...l, updatedAt: "2026-08-17T12:00:00.000Z" } : l,
      ),
    };
    for (const layer of aged.layers) {
      const body = bodies[layer.id];
      await putObject({
        r2Key: layer.r2Key,
        layerId: layer.id,
        packId: aged.packId,
        hash: layer.hash,
        contentType: layer.contentType,
        body,
        storedAt: START,
      });
    }
    await saveManifest(aged);
    const restored = await restorePackedSession({
      now: "2026-08-20T12:00:00.000Z",
      sstOverride: true,
    });
    assert.ok(restored);
    assert.equal(restored.ready.ready, true, restored.ready.failures.join("; "));
    assert.equal(restored.ready.sstOverrideUsed, true);
    assert.equal(readyOffshoreBadge(restored.ready).long, "Ready · stale SST");
    const sst = restored.layers.find((l) => l.id === "sst");
    assert.equal(sst?.verified, true);
    assert.equal(sst?.status, "stale");
    const count = hashedPackCount(restored.layers);
    assert.equal(count.hashed, 12);
    assert.equal(count.stale, 1);
    assert.deepEqual(count.misses, []);
  });

  it("restore uses manifest r2Key so leftover buoys/tides snapshots do not hash-miss", async () => {
    resetPackMemory();
    clearPackedOcean();
    const first = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const second = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      overlays: {
        buoys: `${first.bodies.buoys.slice(0, -1)},"x":1}`,
        tides: `${first.bodies.tides.slice(0, -1)},"x":1}`,
      },
    });
    assert.equal(first.manifest.packId, second.manifest.packId);
    const buoys1 = first.manifest.layers.find((l) => l.id === "buoys")!;
    const buoys2 = second.manifest.layers.find((l) => l.id === "buoys")!;
    const tides1 = first.manifest.layers.find((l) => l.id === "tides")!;
    const tides2 = second.manifest.layers.find((l) => l.id === "tides")!;
    assert.notEqual(buoys1.hash, buoys2.hash);
    assert.notEqual(tides1.hash, tides2.hash);
    assert.notEqual(buoys1.r2Key, buoys2.r2Key);

    for (const layer of second.manifest.layers) {
      const body = second.bodies[layer.id];
      await putObject({
        r2Key: layer.r2Key,
        layerId: layer.id,
        packId: second.manifest.packId,
        hash: layer.hash,
        contentType: layer.contentType,
        body,
        storedAt: START,
      });
    }
    // Leftover earlier snapshots (same packId, older r2Key) — the sea-trial miss.
    seedObjectMemory({
      r2Key: buoys1.r2Key,
      layerId: "buoys",
      packId: first.manifest.packId,
      hash: buoys1.hash,
      contentType: buoys1.contentType,
      body: first.bodies.buoys,
      storedAt: START,
    });
    seedObjectMemory({
      r2Key: tides1.r2Key,
      layerId: "tides",
      packId: first.manifest.packId,
      hash: tides1.hash,
      contentType: tides1.contentType,
      body: first.bodies.tides,
      storedAt: START,
    });
    await saveManifest(second.manifest);

    const restored = await restorePackedSession({ now: START, sstOverride: true });
    assert.ok(restored);
    const count = hashedPackCount(restored.layers);
    assert.equal(count.hashed, 12, `miss ${count.misses.join(",")}`);
    assert.deepEqual(count.misses, []);
    assert.equal(restored.layers.find((l) => l.id === "buoys")?.verified, true);
    assert.equal(restored.layers.find((l) => l.id === "tides")?.verified, true);
    assert.ok(!restored.ready.failures.some((f) => f.includes("hash mismatch")));
    assert.ok(!restored.ready.warnings.some((w) => w.includes("hash mismatch")));
  });
});
