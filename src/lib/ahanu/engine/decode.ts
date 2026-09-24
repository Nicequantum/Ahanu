import type { EngineAlarm, EngineId, EngineReading, EngineSourceKind } from "@/lib/ahanu/types";
import { activeFlags, DISCRETE_STATUS_1, DISCRETE_STATUS_2 } from "./discrete";
import { readS16, readTrim, readU } from "./pgn";
import {
  fuelPressureFromRaw,
  fuelRateFromRaw,
  hoursFromRaw,
  pressure100Pa,
  rpmFromRaw,
  tempCentiK,
  tempDeciK,
  voltsFromRaw,
} from "./units";

export interface DecodeCtx {
  engineId: EngineId;
  instance: number;
  source: EngineSourceKind;
  ts: string;
}

export interface DecodeOut {
  readings: EngineReading[];
  alarms: EngineAlarm[];
}

function sample(
  ctx: DecodeCtx,
  param: string,
  unit: string,
  value: number | null,
  pgn: number,
): EngineReading {
  if (value == null || !Number.isFinite(value)) {
    return { ...ctx, param, unit, value: Number.NaN, quality: "missing", pgn };
  }
  return { ...ctx, param, unit, value, quality: "ok", pgn };
}

export function decode127488(data: Uint8Array, ctx: DecodeCtx): DecodeOut {
  if (data.length < 8) return { readings: [], alarms: [] };
  const rpm = rpmFromRaw(readU(data, 1, 2));
  const boost = pressure100Pa(readU(data, 3, 2));
  const trim = readTrim(data, 5);
  return {
    readings: [
      sample(ctx, "rpm", "rpm", rpm, 127488),
      sample(ctx, "boost", "psi", boost, 127488),
      sample(ctx, "trim", "%", trim, 127488),
    ],
    alarms: [],
  };
}

export function decode127489(data: Uint8Array, ctx: DecodeCtx): DecodeOut {
  if (data.length < 26) return { readings: [], alarms: [] };
  const readings = [
    sample(ctx, "oilPressure", "psi", pressure100Pa(readU(data, 1, 2)), 127489),
    sample(ctx, "coolantTemp", "°F", tempCentiK(readU(data, 5, 2)), 127489),
    sample(ctx, "voltage", "V", voltsFromRaw(readS16(data, 7)), 127489),
    sample(ctx, "fuelRate", "gph", fuelRateFromRaw(readS16(data, 9)), 127489),
    sample(ctx, "hours", "h", hoursFromRaw(readU(data, 11, 4)), 127489),
    sample(ctx, "fuelPressure", "psi", fuelPressureFromRaw(readU(data, 17, 2)), 127489),
  ];
  const alarms: EngineAlarm[] = [];
  for (const flag of [
    ...activeFlags(readU(data, 20, 2), DISCRETE_STATUS_1),
    ...activeFlags(readU(data, 22, 2), DISCRETE_STATUS_2),
  ]) {
    alarms.push({
      tier: 1,
      engineId: ctx.engineId,
      instance: ctx.instance,
      code: flag.code,
      description: flag.description,
      state: "active",
      ts: ctx.ts,
      source: ctx.source,
      pgn: 127489,
    });
  }
  return { readings, alarms };
}

/** Gear: 0 forward, 1 neutral, 2 reverse. 3 is not available. */
export function decode127493(data: Uint8Array, ctx: DecodeCtx): DecodeOut {
  if (data.length < 8) return { readings: [], alarms: [] };
  const gearBits = data[1]! & 0x03;
  const gear = gearBits === 3 ? null : gearBits;
  return {
    readings: [
      sample(ctx, "gear", "gear", gear, 127493),
      sample(ctx, "transPressure", "psi", pressure100Pa(readU(data, 2, 2)), 127493),
      sample(ctx, "transTemp", "°F", tempDeciK(readU(data, 4, 2)), 127493),
    ],
    alarms: [],
  };
}

export function instanceOf(pgn: number, data: Uint8Array): number | null {
  if (data.length < 1) return null;
  if (pgn === 127488 || pgn === 127489 || pgn === 127493) {
    const id = data[0] ?? 0;
    return id === 0xff ? null : id;
  }
  return null;
}
