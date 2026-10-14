/** Runtime copy of config/engine-thresholds.json and engine-instance-map.json. Tests lock them together. */

export type DeltaDirection = "high" | "low";

export interface DeltaRule {
  warn: number;
  direction: DeltaDirection;
  digits: number;
}

export const FACTORY_INSTANCE_MAP: { note: string; instances: Record<string, "port" | "starboard"> } = {
  note: "NMEA 2000 engine instance is not port or starboard. Empty until the skipper calibrates.",
  instances: {},
};

export const ENGINE_THRESHOLDS: {
  note: string;
  staleMs: Record<string, number>;
  delta: Record<string, DeltaRule>;
} = {
  note: "127488 is about 10 Hz. 127489 and 127493 are about 1 Hz. Do not share one timeout.",
  staleMs: {
    "127488": 500,
    "127489": 4000,
    "127493": 4000,
    standalone: 1000,
  },
  delta: {
    rpm: { warn: 150, direction: "high", digits: 0 },
    coolantTemp: { warn: 8, direction: "high", digits: 0 },
    oilPressure: { warn: 6, direction: "low", digits: 0 },
    voltage: { warn: 0.4, direction: "low", digits: 1 },
    afrActual: { warn: 0.6, direction: "low", digits: 1 },
    mapKpa: { warn: 8, direction: "high", digits: 0 },
    tps: { warn: 5, direction: "high", digits: 0 },
    iat: { warn: 15, direction: "high", digits: 0 },
    afrA: { warn: 0.6, direction: "high", digits: 1 },
    afrB: { warn: 0.6, direction: "high", digits: 1 },
    sparkAdvance: { warn: 3, direction: "high", digits: 1 },
    injectorPw: { warn: 0.6, direction: "high", digits: 2 },
    egt: { warn: 75, direction: "high", digits: 0 },
  },
};

export const CARB_PARAMS = ["rpm", "coolantTemp", "oilPressure", "voltage", "hours", "trim"] as const;

export const EFI_PARAMS = [
  "boost",
  "fuelRate",
  "afrCommanded",
  "afrActual",
  "knock",
  "injectorPw",
  "cylTrim1",
  "cylTrim2",
  "cylTrim3",
  "cylTrim4",
  "cylTrim5",
  "cylTrim6",
  "cylTrim7",
  "cylTrim8",
  "fuelPressure",
  "egt",
  "transTemp",
  "transPressure",
  "gear",
] as const;

/**
 * Grok Pilot standalone ECU (Speeduino Dropbear) fields. Names map 1:1 to
 * Nicequantum/ahanu-ecu docs/DATA-SCHEMA.md v0.1 through engine/schema.ts.
 */
export const STANDALONE_PARAMS = [
  "mapKpa",
  "tps",
  "iat",
  "afrA",
  "afrB",
  "afrCommanded",
  "sparkAdvance",
  "egt",
  "injectorPw",
] as const;

export const INJECTOR_CHANNELS = [
  "injectorPw1",
  "injectorPw2",
  "injectorPw3",
  "injectorPw4",
  "injectorPw5",
  "injectorPw6",
  "injectorPw7",
  "injectorPw8",
] as const;

/** AFR spread between the two widebands on one engine before its data is untrusted. Placeholder until ahanu-ecu sets it. */
export const WIDEBAND_SPREAD_AFR = 0.5;

export const PARAM_UNIT: Record<string, string> = {
  rpm: "rpm",
  coolantTemp: "°F",
  oilPressure: "psi",
  voltage: "V",
  hours: "h",
  trim: "%",
  boost: "psi",
  fuelRate: "gph",
  afrCommanded: "AFR",
  afrActual: "AFR",
  knock: "count",
  injectorPw: "ms",
  cylTrim1: "%",
  cylTrim2: "%",
  cylTrim3: "%",
  cylTrim4: "%",
  cylTrim5: "%",
  cylTrim6: "%",
  cylTrim7: "%",
  cylTrim8: "%",
  fuelPressure: "psi",
  egt: "°F",
  transTemp: "°F",
  transPressure: "psi",
  gear: "gear",
  mapKpa: "kPa",
  tps: "%",
  iat: "°F",
  afrA: "AFR",
  afrB: "AFR",
  sparkAdvance: "°BTDC",
  injectorPw1: "ms",
  injectorPw2: "ms",
  injectorPw3: "ms",
  injectorPw4: "ms",
  injectorPw5: "ms",
  injectorPw6: "ms",
  injectorPw7: "ms",
  injectorPw8: "ms",
};
