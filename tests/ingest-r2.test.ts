import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const { ingestFixturePack, persistBuiltPack, persistLayerObject, latestLayerR2Key, R2_SINGLE_PUT_MAX_BYTES } =
  await import("../cloudflare/src/ingest/run.ts");
const { layerBody } = await import("../cloudflare/src/layer-body.ts");
const { resetLiveNoaaCache } = await import("../src/lib/ahanu/noaa-live.ts");
const { resetBuiltPackCache } = await import("../src/lib/ahanu/pack.ts");
const { POINT_JUDITH_CANYON_BBOX } = await import("../src/lib/ahanu/pack.ts");

afterEach(() => {
  resetLiveNoaaCache();
  resetBuiltPackCache();
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
    assert.ok(store.has(`packs/${result.packId}/buoys`), "stable latest alias");
    assert.ok(store.has(`packs/${result.packId}/manifest.json`), "manifest write-through");
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
            store.set(key, typeof value === "string" ? value : new TextDecoder().decode(value));
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

  it("reports d1 true when pack_layers upserts", async () => {
    const rows: unknown[][] = [];
    const result = await persistBuiltPack(
      {
        PACKS: {
          put: async () => {},
        },
        DB: {
          prepare: (query: string) => ({
            bind: (...values: unknown[]) => ({
              run: async () => {
                if (!query.includes("INSERT INTO pack_layers")) {
                  throw new Error(`unexpected sql: ${query}`);
                }
                rows.push(values);
                return { success: true };
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
    assert.equal(result.d1, true);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], [
      "packtest",
      "buoys",
      "packs/packtest/buoys/ab.json",
      "ab",
      2,
      "noaa",
      START,
    ]);
  });

  it("writes a 3.4 MB official-sized ENC body to hash key and latest alias", async () => {
    const store = new Map<string, string>();
    const enc = '{"kind":"enc-clip","zip":"' + "A".repeat(3_400_000) + '"}';
    const result = await persistBuiltPack(
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
        manifest: {
          packId: "packenc",
          version: 1,
          bbox: POINT_JUDITH_CANYON_BBOX,
          start: START,
          hours: 72,
          generatedAt: START,
          readyForOffshore: false,
          layers: [
            {
              id: "enc",
              label: "enc",
              sizeMb: 3.4,
              sizeBytes: enc.length,
              status: "ready",
              updatedAt: START,
              hours: 0,
              hash: "enc-hash",
              r2Key: "packs/packenc/enc/enchash0001.json",
              contentType: "application/json",
              format: "enc-clip",
              source: "noaa",
            },
          ],
          totalBytes: enc.length,
          totalMb: 3.4,
          r2Prefix: "packs/packenc",
          sources: [],
          notes: "",
          liveErrors: [],
          builder: { rev: "test" },
        },
        bodies: { enc },
      },
    );
    assert.equal(result.wrote, 1);
    assert.deepEqual(result.failed, []);
    assert.ok(enc.length > 3_000_000);
    assert.ok(enc.length < R2_SINGLE_PUT_MAX_BYTES, "official ENC must fit one put");
    assert.equal(store.get("packs/packenc/enc/enchash0001.json")?.length, enc.length);
    assert.equal(store.get("packs/packenc/enc"), enc);
    assert.ok(![...store.keys()].some((k) => k.includes(".part/")), "must not split 3.4 MB ENC");
  });

  it("keeps writing remaining layers when one put throws", async () => {
    const store = new Map<string, string>();
    const result = await persistBuiltPack(
      {
        PACKS: {
          put: async (key, value) => {
            if (key.includes("/enc/")) throw new Error("enc too large");
            store.set(key, typeof value === "string" ? value : new TextDecoder().decode(value));
          },
        },
      },
      {
        manifest: {
          packId: "packfail",
          version: 1,
          bbox: POINT_JUDITH_CANYON_BBOX,
          start: START,
          hours: 72,
          generatedAt: START,
          readyForOffshore: false,
          layers: [
            {
              id: "enc",
              label: "enc",
              sizeMb: 0,
              sizeBytes: 4,
              status: "ready",
              updatedAt: START,
              hours: 0,
              hash: "e1",
              r2Key: "packs/packfail/enc/e1.json",
              contentType: "application/json",
              format: "enc-clip",
              source: "noaa",
            },
            {
              id: "sst",
              label: "sst",
              sizeMb: 0,
              sizeBytes: 2,
              status: "ready",
              updatedAt: START,
              hours: 24,
              hash: "s1",
              r2Key: "packs/packfail/sst/s1.json",
              contentType: "application/json",
              format: "grid",
              source: "noaa",
            },
          ],
          totalBytes: 6,
          totalMb: 0,
          r2Prefix: "packs/packfail",
          sources: [],
          notes: "",
          liveErrors: [],
          builder: { rev: "test" },
        },
        bodies: { enc: "ENC!", sst: "{}" },
      },
    );
    assert.equal(result.wrote, 1);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0]?.id, "enc");
    assert.equal(store.get("packs/packfail/sst/s1.json"), "{}");
    assert.equal(store.get(latestLayerR2Key("packfail", "sst")), "{}");
  });

  it("splits a body over the put cap and reconstructs it for objects GET", async () => {
    const store = new Map<string, string>();
    const env = {
      PACKS: {
        put: async (key: string, value: string | ArrayBuffer) => {
          store.set(key, typeof value === "string" ? value : new TextDecoder().decode(value));
        },
        get: async (key: string) => {
          const text = store.get(key);
          return text ? { text: async () => text } : null;
        },
      },
    };
    const body = "ABCDEFGHIJ".repeat(8); // 80 B
    const one = await persistLayerObject(
      env,
      {
        packId: "packparts",
        id: "sst",
        r2Key: "packs/packparts/sst/hashhashhash.json",
        hash: "ab",
        body,
      },
      { putMaxBytes: 20, partBytes: 16 },
    );
    assert.equal(one.wrote, true);
    assert.ok(one.parts >= 2);
    const pointer = store.get("packs/packparts/sst/hashhashhash.json") ?? "";
    assert.ok(pointer.includes("ahanuR2Parts"), pointer.slice(0, 80));
    assert.equal(store.get("packs/packparts/sst"), pointer);

    resetBuiltPackCache();
    const viaLatest = await layerBody(env, POINT_JUDITH_CANYON_BBOX, START, 72, "sst", {
      packId: "packparts",
      fetchImpl: async () => {
        throw new Error("must not rebuild NOAA for split R2 body");
      },
    });
    assert.ok(viaLatest);
    assert.equal(viaLatest.body, body);
    assert.equal(viaLatest.source, "r2");
  });
});
