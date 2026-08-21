import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const {
  DEFAULT_TIDE_HARBOR,
  FALLBACK_TIDE_HARBOR,
  TIDE_HARBOR_KEY,
  packedTideCurve,
  packedTideHarbors,
  readPersistedTideHarbor,
  readPersistedTideHarborRecord,
  resolveTideHarbor,
  writePersistedTideHarbor,
} = await import("../src/lib/ahanu/tide-curve.ts");
const {
  COOPS_HARBOR_STATIONS,
  POINT_JUDITH_COOPS,
  coopsStationsForBox,
  packedTideStationIds,
  packedTidesNeedRefresh,
} = await import("../src/lib/ahanu/noaa-live.ts");
const { POINT_JUDITH_CANYON_BBOX } = await import("../src/lib/ahanu/pack-fixtures.ts");
const { STORE_PERSIST_KEY } = await import("../src/lib/ahanu/display-mode.ts");
const { packedOceanFromBodies, setPackedOcean, clearPackedOcean } = await import(
  "../src/lib/ahanu/packed-fields.ts"
);

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    map,
  };
}

function tidesBody(payload: unknown): string {
  return JSON.stringify({ kind: "json", layer: "tides", payload });
}

function loadTides(payload: unknown): void {
  setPackedOcean(packedOceanFromBodies({ tides: tidesBody(payload) }));
}

const NEWPORT = {
  id: "8452660",
  name: "Newport",
  lat: 41.49,
  lon: -71.327,
  interval: "h",
  datum: "MLLW",
  series: [
    { at: "2026-08-20T12:00:00.000Z", heightFt: 1.2 },
    { at: "2026-08-20T14:00:00.000Z", heightFt: 2.8 },
  ],
  hilo: [
    { at: "2026-08-20T14:00:00.000Z", heightFt: 2.8, type: "H" },
    { at: "2026-08-20T17:00:00.000Z", heightFt: 0.2, type: "L" },
  ],
};

const QUONSET = {
  id: "8452944",
  name: "Quonset Point",
  lat: 41.586,
  lon: -71.41,
  interval: "h",
  datum: "MLLW",
  series: [{ at: "2026-08-20T12:00:00.000Z", heightFt: 0.4 }],
  hilo: [],
};

const MONTAUK = {
  id: "8510560",
  name: "Montauk",
  lat: 41.048,
  lon: -71.959,
  interval: "h",
  datum: "MLLW",
  series: [{ at: "2026-08-20T12:00:00.000Z", heightFt: 1.8 }],
  hilo: [],
};

const POINT_JUDITH = {
  id: POINT_JUDITH_COOPS.id,
  name: POINT_JUDITH_COOPS.name,
  lat: POINT_JUDITH_COOPS.lat,
  lon: POINT_JUDITH_COOPS.lon,
  interval: "h",
  datum: "MLLW",
  series: [{ at: "2026-08-20T12:00:00.000Z", heightFt: 1.1 }],
  hilo: [],
};

describe("tide harbor persist", () => {
  afterEach(() => {
    clearPackedOcean();
  });

  it("defaults to official Point Judith when nothing is stored", () => {
    assert.equal(DEFAULT_TIDE_HARBOR, "POINT JUDITH, HARBOR OF REFUGE");
    assert.equal(DEFAULT_TIDE_HARBOR, POINT_JUDITH_COOPS.name);
    assert.equal(FALLBACK_TIDE_HARBOR, "Newport");
    assert.equal(TIDE_HARBOR_KEY, "ahanu-tide-harbor");
    assert.equal(readPersistedTideHarbor(memoryStorage()), POINT_JUDITH_COOPS.name);
    assert.equal(resolveTideHarbor(undefined, memoryStorage()), POINT_JUDITH_COOPS.name);
  });

  it("round-trips a skipper-chosen harbor id and name", () => {
    loadTides({ fixture: true, start: "2026-08-20T12:00:00.000Z", hours: 24, stations: [NEWPORT, QUONSET, MONTAUK] });
    const store = memoryStorage();
    writePersistedTideHarbor("Quonset", store);
    const rec = readPersistedTideHarborRecord(store);
    assert.ok(rec);
    assert.equal(rec.name, "Quonset Point");
    assert.equal(rec.id, "8452944");
    assert.equal(readPersistedTideHarbor(store), "Quonset Point");
    assert.equal(resolveTideHarbor(undefined, store), "Quonset Point");
    assert.equal(JSON.parse(store.getItem(TIDE_HARBOR_KEY)!).name, "Quonset Point");
  });

  it("restores the last pick after a reload if that station is still packed", () => {
    loadTides({ fixture: true, start: "2026-08-20T12:00:00.000Z", hours: 24, stations: [NEWPORT, QUONSET, MONTAUK] });
    const store = memoryStorage();
    writePersistedTideHarbor({ id: "8510560", name: "Montauk" }, store);
    const resolved = resolveTideHarbor(readPersistedTideHarbor(store), store);
    assert.equal(resolved, "Montauk");
    const curve = packedTideCurve(new Date("2026-08-20T12:30:00.000Z"), resolved);
    assert.ok(curve);
    assert.equal(curve.harbor, "Montauk");
    assert.deepEqual(curve.points, MONTAUK.series);
    assert.equal(curve.nextHigh, null);
    assert.equal(curve.nextLow, null);
  });

  it("reads tideHarbor from the zustand persist blob", () => {
    const store = memoryStorage({
      [STORE_PERSIST_KEY]: JSON.stringify({ state: { tideHarbor: "Montauk" }, version: 0 }),
    });
    assert.equal(readPersistedTideHarbor(store), "Montauk");
  });

  it("prefers the dedicated key over a stale persist blob", () => {
    const store = memoryStorage({
      [TIDE_HARBOR_KEY]: JSON.stringify({ id: "8452944", name: "Quonset Point" }),
      [STORE_PERSIST_KEY]: JSON.stringify({ state: { tideHarbor: "Newport" }, version: 0 }),
    });
    assert.equal(readPersistedTideHarbor(store), "Quonset Point");
  });

  it("falls back to Newport when the packed station is gone and does not invent levels", () => {
    loadTides({ fixture: true, start: "2026-08-20T12:00:00.000Z", hours: 24, stations: [NEWPORT, MONTAUK] });
    const store = memoryStorage({
      [TIDE_HARBOR_KEY]: JSON.stringify({ id: "8452944", name: "Quonset Point" }),
    });
    assert.equal(readPersistedTideHarbor(store), "Quonset Point");
    const resolved = resolveTideHarbor(readPersistedTideHarbor(store), store);
    assert.equal(resolved, "Newport");
    const curve = packedTideCurve(new Date("2026-08-20T12:30:00.000Z"), resolved);
    assert.ok(curve);
    assert.equal(curve.harbor, "Newport");
    assert.equal(curve.stationId, "8452660");
    assert.deepEqual(curve.points, NEWPORT.series);
    assert.equal(curve.nextHigh?.heightFt, 2.8);
  });

  it("missing pack or unknown station resolves without inventing water levels", () => {
    const store = memoryStorage();
    writePersistedTideHarbor({ id: "8452944", name: "Quonset Point" }, store);
    assert.equal(resolveTideHarbor("Quonset Point", store), POINT_JUDITH_COOPS.name);
    assert.equal(packedTideCurve(new Date("2026-08-20T12:00:00.000Z"), resolveTideHarbor("Quonset Point", store)), null);

    loadTides({ fixture: true, start: "2026-08-20T12:00:00.000Z", hours: 24, stations: [] });
    assert.equal(resolveTideHarbor("Montauk", store), POINT_JUDITH_COOPS.name);
    assert.equal(packedTideCurve(new Date("2026-08-20T12:00:00.000Z"), "Montauk"), null);

    loadTides({ fixture: true, start: "2026-08-20T12:00:00.000Z", hours: 24, stations: [NEWPORT, QUONSET, MONTAUK] });
    assert.equal(resolveTideHarbor("Atlantis", store), "Newport");
    const curve = packedTideCurve(new Date("2026-08-20T12:30:00.000Z"), resolveTideHarbor("Atlantis", store));
    assert.ok(curve);
    assert.equal(curve.harbor, "Newport");
    assert.deepEqual(curve.points, NEWPORT.series);
  });

  it("rejects garbage in storage", () => {
    const store = memoryStorage({
      [TIDE_HARBOR_KEY]: "{not-json",
      [STORE_PERSIST_KEY]: "not-json",
    });
    assert.equal(readPersistedTideHarbor(store), POINT_JUDITH_COOPS.name);
    assert.equal(resolveTideHarbor(undefined, store), POINT_JUDITH_COOPS.name);
  });

  it("lists official Point Judith when that station is packed", () => {
    loadTides({
      fixture: true,
      start: "2026-08-20T12:00:00.000Z",
      hours: 24,
      stations: [POINT_JUDITH, NEWPORT, QUONSET, MONTAUK],
    });
    const names = packedTideHarbors();
    assert.ok(names.includes(POINT_JUDITH_COOPS.name));
    assert.ok(names.includes("Newport"));
    assert.equal(resolveTideHarbor(undefined, memoryStorage()), POINT_JUDITH_COOPS.name);
    const curve = packedTideCurve(new Date("2026-08-20T12:00:00.000Z"));
    assert.ok(curve);
    assert.equal(curve.stationId, "8455083");
    assert.equal(curve.harbor, POINT_JUDITH_COOPS.name);
    assert.deepEqual(curve.points, POINT_JUDITH.series);
  });

  it("keeps a persisted Newport pick when Point Judith is also packed", () => {
    loadTides({
      fixture: true,
      start: "2026-08-20T12:00:00.000Z",
      hours: 24,
      stations: [POINT_JUDITH, NEWPORT, QUONSET, MONTAUK],
    });
    const store = memoryStorage();
    writePersistedTideHarbor({ id: "8452660", name: "Newport" }, store);
    assert.equal(resolveTideHarbor(undefined, store), "Newport");
    assert.equal(resolveTideHarbor(readPersistedTideHarbor(store), store), "Newport");
  });
});

describe("CO-OPS Point Judith catalog", () => {
  it("includes official NOAA station 8455083 POINT JUDITH, HARBOR OF REFUGE", () => {
    assert.equal(POINT_JUDITH_COOPS.id, "8455083");
    assert.equal(POINT_JUDITH_COOPS.name, "POINT JUDITH, HARBOR OF REFUGE");
    assert.equal(POINT_JUDITH_COOPS.lat, 41.3633);
    assert.equal(POINT_JUDITH_COOPS.lon, -71.49);
    const row = COOPS_HARBOR_STATIONS.find((s) => s.id === "8455083");
    assert.ok(row);
    assert.equal(row.name, "POINT JUDITH, HARBOR OF REFUGE");
    assert.equal(row.required, true);
    const boxed = coopsStationsForBox(POINT_JUDITH_CANYON_BBOX);
    assert.ok(boxed.some((s) => s.id === "8455083" && s.name === "POINT JUDITH, HARBOR OF REFUGE"));
  });

  it("packedTidesNeedRefresh is true for live 4-station CO-OPS missing 8455083", () => {
    const stale = {
      fixture: false,
      live: true,
      source: "coops",
      stations: [
        { id: "8452660", name: "Newport" },
        { id: "8452944", name: "Quonset Point" },
        { id: "8510560", name: "Montauk" },
        { id: "8461490", name: "New London" },
      ],
    };
    assert.deepEqual(packedTideStationIds(stale), ["8452660", "8452944", "8510560", "8461490"]);
    assert.equal(packedTidesNeedRefresh(stale), true);
    assert.equal(
      packedTidesNeedRefresh({
        ...stale,
        stations: [{ id: POINT_JUDITH_COOPS.id, name: POINT_JUDITH_COOPS.name }, ...stale.stations],
      }),
      false,
    );
    assert.equal(
      packedTidesNeedRefresh({
        fixture: true,
        stations: [
          { id: "8452660", name: "Newport" },
          { id: "8452944", name: "Quonset Point" },
          { id: "8510560", name: "Montauk" },
        ],
      }),
      false,
      "fixture tides are not rewritten — do not invent water levels",
    );
  });
});
