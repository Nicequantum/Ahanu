import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { AnalogAdapter, DigitalAdapter, resetUnmappedWarnings } from "../src/lib/ahanu/engine/adapters.ts";
import { ENGINE_THRESHOLDS, FACTORY_INSTANCE_MAP } from "../src/lib/ahanu/engine/config.ts";
import { bankDelta } from "../src/lib/ahanu/engine/delta.ts";
import { assignInstance, resolveEngineId } from "../src/lib/ahanu/engine/map.ts";
import { applyStale, displayValue } from "../src/lib/ahanu/engine/quality.ts";
import { simPicture } from "../src/lib/ahanu/engine/sim.ts";
import { loadThemeBundles, validateTheme } from "../src/lib/ahanu/engine/theme.ts";
import { fToK, fuelRateFromRaw, gphToM3h, hoursFromRaw, kToF, m3hToGph, paToPsi, psiToPa, secondsToHours, tempCentiK, tempDeciK } from "../src/lib/ahanu/engine/units.ts";
import { YDEG04_COMPAT, YDEG04_UNPUBLISHED } from "../src/lib/ahanu/engine/ydeg04-fields.ts";
import type { EngineReading } from "../src/lib/ahanu/types.ts";

function u16(value: number): [number, number] {
  return [value & 0xff, (value >> 8) & 0xff];
}

function u32(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff];
}

function rapid(instance: number, rpmRaw: number, boostRaw: number, trim: number): Uint8Array {
  return Uint8Array.from([instance, ...u16(rpmRaw), ...u16(boostRaw), trim, 0xff, 0xff]);
}

function dynamic(instance: number, opts: { oil: number; coolant: number; volts: number; status1?: number; status2?: number }): Uint8Array {
  const bytes = new Uint8Array(26).fill(0xff);
  bytes[0] = instance;
  bytes.set(u16(opts.oil), 1);
  bytes.set(u16(opts.coolant), 5);
  bytes.set(u16(opts.volts), 7);
  bytes.set(u32(3600 * 10), 11);
  bytes.set(u16(opts.status1 ?? 0), 20);
  bytes.set(u16(opts.status2 ?? 0), 22);
  return bytes;
}

function transmission(instance: number, gear: number, pressure: number, temp: number): Uint8Array {
  const bytes = new Uint8Array(8).fill(0xff);
  bytes[0] = instance;
  bytes[1] = gear & 0x03;
  bytes.set(u16(pressure), 2);
  bytes.set(u16(temp), 4);
  bytes[6] = 0;
  return bytes;
}

function reading(partial: Partial<EngineReading> & Pick<EngineReading, "param" | "engineId">): EngineReading {
  return {
    value: 1,
    unit: "rpm",
    ts: new Date(0).toISOString(),
    source: "sim",
    quality: "ok",
    ...partial,
  };
}

describe("engine units", () => {
  it("round-trips Kelvin to Fahrenheit", () => {
    assert.ok(Math.abs(kToF(fToK(212)) - 212) < 1e-9);
    assert.ok(Math.abs(tempCentiK(35315)! - 176) < 0.05);
    assert.ok(Math.abs(tempDeciK(3732)! - kToF(373.2)) < 1e-9);
  });

  it("round-trips pascals to psi", () => {
    assert.ok(Math.abs(paToPsi(psiToPa(40)) - 40) < 1e-9);
  });

  it("round-trips fuel rate and hours", () => {
    assert.ok(Math.abs(m3hToGph(gphToM3h(12)) - 12) < 1e-9);
    assert.ok(Math.abs(fuelRateFromRaw(100)! - m3hToGph(0.01)) < 1e-9);
    assert.equal(hoursFromRaw(3600), secondsToHours(3600));
  });
});

describe("engine adapters", () => {
  it("parses 127488 and 127489 for both banks on the analog adapter", () => {
    resetUnmappedWarnings();
    const analog = new AnalogAdapter();
    const map = { "0": "port" as const, "1": "starboard" as const };
    const ts = "2026-09-24T12:00:00.000Z";
    const port = analog.ingest(127488, rapid(0, 5680, 0, 20), map, ts);
    const stbd = analog.ingest(127488, rapid(1, 5440, 0, 12), map, ts);
    assert.equal(port.readings.find((r) => r.param === "rpm")?.engineId, "port");
    assert.equal(port.readings.find((r) => r.param === "rpm")?.value, 1420);
    assert.equal(port.readings.find((r) => r.param === "rpm")?.unit, "rpm");
    assert.equal(stbd.readings.find((r) => r.param === "trim")?.engineId, "starboard");
    const dyn = analog.ingest(127489, dynamic(0, { oil: 2758, coolant: 35315, volts: 1380 }), map, ts);
    assert.ok(Math.abs((dyn.readings.find((r) => r.param === "coolantTemp")?.value ?? 0) - 176) < 0.2);
    assert.ok(Math.abs((dyn.readings.find((r) => r.param === "oilPressure")?.value ?? 0) - 40) < 0.2);
    assert.equal(analog.bytesSent, 0);
  });

  it("keeps 127493 on the digital adapter and off the analog adapter", () => {
    resetUnmappedWarnings();
    const map = { "0": "port" as const, "1": "starboard" as const };
    const ts = "2026-09-24T12:00:00.000Z";
    const frame = transmission(1, 0, 2000, 3600);
    const analog = new AnalogAdapter().ingest(127493, frame, map, ts);
    const digitalAdapter = new DigitalAdapter();
    const digital = digitalAdapter.ingest(127493, frame, map, ts);
    assert.deepEqual(analog.drops, ["analog-ignores-127493"]);
    assert.equal(digital.readings.find((r) => r.param === "gear")?.value, 0);
    assert.equal(digital.readings.find((r) => r.param === "gear")?.engineId, "starboard");
    assert.equal(digital.readings.find((r) => r.param === "transTemp")?.unit, "°F");
    assert.equal(digitalAdapter.dtcs().length, 0);
    assert.equal(digitalAdapter.bytesSent, 0);
  });

  it("matches the canboat 127489 sample, coolant at 0.01 K", () => {
    resetUnmappedWarnings();
    const sample = Uint8Array.from([
      0x00, 0x2f, 0x06, 0x10, 0x20, 0xe3, 0x73, 0x65, 0x05, 0x65, 0x04, 0x72, 0x10, 0x00, 0x00, 0x10, 0x20, 0x30, 0x40, 0xff, 0x06, 0x00, 0xff, 0x00, 0x30, 0x18,
    ]);
    const parsed = new AnalogAdapter().ingest(127489, sample, { "0": "port" }, "2026-09-24T12:00:00.000Z");
    const coolant = parsed.readings.find((row) => row.param === "coolantTemp")?.value ?? 0;
    const volts = parsed.readings.find((row) => row.param === "voltage")?.value ?? 0;
    assert.ok(Math.abs(coolant - 74.336) < 0.05);
    assert.ok(Math.abs(volts - 13.81) < 0.01);
    assert.equal(parsed.alarms.some((row) => row.code === "over-temp"), true);
    assert.equal(parsed.dtcs.length, 0);
  });

  it("parses each Tier 1 flag on its own and never emits a DTC", () => {
    resetUnmappedWarnings();
    const analog = new AnalogAdapter();
    const map = { "2": "port" as const };
    const ts = "2026-09-24T12:00:00.000Z";
    const lowOil = analog.ingest(127489, dynamic(2, { oil: 1000, coolant: 3500, volts: 1400, status1: 1 << 2 }), map, ts);
    assert.deepEqual(lowOil.alarms.map((a) => a.code), ["low-oil-pressure"]);
    assert.equal(lowOil.alarms[0]?.tier, 1);
    assert.equal(lowOil.dtcs.length, 0);
    const overRev = analog.ingest(127489, dynamic(2, { oil: 1000, coolant: 3500, volts: 1400, status1: 1 << 12 }), map, ts);
    assert.deepEqual(overRev.alarms.map((a) => a.code), ["over-rev"]);
  });

  it("leaves an unmapped instance unmapped and does not guess port", () => {
    resetUnmappedWarnings();
    const warnings: string[] = [];
    const parsed = new AnalogAdapter().ingest(127488, rapid(4, 4000, 0, 0), {}, "2026-09-24T12:00:00.000Z", (line) => warnings.push(line));
    assert.equal(parsed.readings[0]?.engineId, "unmapped");
    assert.equal(warnings[0], "Engine instance 4 is unmapped");
    assert.equal(resolveEngineId(0, {}), "unmapped");
  });

  it("recovers after a dropped fast-packet frame", () => {
    resetUnmappedWarnings();
    const digital = new DigitalAdapter();
    const map = { "0": "port" as const };
    const payload = dynamic(0, { oil: 2758, coolant: 3532, volts: 1380, status1: 0, status2: 0 });
    const first = new Uint8Array(8);
    first[0] = 0x00;
    first[1] = payload.length;
    first.set(payload.slice(0, 6), 2);
    const gap = new Uint8Array(8);
    gap[0] = 0x02;
    const restart = new Uint8Array(8);
    restart[0] = 0x20;
    restart[1] = payload.length;
    restart.set(payload.slice(0, 6), 2);
    assert.equal(digital.ingest(127489, first, map, "2026-09-24T12:00:00.000Z").readings.length, 0);
    assert.ok(digital.ingest(127489, gap, map, "2026-09-24T12:00:00.000Z").drops.includes("gap"));
    assert.equal(digital.ingest(127489, restart, map, "2026-09-24T12:00:00.000Z").readings.length, 0);
    const rest = payload.slice(6);
    let seq = 0x21;
    let offset = 0;
    let done = 0;
    while (offset < rest.length) {
      const frame = new Uint8Array(8);
      frame[0] = seq;
      frame.set(rest.slice(offset, offset + 7), 1);
      const parsed = digital.ingest(127489, frame, map, "2026-09-24T12:00:00.000Z");
      done = parsed.readings.length;
      offset += 7;
      seq += 1;
    }
    assert.ok(done > 0);
  });
});

describe("engine room rules", () => {
  it("persists a calibration and dashes the delta until both sides are mapped", () => {
    let map = FACTORY_INSTANCE_MAP.instances;
    assert.equal(resolveEngineId(0, map), "unmapped");
    map = assignInstance(map, 0, "port");
    map = assignInstance(map, 1, "starboard");
    assert.equal(map["0"], "port");
    assert.equal(map["1"], "starboard");
    const again = assignInstance(map, 3, "port");
    assert.equal(again["0"], undefined);
    assert.equal(again["3"], "port");
    const rule = ENGINE_THRESHOLDS.delta.coolantTemp!;
    const dash = bankDelta(
      reading({ param: "coolantTemp", engineId: "unmapped", value: 180, unit: "°F" }),
      reading({ param: "coolantTemp", engineId: "starboard", value: 170, unit: "°F" }),
      rule,
    );
    assert.equal(dash.text, "—");
    const live = bankDelta(
      reading({ param: "coolantTemp", engineId: "port", value: 180, unit: "°F" }),
      reading({ param: "coolantTemp", engineId: "starboard", value: 170, unit: "°F" }),
      rule,
    );
    assert.equal(live.text, "+10");
    assert.equal(live.worse, "port");
  });

  it("uses a shorter stale window for 127488 than 127489", () => {
    const now = Date.parse("2026-09-24T12:00:02.000Z");
    const ts = "2026-09-24T12:00:00.000Z";
    const [rapidStale, slowOk] = applyStale(
      [
        reading({ param: "rpm", engineId: "port", pgn: 127488, ts }),
        reading({ param: "coolantTemp", engineId: "port", pgn: 127489, ts, unit: "°F" }),
      ],
      now,
      ENGINE_THRESHOLDS.staleMs,
    );
    assert.equal(rapidStale?.quality, "stale");
    assert.equal(slowOk?.quality, "ok");
  });

  it("renders a missing param as an em dash and does not invent it", () => {
    assert.equal(displayValue(undefined), "—");
    assert.equal(displayValue(reading({ param: "afrActual", engineId: "port", quality: "missing", value: Number.NaN, unit: "AFR" })), "—");
    const picture = simPicture({ "0": "port", "1": "starboard" }, 1_700_000_000_000);
    assert.equal(picture.bytesSent, 0);
    assert.equal(picture.dtcs.length, 0);
    assert.equal(picture.readings.some((row) => row.param === "afrActual"), false);
    assert.equal(picture.readings.filter((row) => row.engineId === "port").length > 0, true);
  });

  it("matches the JSON config files", () => {
    const thresholds = JSON.parse(readFileSync("config/engine-thresholds.json", "utf8"));
    const map = JSON.parse(readFileSync("config/engine-instance-map.json", "utf8"));
    assert.deepEqual(thresholds.staleMs, ENGINE_THRESHOLDS.staleMs);
    assert.deepEqual(thresholds.delta, ENGINE_THRESHOLDS.delta);
    assert.deepEqual(map.instances, FACTORY_INSTANCE_MAP.instances);
  });

  it("loads eight themes and keeps stealth night-safe", () => {
    const files = readdirSync("themes").filter((name) => name.endsWith(".json"));
    const themes = loadThemeBundles(files.map((name) => JSON.parse(readFileSync(`themes/${name}`, "utf8"))));
    assert.equal(themes.length, 8);
    assert.equal(validateTheme(themes.find((row) => row.id === "stealth-night"))?.nightSafe, true);
    assert.equal(YDEG04_COMPAT.ecm555, false);
    assert.equal(YDEG04_COMPAT.carburetedGasoline, false);
    assert.equal(YDEG04_UNPUBLISHED.every((row) => row.published === false && row.pgn == null), true);
  });

  it("has no transmit path in the engine sources", () => {
    const files = [
      ...readdirSync("src/lib/ahanu/engine").map((name) => `src/lib/ahanu/engine/${name}`),
      "src/lib/sensors/engine-source.ts",
      "src/lib/sensors/engine-bridge.ts",
    ];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      assert.equal(/socket\.(write|send)|createConnection|from "node:dgram"|from "node:net"/.test(text), false, file);
    }
  });
});
