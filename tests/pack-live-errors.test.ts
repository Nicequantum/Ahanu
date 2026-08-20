import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

if (typeof globalThis.localStorage === "undefined") {
  const map = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => {
      map.clear();
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const { handlePacksRequest } = await import("../src/lib/ahanu/pack-http.ts");
const { downloadTripPack } = await import("../src/lib/ahanu/pack-client.ts");
const { resetPackMemory } = await import("../src/lib/ahanu/pack-store.ts");
const { POINT_JUDITH_CANYON_BBOX } = await import("../src/lib/ahanu/pack.ts");
const {
  resetLiveNoaaCache,
  seedLiveNoaaCache,
  liveCacheKey,
  sampleCsvForTests,
  sampleChlCsvForTests,
  sampleSshCsvForTests,
  sampleBathyCsvForTests,
  sampleHmsKmzForTests,
  tryLiveNoaa,
  buoysToPackedJson,
  tidesToPackedJson,
} = await import("../src/lib/ahanu/noaa-live.ts");
const { encodeHour0Sample } = await import("../src/lib/ahanu/grid-io.ts");
const { useAhanu } = await import("../src/lib/ahanu/store.ts");

const START = "2026-08-20T12:00:00.000Z";

const NDBC_SAMPLE = `#STN     LAT      LON  YY MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  PTDY  ATMP  WTMP  DEWP  VIS  TIDE
#text    deg      deg   yr mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa   hPa  degC  degC  degC  nmi    ft
44097    40.967 -71.126 26 08 20 16 40  210  5.2  6.8   1.0     8   5.4 200 1016.5 +0.0  22.1  21.8    MM   MM    MM
`;

const COOPS_SAMPLE = {
  predictions: [
    { t: "2026-08-20 12:00", v: "1.20" },
    { t: "2026-08-20 13:00", v: "1.80" },
  ],
};

const ENC_SAMPLE = `<?xml version="1.0" encoding="UTF-8" ?>
<EncProductCatalog>
  <Header><dt_valid>2026-08-20T04:59:10Z</dt_valid></Header>
  <cell>
    <name>US5PVDBB</name>
    <lname>Block Island Sound</lname>
    <cscale>12000</cscale>
    <status>Active</status>
    <zipfile_location>https://www.charts.noaa.gov/ENCs/US5PVDBB.zip</zipfile_location>
    <zipfile_size>14000</zipfile_size>
    <edtn>5</edtn>
    <cov><panel>
      <vertex><lat>41.325</lat><long>-71.55</long></vertex>
      <vertex><lat>41.4</lat><long>-71.475</long></vertex>
    </panel></cov>
  </cell>
</EncProductCatalog>
`;

function mockNoaa(sstOk: boolean) {
  const sst = sampleCsvForTests();
  const chl = sampleChlCsvForTests();
  const ssh = sampleSshCsvForTests();
  const bathy = sampleBathyCsvForTests();
  const kmz = sampleHmsKmzForTests();
  const grib = encodeHour0Sample();
  return async (url: string) => {
    if (url.includes("analysed_sst") || url.includes("noaacrwsst") || url.includes("MURSST") || url.includes("GEOHIRR")) {
      if (!sstOk) return new Response("no", { status: 503 });
      return new Response(sst, { status: 200, headers: { "Content-Type": "text/csv" } });
    }
    if (url.includes("latest_obs")) return new Response(NDBC_SAMPLE, { status: 200 });
    if (url.includes("datagetter")) return new Response(JSON.stringify(COOPS_SAMPLE), { status: 200 });
    if (url.includes("ENCProdCat")) return new Response(ENC_SAMPLE, { status: 200 });
    if (url.includes("filter_gfswave") || url.includes("atlocn")) {
      return new Response(grib, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
    }
    if (url.includes("chlorophyll") || url.includes("chlor_a") || url.includes("VIIRSchla") || url.includes("erdMH1")) {
      return new Response(chl, { status: 200, headers: { "Content-Type": "text/csv" } });
    }
    if (url.includes("sla") || url.includes("BLENDEDssh") || url.includes("nesdisSSH")) {
      return new Response(ssh, { status: 200, headers: { "Content-Type": "text/csv" } });
    }
    if (url.includes("pelagicll_ne") || url.includes("HMS-A15")) {
      return new Response(kmz, { status: 200 });
    }
    if (url.includes("ETOPO_2022") || url.includes("GEBCO") || url.includes("etopo180")) {
      return new Response(bathy, { status: 200, headers: { "Content-Type": "text/csv" } });
    }
    if (url.includes("MapServer")) return new Response(JSON.stringify({ mapName: "Layers" }), { status: 200 });
    if (url.endsWith(".zip")) return new Response(new Uint8Array([80, 75, 3, 4, 0, 0]), { status: 200 });
    return new Response("no", { status: 404 });
  };
}

afterEach(() => {
  resetLiveNoaaCache();
  resetPackMemory();
});

describe("downloadTripPack surfaces liveErrors", () => {
  it("helm live download query includes skipCache", async () => {
    const orig = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      return handlePacksRequest(new Request(url), { fetchImpl: mockNoaa(false), sleep: async () => {} });
    }) as typeof fetch;
    try {
      await downloadTripPack({
        bbox: POINT_JUDITH_CANYON_BBOX,
        start: START,
        hours: 72,
        base: "http://ahanu.test",
        live: true,
        now: START,
      });
      assert.ok(
        urls.some((u) => u.includes("/api/packs?") && u.includes("live=1") && u.includes("skipCache=1")),
      );
      const objects = urls.filter((u) => u.includes("/api/objects?"));
      assert.ok(objects.length > 0);
      assert.ok(objects.every((u) => u.includes("live=1") && !u.includes("skipCache=")));
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("keeps mocked SST failures on the downloaded manifest", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      return handlePacksRequest(new Request(url), { fetchImpl: mockNoaa(false), sleep: async () => {} });
    }) as typeof fetch;
    try {
      const got = await downloadTripPack({
        bbox: POINT_JUDITH_CANYON_BBOX,
        start: START,
        hours: 72,
        base: "http://ahanu.test",
        live: true,
        now: START,
      });
      assert.equal(got.manifest.layers.find((l) => l.id === "sst")?.source, "fixture");
      const errors = got.manifest.liveErrors ?? [];
      assert.ok(errors.some((e) => e.startsWith("sst")));
      assert.ok(errors.length <= 8);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("stale liveCache does not hide SST", () => {
  it("cached live result without errors does not hide a failed SST", async () => {
    const key = liveCacheKey(POINT_JUDITH_CANYON_BBOX, START, 72);
    seedLiveNoaaCache(key, {
      buoys: buoysToPackedJson(
        [{ id: "44097", name: "Block Island", lat: 40.967, lon: -71.126 }],
        START,
      ),
      tides: tidesToPackedJson(START, 72, []),
      errors: [],
    });
    const live = await tryLiveNoaa({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      skipCache: false,
      fetchImpl: mockNoaa(false),
      sleep: async () => {},
    });
    assert.equal(live.sst, undefined);
    assert.ok(live.errors.some((e) => e.startsWith("sst")), live.errors.join(" | "));
  });

  it("cache hit still carries liveErrors for /api/objects fan-out", async () => {
    const first = await tryLiveNoaa({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      skipCache: true,
      fetchImpl: mockNoaa(false),
      sleep: async () => {},
    });
    assert.ok(first.errors.some((e) => e.startsWith("sst")));
    let fetches = 0;
    const counting = async (url: string) => {
      fetches += 1;
      return mockNoaa(false)(url);
    };
    const second = await tryLiveNoaa({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      skipCache: false,
      fetchImpl: counting,
      sleep: async () => {},
    });
    assert.equal(fetches, 0, "same-download cache should not refetch");
    assert.ok(second.errors.some((e) => e.startsWith("sst")), second.errors.join(" | "));
  });
});

describe("store retry live overlays", () => {
  it("retry calls downloadTripPack again with live and skipCache", async () => {
    const { buildFixturePack } = await import("../src/lib/ahanu/pack.ts");
    const built = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      liveErrors: ["sst: all public paths failed — fixture kept"],
    });
    const orig = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const raw = String(input);
      const url = raw.startsWith("http") ? raw : `http://ahanu.test${raw}`;
      urls.push(url);
      if (url.includes("/api/packs")) {
        return new Response(JSON.stringify(built.manifest), { status: 200 });
      }
      const layer = new URL(url).searchParams.get("layer") ?? "";
      const body = built.bodies[layer];
      if (!body) return new Response("missing", { status: 404 });
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    const prev = useAhanu.getState();
    useAhanu.setState({
      packLive: true,
      packDownloading: false,
      packBbox: { ...POINT_JUDITH_CANYON_BBOX },
      packStart: START,
      packHours: 72,
      packLayers: [],
      packLiveErrors: [],
    });
    try {
      await useAhanu.getState().downloadTripPack();
      const first = useAhanu.getState().packLiveErrors;
      assert.ok(first.some((e) => e.startsWith("sst")), first.join(" | "));
      const packsBefore = urls.filter((u) => u.includes("/api/packs?")).length;
      await useAhanu.getState().downloadTripPack({ skipCache: true });
      const packs = urls.filter((u) => u.includes("/api/packs?"));
      assert.ok(packs.length > packsBefore, "retry should call download again");
      assert.ok(packs.some((u) => u.includes("skipCache=1") && u.includes("live=1")));
      assert.equal(useAhanu.getState().packLive, true);
    } finally {
      globalThis.fetch = orig;
      useAhanu.setState({
        packLive: prev.packLive,
        packLiveErrors: prev.packLiveErrors,
        packLayers: prev.packLayers,
        packManifest: prev.packManifest,
        packReady: prev.packReady,
        packDownloading: false,
      });
    }
  });
});
