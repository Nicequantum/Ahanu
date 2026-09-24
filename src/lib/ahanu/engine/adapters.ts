import type { EngineAlarm, EngineDtc, EngineReading, EngineSourceKind } from "@/lib/ahanu/types";
import { decode127488, decode127489, decode127493, instanceOf } from "./decode";
import { resolveEngineId, type InstanceMap } from "./map";
import { acceptCan, FastPacketAssembler } from "./pgn";

export interface ParsedEngine {
  readings: EngineReading[];
  alarms: EngineAlarm[];
  /** Always empty. Discrete bits are not DTCs. */
  dtcs: EngineDtc[];
  drops: string[];
}

const warned = new Set<number>();

export function resetUnmappedWarnings(): void {
  warned.clear();
}

export function noteUnmapped(instance: number, engineId: string, warn: (line: string) => void): void {
  if (engineId !== "unmapped") {
    warned.delete(instance);
    return;
  }
  if (warned.has(instance)) return;
  warned.add(instance);
  warn(`Engine instance ${instance} is unmapped`);
}

function parsePayload(
  pgn: number,
  data: Uint8Array,
  source: EngineSourceKind,
  map: InstanceMap,
  ts: string,
  allowTransmission: boolean,
  warn: (line: string) => void,
): ParsedEngine {
  const instance = instanceOf(pgn, data);
  if (instance == null) return { readings: [], alarms: [], dtcs: [], drops: ["no-instance"] };
  const engineId = resolveEngineId(instance, map);
  noteUnmapped(instance, engineId, warn);
  const ctx = { engineId, instance, source, ts };
  if (pgn === 127488) return { ...decode127488(data, ctx), dtcs: [], drops: [] };
  if (pgn === 127489) return { ...decode127489(data, ctx), dtcs: [], drops: [] };
  if (pgn === 127493) {
    if (!allowTransmission) return { readings: [], alarms: [], dtcs: [], drops: ["analog-ignores-127493"] };
    return { ...decode127493(data, ctx), dtcs: [], drops: [] };
  }
  return { readings: [], alarms: [], dtcs: [], drops: ["unsupported-pgn"] };
}

/**
 * Actisense EMU-1 / Across Ocean style analog gateway.
 * 127488 and 127489 only. No transmission PGN. No synthesized DTCs.
 * `bytesSent` stays 0 — this object cannot write a frame.
 */
export class AnalogAdapter {
  readonly bytesSent = 0;
  private readonly assembler = new FastPacketAssembler();

  ingest(pgn: number, bytes: Uint8Array, map: InstanceMap, ts: string, warn: (line: string) => void = () => {}): ParsedEngine {
    const step = acceptCan(this.assembler, pgn, bytes);
    if (step.kind === "wait") return { readings: [], alarms: [], dtcs: [], drops: [] };
    if (step.kind === "drop" || !step.data) return { readings: [], alarms: [], dtcs: [], drops: [step.reason ?? "drop"] };
    return parsePayload(pgn, step.data, "analog-n2k", map, ts, false, warn);
  }
}

/**
 * YDEG-04 / Mercury NMEA 2000 gateway path.
 * Same base PGNs as analog, plus 127493. Proprietary AFR/knock/injector fields
 * are not parsed because Yacht Devices does not publish their numbers.
 * DTCs stay empty until a real EFI source connects.
 */
export class DigitalAdapter {
  readonly bytesSent = 0;
  private readonly assembler = new FastPacketAssembler();

  ingest(pgn: number, bytes: Uint8Array, map: InstanceMap, ts: string, warn: (line: string) => void = () => {}): ParsedEngine {
    const step = acceptCan(this.assembler, pgn, bytes);
    if (step.kind === "wait") return { readings: [], alarms: [], dtcs: [], drops: [] };
    if (step.kind === "drop" || !step.data) return { readings: [], alarms: [], dtcs: [], drops: [step.reason ?? "drop"] };
    const source: EngineSourceKind = "smartcraft";
    return parsePayload(pgn, step.data, source, map, ts, true, warn);
  }

  dtcs(): EngineDtc[] {
    return [];
  }
}
