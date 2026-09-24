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
  },
  delta: {
    rpm: { warn: 150, direction: "high", digits: 0 },
    coolantTemp: { warn: 8, direction: "high", digits: 0 },
    oilPressure: { warn: 6, direction: "low", digits: 0 },
    voltage: { warn: 0.4, direction: "low", digits: 1 },
    afrActual: { warn: 0.6, direction: "low", digits: 1 },
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
};
