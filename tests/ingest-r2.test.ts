import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const { ingestFixturePack, persistBuiltPack } = await import("../cloudflare/src/ingest/run.ts");
const { resetLiveNoaaCache } = await import("../src/lib/ahanu/noaa-live.ts");
const { POINT_JUDITH_CANYON_BBOX } = await import("../src/lib/ahanu/pack.ts");

afterEach(() => {
  resetLiveNoaaCache();
});

const START = "2026-08-20T18:00:00.000Z";
const NDBC = `#STN LAT LON YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES PTDY ATMP WTMP DEWP VIS TIDE
44097 40.967 -71.126 26 08 20 16 40 210 5.2 6.8 1.0 8 5.4 200 1016.5 +0.0 22.1 21.8 MM MM MM
`;

function ndbcOnlyFetch(url: string): Promise<Response> {
  if (url.includes("latest_obs")) return Promise.resolve(new Response(NDBC, { status: 200 }));
  return Promise.resolve(new Response("no", { status: 404 }));
}

describe("ingest R2 persist", () => {
  it("puts live NOAA bodies at manifest r2Key and keeps fixture hashes honest", async () => {
    const store = new Map<string, string>();
    const result = await ingestFixturePack(
      {
        PACKS: {
          put: async (key, value) => {
            store.set(key, typeof value === "string" ? value : new TextDecoder().decode(value));
          },
          get: async (key) => {
            const text = store.get(key);
            return text ? { text: async () => text } : null;
          },
        },
      },
      {
        bbox: POINT_JUDITH_CANYON_BBOX,
        start: START,
        hours: 72,
        fetchImpl: ndbcOnlyFetch,
        skipCache: true,
        timeoutMs: 50,
      },
    );
    assert.equal(result.source, "r2");
    assert.equal(result.wrote, 12);
    assert.ok(result.noaa >= 1, "expected at least buoys live");
    const buoys = result.layers.find((l) => l.id === "buoys");
    assert.ok(buoys);
    assert.equal(buoys.source, "noaa");
    assert.ok(store.has(buoys.r2Key));
    const body = store.get(buoys.r2Key) ?? "";
    assert.ok(body.includes("44097") || body.includes("ndbc") || body.includes("buoy"), body.slice(0, 120));
    const sst = result.layers.find((l) => l.id === "sst");
    assert.ok(sst);
    assert.equal(sst.source, "fixture");
    assert.ok(store.has(sst.r2Key), "fixture layer still written honestly");
    assert.notEqual(buoys.r2Key, sst.r2Key);
  });

  it("is a memory no-op when PACKS.put is missing", async () => {
    const result = await ingestFixturePack(
      {},
      {
        bbox: POINT_JUDITH_CANYON_BBOX,
        start: START,
        hours: 72,
        fetchImpl: ndbcOnlyFetch,
        skipCache: true,
        timeoutMs: 50,
      },
    );
    assert.equal(result.wrote, 0);
    assert.equal(result.source, "memory");
    assert.equal(result.d1, false);
    assert.equal(result.layers.length, 12);
  });

  it("skips D1 when pack_layers is unused", async () => {
    const store = new Map<string, string>();
    const result = await persistBuiltPack(
      {
        PACKS: {
          put: async (key, value) => {
            store.set(key, String(value));
          },
        },
        DB: {
          prepare: () => ({
            bind: () => ({
              run: async () => {
                throw new Error("no such table: pack_layers");
              },
            }),
          }),
        },
      },
      {
        manifest: {
          packId: "packtest",
          version: 1,
          bbox: POINT_JUDITH_CANYON_BBOX,
          start: START,
          hours: 72,
          generatedAt: START,
          readyForOffshore: false,
          layers: [
            {
              id: "buoys",
              label: "buoys",
              sizeMb: 0,
              sizeBytes: 2,
              status: "ready",
              updatedAt: START,
              hours: 3,
              hash: "ab",
              r2Key: "packs/packtest/buoys/ab.json",
              contentType: "application/json",
              format: "json",
              source: "noaa",
            },
          ],
          totalBytes: 2,
          totalMb: 0,
          r2Prefix: "packs/packtest",
          sources: [],
          notes: "",
          liveErrors: [],
          builder: { rev: "test" },
        },
        bodies: { buoys: "{}" },
      },
    );
    assert.equal(result.wrote, 1);
    assert.equal(result.d1, false);
    assert.equal(store.get("packs/packtest/buoys/ab.json"), "{}");
  });
});

