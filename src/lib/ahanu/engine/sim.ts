import type { EngineAlarm, EngineDtc, EngineReading, EngineRoomMode } from "@/lib/ahanu/types";
import { noteUnmapped } from "./adapters";
import { resolveEngineId, type InstanceMap } from "./map";

export interface EnginePicture {
  readings: EngineReading[];
  alarms: EngineAlarm[];
  dtcs: EngineDtc[];
  bytesSent: 0;
}

interface Bank {
  instance: number;
  rpm: number;
  coolant: number;
  oil: number;
  volts: number;
  hours: number;
  trim: number;
}

/** Standalone-ECU half of a bank. Display units: kPa, %, °F, AFR, °BTDC, ms. */
interface EfiBank {
  mapKpa: number;
  tps: number;
  iat: number;
  afrA: number;
  /** Second wideband reads this far from the first. Starboard runs a small, in-limit spread. */
  afrBOffset: number;
  afrCommanded: number;
  sparkAdvance: number;
  egt: number;
  injectorPw: number;
  /** Per-cylinder fuel imbalance as a fraction of mean pulse width, cylinders 1–8. */
  cylinderSkew: readonly number[];
}

const BANKS: readonly Bank[] = [
  { instance: 0, rpm: 1420, coolant: 168, oil: 46, volts: 13.8, hours: 1840, trim: 18 },
  { instance: 1, rpm: 1360, coolant: 176, oil: 40, volts: 13.4, hours: 1836, trim: 16 },
];

const EFI_BANKS: readonly EfiBank[] = [
  {
    mapKpa: 52,
    tps: 12,
    iat: 96,
    afrA: 14.1,
    afrBOffset: 0.05,
    afrCommanded: 14.2,
    sparkAdvance: 28,
    egt: 1040,
    injectorPw: 3.2,
    cylinderSkew: [0, 0.01, -0.01, 0.02, 0, -0.02, 0.01, 0],
  },
  {
    mapKpa: 55,
    tps: 13,
    iat: 101,
    afrA: 14.3,
    afrBOffset: 0.3,
    afrCommanded: 14.2,
    sparkAdvance: 27,
    egt: 1075,
    injectorPw: 3.3,
    cylinderSkew: [0.02, 0, -0.01, 0, 0.03, -0.02, 0, -0.01],
  },
];

/**
 * Twin 350s. Display units already. No DTC, no transmit.
 * `carb` (default) is the analog N2K picture with no AFR. `efi` adds the
 * Grok Pilot standalone fields (MAP, TPS, IAT, dual AFR, spark, EGT, injector PW).
 */
export function simPicture(
  map: InstanceMap,
  nowMs: number,
  warn: (line: string) => void = () => {},
  mode: EngineRoomMode = "carb",
): EnginePicture {
  const wobble = Math.sin(nowMs / 900);
  const ts = new Date(nowMs).toISOString();
  const readings: EngineReading[] = [];
  for (const bank of BANKS) {
    const engineId = resolveEngineId(bank.instance, map);
    noteUnmapped(bank.instance, engineId, warn);
    const pulse = bank.instance === 0 ? wobble : -wobble;
    const rows: [string, number, string, number][] = [
      ["rpm", bank.rpm + pulse * 30, "rpm", 127488],
      ["coolantTemp", bank.coolant + pulse * 0.4, "°F", 127489],
      ["oilPressure", bank.oil + pulse * 0.3, "psi", 127489],
      ["voltage", bank.volts, "V", 127489],
      ["hours", bank.hours, "h", 127489],
      ["trim", bank.trim, "%", 127488],
    ];
    if (mode === "efi") {
      const efi = EFI_BANKS[bank.instance];
      const pw = efi.injectorPw + pulse * 0.04;
      rows.push(
        ["mapKpa", efi.mapKpa + pulse * 0.8, "kPa", 0],
        ["tps", efi.tps + pulse * 0.2, "%", 0],
        ["iat", efi.iat, "°F", 0],
        ["afrA", efi.afrA + pulse * 0.05, "AFR", 0],
        ["afrB", efi.afrA + efi.afrBOffset + pulse * 0.05, "AFR", 0],
        ["afrCommanded", efi.afrCommanded, "AFR", 0],
        ["sparkAdvance", efi.sparkAdvance, "°BTDC", 0],
        ["egt", efi.egt + pulse * 4, "°F", 0],
        ["injectorPw", pw, "ms", 0],
      );
      efi.cylinderSkew.forEach((skew, i) => rows.push([`injectorPw${i + 1}`, pw * (1 + skew), "ms", 0]));
    }
    for (const [param, value, unit, pgn] of rows) {
      readings.push({
        engineId,
        param,
        value,
        unit,
        ts,
        source: "sim",
        quality: "ok",
        instance: bank.instance,
        ...(pgn ? { pgn } : {}),
      });
    }
  }
  return { readings, alarms: [], dtcs: [], bytesSent: 0 };
}
