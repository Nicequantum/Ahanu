import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { CARB_PARAMS, ENGINE_THRESHOLDS, INJECTOR_CHANNELS, PARAM_UNIT, STANDALONE_PARAMS, WIDEBAND_SPREAD_AFR } from "../src/lib/ahanu/engine/config.ts";
import { instanceRows } from "../src/lib/ahanu/engine/instances.ts";
import { applyStale } from "../src/lib/ahanu/engine/quality.ts";
import { SCHEMA_FIELD, schemaEngineId, toSchemaSample } from "../src/lib/ahanu/engine/schema.ts";
import { simPicture } from "../src/lib/ahanu/engine/sim.ts";
import { dualSync, widebandCheck } from "../src/lib/ahanu/engine/sync.ts";
import type { EngineReading } from "../src/lib/ahanu/types.ts";

const MAP = { "0": "port", "1": "starboard" } as const;
const NOW = 1_700_000_000_000;

function r(partial: Partial<EngineReading> & Pick<EngineReading, "param" | "engineId" | "value">): EngineReading {
  return { unit: "", ts: new Date(NOW).toISOString(), source: "sim", quality: "ok", ...partial };
}

describe("engine sim efi mode", () => {
  it("carb mode is unchanged: no AFR, no standalone fields", () => {
    const pic = simPicture({ ...MAP }, NOW);
    const params = new Set(pic.readings.map((row) => row.param));
    assert.deepEqual([...params].sort(), [...CARB_PARAMS].sort());
  });

  it("efi mode emits every standalone field and 8 injector channels on both banks", () => {
    const pic = simPicture({ ...MAP }, NOW, () => {}, "efi");
    for (const side of ["port", "starboard"] as const) {
      for (const param of [...STANDALONE_PARAMS, ...INJECTOR_CHANNELS]) {
        const row = pic.readings.find((x) => x.engineId === side && x.param === param);
        assert.ok(row, `${side} ${param}`);
        assert.ok(Number.isFinite(row.value));
        assert.equal(row.unit, PARAM_UNIT[param]);
        assert.equal(row.pgn, undefined, "standalone fields are not N2K PGNs");
      }
    }
    assert.equal(pic.bytesSent, 0);
    assert.equal(pic.dtcs.length, 0);
  });

  it("standalone readings go stale on their own timeout", () => {
    const pic = simPicture({ ...MAP }, NOW, () => {}, "efi");
    const later = applyStale(pic.readings, NOW + ENGINE_THRESHOLDS.staleMs.standalone + 1, ENGINE_THRESHOLDS.staleMs);
    assert.equal(later.find((x) => x.param === "afrA")?.quality, "stale");
    const fresh = applyStale(pic.readings, NOW + 100, ENGINE_THRESHOLDS.staleMs);
    assert.equal(fresh.find((x) => x.param === "afrA")?.quality, "ok");
  });
});

describe("DATA-SCHEMA alignment", () => {
  it("maps every gauge field to a DATA-SCHEMA v0.1 name", () => {
    const expected: Record<string, string> = {
      rpm: "rpm",
      mapKpa: "map_kpa",
      tps: "tps_pct",
      coolantTemp: "coolant_c",
      iat: "iat_c",
      afrA: "afr_a",
      afrB: "afr_b",
      voltage: "battery_v",
      sparkAdvance: "spark_adv_deg",
      egt: "egt_c",
      oilPressure: "oil_press_kpa",
      injectorPw1: "inj_pw_us[1]",
      injectorPw8: "inj_pw_us[8]",
    };
    for (const [param, field] of Object.entries(expected)) assert.equal(SCHEMA_FIELD[param]?.field, field, param);
  });

  it("converts display units to schema units", () => {
    assert.equal(SCHEMA_FIELD.coolantTemp.toSchema(212), 100);
    assert.ok(Math.abs(SCHEMA_FIELD.oilPressure.toSchema(1) - 6.8948) < 1e-3);
    assert.equal(SCHEMA_FIELD.injectorPw3.toSchema(3.2), 3200);
  });

  it("builds a schema sample per engine and never maps unmapped to port", () => {
    const pic = simPicture({ ...MAP }, NOW, () => {}, "efi");
    const port = toSchemaSample(pic.readings, "port");
    assert.equal(port?.engine_id, 0);
    assert.ok(port && "afr_b" in port && "inj_pw_us[8]" in port && "map_kpa" in port);
    assert.equal(toSchemaSample(pic.readings, "unmapped"), null);
    assert.equal(schemaEngineId("starboard"), 1);
    const carb = toSchemaSample(simPicture({ ...MAP }, NOW).readings, "port");
    assert.equal(carb && "afr_a" in carb, false, "absent fields stay absent");
  });
});

describe("dual-engine sync", () => {
  const rules = ENGINE_THRESHOLDS.delta;

  it("sim standalone fields are in sync; the existing carb sim keeps its coolant/voltage split", () => {
    const pic = simPicture({ ...MAP }, NOW, () => {}, "efi");
    const efi = dualSync(pic.readings, STANDALONE_PARAMS, rules);
    assert.equal(efi.allInSync, true, JSON.stringify(efi.rows.filter((x) => x.status !== "sync").map((x) => [x.param, x.delta.text])));
    const carb = dualSync(pic.readings, ["rpm", "coolantTemp", "oilPressure", "voltage"], rules);
    assert.deepEqual(carb.rows.filter((x) => x.status === "mismatch").map((x) => x.param), ["coolantTemp", "voltage"]);
    assert.equal(carb.rows.find((x) => x.param === "coolantTemp")?.delta.worse, "starboard");
  });

  it("flags a mismatch beyond the delta rule and names the worse bank", () => {
    const readings = [r({ engineId: "port", param: "rpm", value: 3000 }), r({ engineId: "starboard", param: "rpm", value: 2700 })];
    const s = dualSync(readings, ["rpm"], rules);
    assert.equal(s.rows[0].status, "mismatch");
    assert.equal(s.rows[0].delta.worse, "port");
    assert.equal(s.allInSync, false);
  });

  it("is in sync exactly under the threshold and mismatched at it", () => {
    const at = (d: number) => dualSync([r({ engineId: "port", param: "rpm", value: 1000 + d }), r({ engineId: "starboard", param: "rpm", value: 1000 })], ["rpm"], rules).rows[0].status;
    assert.equal(at(149), "sync");
    assert.equal(at(150), "mismatch");
  });

  it("missing beats stale beats sync; unmapped never counts", () => {
    const missing = dualSync([r({ engineId: "port", param: "rpm", value: 1000 }), r({ engineId: "unmapped", param: "rpm", value: 1000 })], ["rpm"], rules);
    assert.equal(missing.rows[0].status, "missing");
    const stale = dualSync([r({ engineId: "port", param: "rpm", value: 1000 }), r({ engineId: "starboard", param: "rpm", value: 1000, quality: "stale" })], ["rpm"], rules);
    assert.equal(stale.rows[0].status, "stale");
    const nan = dualSync([r({ engineId: "port", param: "egt", value: Number.NaN }), r({ engineId: "starboard", param: "egt", value: 1000 })], ["egt"], rules);
    assert.equal(nan.rows[0].status, "missing");
    assert.equal(dualSync([], [], rules).allInSync, false);
  });

  it("cross-checks the two widebands on one engine", () => {
    const pic = simPicture({ ...MAP }, NOW, () => {}, "efi");
    assert.equal(widebandCheck(pic.readings, "port", WIDEBAND_SPREAD_AFR).status, "agree");
    assert.equal(widebandCheck(pic.readings, "starboard", WIDEBAND_SPREAD_AFR).status, "agree");
    const bad = [r({ engineId: "port", param: "afrA", value: 14.0 }), r({ engineId: "port", param: "afrB", value: 14.8 })];
    const check = widebandCheck(bad, "port", WIDEBAND_SPREAD_AFR);
    assert.equal(check.status, "disagree");
    assert.ok(Math.abs((check.spread ?? 0) - 0.8) < 1e-9);
    assert.equal(widebandCheck([bad[0]], "port", WIDEBAND_SPREAD_AFR).status, "missing");
    assert.equal(widebandCheck(simPicture({ ...MAP }, NOW).readings, "port", WIDEBAND_SPREAD_AFR).status, "missing");
  });
});

describe("engine instance map", () => {
  it("lists bus and mapped instances with source, feed, mode", () => {
    const pic = simPicture({ ...MAP }, NOW, () => {}, "efi");
    const rows = instanceRows(pic.readings, { ...MAP, "4": "port" }, "sim", "efi");
    assert.deepEqual(rows.map((x) => x.instance), [0, 1, 4]);
    assert.equal(rows[0].engineId, "port");
    assert.deepEqual(rows[0].sources, ["sim"]);
    assert.equal(rows[0].feed, "sim");
    assert.equal(rows[0].mode, "efi");
    assert.equal(rows[0].params, CARB_PARAMS.length + STANDALONE_PARAMS.length + INJECTOR_CHANNELS.length);
    assert.equal(rows[2].lastTs, null);
    assert.equal(rows[2].sources.length, 0);
  });

  it("keeps an unmapped instance unmapped", () => {
    const rows = instanceRows(simPicture({}, NOW).readings, {}, "sim", "carb");
    assert.equal(rows.every((x) => x.engineId === "unmapped"), true);
  });
});

describe("config lock", () => {
  it("JSON thresholds include the standalone timeout and new delta rules", () => {
    const json = JSON.parse(readFileSync("config/engine-thresholds.json", "utf8"));
    assert.equal(json.staleMs.standalone, 1000);
    for (const p of ["mapKpa", "afrA", "afrB", "sparkAdvance", "egt", "injectorPw"]) assert.ok(json.delta[p], p);
  });
});
