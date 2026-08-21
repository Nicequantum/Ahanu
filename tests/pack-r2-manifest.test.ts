import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const {
  resolvePackManifest,
  persistBuiltPack,
  packManifestR2Key,
  loadPersistedManifest,
  hashedLayerR2Key,
  headPackManifest,
  mergeRefreshKeptLiveErrors,
  leftoverRefreshKeptErrors,
  collapseRefreshKeptLiveErrors,
} = await import("../cloudflare/src/ingest/run.ts");
const { layerBody } = await import("../cloudflare/src/layer-body.ts");
const worker = (await import("../cloudflare/src/index.ts")).default;
const {
  buildTripPack,
  leftoverFixtureSources,
  leftoverL4ChlLabel,
  leftoverNdfdWindLabel,
  leftoverWw3WaveLabel,
  packIdFor,
  peekBuiltPack,
  resetBuiltPackCache,
  sha256Hex,
  POINT_JUDITH_CANYON_BBOX,
} = await import("../src/lib/ahanu/pack.ts");
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

function sstCsv(iso, variable = "analysed_sst") {
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

function sstFetch(kind) {
  return async (url) => {
    if (kind === "acspo" && url.includes("noaacwLEOACSPOSSTL3SnrtKDaily")) {
      return new Response(sstCsv("2026-08-20T12:00:00Z", "sea_surface_temperature"), { status: 200 });
    }
    if (kind === "mur" && url.includes("jplMURSST41")) {
      return new Response(sstCsv("2026-08-19T09:00:00Z"), { status: 200 });
    }
    return new Response("no", { status: 404 });
  };
}

const NOW_STALE = new Date("2026-08-21T06:18:00.000Z");


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

  it("GET /api/packs with no bbox serves the helm PJ pack, not the leftover Northeast REGION_* box", async () => {
    const { env } = mockEnv();
    env.REGION_WEST = "-75.4";
    env.REGION_SOUTH = "36.4";
    env.REGION_EAST = "-66.4";
    env.REGION_NORTH = "42.6";
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
    resetBuiltPackCache();
    resetLiveNoaaCache();
    env.fetchImpl = async () => {
      throw new Error("bare GET must hit the cron PJ pack, not rebuild Northeast");
    };

    const res = await worker.fetch(
      new Request(`http://ahanu.test/api/packs?hours=72&start=${START}`),
      env,
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("X-Ahanu-Source"), "r2");
    const man = (await res.json()) as {
      packId: string;
      bbox: { west: number; south: number; east: number; north: number };
    };
    assert.deepEqual(man.bbox, { west: -72.8, south: 39.4, east: -68.8, north: 41.5 });
    assert.equal(man.packId, built.manifest.packId);
  });

  it("worker GET /api/packs sources and notes name ACSPO when that grid landed", async () => {
    const { env } = mockEnv();
    const built = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      createdAt: START,
      tryLive: true,
      skipCache: true,
      now: NOW_STALE,
      timeoutMs: 50,
      fetchImpl: sstFetch("acspo"),
    });
    const sst = built.manifest.layers.find((l) => l.id === "sst");
    assert.ok(sst);
    assert.match(sst.label, /ACSPO/);
    await persistBuiltPack(env, built);
    resetBuiltPackCache();
    resetLiveNoaaCache();

    const res = await worker.fetch(new Request(`http://ahanu.test/api/packs?${Q}`), env);
    assert.equal(res.status, 200);
    const man = (await res.json()) as {
      sources?: { id: string; name: string }[];
      landedSources?: { id: string; name: string }[];
      notes?: string;
      layers: { id: string; label: string }[];
    };
    const catalogSst = (man.sources ?? []).find((s) => s.id === "ghrsst-coastwatch-sst");
    assert.equal(catalogSst, undefined);
    const sstSrc = (man.sources ?? []).find((s) => s.id === "noaa-sst");
    assert.ok(sstSrc, "sources must include landed SST");
    assert.match(sstSrc.name, /ACSPO/);
    assert.doesNotMatch(sstSrc.name, /GHRSST \/ CoastWatch SST/);
    const landed = (man.landedSources ?? []).find((s) => s.id === "noaa-sst");
    assert.match(landed?.name ?? "", /ACSPO/);
    assert.match(man.notes ?? "", /ACSPO/);
    assert.match(man.layers.find((l) => l.id === "sst")?.label ?? "", /ACSPO/);
  });

  it("worker GET /api/packs reconstructs ACSPO from the layer when sources are the catalog", async () => {
    const { env, store } = mockEnv();
    const built = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      createdAt: START,
      tryLive: true,
      skipCache: true,
      now: NOW_STALE,
      timeoutMs: 50,
      fetchImpl: sstFetch("acspo"),
    });
    const catalogOnly = {
      ...built.manifest,
      sources: [
        { id: "ghrsst-coastwatch-sst", name: "GHRSST / CoastWatch SST" },
        { id: "ncep-gfswave", name: "NCEP GFS-Wave / WAVEWATCH III" },
      ],
      notes: "SHA-256 of pack object bytes. CoastWatch SST.",
    };
    built.manifest = catalogOnly;
    await persistBuiltPack(env, built);
    resetBuiltPackCache();
    resetLiveNoaaCache();

    const res = await worker.fetch(new Request(`http://ahanu.test/api/packs?${Q}`), env);
    assert.equal(res.status, 200);
    const man = (await res.json()) as {
      sources?: { id: string; name: string }[];
      notes?: string;
    };
    assert.ok(!(man.sources ?? []).some((s) => s.id === "ghrsst-coastwatch-sst"));
    assert.match((man.sources ?? []).find((s) => s.id === "noaa-sst")?.name ?? "", /ACSPO/);
    assert.match(man.notes ?? "", /ACSPO/);
  });

  it("loadPersistedManifest rejects a corrupt or foreign packId body", async () => {
    const { env, store } = mockEnv();
    store.set(packManifestR2Key("deadbeefdeadbeef"), "{\"packId\":\"other\",\"version\":1,\"layers\":[]}");
    assert.equal(await loadPersistedManifest(env, "deadbeefdeadbeef"), null);
    store.set(packManifestR2Key("deadbeefdeadbeef"), "not-json");
    assert.equal(await loadPersistedManifest(env, "deadbeefdeadbeef"), null);
  });
  it("R2 hit with stale SST refreshes ACSPO and keeps other hashes", async () => {
    const { env } = mockEnv();
    const murPack = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      createdAt: START,
      tryLive: true,
      skipCache: true,
      now: NOW_STALE,
      timeoutMs: 50,
      fetchImpl: sstFetch("mur"),
    });
    await persistBuiltPack(env, murPack);
    const murSst = murPack.manifest.layers.find((l) => l.id === "sst");
    const murBathy = murPack.manifest.layers.find((l) => l.id === "bathymetry");
    assert.ok(murSst && murBathy);
    assert.equal(murSst.updatedAt, "2026-08-19T09:00:00.000Z");

    resetBuiltPackCache();
    resetLiveNoaaCache();

    let fetches = 0;
    const hit = await resolvePackManifest(env, {
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      now: NOW_STALE,
      timeoutMs: 50,
      fetchImpl: async (url) => {
        fetches += 1;
        return sstFetch("acspo")(url);
      },
    });
    assert.equal(hit.source, "live");
    assert.ok(fetches > 0, "stale R2 SST must fetch live SST");
    assert.ok(hit.built);
    const fresh = hit.manifest.layers.find((l) => l.id === "sst");
    assert.ok(fresh);
    assert.equal(fresh.updatedAt, "2026-08-20T12:00:00.000Z");
    assert.notEqual(fresh.hash, murSst.hash);
    assert.match(fresh.label, /ACSPO/);
    const bathy = hit.manifest.layers.find((l) => l.id === "bathymetry");
    assert.ok(bathy);
    assert.equal(bathy.hash, murBathy.hash, "other R2 layers keep hashes");
    assert.equal(hit.manifest.packId, murPack.manifest.packId);

    await persistBuiltPack(env, hit.built);
    resetBuiltPackCache();
    resetLiveNoaaCache();

    let secondFetches = 0;
    const again = await resolvePackManifest(env, {
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      now: NOW_STALE,
      fetchImpl: async () => {
        secondFetches += 1;
        throw new Error("fresh SST must not refetch");
      },
    });
    assert.equal(again.source, "r2");
    assert.equal(secondFetches, 0);
    assert.equal(again.manifest.layers.find((l) => l.id === "sst")?.hash, fresh.hash);
    assert.equal(again.manifest.layers.find((l) => l.id === "sst")?.updatedAt, "2026-08-20T12:00:00.000Z");
  });

  it("persist rewrites leftover MUR label from an ACSPO SST body", async () => {
    const { env } = mockEnv();
    const built = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      createdAt: START,
      tryLive: true,
      skipCache: true,
      now: NOW_STALE,
      timeoutMs: 50,
      fetchImpl: sstFetch("acspo"),
    });
    const sst = built.manifest.layers.find((l) => l.id === "sst");
    assert.ok(sst);
    sst.label = "SST composite (MUR / CoastWatch)";
    built.manifest.sources = [
      { id: "ghrsst-coastwatch-sst", name: "GHRSST / CoastWatch SST" },
      { id: "noaa-sst", name: "SST MUR" },
    ];
    await persistBuiltPack(env, built);
    const loaded = await loadPersistedManifest(env, built.manifest.packId);
    assert.ok(loaded);
    assert.match(loaded.layers.find((l) => l.id === "sst")?.label ?? "", /ACSPO/);
    assert.doesNotMatch(loaded.layers.find((l) => l.id === "sst")?.label ?? "", /MUR \/ CoastWatch/);
    assert.match((loaded.sources ?? []).find((s) => s.id === "noaa-sst")?.name ?? "", /ACSPO/);
    assert.ok(!(loaded.sources ?? []).some((s) => s.id === "ghrsst-coastwatch-sst"));
  });

  it("serving R2 rewrites leftover MUR label from an ACSPO body without NOAA", async () => {
    const { env, store } = mockEnv();
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
      fetchImpl: sstFetch("acspo"),
    });
    await persistBuiltPack(env, built);
    const key = packManifestR2Key(built.manifest.packId);
    const stored = JSON.parse(store.get(key));
    stored.layers.find((l) => l.id === "sst").label = "SST composite (MUR / CoastWatch)";
    stored.sources = [
      { id: "noaa-sst", name: "SST MUR" },
      { id: "ghrsst-coastwatch-sst", name: "GHRSST / CoastWatch SST" },
    ];
    store.set(key, JSON.stringify(stored));

    resetBuiltPackCache();
    resetLiveNoaaCache();

    let fetches = 0;
    const hit = await resolvePackManifest(env, {
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      now: nowFresh,
      fetchImpl: async () => {
        fetches += 1;
        throw new Error("leftover MUR rewrite must not fetch NOAA");
      },
    });
    assert.equal(hit.source, "live");
    assert.equal(fetches, 0, "ACSPO body already landed — no NOAA");
    assert.ok(hit.built);
    assert.match(hit.manifest.layers.find((l) => l.id === "sst")?.label ?? "", /ACSPO/);
    assert.match((hit.manifest.sources ?? []).find((s) => s.id === "noaa-sst")?.name ?? "", /ACSPO/);
    assert.doesNotMatch(hit.manifest.layers.find((l) => l.id === "sst")?.label ?? "", /MUR \/ CoastWatch/);

    await persistBuiltPack(env, hit.built);
    resetBuiltPackCache();
    resetLiveNoaaCache();
    let second = 0;
    const again = await resolvePackManifest(env, {
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      now: nowFresh,
      fetchImpl: async () => {
        second += 1;
        throw new Error("rewritten manifest must not refetch");
      },
    });
    assert.equal(again.source, "r2");
    assert.equal(second, 0);
    assert.match(again.manifest.layers.find((l) => l.id === "sst")?.label ?? "", /ACSPO/);
  });

  it("R2 stale SST keeps MUR with honesty when ACSPO fails", async () => {
    const { env } = mockEnv();
    const murPack = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      createdAt: START,
      tryLive: true,
      skipCache: true,
      now: NOW_STALE,
      timeoutMs: 50,
      fetchImpl: sstFetch("mur"),
    });
    await persistBuiltPack(env, murPack);
    const murSst = murPack.manifest.layers.find((l) => l.id === "sst");
    assert.ok(murSst);

    resetBuiltPackCache();
    resetLiveNoaaCache();

    const hit = await resolvePackManifest(env, {
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      now: NOW_STALE,
      timeoutMs: 50,
      fetchImpl: async () => new Response("no", { status: 404 }),
    });
    assert.equal(hit.manifest.layers.find((l) => l.id === "sst")?.hash, murSst.hash);
    const sstLines = (hit.manifest.liveErrors ?? []).filter((e) => /sst: live refresh failed/.test(e) && /kept/.test(e));
    assert.equal(sstLines.length, 1, hit.manifest.liveErrors?.join(" | "));
    if (hit.built) assert.equal(hit.built.bodies.sst, undefined, "honesty catalog persist must not rewrite SST bytes");
  });

  it("stale SST keep-line is idempotent across GET persist", async () => {
    const { env } = mockEnv();
    const now = new Date("2026-08-21T15:12:00.000Z");
    const acspoPack = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      createdAt: START,
      tryLive: true,
      skipCache: true,
      now,
      timeoutMs: 50,
      fetchImpl: sstFetch("acspo"),
    });
    await persistBuiltPack(env, acspoPack);
    const sst = acspoPack.manifest.layers.find((l) => l.id === "sst");
    assert.ok(sst);
    assert.equal(sst.updatedAt, "2026-08-20T12:00:00.000Z");

    resetBuiltPackCache();
    resetLiveNoaaCache();
    const first = await resolvePackManifest(env, {
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      now,
      timeoutMs: 50,
      fetchImpl: sstFetch("acspo"),
    });
    const firstLines = (first.manifest.liveErrors ?? []).filter((e) => /^sst: live refresh /.test(e));
    assert.equal(firstLines.length, 1, first.manifest.liveErrors?.join(" | "));
    assert.match(firstLines[0] ?? "", /still \d+ h/);
    assert.match(firstLines[0] ?? "", /kept ACSPO/);
    assert.equal(first.manifest.layers.find((l) => l.id === "sst")?.hash, sst.hash);
    assert.ok(first.built);
    assert.equal(first.built.bodies.sst, undefined);

    await persistBuiltPack(env, first.built);
    resetBuiltPackCache();
    resetLiveNoaaCache();
    const second = await resolvePackManifest(env, {
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      now,
      timeoutMs: 50,
      fetchImpl: sstFetch("acspo"),
    });
    const secondLines = (second.manifest.liveErrors ?? []).filter((e) => /^sst: live refresh /.test(e));
    assert.equal(secondLines.length, 1, second.manifest.liveErrors?.join(" | "));
    assert.equal(secondLines[0], firstLines[0]);
    assert.equal(second.built, undefined);
    assert.equal(second.source, "r2");
  });

  it("HEAD persist collapses duplicate sst live-refresh liveErrors without NOAA", async () => {
    const { env, store } = mockEnv();
    const now = new Date("2026-08-21T15:12:00.000Z");
    const acspoPack = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      createdAt: START,
      tryLive: true,
      skipCache: true,
      now,
      timeoutMs: 50,
      fetchImpl: sstFetch("acspo"),
    });
    const line =
      "sst: live refresh still 27 h (noaacwLEOACSPOSSTL3SnrtKDaily) — kept ACSPO 2026-08-20T12:00:00.000Z";
    const ais = "ais: no positions in snapshot (0 frames) — live miss";
    acspoPack.manifest.liveErrors = [line, line, ais];
    await persistBuiltPack(env, acspoPack);
    const key = packManifestR2Key(acspoPack.manifest.packId);
    const stored = JSON.parse(store.get(key));
    stored.liveErrors = [line, line, ais];
    store.set(key, JSON.stringify(stored));
    assert.equal(leftoverRefreshKeptErrors(stored.liveErrors), true);

    resetBuiltPackCache();
    resetLiveNoaaCache();
    const headed = await headPackManifest(env, {
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
    });
    assert.equal(headed.source, "r2");
    assert.ok(headed.manifest);
    const sstLines = (headed.manifest.liveErrors ?? []).filter((e) => /^sst: live refresh /.test(e));
    assert.equal(sstLines.length, 1, headed.manifest.liveErrors?.join(" | "));
    assert.ok((headed.manifest.liveErrors ?? []).includes(ais));
    assert.ok(headed.built);
    assert.equal(Object.keys(headed.built.bodies).length, 0);
  });

  it("GET/HEAD persist drops leftover GRIB/SST/CMEMS fixture sources when those layers are live NOAA", async () => {
    const { env, store } = mockEnv();
    const built = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      createdAt: START,
      tryLive: true,
      skipCache: true,
      now: NOW_STALE,
      timeoutMs: 50,
      fetchImpl: sstFetch("acspo"),
    });
    built.manifest.sources = [
      { id: "fixture", name: "Hashed fixture objects (not live GRIB/SST/CMEMS)" },
      ...(built.manifest.sources ?? []).filter((s) => s.id !== "fixture"),
    ];
    for (const id of ["sst", "wind", "waves", "bathymetry"] as const) {
      const layer = built.manifest.layers.find((l) => l.id === id);
      if (layer) layer.source = "noaa";
    }
    const aisLayer = built.manifest.layers.find((l) => l.id === "ais");
    if (aisLayer) aisLayer.source = "fixture";
    built.manifest.liveErrors = ["ais: no positions in snapshot (0 frames) — live miss"];
    assert.equal(leftoverFixtureSources(built.manifest.sources, built.manifest.layers), true);
    await persistBuiltPack(env, built);
    const key = packManifestR2Key(built.manifest.packId);
    const stored = JSON.parse(store.get(key));
    stored.sources = built.manifest.sources;
    stored.layers = built.manifest.layers;
    stored.liveErrors = built.manifest.liveErrors;
    store.set(key, JSON.stringify(stored));
    resetBuiltPackCache();
    resetLiveNoaaCache();

    const res = await worker.fetch(new Request(`http://ahanu.test/api/packs?${Q}`), env);
    assert.equal(res.status, 200);
    const man = (await res.json()) as {
      sources?: { id: string; name: string }[];
      layers: { id: string; source?: string }[];
    };
    const fixture = (man.sources ?? []).find((s) => s.id === "fixture");
    assert.ok(!fixture || !/not live GRIB\/SST\/CMEMS/i.test(fixture.name), fixture?.name);
    if (fixture) assert.match(fixture.name, /ais/i);
    assert.equal(leftoverFixtureSources(man.sources, man.layers), false);

    resetBuiltPackCache();
    resetLiveNoaaCache();
    const headed = await headPackManifest(env, {
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
    });
    assert.ok(headed.manifest);
    assert.equal(leftoverFixtureSources(headed.manifest.sources, headed.manifest.layers), false);
    const headFixture = headed.manifest.sources.find((s) => s.id === "fixture");
    assert.ok(!headFixture || !/not live GRIB\/SST\/CMEMS/i.test(headFixture.name));
  });

  it("GET/HEAD persist drops leftover NDFD wind labels when GFS-Wave already landed", async () => {
    const { env, store } = mockEnv();
    const built = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      createdAt: START,
      tryLive: true,
      skipCache: true,
      now: NOW_STALE,
      timeoutMs: 50,
      fetchImpl: sstFetch("acspo"),
    });
    const wind = built.manifest.layers.find((l) => l.id === "wind");
    assert.ok(wind);
    wind.source = "noaa";
    wind.label = "NDFD oceanic + GFS-Wave wind GRIB";
    assert.equal(leftoverNdfdWindLabel(wind.label), true);
    await persistBuiltPack(env, built);
    const key = packManifestR2Key(built.manifest.packId);
    const stored = JSON.parse(store.get(key));
    const storedWind = stored.layers.find((l) => l.id === "wind");
    storedWind.source = "noaa";
    storedWind.label = "NDFD oceanic + GFS-Wave wind GRIB";
    store.set(key, JSON.stringify(stored));
    resetBuiltPackCache();
    resetLiveNoaaCache();

    const res = await worker.fetch(new Request(`http://ahanu.test/api/packs?${Q}`), env);
    assert.equal(res.status, 200);
    const man = (await res.json()) as { layers: { id: string; label: string; source?: string }[] };
    const liveWind = man.layers.find((l) => l.id === "wind");
    assert.ok(liveWind);
    assert.equal(leftoverNdfdWindLabel(liveWind.label), false);
    assert.doesNotMatch(liveWind.label, /NDFD/);
    assert.match(liveWind.label, /GFS-Wave/);

    resetBuiltPackCache();
    resetLiveNoaaCache();
    const headed = await headPackManifest(env, {
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
    });
    assert.ok(headed.manifest);
    const headWind = headed.manifest.layers.find((l) => l.id === "wind");
    assert.ok(headWind);
    assert.equal(leftoverNdfdWindLabel(headWind.label), false);
    assert.doesNotMatch(headWind.label, /NDFD/);
  });

  it("GET/HEAD persist drops leftover L4 chlorophyll labels when Aqua MODIS already landed", async () => {
    const { env, store } = mockEnv();
    const built = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      createdAt: START,
      tryLive: true,
      skipCache: true,
      now: NOW_STALE,
      timeoutMs: 50,
      fetchImpl: sstFetch("acspo"),
    });
    const chl = built.manifest.layers.find((l) => l.id === "chlorophyll");
    assert.ok(chl);
    chl.source = "noaa";
    chl.label = "Chlorophyll-a L4";
    assert.equal(leftoverL4ChlLabel(chl.label), true);
    await persistBuiltPack(env, built);
    const key = packManifestR2Key(built.manifest.packId);
    const stored = JSON.parse(store.get(key));
    const storedChl = stored.layers.find((l) => l.id === "chlorophyll");
    storedChl.source = "noaa";
    storedChl.label = "Chlorophyll-a L4";
    store.set(key, JSON.stringify(stored));
    resetBuiltPackCache();
    resetLiveNoaaCache();

    const res = await worker.fetch(new Request(`http://ahanu.test/api/packs?${Q}`), env);
    assert.equal(res.status, 200);
    const man = (await res.json()) as { layers: { id: string; label: string; source?: string }[] };
    const liveChl = man.layers.find((l) => l.id === "chlorophyll");
    assert.ok(liveChl);
    assert.equal(leftoverL4ChlLabel(liveChl.label), false);
    assert.doesNotMatch(liveChl.label, /\bL4\b/);
    assert.match(liveChl.label, /Aqua MODIS/);

    resetBuiltPackCache();
    resetLiveNoaaCache();
    const headed = await headPackManifest(env, {
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
    });
    assert.ok(headed.manifest);
    const headChl = headed.manifest.layers.find((l) => l.id === "chlorophyll");
    assert.ok(headChl);
    assert.equal(leftoverL4ChlLabel(headChl.label), false);
    assert.doesNotMatch(headChl.label, /\bL4\b/);
  });

  it("GET/HEAD persist drops leftover WW3 wave labels when GFS-Wave already landed", async () => {
    const { env, store } = mockEnv();
    const built = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      createdAt: START,
      tryLive: true,
      skipCache: true,
      now: NOW_STALE,
      timeoutMs: 50,
      fetchImpl: sstFetch("acspo"),
    });
    const waves = built.manifest.layers.find((l) => l.id === "waves");
    assert.ok(waves);
    waves.source = "noaa";
    waves.label = "GFS-Wave / WW3 GRIB";
    assert.equal(leftoverWw3WaveLabel(waves.label), true);
    await persistBuiltPack(env, built);
    const key = packManifestR2Key(built.manifest.packId);
    const stored = JSON.parse(store.get(key));
    const storedWaves = stored.layers.find((l) => l.id === "waves");
    storedWaves.source = "noaa";
    storedWaves.label = "GFS-Wave / WW3 GRIB";
    store.set(key, JSON.stringify(stored));
    resetBuiltPackCache();
    resetLiveNoaaCache();

    const res = await worker.fetch(new Request(`http://ahanu.test/api/packs?${Q}`), env);
    assert.equal(res.status, 200);
    const man = (await res.json()) as { layers: { id: string; label: string; source?: string }[] };
    const liveWaves = man.layers.find((l) => l.id === "waves");
    assert.ok(liveWaves);
    assert.equal(leftoverWw3WaveLabel(liveWaves.label), false);
    assert.doesNotMatch(liveWaves.label, /WW3/);
    assert.match(liveWaves.label, /GFS-Wave/);

    resetBuiltPackCache();
    resetLiveNoaaCache();
    const headed = await headPackManifest(env, {
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
    });
    assert.ok(headed.manifest);
    const headWaves = headed.manifest.layers.find((l) => l.id === "waves");
    assert.ok(headWaves);
    assert.equal(leftoverWw3WaveLabel(headWaves.label), false);
    assert.doesNotMatch(headWaves.label, /WW3/);
  });
});

describe("mergeRefreshKeptLiveErrors", () => {
  it("replaces same-kind sst keep-lines and drops exact dups", () => {
    const a = "sst: live refresh still 27 h (noaacwLEOACSPOSSTL3SnrtKDaily) — kept ACSPO 2026-08-20T12:00:00.000Z";
    const b = "sst: live refresh still 28 h (noaacwLEOACSPOSSTL3SnrtKDaily) — kept ACSPO 2026-08-20T12:00:00.000Z";
    const ais = "ais: no positions in snapshot (0 frames) — live miss";
    const merged = mergeRefreshKeptLiveErrors([a, a, ais], b);
    assert.deepEqual(merged, [b, ais]);
    assert.equal(leftoverRefreshKeptErrors([a, a, ais]), true);
    assert.equal(leftoverRefreshKeptErrors([b, ais]), false);
    assert.deepEqual(collapseRefreshKeptLiveErrors([a, a, ais]), [a, ais]);
  });
});

const OLD_8_ENC = [
  "US5PVDBB",
  "US5PVDCB",
  "US5NY2GL",
  "US5PVDDD",
  "US3NY01M",
  "US3RI1AA",
  "US3MA1AD",
  "US3MA1AC",
];
const NEW_8_ENC = [
  "US5RI1CD",
  "US5RI1BD",
  "US5RI1BE",
  "US5PVDCC",
  "US5PVDCD",
  "US4CN22M",
  "US4NY1CY",
  "US4RI1EA",
];
const NEW_4_ENC = ["US5PVDAB", "US5RI1CE", "US5PVDAA", "US4NY1BY"];
const PICKER_16_ENC = [...OLD_8_ENC, ...NEW_8_ENC];
const PICKER_20_ENC = [...PICKER_16_ENC, ...NEW_4_ENC];

const ENC_PICKER_CELLS = [
  ["US5PVDBB", 5, "Block Island Sound - From Matunuck Point to Point Judith", 12000, 291358, -71.55, 41.325, -71.475, 41.4],
  ["US5PVDCB", 5, "Point Judith Harbor", 12000, 114301, -71.55, 41.4, -71.475, 41.475],
  ["US5NY2GL", 5, "Long Island - Montauk Harbor Entrance", 12000, 106892, -72.0, 41.025, -71.925, 41.1],
  ["US5PVDDD", 5, "Narragansett Bay - East Pass and Conanicut Island", 22000, 186263, -71.4, 41.475, -71.325, 41.55],
  ["US5RI1CD", 5, "Block Island Sound - North Block Island", 12000, 132657, -71.625, 41.175, -71.55, 41.25],
  ["US5RI1BD", 5, "Block Island", 12000, 91709, -71.625, 41.1, -71.55, 41.175],
  ["US5RI1BE", 5, "Block Island Sound", 12000, 52114, -71.55, 41.1, -71.475, 41.175],
  ["US5PVDCC", 5, "Rhode Island Sound to West Pass", 22000, 114530, -71.475, 41.4, -71.4, 41.475],
  ["US5PVDCD", 5, "Rhode Island Sound to East Passage", 22000, 146388, -71.4, 41.4, -71.325, 41.475],
  ["US3NY01M", 3, "Approaches to New York, Nantucket Shoals to Five Fathom Bank", 350000, 179183, -74.7, 38.7667, -69.2667, 41.5833],
  ["US3RI1AA", 3, "Rhode Island", 350000, 227577, -72.0, 40.8, -70.8, 42.0],
  ["US3MA1AD", 3, "Massachusetts", 180000, 80045, -69.6, 39.6, -68.4, 40.8],
  ["US3MA1AC", 3, "Massachusetts", 350000, 60971, -70.8, 39.6, -69.6, 40.8],
  ["US4CN22M", 4, "Block Island Sound and Approaches", 80000, 36143, -72.0, 40.6668, -71.4662, 40.8],
  ["US4NY1CY", 4, "New York", 45000, 237503, -71.7, 41.1, -71.4, 41.4],
  ["US4RI1EA", 4, "Rhode Island", 45000, 131608, -71.7, 41.4, -71.4, 41.7],
  ["US5PVDAB", 5, "Block Island Sound", 22000, 23238, -71.55, 41.25, -71.475, 41.325],
  ["US5RI1CE", 5, "Block Island Sound", 12000, 28964, -71.55, 41.175, -71.475, 41.25],
  ["US5PVDAA", 5, "Block Island Sound", 22000, 23926, -71.625, 41.25, -71.55, 41.325],
  ["US4NY1BY", 4, "New York", 45000, 42513, -71.7, 40.8, -71.4, 41.1],
  ["US4RI1EB", 4, "Rhode Island", 45000, 358958, -71.4, 41.4, -71.1, 41.7],
  ["US3MA1BD", 3, "Massachusetts", 180000, 148781, -69.6, 40.8, -68.4, 42.0],
  ["US3NY1AG", 3, "New York", 350000, 95346, -72.0, 39.6, -70.8, 40.8],
  ["US3CT1AA", 3, "Connecticut", 350000, 100142, -73.2, 40.8, -72.0, 42.0],
];

function encCatalogXml() {
  const cells = ENC_PICKER_CELLS.map((c) => {
    const [id, _u, name, scale, zipBytes, west, south, east, north] = c;
    return `<cell>
    <name>${id}</name>
    <lname>${name}</lname>
    <cscale>${scale}</cscale>
    <status>Active</status>
    <zipfile_location>https://charts.noaa.gov/ENCs/${id}.zip</zipfile_location>
    <zipfile_size>${zipBytes}</zipfile_size>
    <cov><panel>
      <vertex><lat>${south}</lat><long>${west}</long></vertex>
      <vertex><lat>${north}</lat><long>${east}</long></vertex>
    </panel></cov>
  </cell>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" ?><EncProductCatalog><Header><dt_valid>2026-08-21T04:59:10Z</dt_valid></Header>${cells.join("")}</EncProductCatalog>`;
}

function officialEncBody(cellIds) {
  return JSON.stringify({
    kind: "enc-clip",
    layer: "enc",
    payload: {
      fixture: false,
      live: true,
      official: true,
      encoding: "s-57",
      source: "noaa",
      note: "test official ENC",
      s57: { source: "noaa", encoding: "s-57", official: true, cellIds, updateCount: 0 },
      cells: [],
    },
  });
}

async function persistOfficialEnc(env, built, cellIds) {
  const { specForLayer } = await import("../src/lib/ahanu/pack-fixtures.ts");
  const body = officialEncBody(cellIds);
  const hash = await sha256Hex(body);
  const spec = specForLayer("enc");
  const r2Key = hashedLayerR2Key(built.manifest.packId, "enc", hash, spec.ext);
  const bytes = new TextEncoder().encode(body).byteLength;
  const next = {
    manifest: {
      ...built.manifest,
      layers: built.manifest.layers.map((l) =>
        l.id === "enc"
          ? {
              ...l,
              hash,
              r2Key,
              sizeBytes: bytes,
              sizeMb: Math.round((bytes / (1024 * 1024)) * 1000) / 1000,
              source: "noaa",
              label: "NOAA ENC (official S-57)",
            }
          : l,
      ),
    },
    bodies: { ...built.bodies, enc: body },
  };
  await persistBuiltPack(env, next);
  return next;
}

function encLiveFetch() {
  return async (url) => {
    if (url.includes("ENCProdCat")) return new Response(encCatalogXml(), { status: 200 });
    if (url.includes("/ENCs/") && url.endsWith(".zip")) {
      const id = url.split("/").pop().replace(/\.zip$/i, "");
      const { sampleS57Zip } = await import("../src/lib/ahanu/noaa-enc.ts");
      return new Response(sampleS57Zip(id), { status: 200, headers: { "Content-Type": "application/zip" } });
    }
    return new Response("no", { status: 404 });
  };
}

describe("GET /api/packs R2 ENC refresh", () => {
  const NOW_FRESH = new Date("2026-08-20T19:00:00.000Z");

  it("R2 8-cell ENC + current picker 20 refreshes ENC and keeps other hashes", async () => {
    const { env } = mockEnv();
    const packed = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      createdAt: START,
      tryLive: true,
      skipCache: true,
      now: NOW_FRESH,
      timeoutMs: 50,
      fetchImpl: ndbcFetch(NDBC_N),
    });
    const stored = await persistOfficialEnc(env, packed, OLD_8_ENC);
    const oldEnc = stored.manifest.layers.find((l) => l.id === "enc");
    const bathy = stored.manifest.layers.find((l) => l.id === "bathymetry");
    assert.ok(oldEnc && bathy);

    resetBuiltPackCache();
    resetLiveNoaaCache();

    let fetches = 0;
    const hit = await resolvePackManifest(env, {
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      now: NOW_FRESH,
      timeoutMs: 2000,
      fetchImpl: async (url) => {
        fetches += 1;
        return encLiveFetch()(url);
      },
    });
    assert.equal(hit.source, "live");
    assert.ok(fetches > 0, "short official ENC must refetch liveEnc");
    assert.ok(hit.built);
    const fresh = hit.manifest.layers.find((l) => l.id === "enc");
    assert.ok(fresh);
    assert.notEqual(fresh.hash, oldEnc.hash);
    const body = JSON.parse(hit.built.bodies.enc);
    const ids = body.payload?.s57?.cellIds ?? [];
    assert.ok(ids.length >= 20, `expected 20 cellIds, got ${ids.join(",")}`);
    for (const id of [...NEW_8_ENC, ...NEW_4_ENC]) {
      assert.ok(ids.includes(id), `missing ${id} in ${ids.join(",")}`);
    }
    const kept = hit.manifest.layers.find((l) => l.id === "bathymetry");
    assert.ok(kept);
    assert.equal(kept.hash, bathy.hash, "other R2 layers keep hashes");
  });

  it("R2 already 20 official ENC does not refetch", async () => {
    const { env } = mockEnv();
    const packed = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      createdAt: START,
      tryLive: true,
      skipCache: true,
      now: NOW_FRESH,
      timeoutMs: 50,
      fetchImpl: ndbcFetch(NDBC_N),
    });
    const stored = await persistOfficialEnc(env, packed, PICKER_20_ENC);
    const oldEnc = stored.manifest.layers.find((l) => l.id === "enc");
    assert.ok(oldEnc);

    resetBuiltPackCache();
    resetLiveNoaaCache();

    let fetches = 0;
    const hit = await resolvePackManifest(env, {
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      now: NOW_FRESH,
      fetchImpl: async () => {
        fetches += 1;
        throw new Error("complete ENC must not refetch");
      },
    });
    assert.equal(hit.source, "r2");
    assert.equal(fetches, 0);
    assert.equal(hit.built, undefined);
    assert.equal(hit.manifest.layers.find((l) => l.id === "enc")?.hash, oldEnc.hash);
  });

  it("persist official ENC writes cell and update counts into sources[]", async () => {
    const { env } = mockEnv();
    const packed = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      createdAt: START,
      tryLive: true,
      skipCache: true,
      now: NOW_FRESH,
      timeoutMs: 50,
      fetchImpl: ndbcFetch(NDBC_N),
    });
    const stored = await persistOfficialEnc(env, packed, PICKER_20_ENC);
    const loaded = await loadPersistedManifest(env, stored.manifest.packId);
    assert.ok(loaded);
    const encSrc = (loaded.sources ?? []).find((s) => s.id === "noaa-enc");
    assert.ok(encSrc, "official ENC persist must name noaa-enc");
    assert.match(encSrc.name, /20 cells/);
    assert.match(encSrc.name, /update/);
  });
});

const COOPS_PREDICTIONS = {
  predictions: [
    { t: "2026-08-20 12:00", v: "1.20" },
    { t: "2026-08-20 13:00", v: "1.80" },
    { t: "2026-08-20 18:00", v: "0.10" },
  ],
};

function fourStationLiveTides(start) {
  const stations = [
    { id: "8452660", name: "Newport", lat: 41.49, lon: -71.327 },
    { id: "8452944", name: "Quonset Point", lat: 41.586, lon: -71.41 },
    { id: "8510560", name: "Montauk", lat: 41.048, lon: -71.959 },
    { id: "8461490", name: "New London", lat: 41.355, lon: -72.09 },
  ].map((s) => ({
    ...s,
    interval: "h",
    datum: "MLLW",
    series: [{ at: start, heightFt: 1.1 }],
    hilo: [],
  }));
  return JSON.stringify({
    kind: "json",
    layer: "tides",
    payload: {
      fixture: false,
      live: true,
      source: "coops",
      start,
      hours: 72,
      harbor: "Point Judith / Newport / Montauk",
      stations,
    },
  });
}

async function persistLiveTides(env, built, body) {
  const { specForLayer } = await import("../src/lib/ahanu/pack-fixtures.ts");
  const hash = await sha256Hex(body);
  const spec = specForLayer("tides");
  const r2Key = hashedLayerR2Key(built.manifest.packId, "tides", hash, spec.ext);
  const bytes = new TextEncoder().encode(body).byteLength;
  const next = {
    manifest: {
      ...built.manifest,
      layers: built.manifest.layers.map((l) =>
        l.id === "tides"
          ? {
              ...l,
              hash,
              r2Key,
              sizeBytes: bytes,
              sizeMb: Math.round((bytes / (1024 * 1024)) * 1000) / 1000,
              source: "noaa",
              label: "CO-OPS tidal window",
            }
          : l,
      ),
    },
    bodies: { ...built.bodies, tides: body },
  };
  await persistBuiltPack(env, next);
  return next;
}

function coopsLiveFetch() {
  return async (url) => {
    if (url.includes("datagetter")) {
      return new Response(JSON.stringify(COOPS_PREDICTIONS), { status: 200 });
    }
    return new Response("no", { status: 404 });
  };
}

describe("GET /api/packs R2 tides refresh", () => {
  const NOW_FRESH = new Date("2026-08-20T19:00:00.000Z");

  it("R2 4-station live tides missing 8455083 refreshes and keeps other hashes", async () => {
    const { env } = mockEnv();
    const packed = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      createdAt: START,
      tryLive: true,
      skipCache: true,
      now: NOW_FRESH,
      timeoutMs: 50,
      fetchImpl: ndbcFetch(NDBC_N),
    });
    const stored = await persistLiveTides(env, packed, fourStationLiveTides(START));
    const oldTides = stored.manifest.layers.find((l) => l.id === "tides");
    const bathy = stored.manifest.layers.find((l) => l.id === "bathymetry");
    assert.ok(oldTides && bathy);
    assert.equal(JSON.parse(stored.bodies.tides).payload.stations.some((s) => s.id === "8455083"), false);

    resetBuiltPackCache();
    resetLiveNoaaCache();

    let fetches = 0;
    const hit = await resolvePackManifest(env, {
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      now: NOW_FRESH,
      timeoutMs: 2000,
      fetchImpl: async (url) => {
        fetches += 1;
        return coopsLiveFetch()(url);
      },
    });
    assert.equal(hit.source, "live");
    assert.ok(fetches > 0, "short live CO-OPS must refetch tides");
    assert.ok(hit.built);
    const fresh = hit.manifest.layers.find((l) => l.id === "tides");
    assert.ok(fresh);
    assert.notEqual(fresh.hash, oldTides.hash);
    const body = JSON.parse(hit.built.bodies.tides);
    const stations = body.payload?.stations ?? [];
    const pj = stations.find((s) => s.id === "8455083");
    assert.ok(pj, `expected 8455083 in ${stations.map((s) => s.id).join(",")}`);
    assert.equal(pj.name, "POINT JUDITH, HARBOR OF REFUGE");
    const kept = hit.manifest.layers.find((l) => l.id === "bathymetry");
    assert.ok(kept);
    assert.equal(kept.hash, bathy.hash, "other R2 layers keep hashes");

    await persistBuiltPack(env, { manifest: hit.manifest, bodies: { ...stored.bodies, ...hit.built.bodies } });
    const served = await layerBody(env, POINT_JUDITH_CANYON_BBOX, START, HOURS, "tides", {
      packId: hit.manifest.packId,
      hash: fresh.hash,
    });
    assert.ok(served);
    const servedBody = JSON.parse(served.body);
    const names = (servedBody.payload?.stations ?? []).map((s) => s.name);
    assert.ok(names.includes("POINT JUDITH, HARBOR OF REFUGE"));
    assert.ok((servedBody.payload?.stations ?? []).some((s) => s.id === "8455083"));
  });

  it("R2 already packing 8455083 does not refetch tides", async () => {
    const { POINT_JUDITH_COOPS } = await import("../src/lib/ahanu/noaa-live.ts");
    const { env } = mockEnv();
    const packed = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      createdAt: START,
      tryLive: true,
      skipCache: true,
      now: NOW_FRESH,
      timeoutMs: 50,
      fetchImpl: ndbcFetch(NDBC_N),
    });
    const withPj = JSON.parse(fourStationLiveTides(START));
    withPj.payload.stations.unshift({
      id: POINT_JUDITH_COOPS.id,
      name: POINT_JUDITH_COOPS.name,
      lat: POINT_JUDITH_COOPS.lat,
      lon: POINT_JUDITH_COOPS.lon,
      interval: "h",
      datum: "MLLW",
      series: [{ at: START, heightFt: 1.0 }],
      hilo: [],
    });
    const stored = await persistLiveTides(env, packed, JSON.stringify(withPj));
    const oldTides = stored.manifest.layers.find((l) => l.id === "tides");
    assert.ok(oldTides);

    resetBuiltPackCache();
    resetLiveNoaaCache();

    let fetches = 0;
    const hit = await resolvePackManifest(env, {
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: HOURS,
      now: NOW_FRESH,
      fetchImpl: async () => {
        fetches += 1;
        throw new Error("complete tides must not refetch");
      },
    });
    assert.equal(hit.source, "r2");
    assert.equal(fetches, 0);
    assert.equal(hit.built, undefined);
    assert.equal(hit.manifest.layers.find((l) => l.id === "tides")?.hash, oldTides.hash);
  });
});
