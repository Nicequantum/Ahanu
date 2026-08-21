import "./register-alias.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

if (typeof globalThis.localStorage === "undefined") {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    clear: () => {
      map.clear();
    },
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

const {
  GEO_DENIED,
  GEO_TIMEOUT,
  GPS_ON_KEY,
  MS_TO_KT,
  applyOwnshipGpsFix,
  gpsHudLabel,
  gpsStatusFromError,
  gpsStatusLine,
  isOwnshipGpsWatching,
  parseGpsCoords,
  parseGpsOn,
  readPersistedGpsOn,
  setOwnshipGeolocation,
  startOwnshipGps,
  stopOwnshipGps,
  writePersistedGpsOn,
} = await import("../src/lib/ahanu/ownship-gps.ts");
const { POINT_JUDITH, VEATCH_HEAD } = await import("../src/lib/ahanu/constants.ts");
const { useAhanu } = await import("../src/lib/ahanu/store.ts");

const SETTINGS = fileURLToPath(new URL("../src/components/panels/SettingsPanel.tsx", import.meta.url));
const STORE = fileURLToPath(new URL("../src/lib/ahanu/store.ts", import.meta.url));
const SHELL = fileURLToPath(new URL("../src/components/ahanu/AppShell.tsx", import.meta.url));

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

function fakeGeo(opts: {
  coords?: { latitude: number; longitude: number; speed?: number | null; heading?: number | null };
  error?: { code: number; message?: string };
}) {
  let id = 0;
  const watchers = new Map<
    number,
    {
      success: (pos: { coords: typeof opts.coords }) => void;
      error?: (err: { code?: number; message?: string }) => void;
    }
  >();
  return {
    watchers,
    watchPosition(
      success: (pos: { coords: NonNullable<typeof opts.coords> }) => void,
      error?: (err: { code?: number; message?: string }) => void,
    ) {
      const wid = ++id;
      watchers.set(wid, { success: success as never, error });
      if (opts.error) error?.(opts.error);
      else if (opts.coords) success({ coords: opts.coords });
      return wid;
    },
    clearWatch(wid: number) {
      watchers.delete(wid);
    },
    push(coords: NonNullable<typeof opts.coords>) {
      for (const w of watchers.values()) w.success({ coords });
    },
    fail(err: { code: number; message?: string }) {
      for (const w of watchers.values()) w.error?.(err);
    },
  };
}

function resetHelm() {
  stopOwnshipGps();
  setOwnshipGeolocation(null);
  writePersistedGpsOn(false);
  useAhanu.setState({
    gpsStatus: "off",
    gpsFix: null,
    vessel: {
      lat: 39.905,
      lon: -69.695,
      cog: 145,
      sog: 7.4,
      heading: 145,
      depthM: 188,
      mode: "trolling",
      simulating: true,
      anchored: false,
      anchor: null,
      anchorRadiusM: 80,
    },
    track: [{ lat: 39.905, lon: -69.695 }],
  });
}

afterEach(() => {
  resetHelm();
});

describe("parseGpsCoords", () => {
  it("maps a dock fix and converts m/s to knots", () => {
    const fix = parseGpsCoords({
      latitude: POINT_JUDITH.lat,
      longitude: POINT_JUDITH.lon,
      speed: 2,
      heading: 145,
      accuracy: 8,
    });
    assert.ok(fix);
    assert.equal(fix.lat, POINT_JUDITH.lat);
    assert.equal(fix.lon, POINT_JUDITH.lon);
    assert.ok(Math.abs((fix.sog ?? 0) - 2 * MS_TO_KT) < 1e-9);
    assert.equal(fix.cog, 145);
    assert.equal(fix.accuracyM, 8);
  });

  it("rejects invalid or missing coordinates — no invented Galilee", () => {
    assert.equal(parseGpsCoords(null), null);
    assert.equal(parseGpsCoords({ latitude: 91, longitude: -71.48 }), null);
    assert.equal(parseGpsCoords({ latitude: 41.36, longitude: 200 }), null);
    assert.equal(parseGpsCoords({ latitude: Number.NaN, longitude: -71.48 }), null);
    const quiet = parseGpsCoords({
      latitude: POINT_JUDITH.lat,
      longitude: POINT_JUDITH.lon,
      speed: null,
      heading: null,
    });
    assert.ok(quiet);
    assert.equal(quiet.sog, null);
    assert.equal(quiet.cog, null);
  });
});

describe("applyOwnshipGpsFix", () => {
  const veatch = { lat: VEATCH_HEAD.lat, lon: VEATCH_HEAD.lon, sog: 7.4, cog: 145, heading: 145 };

  it("does not keep simulated trolling SOG when speed is unknown", () => {
    const next = applyOwnshipGpsFix(veatch, {
      lat: POINT_JUDITH.lat,
      lon: POINT_JUDITH.lon,
      sog: null,
      cog: null,
      accuracyM: 12,
    });
    assert.equal(next.lat, POINT_JUDITH.lat);
    assert.equal(next.lon, POINT_JUDITH.lon);
    assert.equal(next.sog, 0);
    assert.equal(next.cog, 145);
  });

  it("derives COG from the last live GPS hop, not Veatch", () => {
    const next = applyOwnshipGpsFix(
      veatch,
      { lat: 41.37, lon: -71.47, sog: 5, cog: null, accuracyM: 6 },
      { lat: POINT_JUDITH.lat, lon: POINT_JUDITH.lon },
    );
    assert.ok(next.cog !== 145);
    assert.ok(next.cog >= 0 && next.cog < 360);
    assert.equal(next.sog, 5);
  });
});

describe("gps status copy", () => {
  it("names denied / unavailable without inventing a position", () => {
    assert.equal(gpsStatusFromError({ code: GEO_DENIED }), "denied");
    assert.equal(gpsStatusFromError({ code: GEO_TIMEOUT }), "timeout");
    assert.equal(gpsStatusFromError({ code: 2 }), "unavailable");
    assert.equal(gpsStatusFromError(null), "unavailable");
    assert.match(gpsStatusLine("denied"), /denied — last position/);
    assert.match(gpsStatusLine("unavailable"), /unavailable — last position/);
    assert.match(gpsStatusLine("live"), /this device/);
    assert.equal(gpsHudLabel("live"), "GPS");
    assert.equal(gpsHudLabel("off"), "");
  });
});

describe("GPS persist", () => {
  it("defaults off so first visit stays trolling", () => {
    assert.equal(parseGpsOn(undefined), false);
    assert.equal(readPersistedGpsOn(memoryStorage()), false);
  });

  it("round-trips a skipper GPS tap", () => {
    const store = memoryStorage();
    writePersistedGpsOn(true, store);
    assert.equal(store.getItem(GPS_ON_KEY), "1");
    assert.equal(readPersistedGpsOn(store), true);
    writePersistedGpsOn(false, store);
    assert.equal(readPersistedGpsOn(store), false);
  });
});

describe("startOwnshipGps", () => {
  it("lands a real fix and stops without inventing", () => {
    const fixes: { lat: number; lon: number }[] = [];
    const statuses: string[] = [];
    const geo = fakeGeo({
      coords: { latitude: POINT_JUDITH.lat, longitude: POINT_JUDITH.lon, speed: 0, heading: 90 },
    });
    assert.equal(
      startOwnshipGps({
        onFix: (f) => fixes.push({ lat: f.lat, lon: f.lon }),
        onStatus: (s) => statuses.push(s),
        geolocation: geo,
      }),
      true,
    );
    assert.equal(isOwnshipGpsWatching(), true);
    assert.deepEqual(fixes, [{ lat: POINT_JUDITH.lat, lon: POINT_JUDITH.lon }]);
    assert.ok(statuses.includes("waiting"));
    assert.ok(statuses.includes("live"));
    stopOwnshipGps();
    assert.equal(isOwnshipGpsWatching(), false);
    assert.equal(geo.watchers.size, 0);
  });

  it("denied does not emit a fix", () => {
    const fixes: unknown[] = [];
    const statuses: string[] = [];
    startOwnshipGps({
      onFix: (f) => fixes.push(f),
      onStatus: (s) => statuses.push(s),
      geolocation: fakeGeo({ error: { code: GEO_DENIED, message: "denied" } }),
    });
    assert.deepEqual(fixes, []);
    assert.ok(statuses.includes("denied"));
  });

  it("missing geolocation is unavailable — last position", () => {
    const statuses: string[] = [];
    assert.equal(
      startOwnshipGps({
        onFix: () => {
          throw new Error("no invented fix");
        },
        onStatus: (s) => statuses.push(s),
        geolocation: null,
      }),
      false,
    );
    assert.deepEqual(statuses, ["unavailable"]);
  });
});

describe("store GPS mode", () => {
  it("GPS tap watches this device and moves ownship to the fix", () => {
    setOwnshipGeolocation(
      fakeGeo({
        coords: {
          latitude: POINT_JUDITH.lat,
          longitude: POINT_JUDITH.lon,
          speed: 1.5,
          heading: 200,
        },
      }),
    );
    useAhanu.getState().setMode("gps");
    const s = useAhanu.getState();
    assert.equal(s.vessel.mode, "gps");
    assert.equal(s.vessel.simulating, false);
    assert.equal(s.gpsStatus, "live");
    assert.equal(s.vessel.lat, POINT_JUDITH.lat);
    assert.equal(s.vessel.lon, POINT_JUDITH.lon);
    assert.ok(s.vessel.sog > 0);
    assert.equal(s.vessel.cog, 200);
    assert.equal(readPersistedGpsOn(), true);
  });

  it("denied GPS keeps the last simulated position", () => {
    const before = useAhanu.getState().vessel;
    setOwnshipGeolocation(fakeGeo({ error: { code: GEO_DENIED, message: "no" } }));
    useAhanu.getState().setMode("gps");
    const s = useAhanu.getState();
    assert.equal(s.vessel.mode, "gps");
    assert.equal(s.gpsStatus, "denied");
    assert.equal(s.vessel.lat, before.lat);
    assert.equal(s.vessel.lon, before.lon);
  });

  it("leaving GPS stops the watch and does not invent a dock", () => {
    const geo = fakeGeo({
      coords: { latitude: POINT_JUDITH.lat, longitude: POINT_JUDITH.lon, speed: 0, heading: 90 },
    });
    setOwnshipGeolocation(geo);
    useAhanu.getState().setMode("gps");
    assert.equal(isOwnshipGpsWatching(), true);
    useAhanu.getState().setMode("trolling");
    assert.equal(isOwnshipGpsWatching(), false);
    assert.equal(useAhanu.getState().gpsStatus, "off");
    assert.equal(useAhanu.getState().vessel.simulating, true);
    assert.equal(readPersistedGpsOn(), false);
    assert.equal(geo.watchers.size, 0);
  });

  it("drop anchor stops GPS", () => {
    setOwnshipGeolocation(
      fakeGeo({
        coords: { latitude: POINT_JUDITH.lat, longitude: POINT_JUDITH.lon, speed: 0, heading: 10 },
      }),
    );
    useAhanu.getState().setMode("gps");
    useAhanu.getState().dropAnchor();
    assert.equal(isOwnshipGpsWatching(), false);
    assert.equal(useAhanu.getState().vessel.mode, "anchor");
    assert.equal(useAhanu.getState().gpsStatus, "off");
    assert.equal(readPersistedGpsOn(), false);
  });
});

describe("helm GPS copy", () => {
  it("Settings names this device and does not invent a fix", async () => {
    const src = await readFile(SETTINGS, "utf8");
    assert.match(src, /gpsStatusLine/);
    assert.match(src, /this device/);
    assert.match(src, /no invented fix/);
    assert.match(src, /Trolling and steaming stay simulated/);
  });

  it("store starts and stops the geolocation watch from setMode", async () => {
    const src = await readFile(STORE, "utf8");
    assert.match(src, /startOwnshipGps/);
    assert.match(src, /stopOwnshipGps/);
    assert.match(src, /writePersistedGpsOn/);
    assert.match(src, /readPersistedGpsOn/);
  });

  it("instrument bar prefixes GPS when that mode is on", async () => {
    const src = await readFile(SHELL, "utf8");
    assert.match(src, /gpsHudLabel/);
    assert.match(src, /gpsStatus/);
  });
});
