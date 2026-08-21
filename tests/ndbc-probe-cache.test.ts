import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const {
  NDBC_PROBE_TTL_MS,
  NDBC_PROBE_MIN_INTERVAL_MS,
  NDBC_PROBE_R2_KEY,
  parseNdbcCacheEntry,
  resetNdbcProbeCache,
  resolveNdbcBuoys,
  resolveNdbcHealth,
  seedNdbcProbeCache,
} = await import("../cloudflare/src/ndbc-probe-cache.ts");
const worker = (await import("../cloudflare/src/index.ts")).default;

afterEach(() => {
  resetNdbcProbeCache();
});

const NDBC = `#STN LAT LON YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES PTDY ATMP WTMP DEWP VIS TIDE
44097 40.967 -71.126 26 08 20 16 40 210 5.2 6.8 1.0 8 5.4 200 1016.5 +0.0 22.1 21.8 MM MM MM
`;

const NDBC_OTHER = `#STN LAT LON YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES PTDY ATMP WTMP DEWP VIS TIDE
44017 40.693 -72.049 26 08 20 17 00 200 4.0 5.0 0.8 7 5.0 190 1017.0 +0.0 21.0 20.5 MM MM MM
`;

function countingFetch(text: string) {
  let calls = 0;
  const fetchImpl = (url: string) => {
    if (url.includes("latest_obs")) {
      calls += 1;
      return Promise.resolve(new Response(text, { status: 200 }));
    }
    return Promise.resolve(new Response("no", { status: 404 }));
  };
  return {
    fetchImpl,
    calls: () => calls,
  };
}

function failingFetch() {
  let calls = 0;
  const fetchImpl = (url: string) => {
    if (url.includes("latest_obs")) {
      calls += 1;
      return Promise.reject(new Error("ndbc down"));
    }
    return Promise.resolve(new Response("no", { status: 404 }));
  };
  return { fetchImpl, calls: () => calls };
}

function r2Env(fetchImpl: (url: string) => Promise<Response>, store = new Map<string, string>()) {
  return {
    store,
    env: {
      SERVICE: "ahanu-packs",
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

describe("NDBC probe cache", () => {
  it("rejects invented cache rows that are not last-successful NDBC", () => {
    assert.equal(parseNdbcCacheEntry({ probedAt: "x" }), null);
    assert.equal(parseNdbcCacheEntry({ probedAt: "2026-08-21T00:00:00.000Z", probe: { host: "ndbc", ok: true }, buoys: { buoys: [{ id: "FAKE" }] } })?.buoys, undefined);
    const ok = parseNdbcCacheEntry({
      probedAt: "2026-08-21T00:00:00.000Z",
      probe: { host: "ndbc", ok: true, status: 200, bytes: 12, probedAt: "2026-08-21T00:00:00.000Z" },
      buoys: {
        probedAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-20T16:40:00.000Z",
        count: 1,
        buoys: [{ id: "44097", name: "Block Island", lat: 40.967, lon: -71.126, sstC: 21.8 }],
      },
    });
    assert.ok(ok?.buoys);
    assert.equal(ok!.buoys!.buoys[0]!.id, "44097");
  });

  it("GET /health second request is cached and does not refetch NDBC", async () => {
    const ndbc = countingFetch(NDBC);
    const { env } = r2Env(ndbc.fetchImpl);
    const first = await worker.fetch(new Request("http://ahanu.test/health"), env);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("X-Ahanu-Ndbc"), "live");
    const a = (await first.json()) as { ok: boolean; noaa: { ok: boolean; cached: boolean; source: string; bytes?: number } };
    assert.equal(a.ok, true);
    assert.equal(a.noaa.ok, true);
    assert.equal(a.noaa.cached, false);
    assert.equal(a.noaa.source, "live");
    assert.ok((a.noaa.bytes ?? 0) > 0);
    assert.equal(ndbc.calls(), 1);

    const second = await worker.fetch(new Request("http://ahanu.test/health"), env);
    assert.equal(second.status, 200);
    assert.equal(second.headers.get("X-Ahanu-Ndbc"), "cached");
    const b = (await second.json()) as { noaa: { cached: boolean; source: string; ageSec: number; bytes?: number } };
    assert.equal(b.noaa.cached, true);
    assert.equal(b.noaa.source, "cached");
    assert.equal(b.noaa.bytes, a.noaa.bytes);
    assert.ok(b.noaa.ageSec >= 0);
    assert.equal(ndbc.calls(), 1, "second /health must not probe NDBC");
  });

  it("stale last-good keeps /health 200 without a live NDBC trip after a miss", async () => {
    const t0 = Date.parse("2026-08-21T04:00:00.000Z");
    seedNdbcProbeCache(
      {
        probedAt: new Date(t0).toISOString(),
        probe: { host: "ndbc", ok: true, status: 200, bytes: 80, probedAt: new Date(t0).toISOString() },
      },
      { isolateAt: t0, lastLiveAt: t0 },
    );
    const ndbc = failingFetch();
    const resolved = await resolveNdbcHealth({
      env: { fetchImpl: ndbc.fetchImpl },
      fetchImpl: ndbc.fetchImpl,
      now: t0 + NDBC_PROBE_TTL_MS + 1_000,
    });
    assert.equal(resolved.source, "stale");
    assert.equal(resolved.noaa.ok, true);
    assert.equal(resolved.noaa.cached, true);
    assert.equal(resolved.noaa.bytes, 80);
    assert.ok((resolved.noaa.ageSec ?? 0) >= 600);
    assert.equal(ndbc.calls(), 1);
  });

  it("rate-limits a cache-miss live probe when last-good exists — /health stays 200", async () => {
    const t0 = Date.parse("2026-08-21T04:00:00.000Z");
    seedNdbcProbeCache(
      {
        probedAt: new Date(t0).toISOString(),
        probe: { host: "ndbc", ok: true, status: 200, bytes: 40, probedAt: new Date(t0).toISOString() },
      },
      { isolateAt: t0, lastLiveAt: t0 + NDBC_PROBE_TTL_MS + 5_000 },
    );
    const ndbc = countingFetch(NDBC);
    const resolved = await resolveNdbcHealth({
      env: { fetchImpl: ndbc.fetchImpl },
      fetchImpl: ndbc.fetchImpl,
      now: t0 + NDBC_PROBE_TTL_MS + 5_000 + 1_000,
    });
    assert.ok(NDBC_PROBE_MIN_INTERVAL_MS > 1_000);
    assert.equal(resolved.source, "stale");
    assert.equal(resolved.noaa.ok, true);
    assert.equal(ndbc.calls(), 0);
  });

  it("GET /api/buoys reuses last-successful NDBC rows and does not invent observations", async () => {
    const ndbc = countingFetch(NDBC);
    const { env, store } = r2Env(ndbc.fetchImpl);
    const first = await worker.fetch(new Request("http://ahanu.test/api/buoys"), env);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("X-Ahanu-Ndbc"), "live");
    const a = (await first.json()) as { source: string; cached: boolean; buoys: { id: string; sstC?: number }[] };
    assert.equal(a.source, "ndbc-live");
    assert.equal(a.cached, false);
    assert.ok(a.buoys.some((b) => b.id === "44097"));
    assert.equal(a.buoys.find((b) => b.id === "44097")?.sstC, 21.8);
    assert.equal(ndbc.calls(), 1);
    assert.ok(store.has(NDBC_PROBE_R2_KEY));

    const other = countingFetch(NDBC_OTHER);
    env.fetchImpl = other.fetchImpl;
    const second = await worker.fetch(new Request("http://ahanu.test/api/buoys"), env);
    assert.equal(second.headers.get("X-Ahanu-Ndbc"), "cached");
    const b = (await second.json()) as { source: string; cached: boolean; buoys: { id: string; sstC?: number }[] };
    assert.equal(b.source, "ndbc-live");
    assert.equal(b.cached, true);
    assert.ok(b.buoys.some((row) => row.id === "44097"));
    assert.equal(
      b.buoys.some((row) => row.id === "44017"),
      false,
      "must not replace last-successful 44097 with a new live snapshot",
    );
    assert.equal(other.calls(), 0);
  });

  it("cold isolate serves last-good from R2 without NDBC", async () => {
    const t0 = Date.parse("2026-08-21T04:10:00.000Z");
    const store = new Map<string, string>([
      [
        NDBC_PROBE_R2_KEY,
        JSON.stringify({
          probedAt: new Date(t0).toISOString(),
          probe: { host: "ndbc", ok: true, status: 200, bytes: 90, probedAt: new Date(t0).toISOString() },
          buoys: {
            probedAt: new Date(t0).toISOString(),
            updatedAt: "2026-08-20T16:40:00.000Z",
            count: 1,
            buoys: [{ id: "44097", name: "Block Island", lat: 40.967, lon: -71.126, sstC: 21.8 }],
          },
        }),
      ],
    ]);
    const ndbc = countingFetch(NDBC_OTHER);
    resetNdbcProbeCache();
    const health = await resolveNdbcHealth({
      env: r2Env(ndbc.fetchImpl, store).env,
      now: t0 + 60_000,
    });
    assert.equal(health.source, "cached");
    assert.equal(health.noaa.bytes, 90);
    assert.equal(ndbc.calls(), 0);

    resetNdbcProbeCache();
    const buoys = await resolveNdbcBuoys({
      env: r2Env(ndbc.fetchImpl, store).env,
      now: t0 + 60_000,
    });
    assert.equal(buoys.source, "cached");
    assert.equal(buoys.buoys?.[0]?.id, "44097");
    assert.equal(buoys.buoys?.[0]?.sstC, 21.8);
    assert.equal(ndbc.calls(), 0);
  });

  it("buoys miss without last-good does not invent rows (snapshot is the existing fallback)", async () => {
    const ndbc = failingFetch();
    const { env } = r2Env(ndbc.fetchImpl);
    const res = await worker.fetch(new Request("http://ahanu.test/api/buoys"), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("X-Ahanu-Ndbc"), "snapshot");
    const body = (await res.json()) as { source: string; buoys: { id: string }[] };
    assert.equal(body.source, "ndbc-snapshot");
    assert.ok(body.buoys.length > 0);
    assert.equal(ndbc.calls(), 1);
  });
});
