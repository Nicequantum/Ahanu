import type { EngineAlarm, EngineDtc, EngineReading } from "@/lib/ahanu/types";
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

const BANKS: readonly Bank[] = [
  { instance: 0, rpm: 1420, coolant: 168, oil: 46, volts: 13.8, hours: 1840, trim: 18 },
  { instance: 1, rpm: 1360, coolant: 176, oil: 40, volts: 13.4, hours: 1836, trim: 16 },
];

/** Carbureted twin 350s. Display units already. No AFR, no DTC, no transmit. */
export function simPicture(map: InstanceMap, nowMs: number, warn: (line: string) => void = () => {}): EnginePicture {
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
        pgn,
      });
    }
  }
  return { readings, alarms: [], dtcs: [], bytesSent: 0 };
}
