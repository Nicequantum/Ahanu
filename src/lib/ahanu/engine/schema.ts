/**
 * Bridge from Ahanu display params to the Grok Pilot Teensy log schema
 * (Nicequantum/ahanu-ecu docs/DATA-SCHEMA.md v0.1, engine sample record).
 * Gauges keep display units (°F, psi, ms). The schema stores °C, kPa, µs.
 */

import type { EngineId, EngineReading } from "@/lib/ahanu/types";

export interface SchemaField {
  field: string;
  unit: string;
  toSchema: (display: number) => number;
}

const same = (v: number) => v;
const fToC = (f: number) => ((f - 32) * 5) / 9;
const psiToKpa = (psi: number) => psi * 6.894757293168361;
const msToUs = (ms: number) => ms * 1000;

const injector = (ch: number): SchemaField => ({ field: `inj_pw_us[${ch}]`, unit: "µs", toSchema: msToUs });

export const SCHEMA_FIELD: Record<string, SchemaField> = {
  rpm: { field: "rpm", unit: "rev/min", toSchema: same },
  mapKpa: { field: "map_kpa", unit: "kPa", toSchema: same },
  tps: { field: "tps_pct", unit: "%", toSchema: same },
  coolantTemp: { field: "coolant_c", unit: "°C", toSchema: fToC },
  iat: { field: "iat_c", unit: "°C", toSchema: fToC },
  afrA: { field: "afr_a", unit: "AFR", toSchema: same },
  afrB: { field: "afr_b", unit: "AFR", toSchema: same },
  voltage: { field: "battery_v", unit: "V", toSchema: same },
  sparkAdvance: { field: "spark_adv_deg", unit: "° BTDC", toSchema: same },
  egt: { field: "egt_c", unit: "°C", toSchema: fToC },
  oilPressure: { field: "oil_press_kpa", unit: "kPa", toSchema: psiToKpa },
  injectorPw1: injector(1),
  injectorPw2: injector(2),
  injectorPw3: injector(3),
  injectorPw4: injector(4),
  injectorPw5: injector(5),
  injectorPw6: injector(6),
  injectorPw7: injector(7),
  injectorPw8: injector(8),
};

/** DATA-SCHEMA engine_id enum. Unmapped never becomes port. */
export function schemaEngineId(id: EngineId): 0 | 1 | null {
  if (id === "port") return 0;
  if (id === "starboard") return 1;
  return null;
}

/**
 * One engine's readings as a schema-named sample. Only live (non-missing,
 * finite) readings are written; absent fields stay absent, never zero.
 */
export function toSchemaSample(readings: EngineReading[], engineId: EngineId): Record<string, number> | null {
  const id = schemaEngineId(engineId);
  if (id == null) return null;
  const out: Record<string, number> = { engine_id: id };
  for (const row of readings) {
    if (row.engineId !== engineId || row.quality === "missing" || !Number.isFinite(row.value)) continue;
    const spec = SCHEMA_FIELD[row.param];
    if (spec) out[spec.field] = spec.toSchema(row.value);
  }
  return out;
}
