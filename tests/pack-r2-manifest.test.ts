import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const { resolvePackManifest, persistBuiltPack, packManifestR2Key, loadPersistedManifest, hashedLayerR2Key } =
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
    assert.equal(hit.source, "r2");
    assert.equal(hit.built, undefined);
    assert.equal(hit.manifest.layers.find((l) => l.id === "sst")?.hash, murSst.hash);
    assert.ok(
      (hit.manifest.liveErrors ?? []).some((e) => /sst: live refresh failed/.test(e) && /kept/.test(e)),
      hit.manifest.liveErrors?.join(" | "),
    );
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
const PICKER_16_ENC = [...OLD_8_ENC, ...NEW_8_ENC];

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
      s57: { source: "noaa", encoding: "s-57", official: true, cellIds },
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

  it("R2 8-cell ENC + current picker 16 refreshes ENC and keeps other hashes", async () => {
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
    assert.ok(ids.length >= 16, `expected 16 cellIds, got ${ids.join(",")}`);
    for (const id of NEW_8_ENC) {
      assert.ok(ids.includes(id), `missing ${id} in ${ids.join(",")}`);
    }
    const kept = hit.manifest.layers.find((l) => l.id === "bathymetry");
    assert.ok(kept);
    assert.equal(kept.hash, bathy.hash, "other R2 layers keep hashes");
  });

  it("R2 already 16 official ENC does not refetch", async () => {
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
    const stored = await persistOfficialEnc(env, packed, PICKER_16_ENC);
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
});
