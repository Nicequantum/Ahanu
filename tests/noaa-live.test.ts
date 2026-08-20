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
  COOPS_HARBOR_STATIONS,
} = await import("../src/lib/ahanu/noaa-live.ts");
const { buildFixturePack, buildTripPack, sha256Hex, POINT_JUDITH_CANYON_BBOX } = await import(
  "../src/lib/ahanu/pack.ts"
);
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
    const buoyPayload = live.buoys.payload as { live?: boolean; source?: string; buoys?: { id: string }[] };
    assert.equal(buoyPayload.live, true);
    assert.equal(buoyPayload.source, "ndbc");
    assert.ok(buoyPayload.buoys?.some((b) => b.id === "44097"));
    const tidePayload = live.tides.payload as { stations?: { id: string; series: unknown[] }[] };
    assert.equal(tidePayload.stations?.length, COOPS_HARBOR_STATIONS.length);
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
    assert.equal(live.manifest.layers.find((l) => l.id === "enc")!.hash, fixture.manifest.layers.find((l) => l.id === "enc")!.hash);
  });
});

describe("ENC honesty", () => {
  it("fixture ENC is a cell list, not S-57 bytes", async () => {
    const { generateLayerBody } = await import("../src/lib/ahanu/pack-fixtures.ts");
    const body = generateLayerBody("enc", POINT_JUDITH_CANYON_BBOX, START, 72);
    assert.match(body, /not official S-57/);
    assert.doesNotMatch(body, /application\/zip/);
    const parsed = parseLayerBody(body) as { kind?: string; payload?: { fixture?: boolean; cells?: unknown[] } };
    assert.equal(parsed.kind, "enc-clip");
    assert.equal(parsed.payload?.fixture, true);
    assert.ok((parsed.payload?.cells?.length ?? 0) >= 3);
  });
});
