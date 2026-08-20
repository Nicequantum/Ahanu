import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const {
  parseNdbcLatestObs,
  parseCoopsPredictions,
  buoysToPackedJson,
  tidesToPackedJson,
  tryLiveNoaa,
  resetLiveNoaaCache,
  parseEncProductCatalog,
  parseCoopsWaterLevel,
  isGrib2,
  gfsWaveFilterUrl,
  erddapSstCsvUrl,
  parseErddapSstCsv,
  sstTableToPacked,
  fetchLiveSst,
  sampleCsvForTests,
  SST_ENDPOINTS,
  erddapChlCsvUrl,
  parseErddapChlCsv,
  chlTableToPacked,
  fetchLiveChl,
  sampleChlCsvForTests,
  CHL_ENDPOINTS,
  erddapSshCsvUrl,
  parseErddapSshCsv,
  sshTableToPacked,
  fetchLiveSsh,
  sampleSshCsvForTests,
  SSH_ENDPOINTS,
  parseKmlPolygons,
  clipHmsFeatures,
  fetchLiveHms,
  hmsToPackedJson,
  sampleHmsKmlForTests,
  sampleHmsKmzForTests,
  HMS_ENDPOINTS,
  HMS_REMINDER_NOTE,
  erddapBathyCsvUrl,
  parseErddapBathyCsv,
  bathyTableToPacked,
  contoursFromDepthGrid,
  fetchLiveBathy,
  sampleBathyCsvForTests,
  BATHY_ENDPOINTS,
  fetchNoaaBytes,
  fetchNoaaText,
  NOAA_GRID_TIMEOUT_MS,
  NOAA_RETRY_BACKOFF_MS,
} = await import("../src/lib/ahanu/noaa-live.ts");
const { buildFixturePack, buildTripPack, sha256Hex, POINT_JUDITH_CANYON_BBOX } =
  await import("../src/lib/ahanu/pack.ts");
const { parseLayerBody } = await import("../src/lib/ahanu/pack-fixtures.ts");

afterEach(() => {
  resetLiveNoaaCache();
});

const NDBC_SAMPLE = `#STN     LAT      LON  YY MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  PTDY  ATMP  WTMP  DEWP  VIS  TIDE
#text    deg      deg   yr mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa   hPa  degC  degC  degC  nmi    ft
44097    40.967 -71.126 26 08 20 16 40  210  5.2  6.8   1.0     8   5.4 200 1016.5 +0.0  22.1  21.8    MM   MM    MM
44017    40.693 -72.049 26 08 20 16 40  200  4.8  6.1   1.1     7   5.1 195 1016.2 -0.1  21.8  21.4    MM   MM    MM
99999    10.000  10.000 26 08 20 16 40  180  3.0  4.0   0.5     6   4.0 180 1012.0 +0.0  28.0  27.0    MM   MM    MM
`;

const COOPS_SAMPLE = {
  predictions: [
    { t: "2026-08-20 12:00", v: "1.20" },
    { t: "2026-08-20 13:00", v: "1.80" },
    { t: "2026-08-20 18:00", v: "0.10" },
  ],
};

const START = "2026-08-20T12:00:00.000Z";

describe("parseNdbcLatestObs", () => {
  it("keeps Northeast stations, converts m/s and meters, drops outsiders", () => {
    const rows = parseNdbcLatestObs(NDBC_SAMPLE, POINT_JUDITH_CANYON_BBOX);
    assert.equal(rows.length, 2);
    const block = rows.find((b) => b.id === "44097");
    assert.ok(block);
    assert.equal(block.name, "Block Island");
    assert.ok(block.windKt! > 9 && block.windKt! < 11, `windKt ${block.windKt}`);
    assert.ok(block.waveFt! > 3 && block.waveFt! < 3.5, `waveFt ${block.waveFt}`);
    assert.equal(block.sstC, 21.8);
    assert.equal(block.updatedAt, "2026-08-20T16:40:00.000Z");
    assert.ok(!rows.some((b) => b.id === "99999"));
  });
});

describe("parseCoopsPredictions", () => {
  it("reads hourly heights", () => {
    const series = parseCoopsPredictions(COOPS_SAMPLE);
    assert.equal(series.length, 3);
    assert.equal(series[0]!.at, "2026-08-20T12:00:00.000Z");
    assert.equal(series[1]!.heightFt, 1.8);
  });

  it("returns empty on error payload", () => {
    assert.equal(parseCoopsPredictions({ error: { message: "nope" } }).length, 0);
  });
});

describe("tryLiveNoaa", () => {
  it("writes fixture-shaped live objects when fetch succeeds", async () => {
    const fetchImpl = async (url: string) => {
      if (url.includes("latest_obs")) {
        return new Response(NDBC_SAMPLE, { status: 200 });
      }
      if (url.includes("datagetter")) {
        return new Response(JSON.stringify(COOPS_SAMPLE), { status: 200 });
      }
      return new Response("no", { status: 404 });
    };
    const live = await tryLiveNoaa({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      fetchImpl,
      skipCache: true,
    });
    assert.ok(live.buoys);
    assert.ok(live.tides);
    const buoyPayload = live.buoys.payload as {
      live?: boolean;
      source?: string;
      buoys?: { id: string }[];
    };
    assert.equal(buoyPayload.live, true);
    assert.equal(buoyPayload.source, "ndbc");
    assert.ok(buoyPayload.buoys?.some((b) => b.id === "44097"));
    const tidePayload = live.tides.payload as { stations?: { id: string; series: unknown[] }[] };
    assert.ok((tidePayload.stations?.length ?? 0) >= 3);
  });

  it("degrades to empty overlays when the network is blocked", async () => {
    const fetchImpl = async () => {
      throw new Error("blocked");
    };
    const live = await tryLiveNoaa({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      fetchImpl,
      skipCache: true,
    });
    assert.equal(live.buoys, undefined);
    assert.equal(live.tides, undefined);
    assert.ok(live.errors.some((e) => e.includes("ndbc")));
  });
});

describe("buildTripPack live overlay", () => {
  it("hashes the live buoy body, not the fixture", async () => {
    const fetchImpl = async (url: string) => {
      if (url.includes("latest_obs")) return new Response(NDBC_SAMPLE, { status: 200 });
      return new Response("no", { status: 404 });
    };
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const live = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      fetchImpl,
      timeoutMs: 1000,
    });
    const liveBuoy = live.manifest.layers.find((l) => l.id === "buoys")!;
    const fixBuoy = fixture.manifest.layers.find((l) => l.id === "buoys")!;
    assert.notEqual(liveBuoy.hash, fixBuoy.hash);
    assert.equal(liveBuoy.source, "noaa");
    assert.equal(await sha256Hex(live.bodies.buoys!), liveBuoy.hash);
    const parsed = parseLayerBody(live.bodies.buoys!);
    assert.equal((parsed as { payload?: { source?: string } })?.payload?.source, "ndbc");
    const sst = live.manifest.layers.find((l) => l.id === "sst")!;
    assert.equal(sst.hash, fixture.manifest.layers.find((l) => l.id === "sst")!.hash);
  });

  it("keeps fixtures when live fetch fails", async () => {
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const live = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    assert.equal(
      live.manifest.layers.find((l) => l.id === "buoys")!.hash,
      fixture.manifest.layers.find((l) => l.id === "buoys")!.hash,
    );
    assert.equal(
      live.manifest.layers.find((l) => l.id === "enc")!.hash,
      fixture.manifest.layers.find((l) => l.id === "enc")!.hash,
    );
  });
});

describe("ENC honesty", () => {
  it("fixture ENC is a cell list, not S-57 bytes", async () => {
    const { generateLayerBody } = await import("../src/lib/ahanu/pack-fixtures.ts");
    const body = generateLayerBody("enc", POINT_JUDITH_CANYON_BBOX, START, 72);
    assert.match(body, /not official S-57/);
    assert.doesNotMatch(body, /application\/zip/);
    const parsed = parseLayerBody(body) as {
      kind?: string;
      payload?: { fixture?: boolean; cells?: unknown[] };
    };
    assert.equal(parsed.kind, "enc-clip");
    assert.equal(parsed.payload?.fixture, true);
    assert.ok((parsed.payload?.cells?.length ?? 0) >= 3);
  });
});

const ENC_SAMPLE = `<?xml version="1.0" encoding="UTF-8" ?>
<EncProductCatalog>
  <Header><dt_valid>2026-08-20T04:59:10Z</dt_valid></Header>
  <cell>
    <name>US5PVDBB</name>
    <lname>Block Island Sound - From Matunuck Point to Point Judith</lname>
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
  <cell>
    <name>US3NY01M</name>
    <lname>Approaches to New York</lname>
    <cscale>350000</cscale>
    <status>Active</status>
    <zipfile_location>https://www.charts.noaa.gov/ENCs/US3NY01M.zip</zipfile_location>
    <zipfile_size>179183</zipfile_size>
    <cov><panel>
      <vertex><lat>38.7</lat><long>-74.4</long></vertex>
      <vertex><lat>41.5</lat><long>-69.2</long></vertex>
    </panel></cov>
  </cell>
  <cell>
    <name>US5CA99M</name>
    <lname>San Francisco</lname>
    <cscale>12000</cscale>
    <status>Active</status>
    <zipfile_location>https://www.charts.noaa.gov/ENCs/US5CA99M.zip</zipfile_location>
    <zipfile_size>1000</zipfile_size>
    <cov><panel>
      <vertex><lat>37.7</lat><long>-122.5</long></vertex>
      <vertex><lat>37.9</lat><long>-122.3</long></vertex>
    </panel></cov>
  </cell>
  <cell>
    <name>US4XX00M</name>
    <lname>Cancelled leftover</lname>
    <status>Cancelled</status>
    <cov><panel>
      <vertex><lat>40</lat><long>-72</long></vertex>
      <vertex><lat>41</lat><long>-70</long></vertex>
    </panel></cov>
  </cell>
</EncProductCatalog>
`;

const GRIB_MIN = new Uint8Array([
  71, 82, 73, 66, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 16, 55, 55, 55, 55,
]);

function liveFetch(url: string): Promise<Response> {
  if (url.includes("latest_obs"))
    return Promise.resolve(new Response(NDBC_SAMPLE, { status: 200 }));
  if (url.includes("ENCProdCat")) return Promise.resolve(new Response(ENC_SAMPLE, { status: 200 }));
  if (url.includes("filter_gfswave") || url.includes("atlocn")) {
    return Promise.resolve(
      new Response(GRIB_MIN, {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );
  }
  if (url.includes("datagetter") && url.includes("water_level")) {
    return Promise.resolve(
      new Response(JSON.stringify({ data: [{ t: "2026-08-20 18:18", v: "3.73" }] }), {
        status: 200,
      }),
    );
  }
  if (url.includes("datagetter"))
    return Promise.resolve(new Response(JSON.stringify(COOPS_SAMPLE), { status: 200 }));
  if (url.includes("MapServer")) {
    return Promise.resolve(new Response(JSON.stringify({ mapName: "Layers" }), { status: 200 }));
  }
  if (url.endsWith(".zip")) {
    return Promise.resolve(new Response(new Uint8Array([80, 75, 3, 4, 0, 0]), { status: 200 }));
  }
  return Promise.resolve(new Response("no", { status: 404 }));
}

describe("parseEncProductCatalog", () => {
  it("keeps Active usage 3–5 cells that intersect the box and drops the rest", () => {
    const cells = parseEncProductCatalog(ENC_SAMPLE, POINT_JUDITH_CANYON_BBOX);
    assert.ok(cells.some((c) => c.id === "US5PVDBB"));
    assert.ok(cells.some((c) => c.id === "US3NY01M"));
    assert.ok(!cells.some((c) => c.id === "US5CA99M"));
    assert.ok(!cells.some((c) => c.id === "US4XX00M"));
    const pj = cells.find((c) => c.id === "US5PVDBB")!;
    assert.equal(pj.usage, 5);
    assert.equal(pj.zipBytes, 14000);
  });
});

describe("parseCoopsWaterLevel", () => {
  it("reads latest observed height", () => {
    const obs = parseCoopsWaterLevel({ data: [{ t: "2026-08-20 18:18", v: "3.73" }] });
    assert.ok(obs);
    assert.equal(obs.heightFt, 3.7);
    assert.equal(obs.at, "2026-08-20T18:18:00.000Z");
  });
});

describe("isGrib2", () => {
  it("accepts GRIB…7777 and rejects HTML", () => {
    assert.equal(isGrib2(GRIB_MIN), true);
    assert.equal(isGrib2(new TextEncoder().encode("<html>")), false);
  });
});

describe("tryLiveNoaa expanded ingest", () => {
  it("overlays ENC catalog + GFS-Wave hash when fetch succeeds", async () => {
    const live = await tryLiveNoaa({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      fetchImpl: liveFetch,
      skipCache: true,
    });
    assert.ok(live.buoys);
    assert.ok(live.tides);
    assert.ok(live.enc);
    assert.ok(live.gfsWave);
    const enc = live.enc.payload as {
      official?: boolean;
      live?: boolean;
      source?: string;
      cells?: { id: string }[];
    };
    assert.equal(enc.official, false);
    assert.equal(enc.live, true);
    assert.equal(enc.source, "noaa-enc-catalog");
    assert.ok(enc.cells?.some((c) => c.id === "US5PVDBB"));
    assert.equal(live.gfsWave.source, "nomads-gfswave");
    assert.equal(live.gfsWave.bytes, GRIB_MIN.byteLength);
    assert.match(live.gfsWave.sha256, /^[0-9a-f]{64}$/);
    const tide = live.tides.payload as { stations?: { observed?: { heightFt: number } }[] };
    assert.ok(tide.stations?.some((s) => s.observed && s.observed.heightFt === 3.7));
  });

  it("omits ENC and GFS-Wave on network fail", async () => {
    const live = await tryLiveNoaa({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      fetchImpl: async () => {
        throw new Error("blocked");
      },
      skipCache: true,
    });
    assert.equal(live.enc, undefined);
    assert.equal(live.gfsWave, undefined);
    assert.ok(live.errors.some((e) => e.includes("enc")));
    assert.ok(live.errors.some((e) => e.includes("gfs-wave")));
  });
});

describe("buildTripPack ENC + GFS-Wave honesty", () => {
  it("marks ENC source noaa and leaves wind/waves as fixture", async () => {
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const live = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      fetchImpl: liveFetch,
      timeoutMs: 1000,
    });
    const enc = live.manifest.layers.find((l) => l.id === "enc")!;
    assert.equal(enc.source, "noaa");
    assert.notEqual(enc.hash, fixture.manifest.layers.find((l) => l.id === "enc")!.hash);
    assert.equal(await sha256Hex(live.bodies.enc!), enc.hash);
    const parsed = parseLayerBody(live.bodies.enc!) as { payload?: { official?: boolean } };
    assert.equal(parsed.payload?.official, false);
    assert.equal(
      live.manifest.layers.find((l) => l.id === "waves")!.hash,
      fixture.manifest.layers.find((l) => l.id === "waves")!.hash,
    );
    assert.equal(live.manifest.layers.find((l) => l.id === "wind")!.source, "fixture");
    assert.ok(live.manifest.sources.some((s) => s.id === "nomads-gfswave"));
    assert.equal(live.manifest.readyForOffshore, true);
  });
});

describe("gfsWaveFilterUrl", () => {
  it("points at NOMADS atlocn subset", () => {
    const url = gfsWaveFilterUrl("20260820", "12", 0, POINT_JUDITH_CANYON_BBOX);
    assert.match(url, /filter_gfswave\.pl/);
    assert.match(url, /atlocn\.0p16\.f000/);
    assert.match(url, /var_HTSGW=on/);
    assert.match(url, /leftlon=-72\.8/);
  });
});

function sstCsvAt(iso: string, unit = "degree_C", kelvin = false): string {
  const rows = [`time,latitude,longitude,analysed_sst`, `UTC,degrees_north,degrees_east,${unit}`];
  const lats = [39.4, 40.0, 40.6, 41.2];
  const lons = [-72.8, -71.6, -70.4, -69.2];
  for (const lat of lats) {
    for (const lon of lons) {
      let v = 22.4 - (lat - 39.6) * 0.8 + (lon + 70.6) * 0.1;
      if (kelvin) v += 273.15;
      rows.push(`${iso},${lat},${lon},${v.toFixed(2)}`);
    }
  }
  return rows.join("\n") + "\n";
}

describe("ERDDAP SST parse", () => {
  it("builds a north-up degC grid and does not claim 1 km MUR", () => {
    const table = parseErddapSstCsv(sampleCsvForTests());
    assert.ok(table);
    const ep = SST_ENDPOINTS[0]!;
    const grid = sstTableToPacked(table!, ep, POINT_JUDITH_CANYON_BBOX);
    assert.ok(grid);
    assert.equal(grid.layer, "sst");
    assert.equal(grid.source, "noaa");
    assert.equal(grid.live, true);
    assert.equal(grid.hoursCovered, 24);
    assert.equal(grid.unit, "degC");
    assert.equal(grid.nx, 4);
    assert.equal(grid.ny, 4);
    assert.equal(grid.updatedAt, "2026-08-18T12:00:00.000Z");
    assert.match(grid.note ?? "", /5 km|0\.05/);
    assert.match(grid.note ?? "", /not 1 km MUR/);
    assert.ok((grid.values[0]![0] ?? 0) > 15 && (grid.values[0]![0] ?? 0) < 30);
  });

  it("converts Kelvin units to degC", () => {
    const table = parseErddapSstCsv(sstCsvAt("2026-08-19T12:00:00Z", "degree_K", true));
    assert.ok(table);
    const grid = sstTableToPacked(table!, SST_ENDPOINTS[0]!, POINT_JUDITH_CANYON_BBOX);
    assert.ok(grid);
    const v = grid.values[0]![0]!;
    assert.ok(v > 15 && v < 30, `expected degC, got ${v}`);
  });

  it("rejects HTML error pages", () => {
    assert.equal(parseErddapSstCsv("<html>nope</html>"), null);
  });

  it("builds the CoralTemp ERDDAP CSV URL", () => {
    const url = erddapSstCsvUrl(SST_ENDPOINTS[0]!, POINT_JUDITH_CANYON_BBOX);
    assert.match(url, /noaacrwsstDaily\.csv/);
    assert.match(url, /analysed_sst/);
    assert.match(url, /39\.4/);
    assert.match(url, /-72\.8/);
  });
});

describe("tryLiveNoaa SST overlay", () => {
  it("paints sst source noaa when CoralTemp CSV parses", async () => {
    const csv = sstCsvAt(START);
    const fetchImpl = async (url: string) => {
      if (url.includes("noaacrwsstDaily") || url.includes("analysed_sst")) {
        return new Response(csv, { status: 200, headers: { "Content-Type": "text/csv" } });
      }
      return new Response("no", { status: 404 });
    };
    const live = await tryLiveNoaa({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      fetchImpl,
      skipCache: true,
    });
    assert.ok(live.sst);
    assert.equal(live.sst.source, "noaa");
    assert.equal(live.sst.dataset, "noaacrwsstDaily");
    assert.equal(live.sst.grid.source, "noaa");
    assert.match(live.sst.note, /5 km|0\.05/);
    assert.doesNotMatch(live.sst.note, /native 1 km/);
  });

  it("omits sst on network or parse fail", async () => {
    const live = await tryLiveNoaa({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      fetchImpl: async () => {
        throw new Error("blocked");
      },
      skipCache: true,
    });
    assert.equal(live.sst, undefined);
    assert.ok(live.errors.some((e) => e.includes("sst")));
  });
});

describe("buildTripPack SST overlay", () => {
  it("hashes live SST and marks source noaa", async () => {
    const csv = sstCsvAt(START);
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const live = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      timeoutMs: 1000,
      fetchImpl: async (url: string) => {
        if (url.includes("noaacrwsstDaily") || url.includes("analysed_sst")) {
          return new Response(csv, { status: 200 });
        }
        return new Response("no", { status: 404 });
      },
    });
    const sst = live.manifest.layers.find((l) => l.id === "sst")!;
    assert.equal(sst.source, "noaa");
    assert.notEqual(sst.hash, fixture.manifest.layers.find((l) => l.id === "sst")!.hash);
    assert.equal(await sha256Hex(live.bodies.sst!), sst.hash);
    assert.equal(sst.updatedAt, START);
    assert.equal(sst.hours, 24);
    const body = parseLayerBody(live.bodies.sst!) as {
      source?: string;
      note?: string;
      live?: boolean;
    };
    assert.equal(body.source, "noaa");
    assert.match(body.note ?? "", /not 1 km MUR/);
    assert.ok(live.manifest.sources.some((s) => s.id === "noaa-sst"));
    assert.equal(live.manifest.readyForOffshore, true);
  });

  it("keeps fixture SST when the probe fails", async () => {
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const live = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    assert.equal(
      live.manifest.layers.find((l) => l.id === "sst")!.hash,
      fixture.manifest.layers.find((l) => l.id === "sst")!.hash,
    );
    assert.equal(live.manifest.layers.find((l) => l.id === "sst")!.source, "fixture");
  });

  it("stale live SST fails Ready-for-offshore without override", async () => {
    const csv = sstCsvAt("2026-08-17T12:00:00.000Z");
    const live = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      timeoutMs: 1000,
      fetchImpl: async (url: string) => {
        if (url.includes("analysed_sst") || url.includes("noaacrwsstDaily")) {
          return new Response(csv, { status: 200 });
        }
        return new Response("no", { status: 404 });
      },
    });
    const sst = live.manifest.layers.find((l) => l.id === "sst")!;
    assert.equal(sst.source, "noaa");
    assert.equal(sst.updatedAt, "2026-08-17T12:00:00.000Z");
    assert.equal(live.manifest.readyForOffshore, false);
  });
});

describe("optional live SST probe", () => {
  it("skips when every public path is blocked", async (t) => {
    const errors: string[] = [];
    let sst;
    try {
      sst = await fetchLiveSst({
        bbox: POINT_JUDITH_CANYON_BBOX,
        fetchImpl: globalThis.fetch,
        timeoutMs: 8000,
        errors,
      });
    } catch {
      t.skip("live SST fetch threw");
      return;
    }
    if (!sst) {
      t.skip(errors.join("; ") || "live SST blocked");
      return;
    }
    assert.equal(sst.source, "noaa");
    assert.ok(sst.grid.nx >= 2 && sst.grid.ny >= 2);
    assert.equal(sst.grid.unit, "degC");
    if (sst.dataset === "noaacrwsstDaily") {
      assert.ok(Math.abs(sst.effectiveDeg - 0.05) < 1e-6);
      assert.match(sst.note, /5 km|0\.05/);
      assert.match(sst.note, /not 1 km MUR/);
    } else {
      assert.match(sst.note, /subsampled|km|°/);
    }
  });
});

function chlCsvAt(iso: string): string {
  const rows = [
    `time,altitude,latitude,longitude,chlor_a`,
    `UTC,m,degrees_north,degrees_east,mg m^-3`,
  ];
  const lats = [39.4, 40.0, 40.6, 41.2];
  const lons = [-72.8, -71.6, -70.4, -69.2];
  for (const lat of lats) {
    for (const lon of lons) {
      const v = 0.18 + (41.2 - lat) * 0.35 + Math.max(0, -70.4 - lon) * 0.08;
      rows.push(`${iso},0.0,${lat},${lon},${v.toFixed(3)}`);
    }
  }
  return rows.join("\n") + "\n";
}

describe("ERDDAP chlorophyll parse", () => {
  it("builds a north-up mg_m3 grid and does not claim 1 km VIIRS", () => {
    const table = parseErddapChlCsv(sampleChlCsvForTests());
    assert.ok(table);
    const ep = CHL_ENDPOINTS[0]!;
    const grid = chlTableToPacked(table!, ep, POINT_JUDITH_CANYON_BBOX);
    assert.ok(grid);
    assert.equal(grid.layer, "chlorophyll");
    assert.equal(grid.source, "noaa");
    assert.equal(grid.live, true);
    assert.equal(grid.hoursCovered, 24);
    assert.equal(grid.unit, "mg_m3");
    assert.equal(grid.nx, 4);
    assert.equal(grid.ny, 4);
    assert.equal(grid.updatedAt, "2026-07-09T12:00:00.000Z");
    assert.match(grid.note ?? "", /4 km|0\.0375/);
    assert.match(grid.note ?? "", /not 1 km VIIRS/);
    assert.match(grid.note ?? "", /not CMEMS/);
    assert.ok((grid.values[0]![0] ?? 0) > 0 && (grid.values[0]![0] ?? 0) < 10);
  });

  it("rejects HTML error pages", () => {
    assert.equal(parseErddapChlCsv("<html>nope</html>"), null);
  });

  it("builds the S-NPP VIIRS ERDDAP CSV URL with altitude", () => {
    const url = erddapChlCsvUrl(CHL_ENDPOINTS[0]!, POINT_JUDITH_CANYON_BBOX);
    assert.match(url, /noaacwNPPVIIRSchlaDaily\.csv/);
    assert.match(url, /chlor_a/);
    assert.match(url, /39\.4/);
    assert.match(url, /-72\.8/);
    assert.match(url, /\[\(0\.0\)\]/);
  });
});

describe("tryLiveNoaa chlorophyll overlay", () => {
  it("paints chlorophyll source noaa when VIIRS CSV parses", async () => {
    const csv = chlCsvAt("2026-07-09T12:00:00Z");
    const fetchImpl = async (url: string) => {
      if (url.includes("chlor_a") || url.includes("VIIRSchla")) {
        return new Response(csv, { status: 200, headers: { "Content-Type": "text/csv" } });
      }
      return new Response("no", { status: 404 });
    };
    const live = await tryLiveNoaa({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      fetchImpl,
      skipCache: true,
    });
    assert.ok(live.chlorophyll);
    assert.equal(live.chlorophyll.source, "noaa");
    assert.equal(live.chlorophyll.dataset, "noaacwNPPVIIRSchlaDaily");
    assert.equal(live.chlorophyll.grid.source, "noaa");
    assert.match(live.chlorophyll.note, /4 km|0\.0375/);
    assert.doesNotMatch(live.chlorophyll.note, /1 km VIIRS L4|CMEMS L4 gap/);
  });

  it("omits chlorophyll on network or parse fail", async () => {
    const live = await tryLiveNoaa({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      fetchImpl: async () => {
        throw new Error("blocked");
      },
      skipCache: true,
    });
    assert.equal(live.chlorophyll, undefined);
    assert.ok(live.errors.some((e) => e.includes("chl")));
  });
});

describe("buildTripPack chlorophyll overlay", () => {
  it("hashes live chlorophyll and marks source noaa without blocking Ready", async () => {
    const csv = chlCsvAt("2026-07-09T12:00:00.000Z");
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const live = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      timeoutMs: 1000,
      fetchImpl: async (url: string) => {
        if (url.includes("chlor_a") || url.includes("VIIRSchla")) {
          return new Response(csv, { status: 200 });
        }
        return new Response("no", { status: 404 });
      },
    });
    const chl = live.manifest.layers.find((l) => l.id === "chlorophyll")!;
    assert.equal(chl.source, "noaa");
    assert.notEqual(chl.hash, fixture.manifest.layers.find((l) => l.id === "chlorophyll")!.hash);
    assert.equal(await sha256Hex(live.bodies.chlorophyll!), chl.hash);
    assert.equal(chl.updatedAt, "2026-07-09T12:00:00.000Z");
    assert.equal(chl.hours, 24);
    const body = parseLayerBody(live.bodies.chlorophyll!) as {
      source?: string;
      note?: string;
      live?: boolean;
    };
    assert.equal(body.source, "noaa");
    assert.match(body.note ?? "", /not 1 km VIIRS/);
    assert.ok(live.manifest.sources.some((s) => s.id === "noaa-chl"));
    assert.equal(live.manifest.readyForOffshore, true);
  });

  it("keeps fixture chlorophyll when the probe fails", async () => {
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const live = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    assert.equal(
      live.manifest.layers.find((l) => l.id === "chlorophyll")!.hash,
      fixture.manifest.layers.find((l) => l.id === "chlorophyll")!.hash,
    );
    assert.equal(live.manifest.layers.find((l) => l.id === "chlorophyll")!.source, "fixture");
  });
});

describe("optional live chlorophyll probe", () => {
  it("skips when every public path is blocked", async (t) => {
    const errors: string[] = [];
    let chl;
    try {
      chl = await fetchLiveChl({
        bbox: POINT_JUDITH_CANYON_BBOX,
        fetchImpl: globalThis.fetch,
        timeoutMs: 8000,
        errors,
      });
    } catch {
      t.skip("live chlorophyll fetch threw");
      return;
    }
    if (!chl) {
      t.skip(errors.join("; ") || "live chlorophyll blocked");
      return;
    }
    assert.equal(chl.source, "noaa");
    assert.ok(chl.grid.nx >= 2 && chl.grid.ny >= 2);
    assert.equal(chl.grid.unit, "mg_m3");
    assert.match(chl.note, /4 km|0\.0375|km|°/);
    assert.match(chl.note, /not 1 km VIIRS/);
    if (chl.dataset === "noaacwNPPVIIRSchlaDaily") {
      assert.ok(Math.abs(chl.effectiveDeg - 0.0375) < 1e-6);
    }
  });
});

function sshCsvAt(iso: string, unit = "m"): string {
  const rows = [`time,latitude,longitude,sla`, `UTC,degrees_north,degrees_east,${unit}`];
  const lats = [39.375, 40.125, 40.625, 41.375];
  const lons = [-72.875, -71.625, -70.375, -69.125];
  for (const lat of lats) {
    for (const lon of lons) {
      let v = 0.06 + (40.6 - lat) * 0.08 + Math.max(0, -70.4 - lon) * 0.04;
      if (unit === "cm") v *= 100;
      rows.push(`${iso},${lat},${lon},${v.toFixed(4)}`);
    }
  }
  return rows.join("\n") + "\n";
}

describe("ERDDAP SSH parse", () => {
  it("builds a north-up cm grid and does not claim CMEMS or AVISO", () => {
    const table = parseErddapSshCsv(sampleSshCsvForTests());
    assert.ok(table);
    const ep = SSH_ENDPOINTS[0]!;
    const grid = sshTableToPacked(table!, ep, POINT_JUDITH_CANYON_BBOX);
    assert.ok(grid);
    assert.equal(grid.layer, "altimetry");
    assert.equal(grid.source, "noaa");
    assert.equal(grid.live, true);
    assert.equal(grid.hoursCovered, 24);
    assert.equal(grid.unit, "cm");
    assert.equal(grid.nx, 4);
    assert.equal(grid.ny, 4);
    assert.equal(grid.updatedAt, "2026-08-19T00:00:00.000Z");
    assert.match(grid.note ?? "", /0\.25/);
    assert.match(grid.note ?? "", /not CMEMS/);
    assert.match(grid.note ?? "", /not AVISO/);
    const v = grid.values[0]![0] ?? 0;
    assert.ok(v > 1 && v < 40, `expected cm, got ${v}`);
  });

  it("converts meter units to cm", () => {
    const table = parseErddapSshCsv(sshCsvAt("2026-08-19T00:00:00Z", "m"));
    assert.ok(table);
    const grid = sshTableToPacked(table!, SSH_ENDPOINTS[0]!, POINT_JUDITH_CANYON_BBOX);
    assert.ok(grid);
    const v = grid.values[0]![0]!;
    assert.ok(v > 1 && v < 40, `expected cm, got ${v}`);
  });

  it("rejects HTML error pages", () => {
    assert.equal(parseErddapSshCsv("<html>nope</html>"), null);
  });

  it("builds the CoastWatch blended SLA ERDDAP CSV URL", () => {
    const url = erddapSshCsvUrl(SSH_ENDPOINTS[0]!, POINT_JUDITH_CANYON_BBOX);
    assert.match(url, /noaacwBLENDEDsshDaily\.csv/);
    assert.match(url, /sla/);
    assert.match(url, /39\.4/);
    assert.match(url, /-72\.8/);
  });
});

describe("tryLiveNoaa SSH overlay", () => {
  it("paints altimetry source noaa when blended SLA CSV parses", async () => {
    const csv = sshCsvAt("2026-08-19T00:00:00Z");
    const fetchImpl = async (url: string) => {
      if (url.includes("sla") || url.includes("BLENDEDssh") || url.includes("nesdisSSH")) {
        return new Response(csv, { status: 200, headers: { "Content-Type": "text/csv" } });
      }
      return new Response("no", { status: 404 });
    };
    const live = await tryLiveNoaa({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      fetchImpl,
      skipCache: true,
    });
    assert.ok(live.altimetry);
    assert.equal(live.altimetry.source, "noaa");
    assert.equal(live.altimetry.dataset, "noaacwBLENDEDsshDaily");
    assert.equal(live.altimetry.grid.source, "noaa");
    assert.match(live.altimetry.note, /0\.25/);
    assert.doesNotMatch(live.altimetry.note, /CMEMS L4 gap|AVISO DUACS L4/);
  });

  it("omits altimetry on network or parse fail", async () => {
    const live = await tryLiveNoaa({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      fetchImpl: async () => {
        throw new Error("blocked");
      },
      skipCache: true,
    });
    assert.equal(live.altimetry, undefined);
    assert.ok(live.errors.some((e) => e.includes("ssh")));
  });
});

describe("buildTripPack SSH overlay", () => {
  it("hashes live altimetry and marks source noaa without blocking Ready", async () => {
    const csv = sshCsvAt("2026-08-19T00:00:00.000Z");
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const live = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      timeoutMs: 1000,
      fetchImpl: async (url: string) => {
        if (url.includes("sla") || url.includes("BLENDEDssh") || url.includes("nesdisSSH")) {
          return new Response(csv, { status: 200 });
        }
        return new Response("no", { status: 404 });
      },
    });
    const ssh = live.manifest.layers.find((l) => l.id === "altimetry")!;
    assert.equal(ssh.source, "noaa");
    assert.notEqual(ssh.hash, fixture.manifest.layers.find((l) => l.id === "altimetry")!.hash);
    assert.equal(await sha256Hex(live.bodies.altimetry!), ssh.hash);
    assert.equal(ssh.updatedAt, "2026-08-19T00:00:00.000Z");
    assert.equal(ssh.hours, 24);
    const body = parseLayerBody(live.bodies.altimetry!) as {
      source?: string;
      note?: string;
      live?: boolean;
    };
    assert.equal(body.source, "noaa");
    assert.match(body.note ?? "", /not CMEMS/);
    assert.ok(live.manifest.sources.some((s) => s.id === "noaa-ssh"));
    assert.equal(live.manifest.readyForOffshore, true);
  });

  it("keeps fixture altimetry when the probe fails", async () => {
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const live = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    assert.equal(
      live.manifest.layers.find((l) => l.id === "altimetry")!.hash,
      fixture.manifest.layers.find((l) => l.id === "altimetry")!.hash,
    );
    assert.equal(live.manifest.layers.find((l) => l.id === "altimetry")!.source, "fixture");
  });
});

describe("optional live SSH probe", () => {
  it("skips when every public path is blocked", async (t) => {
    const errors: string[] = [];
    let ssh;
    try {
      ssh = await fetchLiveSsh({
        bbox: POINT_JUDITH_CANYON_BBOX,
        fetchImpl: globalThis.fetch,
        timeoutMs: 8000,
        errors,
      });
    } catch {
      t.skip("live SSH fetch threw");
      return;
    }
    if (!ssh) {
      t.skip(errors.join("; ") || "live SSH blocked");
      return;
    }
    assert.equal(ssh.source, "noaa");
    assert.ok(ssh.grid.nx >= 2 && ssh.grid.ny >= 2);
    assert.equal(ssh.grid.unit, "cm");
    assert.match(ssh.note, /0\.25|km|°/);
    assert.match(ssh.note, /not CMEMS/);
    if (ssh.dataset === "noaacwBLENDEDsshDaily") {
      assert.ok(Math.abs(ssh.effectiveDeg - 0.25) < 1e-6);
    }
  });
});

describe("HMS KML / KMZ parse", () => {
  it("reads the Northeastern US closed-area rectangle", () => {
    const feats = parseKmlPolygons(sampleHmsKmlForTests());
    assert.equal(feats.length, 1);
    assert.equal((feats[0]!.properties as { name?: string }).name, "Northeastern US closed area");
    assert.equal((feats[0]!.properties as { legal?: boolean }).legal, false);
    assert.equal(feats[0]!.geometry.type, "Polygon");
    const ring = (feats[0]!.geometry as GeoJSON.Polygon).coordinates[0]!;
    assert.ok(ring.length >= 4);
    assert.ok(clipHmsFeatures(feats, POINT_JUDITH_CANYON_BBOX).length === 1);
  });

  it("rejects HTML and drops features outside the box", () => {
    assert.equal(parseKmlPolygons("<html>nope</html>").length, 0);
    const feats = parseKmlPolygons(sampleHmsKmlForTests());
    const south = { west: -80, south: 25, east: -79, north: 26 };
    assert.equal(clipHmsFeatures(feats, south).length, 0);
  });

  it("unzips a store-method KMZ", async () => {
    const kmz = sampleHmsKmzForTests();
    const { featuresFromZip } = await import("../src/lib/ahanu/noaa-hms.ts");
    const feats = await featuresFromZip(kmz);
    assert.equal(feats.length, 1);
  });
});

describe("tryLiveNoaa HMS overlay", () => {
  it("paints hms_zones source noaa when the NE KMZ parses", async () => {
    const kmz = sampleHmsKmzForTests();
    const fetchImpl = async (url: string) => {
      if (url.includes("pelagicll_ne") || url.includes("HMS-A15")) {
        return new Response(kmz, { status: 200, headers: { "Content-Type": "application/vnd.google-earth.kmz" } });
      }
      return new Response("no", { status: 404 });
    };
    const live = await tryLiveNoaa({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      fetchImpl,
      skipCache: true,
    });
    assert.ok(live.hms);
    assert.equal(live.hms.source, "noaa");
    assert.equal(live.hms.dataset, "pelagicll-ne-kmz");
    assert.ok(live.hms.featureCount >= 1);
    assert.match(live.hms.note, /not a legal determination/i);
    const payload = live.hms.body.payload as { source?: string; legal?: boolean; features?: unknown[] };
    assert.equal(payload.source, "noaa");
    assert.equal(payload.legal, false);
    assert.ok((payload.features?.length ?? 0) >= 1);
  });

  it("omits HMS on network or parse fail", async () => {
    const live = await tryLiveNoaa({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      fetchImpl: async () => {
        throw new Error("blocked");
      },
      skipCache: true,
    });
    assert.equal(live.hms, undefined);
    assert.ok(live.errors.some((e) => e.includes("hms")));
  });
});

describe("buildTripPack HMS overlay", () => {
  it("hashes live HMS and marks source noaa without claiming legal status", async () => {
    const kmz = sampleHmsKmzForTests();
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const live = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      timeoutMs: 1000,
      fetchImpl: async (url: string) => {
        if (url.includes("pelagicll_ne") || url.includes("HMS-A15")) {
          return new Response(kmz, { status: 200 });
        }
        return new Response("no", { status: 404 });
      },
    });
    const hms = live.manifest.layers.find((l) => l.id === "hms_zones")!;
    assert.equal(hms.source, "noaa");
    assert.notEqual(hms.hash, fixture.manifest.layers.find((l) => l.id === "hms_zones")!.hash);
    assert.equal(await sha256Hex(live.bodies.hms_zones!), hms.hash);
    const body = parseLayerBody(live.bodies.hms_zones!) as {
      payload?: { source?: string; legal?: boolean; note?: string; features?: unknown[] };
    };
    assert.equal(body.payload?.source, "noaa");
    assert.equal(body.payload?.legal, false);
    assert.match(body.payload?.note ?? "", /not a legal determination/i);
    assert.ok(live.manifest.sources.some((s) => s.id === "noaa-hms"));
    assert.equal(live.manifest.readyForOffshore, true);
    assert.ok(hmsToPackedJson([], HMS_REMINDER_NOTE));
    assert.equal(HMS_ENDPOINTS[0]!.kind, "kmz");
  });

  it("keeps fixture HMS when the probe fails", async () => {
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const live = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    assert.equal(
      live.manifest.layers.find((l) => l.id === "hms_zones")!.hash,
      fixture.manifest.layers.find((l) => l.id === "hms_zones")!.hash,
    );
    assert.equal(live.manifest.layers.find((l) => l.id === "hms_zones")!.source, "fixture");
  });
});

describe("optional live HMS probe", () => {
  it("skips when every public path is blocked", async (t) => {
    const errors: string[] = [];
    let hms;
    try {
      hms = await fetchLiveHms({
        bbox: POINT_JUDITH_CANYON_BBOX,
        fetchImpl: globalThis.fetch,
        timeoutMs: 8000,
        errors,
      });
    } catch {
      t.skip("live HMS fetch threw");
      return;
    }
    if (!hms) {
      t.skip(errors.join("; ") || "live HMS blocked");
      return;
    }
    assert.equal(hms.source, "noaa");
    assert.ok(hms.featureCount >= 1);
    assert.match(hms.note, /not a legal determination/i);
    const payload = hms.body.payload as { legal?: boolean; features?: { properties?: { legal?: boolean } }[] };
    assert.equal(payload.legal, false);
    assert.ok(payload.features?.every((f) => f.properties?.legal === false));
  });
});

function bathyCsvAt(): string {
  return sampleBathyCsvForTests();
}

describe("ERDDAP bathymetry parse", () => {
  it("builds a north-up depth-m grid and does not claim official ENC", () => {
    const table = parseErddapBathyCsv(sampleBathyCsvForTests());
    assert.ok(table);
    const ep = BATHY_ENDPOINTS[0]!;
    const grid = bathyTableToPacked(table!, ep, POINT_JUDITH_CANYON_BBOX);
    assert.ok(grid);
    assert.equal(grid.layer, "bathymetry");
    assert.equal(grid.source, "noaa");
    assert.equal(grid.live, true);
    assert.equal(grid.unit, "m");
    assert.equal(grid.hoursCovered, 0);
    assert.equal(grid.nx, 4);
    assert.equal(grid.ny, 4);
    assert.match(grid.note ?? "", /0\.033|stride 8|15 arc-second/);
    assert.match(grid.note ?? "", /not official ENC|not a substitute/i);
    const plane = grid.values[0]!;
    const hi = Math.max(...plane);
    const lo = Math.min(...plane);
    assert.ok(hi > 180, `expected canyon/slope depth, got max ${hi}`);
    assert.ok(lo < 80, `expected shelf or land, got min ${lo}`);
    const contours = contoursFromDepthGrid(grid);
    assert.ok(contours);
    const fc = contours.payload as GeoJSON.FeatureCollection;
    assert.ok(fc.features.length >= 1);
    assert.ok(fc.features.some((f) => (f.properties as { depthM?: number })?.depthM === 183));
  });

  it("rejects HTML error pages", () => {
    assert.equal(parseErddapBathyCsv("<html>nope</html>"), null);
  });

  it("builds the ETOPO 2022 ERDDAP CSV URL", () => {
    const url = erddapBathyCsvUrl(BATHY_ENDPOINTS[0]!, POINT_JUDITH_CANYON_BBOX);
    assert.match(url, /ETOPO_2022_v1_15s\.csv/);
    assert.match(url, /\?z\[/);
    assert.match(url, /39\.4/);
    assert.match(url, /-72\.8/);
    assert.match(url, /:8:/);
  });
});

describe("tryLiveNoaa bathymetry overlay", () => {
  it("paints bathymetry source noaa when ETOPO CSV parses", async () => {
    const csv = bathyCsvAt();
    const fetchImpl = async (url: string) => {
      if (url.includes("ETOPO_2022") || url.includes("GEBCO_2020") || url.includes("etopo180")) {
        return new Response(csv, { status: 200, headers: { "Content-Type": "text/csv" } });
      }
      return new Response("no", { status: 404 });
    };
    const live = await tryLiveNoaa({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      fetchImpl,
      skipCache: true,
    });
    assert.ok(live.bathymetry);
    assert.equal(live.bathymetry.source, "noaa");
    assert.equal(live.bathymetry.dataset, "ETOPO_2022_v1_15s");
    assert.equal(live.bathymetry.grid.source, "noaa");
    assert.equal(live.bathymetry.grid.unit, "m");
    assert.match(live.bathymetry.note, /not official ENC/i);
    assert.ok(live.bathymetry.contours);
  });

  it("omits bathymetry on network or parse fail", async () => {
    const live = await tryLiveNoaa({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      fetchImpl: async () => {
        throw new Error("blocked");
      },
      skipCache: true,
    });
    assert.equal(live.bathymetry, undefined);
    assert.ok(live.errors.some((e) => e.includes("bathy")));
  });
});

describe("buildTripPack bathymetry overlay", () => {
  it("hashes live bathymetry and marks source noaa", async () => {
    const csv = bathyCsvAt();
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const live = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      timeoutMs: 1000,
      fetchImpl: async (url: string) => {
        if (url.includes("ETOPO_2022") || url.includes("GEBCO") || url.includes("etopo180")) {
          return new Response(csv, { status: 200 });
        }
        return new Response("no", { status: 404 });
      },
    });
    const bathy = live.manifest.layers.find((l) => l.id === "bathymetry")!;
    assert.equal(bathy.source, "noaa");
    assert.notEqual(bathy.hash, fixture.manifest.layers.find((l) => l.id === "bathymetry")!.hash);
    assert.equal(await sha256Hex(live.bodies.bathymetry!), bathy.hash);
    const body = parseLayerBody(live.bodies.bathymetry!) as {
      source?: string;
      note?: string;
      live?: boolean;
      unit?: string;
    };
    assert.equal(body.source, "noaa");
    assert.equal(body.unit, "m");
    assert.match(body.note ?? "", /not official ENC/i);
    assert.ok(live.manifest.sources.some((s) => s.id === "noaa-bathy"));
    const contours = live.manifest.layers.find((l) => l.id === "contours")!;
    assert.equal(contours.source, "noaa");
    assert.notEqual(contours.hash, fixture.manifest.layers.find((l) => l.id === "contours")!.hash);
    assert.equal(live.manifest.readyForOffshore, true);
  });

  it("keeps fixture bathymetry when the probe fails", async () => {
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const live = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    assert.equal(
      live.manifest.layers.find((l) => l.id === "bathymetry")!.hash,
      fixture.manifest.layers.find((l) => l.id === "bathymetry")!.hash,
    );
    assert.equal(live.manifest.layers.find((l) => l.id === "bathymetry")!.source, "fixture");
    assert.equal(live.manifest.layers.find((l) => l.id === "contours")!.source, "fixture");
  });
});

describe("optional live bathymetry probe", () => {
  it("skips when every public path is blocked", async (t) => {
    const errors: string[] = [];
    let bathy;
    try {
      bathy = await fetchLiveBathy({
        bbox: POINT_JUDITH_CANYON_BBOX,
        fetchImpl: globalThis.fetch,
        timeoutMs: 8000,
        errors,
      });
    } catch {
      t.skip("live bathymetry fetch threw");
      return;
    }
    if (!bathy) {
      t.skip(errors.join("; ") || "live bathymetry blocked");
      return;
    }
    assert.equal(bathy.source, "noaa");
    assert.ok(bathy.grid.nx >= 2 && bathy.grid.ny >= 2);
    assert.equal(bathy.grid.unit, "m");
    assert.match(bathy.note, /not official ENC/i);
    const plane = bathy.grid.values[0]!;
    assert.ok(Math.max(...plane) > 180);
    if (bathy.dataset === "ETOPO_2022_v1_15s") {
      assert.ok(Math.abs(bathy.effectiveDeg - 0.004166666666666667 * 8) < 1e-6);
    }
  });
});


function abortErr(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

describe("NOAA fetch timeout + retry", () => {
  it("uses an 18 s ERDDAP grid timeout", () => {
    assert.equal(NOAA_GRID_TIMEOUT_MS, 18_000);
    assert.ok(NOAA_RETRY_BACKOFF_MS >= 1000 && NOAA_RETRY_BACKOFF_MS <= 2000);
  });

  it("retries once after a timeout and then succeeds", async () => {
    let n = 0;
    const slept: number[] = [];
    const bytes = await fetchNoaaBytes({
      url: "https://coastwatch.test/grid.csv",
      timeoutMs: 20,
      maxBytes: 64,
      sleep: async (ms) => {
        slept.push(ms);
      },
      fetchImpl: async (_url, init) => {
        n += 1;
        if (n === 1) {
          await new Promise<never>((_, reject) => {
            const sig = init?.signal;
            if (!sig) {
              reject(new Error("missing abort signal"));
              return;
            }
            const fail = () => reject(abortErr());
            if (sig.aborted) {
              fail();
              return;
            }
            sig.addEventListener("abort", fail, { once: true });
          });
        }
        return new Response("ok-grid", { status: 200 });
      },
    });
    assert.equal(n, 2);
    assert.deepEqual(slept, [NOAA_RETRY_BACKOFF_MS]);
    assert.equal(new TextDecoder().decode(bytes!), "ok-grid");
  });

  it("retries 429 and 503 then succeeds", async () => {
    let n = 0;
    const text = await fetchNoaaText({
      url: "https://coastwatch.test/grid.csv",
      timeoutMs: 50,
      maxBytes: 64,
      sleep: async () => {},
      fetchImpl: async () => {
        n += 1;
        if (n === 1) return new Response("slow", { status: 429 });
        return new Response("csv-ok", { status: 200 });
      },
    });
    assert.equal(n, 2);
    assert.equal(text, "csv-ok");
  });

  it("does not retry 404", async () => {
    let n = 0;
    const bytes = await fetchNoaaBytes({
      url: "https://coastwatch.test/missing.csv",
      timeoutMs: 50,
      maxBytes: 64,
      sleep: async () => {
        throw new Error("404 must not sleep");
      },
      fetchImpl: async () => {
        n += 1;
        return new Response("no", { status: 404 });
      },
    });
    assert.equal(n, 1);
    assert.equal(bytes, null);
  });

  it("returns null after two 5xx failures", async () => {
    let n = 0;
    const bytes = await fetchNoaaBytes({
      url: "https://coastwatch.test/down.csv",
      timeoutMs: 50,
      maxBytes: 64,
      sleep: async () => {},
      fetchImpl: async () => {
        n += 1;
        return new Response("no", { status: 503 });
      },
    });
    assert.equal(n, 2);
    assert.equal(bytes, null);
  });

  it("paints live SST after a timeout then a good CSV", async () => {
    const csv = sampleCsvForTests();
    let n = 0;
    const sst = await fetchLiveSst({
      bbox: POINT_JUDITH_CANYON_BBOX,
      endpoints: [SST_ENDPOINTS[0]!],
      sleep: async () => {},
      fetchImpl: async () => {
        n += 1;
        if (n === 1) throw abortErr();
        return new Response(csv, { status: 200 });
      },
    });
    assert.equal(n, 2);
    assert.ok(sst);
    assert.equal(sst!.source, "noaa");
  });

  it("does not retry a 404 SST path", async () => {
    let n = 0;
    const sst = await fetchLiveSst({
      bbox: POINT_JUDITH_CANYON_BBOX,
      endpoints: [SST_ENDPOINTS[0]!],
      sleep: async () => {
        throw new Error("404 must not sleep");
      },
      fetchImpl: async () => {
        n += 1;
        return new Response("no", { status: 404 });
      },
    });
    assert.equal(n, 1);
    assert.equal(sst, undefined);
  });

  it("keeps the SST fixture after two failures", async () => {
    let n = 0;
    const fixture = await buildFixturePack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
    });
    const live = await buildTripPack({
      bbox: POINT_JUDITH_CANYON_BBOX,
      start: START,
      hours: 72,
      createdAt: START,
      tryLive: true,
      sleep: async () => {},
      fetchImpl: async (url: string) => {
        if (
          url.includes("analysed_sst") ||
          url.includes("noaacrwsst") ||
          url.includes("MURSST") ||
          url.includes("GEOHIRR")
        ) {
          n += 1;
          if (n % 2 === 1) throw abortErr();
          return new Response("no", { status: 503 });
        }
        return new Response("no", { status: 404 });
      },
    });
    assert.ok(n >= 2);
    assert.equal(live.manifest.layers.find((l) => l.id === "sst")!.source, "fixture");
    assert.equal(
      live.manifest.layers.find((l) => l.id === "sst")!.hash,
      fixture.manifest.layers.find((l) => l.id === "sst")!.hash,
    );
  });
});
