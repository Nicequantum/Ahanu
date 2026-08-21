import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const {
  LIVE_REBUILD_LIMIT,
  LIVE_REBUILD_WINDOW_MS,
  connectingIp,
  resetLiveRebuildLimit,
  takeLiveRebuildSlot,
} = await import("../cloudflare/src/live-rebuild-limit.ts");
const { resolvePackManifest, persistBuiltPack, ingestFixturePack } = await import("../cloudflare/src/ingest/run.ts");
const { layerBody } = await import("../cloudflare/src/layer-body.ts");
const worker = (await import("../cloudflare/src/index.ts")).default;
const { buildTripPack, resetBuiltPackCache, POINT_JUDITH_CANYON_BBOX } = await import("../src/lib/ahanu/pack.ts");
const { resetLiveNoaaCache } = await import("../src/lib/ahanu/noaa-live.ts");

afterEach(() => {
  resetLiveNoaaCache();
  resetBuiltPackCache();
  resetLiveRebuildLimit();
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

function mockEnv() {
  const store = new Map<string, string>();
  return {
    store,
    env: {
      GFS_WAVE_SERIES: "0",
      fetchImpl: ndbcFetch,
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

function packsReq(ip: string | null, skipCache: boolean): Request {
  const q = skipCache ? `${Q}&skipCache=1` : Q;
  const headers: Record<string, string> = {};
  if (ip) headers["CF-Connecting-IP"] = ip;
  return new Request(`http://ahanu.test/api/packs?${q}`, { headers });
}

describe("live rebuild limiter", () => {
  it("allows the first three slots then denies with Retry-After", () => {
    const now = 1_000_000;
    assert.equal(takeLiveRebuildSlot("203.0.113.10", now).ok, true);
    assert.equal(takeLiveRebuildSlot("203.0.113.10", now + 1_000).ok, true);
    assert.equal(takeLiveRebuildSlot("203.0.113.10", now + 2_000).ok, true);
    const denied = takeLiveRebuildSlot("203.0.113.10", now + 3_000);
    assert.equal(denied.ok, false);
    if (!denied.ok) {
      assert.ok(denied.retryAfter >= 1);
      assert.ok(denied.retryAfter <= LIVE_REBUILD_WINDOW_MS / 1000);
    }
    assert.equal(takeLiveRebuildSlot("198.51.100.20", now + 3_000).ok, true, "other IP is independent");
  });

  it("fail-closes on a missing IP and reopens after the window", () => {
    assert.equal(takeLiveRebuildSlot(null).ok, false);
    assert.equal(takeLiveRebuildSlot("").ok, false);
    const now = 5_000_000;
    assert.equal(takeLiveRebuildSlot("203.0.113.8", now).ok, true);
    assert.equal(takeLiveRebuildSlot("203.0.113.8", now + 10).ok, true);
    assert.equal(takeLiveRebuildSlot("203.0.113.8", now + 20).ok, true);
    assert.equal(takeLiveRebuildSlot("203.0.113.8", now + 30).ok, false);
    assert.equal(takeLiveRebuildSlot("203.0.113.8", now + LIVE_REBUILD_WINDOW_MS + 1).ok, true);
  });

  it("prefers CF-Connecting-IP over X-Forwarded-For", () => {
    const req = new Request("http://ahanu.test/api/packs", {
      headers: {
        "CF-Connecting-IP": "203.0.113.1",
        "X-Forwarded-For": "198.51.100.1, 192.0.2.1",
      },
    });
    assert.equal(connectingIp(req), "203.0.113.1");
    assert.equal(
      connectingIp(new Request("http://ahanu.test/", { headers: { "X-Forwarded-For": "198.51.100.9" } })),
      "198.51.100.9",
    );
    assert.equal(connectingIp(new Request("http://ahanu.test/")), null);
  });
});

describe("GET /api/packs skipCache live rebuild limit", () => {
  it("allows the first skipCache rebuilds then 429s", async () => {
    const { env } = mockEnv();
    const ip = "203.0.113.40";
    const statuses: number[] = [];
    for (let i = 0; i < LIVE_REBUILD_LIMIT + 1; i++) {
      resetBuiltPackCache();
      resetLiveNoaaCache();
      const res = await worker.fetch(packsReq(ip, true), env);
      statuses.push(res.status);
      if (res.status === 429) {
        assert.ok(res.headers.get("Retry-After"));
        const body = (await res.json()) as { error?: string; limit?: number };
        assert.equal(body.error, "too many live rebuilds");
        assert.equal(body.limit, LIVE_REBUILD_LIMIT);
      } else {
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("X-Ahanu-Source"), "live");
      }
    }
    assert.deepEqual(statuses, [200, 200, 200, 429]);
  });

  it("R2 / manifest hits do not count against the live rebuild limit", async () => {
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

    const ip = "203.0.113.41";
    for (let i = 0; i < LIVE_REBUILD_LIMIT; i++) {
      assert.equal(takeLiveRebuildSlot(ip).ok, true);
    }

    resetBuiltPackCache();
    resetLiveNoaaCache();
    const hit = await worker.fetch(packsReq(ip, false), env);
    assert.equal(hit.status, 200);
    assert.equal(hit.headers.get("X-Ahanu-Source"), "r2");

    resetBuiltPackCache();
    resetLiveNoaaCache();
    const skip = await worker.fetch(packsReq(ip, true), env);
    assert.equal(skip.status, 429);
    assert.equal(skip.headers.get("Retry-After"), skip.headers.get("Retry-After"));
    assert.ok(Number(skip.headers.get("Retry-After")) >= 1);
  });

  it("fail-closes skipCache when CF-Connecting-IP is missing", async () => {
    const { env } = mockEnv();
    const res = await worker.fetch(packsReq(null, true), env);
    assert.equal(res.status, 429);
    assert.ok(res.headers.get("Retry-After"));
  });

  it("a second IP can still skipCache after the first is limited", async () => {
    const { env } = mockEnv();
    const a = "203.0.113.50";
    const b = "203.0.113.51";
    for (let i = 0; i < LIVE_REBUILD_LIMIT; i++) {
      resetBuiltPackCache();
      resetLiveNoaaCache();
      const res = await worker.fetch(packsReq(a, true), env);
      assert.equal(res.status, 200);
    }
    const limited = await worker.fetch(packsReq(a, true), env);
    assert.equal(limited.status, 429);
    resetBuiltPackCache();
    resetLiveNoaaCache();
    const other = await worker.fetch(packsReq(b, true), env);
    assert.equal(other.status, 200);
    assert.equal(other.headers.get("X-Ahanu-Source"), "live");
  });
});

describe("objects rebuild-on-total-miss is limited; R2 is not", () => {
  it("unpinned objects miss that rebuilds NOAA counts, R2 hit does not", async () => {
    const { env } = mockEnv();
    const ip = "203.0.113.60";

    resetBuiltPackCache();
    const live = await layerBody(env, POINT_JUDITH_CANYON_BBOX, START, HOURS, "buoys", {
      fetchImpl: ndbcFetch,
      limitLiveRebuild: { ip },
    });
    assert.ok(live);
    assert.notEqual(live.source, "r2");

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
    takeLiveRebuildSlot(ip);
    takeLiveRebuildSlot(ip);
    const r2 = await layerBody(env, POINT_JUDITH_CANYON_BBOX, START, HOURS, "buoys", {
      packId: built.manifest.packId,
      hash: built.manifest.layers.find((l) => l.id === "buoys")?.hash,
      fetchImpl: async () => {
        throw new Error("R2 hit must not rebuild NOAA");
      },
      limitLiveRebuild: { ip },
    });
    assert.ok(r2);
    assert.equal(r2.source, "r2");

    resetBuiltPackCache();
    resetLiveNoaaCache();
    await assert.rejects(
      () =>
        layerBody(env, POINT_JUDITH_CANYON_BBOX, START, HOURS, "buoys", {
          skipCache: true,
          fetchImpl: ndbcFetch,
          limitLiveRebuild: { ip },
        }),
      (err: unknown) => err instanceof Error && err.name === "LiveRebuildLimitError",
    );
  });
});

describe("cron ingest is not HTTP-limited", () => {
  it("ingestFixturePack still builds after the HTTP slots are full", async () => {
    const ip = "203.0.113.70";
    for (let i = 0; i < LIVE_REBUILD_LIMIT; i++) assert.equal(takeLiveRebuildSlot(ip).ok, true);
    const result = await ingestFixturePack(
      {},
      {
        bbox: POINT_JUDITH_CANYON_BBOX,
        start: START,
        hours: HOURS,
        fetchImpl: ndbcFetch,
        skipCache: true,
        timeoutMs: 50,
      },
    );
    assert.equal(result.layers.length, 12);
    assert.equal(result.source, "memory");
  });

  it("resolvePackManifest without limitLiveRebuild ignores the HTTP cap", async () => {
    const { env } = mockEnv();
    const ip = "203.0.113.71";
    for (let i = 0; i < LIVE_REBUILD_LIMIT; i++) assert.equal(takeLiveRebuildSlot(ip).ok, true);
    const live = await resolvePackManifest(env, {
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      skipCache: true,
      fetchImpl: ndbcFetch,
      timeoutMs: 50,
    });
    assert.equal(live.source, "live");
    assert.ok(live.built);
  });
});
