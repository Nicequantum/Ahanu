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

const { helmNowMs, setHelmNowMs } = await import("../src/lib/ahanu/helm-clock.ts");
const { useAhanu } = await import("../src/lib/ahanu/store.ts");
const { packedTideCurve } = await import("../src/lib/ahanu/tide-curve.ts");
const { packedOceanFromBodies, setPackedOcean, clearPackedOcean } = await import(
  "../src/lib/ahanu/packed-fields.ts"
);

const STORE = fileURLToPath(new URL("../src/lib/ahanu/store.ts", import.meta.url));
const LEFTOVER = Date.parse("2026-08-20T21:40:00Z");

function tidesBody(payload: unknown): string {
  return JSON.stringify({ kind: "json", layer: "tides", payload });
}

const PJ = {
  id: "8455083",
  name: "POINT JUDITH, HARBOR OF REFUGE",
  lat: 41.361,
  lon: -71.49,
  interval: "h",
  datum: "MLLW",
  series: [
    { at: "2026-08-21T12:00:00.000Z", heightFt: 1.1 },
    { at: "2026-08-21T15:00:00.000Z", heightFt: 3.0 },
    { at: "2026-08-21T18:00:00.000Z", heightFt: 0.4 },
    { at: "2026-08-21T21:00:00.000Z", heightFt: 2.6 },
  ],
  hilo: [
    { at: "2026-08-21T15:00:00.000Z", heightFt: 3.0, type: "H" },
    { at: "2026-08-21T18:00:00.000Z", heightFt: 0.4, type: "L" },
    { at: "2026-08-21T21:00:00.000Z", heightFt: 2.6, type: "H" },
  ],
};

afterEach(() => {
  setHelmNowMs(null);
  clearPackedOcean();
});

describe("helmNowMs", () => {
  it("defaults to wall time, not the leftover demo stamp", () => {
    setHelmNowMs(null);
    const before = Date.now();
    const t = helmNowMs();
    const after = Date.now();
    assert.ok(t >= before - 5 && t <= after + 5, `helmNowMs ${t} not wall time`);
    assert.notEqual(t, LEFTOVER);
  });

  it("tests inject a frozen clock", () => {
    const frozen = Date.parse("2026-08-21T16:00:00.000Z");
    setHelmNowMs(() => frozen);
    assert.equal(helmNowMs(), frozen);
    setHelmNowMs(null);
    assert.notEqual(helmNowMs(), frozen);
  });
});

describe("store clockMs", () => {
  it("tickSim follows the injected clock, not leftover + 12x", () => {
    const frozen = Date.parse("2026-08-21T16:00:00.000Z");
    setHelmNowMs(() => frozen);
    useAhanu.setState({
      clockMs: 0,
      vessel: { ...useAhanu.getState().vessel, simulating: true, anchored: false, mode: "trolling" },
    });
    useAhanu.getState().tickSim(1000);
    assert.equal(useAhanu.getState().clockMs, frozen);
    assert.notEqual(useAhanu.getState().clockMs, LEFTOVER + 12_000);
    assert.notEqual(useAhanu.getState().clockMs, 12_000);
  });

  it("tickSim still follows wall time when not simulating", () => {
    const frozen = Date.parse("2026-08-21T16:05:00.000Z");
    setHelmNowMs(() => frozen);
    useAhanu.setState({
      clockMs: LEFTOVER,
      vessel: { ...useAhanu.getState().vessel, simulating: false, anchored: true },
    });
    useAhanu.getState().tickSim(500);
    assert.equal(useAhanu.getState().clockMs, frozen);
    assert.notEqual(useAhanu.getState().clockMs, LEFTOVER + 500);
  });

  it("store has no leftover demo stamp and no 12x clock warp", async () => {
    const src = await readFile(STORE, "utf8");
    assert.doesNotMatch(src, /2026-08-20T21:40/);
    assert.doesNotMatch(src, /dtMs \* 12/);
    assert.match(src, /helmNowMs/);
  });
});

describe("packed 8455083 next high/low vs helm clock", () => {
  it("next high/low and now follow the injected clock — no invented water levels", () => {
    setPackedOcean(
      packedOceanFromBodies({
        tides: tidesBody({
          live: true,
          source: "coops",
          start: "2026-08-21T12:00:00.000Z",
          hours: 12,
          stations: [PJ],
        }),
      }),
    );
    const leftoverLie = packedTideCurve(new Date(LEFTOVER), "8455083");
    assert.ok(leftoverLie);
    assert.equal(leftoverLie.stationId, "8455083");
    assert.equal(leftoverLie.nextHigh?.at, "2026-08-21T15:00:00.000Z");
    assert.equal(leftoverLie.nextLow?.at, "2026-08-21T18:00:00.000Z");

    const now = Date.parse("2026-08-21T16:30:00.000Z");
    setHelmNowMs(() => now);
    useAhanu.setState({ clockMs: helmNowMs() });
    useAhanu.getState().tickSim(90);
    const curve = packedTideCurve(new Date(useAhanu.getState().clockMs), "8455083");
    assert.ok(curve);
    assert.equal(curve.stationId, "8455083");
    assert.equal(curve.nextHigh?.at, "2026-08-21T21:00:00.000Z");
    assert.equal(curve.nextHigh?.heightFt, 2.6);
    assert.equal(curve.nextLow?.at, "2026-08-21T18:00:00.000Z");
    assert.equal(curve.nextLow?.heightFt, 0.4);
    assert.deepEqual(
      curve.points.map((p) => p.heightFt),
      PJ.series.map((p) => p.heightFt),
    );
  });
});
