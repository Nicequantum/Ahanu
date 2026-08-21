import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const { handlePacksRequest } = await import("../src/lib/ahanu/pack-http.ts");
const { buildFixturePack, PACK_BUILDER_REV, POINT_JUDITH_CANYON_BBOX, resetBuiltPackCache, sha256Hex } = await import("../src/lib/ahanu/pack.ts");
const {
  resetLiveNoaaCache,
  sampleCsvForTests,
  sampleChlCsvForTests,
  sampleSshCsvForTests,
  sampleBathyCsvForTests,
  sampleHmsKmzForTests,
  sampleCanyonsGeojsonForTests,
  SST_ENDPOINTS,
} = await import("../src/lib/ahanu/noaa-live.ts");
const { encodeHour0Sample } = await import("../src/lib/ahanu/grid-io.ts");

afterEach(() => {
  resetLiveNoaaCache();
  resetBuiltPackCache();
});

const START = "2026-08-20T12:00:00.000Z";
const Q =
  "west=-72.8&south=39.4&east=-68.8&north=41.5&hours=72&start=2026-08-20T12:00:00.000Z";

const NDBC_SAMPLE = `#STN     LAT      LON  YY MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  PTDY  ATMP  WTMP  DEWP  VIS  TIDE
#text    deg      deg   yr mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa   hPa  degC  degC  degC  nmi    ft
44097    40.967 -71.126 26 08 20 16 40  210  5.2  6.8   1.0     8   5.4 200 1016.5 +0.0  22.1  21.8    MM   MM    MM
`;

const COOPS_SAMPLE = {
  predictions: [
    { t: "2026-08-20 12:00", v: "1.20" },
    { t: "2026-08-20 13:00", v: "1.80" },
    { t: "2026-08-20 18:00", v: "0.10" },
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

const LIVE_LAYERS = [
  "buoys",
  "tides",
  "sst",
  "bathymetry",
  "contours",
  "canyons",
  "chlorophyll",
  "altimetry",
  "hms_zones",
  "wind",
  "waves",
] as const;

type LayerRow = { id: string; hash: string; source: string; hours?: number; updatedAt?: string };

function mockNoaaSuccess(): (url: string) => Promise<Response> {
  const sst = sampleCsvForTests().replaceAll("2026-08-18T12:00:00Z", "2026-08-20T12:00:00Z");
  const chl = sampleChlCsvForTests();
  const ssh = sampleSshCsvForTests();
  const bathy = sampleBathyCsvForTests();
  const kmz = sampleHmsKmzForTests();
  const canyons = sampleCanyonsGeojsonForTests();
  const grib = encodeHour0Sample();
  return async (url: string) => {
    if (url.includes("latest_obs")) return new Response(NDBC_SAMPLE, { status: 200 });
    if (url.includes("datagetter")) return new Response(JSON.stringify(COOPS_SAMPLE), { status: 200 });
    if (url.includes("ENCProdCat")) return new Response(ENC_SAMPLE, { status: 200 });
    if (url.includes("filter_gfswave") || url.includes("atlocn")) {
      return new Response(grib, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
    }
    if (url.includes("noaacrwsstDaily") || url.includes("analysed_sst")) {
      return new Response(sst, { status: 200, headers: { "Content-Type": "text/csv" } });
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
    if (url.includes("UnderseaFeaturePlaceNames")) {
      return new Response(canyons, { status: 200, headers: { "Content-Type": "application/geo+json" } });
    }
    if (url.includes("ETOPO_2022") || url.includes("GEBCO") || url.includes("etopo180")) {
      return new Response(bathy, { status: 200, headers: { "Content-Type": "text/csv" } });
    }
    if (url.includes("MapServer")) {
      return new Response(JSON.stringify({ mapName: "Layers" }), { status: 200 });
    }
    if (url.endsWith(".zip")) {
      return new Response(new Uint8Array([80, 75, 3, 4, 0, 0]), { status: 200 });
    }
    return new Response("no", { status: 404 });
  };
}

describe("preview pack HTTP live overlays", () => {
  it("GET /api/packs?live=1 with mocked NOAA marks SST bathy contours chl SSH HMS canyons hour-0 GFS noaa", async () => {
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const res = await handlePacksRequest(new Request(`http://ahanu.test/api/packs?${Q}&live=1`), {
      fetchImpl: mockNoaaSuccess(),
    });
    assert.equal(res.status, 200);
    const man = (await res.json()) as { layers: LayerRow[]; builder: { rev: string } };
    assert.equal(man.builder.rev, PACK_BUILDER_REV);
    assert.equal(fixture.manifest.builder.rev, PACK_BUILDER_REV);
    for (const id of LIVE_LAYERS) {
      const live = man.layers.find((l) => l.id === id);
      const fix = fixture.manifest.layers.find((l) => l.id === id);
      assert.ok(live, `missing ${id}`);
      assert.ok(fix, `missing fixture ${id}`);
      assert.equal(live!.source, "noaa", `${id} should be noaa`);
      assert.notEqual(live!.hash, fix!.hash, `${id} hash should change`);
    }
  });

  it("GET /api/objects?live=1 returns the same overlaid bodies", async () => {
    const fetchImpl = mockNoaaSuccess();
    const manRes = await handlePacksRequest(new Request(`http://ahanu.test/api/packs?${Q}&live=1`), {
      fetchImpl,
    });
    const man = (await manRes.json()) as { layers: LayerRow[] };
    for (const id of ["sst", "bathymetry", "contours", "chlorophyll", "altimetry", "hms_zones", "wind"] as const) {
      const rec = man.layers.find((l) => l.id === id)!;
      assert.equal(rec.source, "noaa", id);
      const obj = await handlePacksRequest(
        new Request(`http://ahanu.test/api/objects?${Q}&live=1&layer=${id}`),
        { fetchImpl },
      );
      assert.equal(obj.status, 200, id);
      assert.equal(obj.headers.get("X-Ahanu-Source"), "noaa", id);
      assert.equal(obj.headers.get("X-Ahanu-Hash"), rec.hash, id);
      const body = await obj.text();
      assert.ok(body.length > 8, `${id} empty`);
    }
  });

  it("GET /api/packs?live=1 with all fetches failing stays fixture", async () => {
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const res = await handlePacksRequest(new Request(`http://ahanu.test/api/packs?${Q}&live=1`), {
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    assert.equal(res.status, 200);
    const man = (await res.json()) as { layers: LayerRow[] };
    for (const id of LIVE_LAYERS) {
      const live = man.layers.find((l) => l.id === id)!;
      const fix = fixture.manifest.layers.find((l) => l.id === id)!;
      assert.equal(live.source, "fixture", id);
      assert.equal(live.hash, fix.hash, id);
    }
  });

  it("GET /api/packs without live=1 stays fixture even if NOAA would succeed", async () => {
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    let fetches = 0;
    const res = await handlePacksRequest(new Request(`http://ahanu.test/api/packs?${Q}`), {
      fetchImpl: async (url: string) => {
        fetches += 1;
        return mockNoaaSuccess()(url);
      },
    });
    assert.equal(res.status, 200);
    assert.equal(fetches, 0);
    const man = (await res.json()) as { layers: LayerRow[] };
    for (const id of LIVE_LAYERS) {
      const row = man.layers.find((l) => l.id === id)!;
      const fix = fixture.manifest.layers.find((l) => l.id === id)!;
      assert.equal(row.source, "fixture", id);
      assert.equal(row.hash, fix.hash, id);
    }
  });
});


function abortErr(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function isSstUrl(url: string): boolean {
  return (
    url.includes("analysed_sst") ||
    url.includes("noaacrwsst") ||
    url.includes("MURSST") ||
    url.includes("GEOHIRR")
  );
}

describe("preview pack HTTP NOAA retry", () => {
  it("GET /api/packs?live=1 retries a timed-out SST then marks noaa", async () => {
    const base = mockNoaaSuccess();
    let sst = 0;
    const res = await handlePacksRequest(new Request(`http://ahanu.test/api/packs?${Q}&live=1`), {
      sleep: async () => {},
      fetchImpl: async (url: string) => {
        if (isSstUrl(url)) {
          sst += 1;
          if (sst === 1) throw abortErr();
        }
        return base(url);
      },
    });
    assert.equal(res.status, 200);
    assert.equal(sst, 2);
    const man = (await res.json()) as { layers: LayerRow[] };
    assert.equal(man.layers.find((l) => l.id === "sst")!.source, "noaa");
  });

  it("GET /api/packs?live=1 does not retry a 404 SST path", async () => {
    const base = mockNoaaSuccess();
    let sst = 0;
    const res = await handlePacksRequest(new Request(`http://ahanu.test/api/packs?${Q}&live=1`), {
      sleep: async () => {
        throw new Error("404 must not sleep");
      },
      fetchImpl: async (url: string) => {
        if (isSstUrl(url)) {
          sst += 1;
          return new Response("no", { status: 404 });
        }
        return base(url);
      },
    });
    assert.equal(res.status, 200);
    assert.equal(sst, SST_ENDPOINTS.length);
    const man = (await res.json()) as { layers: LayerRow[] };
    assert.equal(man.layers.find((l) => l.id === "sst")!.source, "fixture");
  });

  it("GET /api/packs?live=1 keeps fixture SST after two 503s", async () => {
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const base = mockNoaaSuccess();
    let sst = 0;
    const res = await handlePacksRequest(new Request(`http://ahanu.test/api/packs?${Q}&live=1`), {
      sleep: async () => {},
      fetchImpl: async (url: string) => {
        if (isSstUrl(url)) {
          sst += 1;
          return new Response("no", { status: 503 });
        }
        return base(url);
      },
    });
    assert.equal(res.status, 200);
    assert.equal(sst, SST_ENDPOINTS.length * 2);
    const man = (await res.json()) as { layers: LayerRow[] };
    const live = man.layers.find((l) => l.id === "sst")!;
    const fix = fixture.manifest.layers.find((l) => l.id === "sst")!;
    assert.equal(live.source, "fixture");
    assert.equal(live.hash, fix.hash);
  });
});

describe("preview pack HTTP live ENC catalog bounds", () => {
  it("live catalog mock with bounds keeps west/south/east/north and paints polygons", async () => {
    const { encCatalogFeatures } = await import("../src/lib/ahanu/packed-chart.ts");
    const fetchImpl = mockNoaaSuccess();
    const obj = await handlePacksRequest(
      new Request(`http://ahanu.test/api/objects?${Q}&live=1&layer=enc`),
      { fetchImpl },
    );
    assert.equal(obj.status, 200);
    assert.equal(obj.headers.get("X-Ahanu-Source"), "noaa");
    const body = JSON.parse(await obj.text()) as {
      kind?: string;
      payload?: {
        official?: boolean;
        source?: string;
        cells?: {
          id: string;
          name?: string;
          zipUrl?: string;
          west?: number;
          south?: number;
          east?: number;
          north?: number;
        }[];
      };
    };
    assert.equal(body.kind, "enc-clip");
    assert.equal(body.payload?.official, false);
    assert.equal(body.payload?.source, "noaa-enc-catalog");
    const cell = body.payload?.cells?.find((c) => c.id === "US5PVDBB");
    assert.ok(cell, "live catalog cell missing");
    assert.equal(cell.west, -71.55);
    assert.equal(cell.south, 41.325);
    assert.equal(cell.east, -71.475);
    assert.equal(cell.north, 41.4);
    assert.ok(cell.zipUrl);
    const geo = encCatalogFeatures(body.payload?.cells ?? []);
    assert.equal(geo.features.length, 1);
    assert.equal(geo.features[0]!.geometry.type, "Polygon");
    assert.equal((geo.features[0]!.properties as { id?: string })?.id, "US5PVDBB");
    assert.equal((geo.features[0]!.properties as { legal?: boolean })?.legal, false);
  });
});

describe("preview pack HTTP liveErrors", () => {
  it("records SST ingest errors when the live probe fails", async () => {
    const base = mockNoaaSuccess();
    const res = await handlePacksRequest(new Request(`http://ahanu.test/api/packs?${Q}&live=1`), {
      sleep: async () => {},
      fetchImpl: async (url: string) => {
        if (isSstUrl(url)) return new Response("no", { status: 503 });
        return base(url);
      },
    });
    assert.equal(res.status, 200);
    const man = (await res.json()) as { layers: LayerRow[]; liveErrors?: string[] };
    assert.equal(man.layers.find((l) => l.id === "sst")!.source, "fixture");
    const errors = man.liveErrors ?? [];
    assert.ok(errors.length > 0, "expected live SST errors");
    assert.ok(errors.length <= 8);
    assert.ok(errors.some((e) => e.startsWith("sst") && (e.includes("fetch failed") || e.includes("fixture kept"))));
  });

  it("keeps liveErrors empty when live is off", async () => {
    const res = await handlePacksRequest(new Request(`http://ahanu.test/api/packs?${Q}`), {
      fetchImpl: mockNoaaSuccess(),
    });
    assert.equal(res.status, 200);
    const man = (await res.json()) as { liveErrors?: string[] };
    assert.deepEqual(man.liveErrors ?? [], []);
  });

  it("keeps liveErrors empty when every overlay lands noaa", async () => {
    const res = await handlePacksRequest(new Request(`http://ahanu.test/api/packs?${Q}&live=1`), {
      fetchImpl: mockNoaaSuccess(),
    });
    assert.equal(res.status, 200);
    const man = (await res.json()) as { layers: LayerRow[]; liveErrors?: string[] };
    const overlayIds = [
      "enc",
      "bathymetry",
      "contours",
      "sst",
      "chlorophyll",
      "altimetry",
      "wind",
      "waves",
      "buoys",
      "tides",
      "hms_zones",
      "canyons",
    ];
    for (const id of overlayIds) {
      assert.equal(man.layers.find((l) => l.id === id)?.source, "noaa", id);
    }
    const errors = man.liveErrors ?? [];
    assert.ok(errors.every((e) => e.includes("hour-0 live") && e.includes("fixture")));
    assert.ok(!errors.some((e) => e.includes("f000–f072")));
    assert.equal(man.layers.find((l) => l.id === "wind")!.hours, 72);
    assert.equal(man.layers.find((l) => l.id === "waves")!.hours, 72);
  });
});

describe("preview pack HTTP hour-0 GFS merge", () => {
  it("hour-0 live + series off keeps wind/wave hours 72 and does not claim a 72 h NOAA series", async () => {
    const res = await handlePacksRequest(new Request(`http://ahanu.test/api/packs?${Q}&live=1`), {
      fetchImpl: mockNoaaSuccess(),
    });
    assert.equal(res.status, 200);
    const man = (await res.json()) as {
      layers: (LayerRow & { hours?: number })[];
      liveErrors?: string[];
      sources?: { id: string; name: string }[];
      readyForOffshore?: boolean;
      notes?: string;
    };
    const wind = man.layers.find((l) => l.id === "wind")!;
    const waves = man.layers.find((l) => l.id === "waves")!;
    assert.equal(wind.source, "noaa");
    assert.equal(waves.source, "noaa");
    assert.equal(wind.hours, 72);
    assert.equal(waves.hours, 72);
    const nomads = man.sources?.find((s) => s.id === "nomads-gfswave");
    assert.ok(nomads?.name.includes("hour-0 live"));
    assert.ok(nomads?.name.includes("fixture"));
    assert.ok(!nomads?.name.includes("f000–f072 / 3 h"));
    assert.ok(!(man.notes ?? "").includes("that coverage is 1 h"));
    assert.ok((man.liveErrors ?? []).some((e) => e.includes("hour-0 live") && e.includes("series off")));
    const ev = man.layers.map((l) => ({
      id: l.id,
      present: true,
      hashExpected: l.hash,
      hashActual: l.hash,
      hoursCovered: l.hours,
    }));
    const { evaluateReadyForOffshore } = await import("../src/lib/ahanu/pack.ts");
    const ready = evaluateReadyForOffshore({
      hours: 72,
      start: START,
      now: START,
      layers: ev,
    });
    assert.ok(!ready.failures.some((f) => /covers 1 h/.test(f)));
  });
});

describe("preview pack HTTP objects reuse last pack bytes", () => {
  it("GET /api/objects?layer=buoys keeps the packs hash when NDBC snapshot changes", async () => {
    const NDBC_N = `#STN     LAT      LON  YY MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  PTDY  ATMP  WTMP  DEWP  VIS  TIDE
#text    deg      deg   yr mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa   hPa  degC  degC  degC  nmi    ft
44097    40.967 -71.126 26 08 20 16 40  210  5.2  6.8   1.0     8   5.4 200 1016.5 +0.0  22.1  21.8    MM   MM    MM
`;
    const NDBC_N1 = `#STN     LAT      LON  YY MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  PTDY  ATMP  WTMP  DEWP  VIS  TIDE
#text    deg      deg   yr mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa   hPa  degC  degC  degC  nmi    ft
44097    40.967 -71.126 26 08 20 16 50  220  7.1  8.4   1.3     9   5.8 210 1015.8 -0.4  22.0  21.6    MM   MM    MM
`;
    let ndbc = NDBC_N;
    const base = mockNoaaSuccess();
    const fetchImpl = async (url: string) => {
      if (url.includes("latest_obs")) return new Response(ndbc, { status: 200 });
      return base(url);
    };
    const manRes = await handlePacksRequest(new Request(`http://ahanu.test/api/packs?${Q}&live=1&skipCache=1`), {
      fetchImpl,
    });
    assert.equal(manRes.status, 200);
    const man = (await manRes.json()) as { layers: LayerRow[]; packId: string };
    const buoys = man.layers.find((l) => l.id === "buoys");
    assert.ok(buoys);
    assert.equal(buoys.source, "noaa");
    ndbc = NDBC_N1;
    const obj = await handlePacksRequest(
      new Request(`http://ahanu.test/api/objects?${Q}&live=1&layer=buoys`),
      { fetchImpl },
    );
    assert.equal(obj.status, 200);
    const body = await obj.text();
    assert.equal(obj.headers.get("X-Ahanu-Hash"), buoys.hash);
    assert.equal(await sha256Hex(body), buoys.hash);
    assert.ok(body.includes("21.8") || body.includes("5.2"), "expected snapshot N bytes");
  });
});

