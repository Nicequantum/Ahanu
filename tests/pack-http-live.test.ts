import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const { handlePacksRequest } = await import("../src/lib/ahanu/pack-http.ts");
const { buildFixturePack, POINT_JUDITH_CANYON_BBOX } = await import("../src/lib/ahanu/pack.ts");
const {
  resetLiveNoaaCache,
  sampleCsvForTests,
  sampleChlCsvForTests,
  sampleSshCsvForTests,
  sampleBathyCsvForTests,
  sampleHmsKmzForTests,
} = await import("../src/lib/ahanu/noaa-live.ts");
const { encodeHour0Sample } = await import("../src/lib/ahanu/grid-io.ts");

afterEach(() => {
  resetLiveNoaaCache();
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
  "chlorophyll",
  "altimetry",
  "hms_zones",
  "wind",
  "waves",
] as const;

type LayerRow = { id: string; hash: string; source: string };

function mockNoaaSuccess(): (url: string) => Promise<Response> {
  const sst = sampleCsvForTests();
  const chl = sampleChlCsvForTests();
  const ssh = sampleSshCsvForTests();
  const bathy = sampleBathyCsvForTests();
  const kmz = sampleHmsKmzForTests();
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
    if (url.includes("chlor_a") || url.includes("VIIRSchla")) {
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
  it("GET /api/packs?live=1 with mocked NOAA marks SST bathy contours chl SSH HMS hour-0 GFS noaa", async () => {
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
    const man = (await res.json()) as { layers: LayerRow[] };
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
