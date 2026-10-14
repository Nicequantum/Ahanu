import type { EngineId, EngineReading } from "@/lib/ahanu/types";
import type { DeltaRule } from "./config";
import { bankDelta, type BankDelta } from "./delta";

export type SyncStatus = "sync" | "mismatch" | "stale" | "missing";

export interface SyncRow {
  param: string;
  port?: EngineReading;
  starboard?: EngineReading;
  delta: BankDelta;
  status: SyncStatus;
}

export interface SyncSummary {
  rows: SyncRow[];
  sync: number;
  mismatch: number;
  stale: number;
  missing: number;
  /** True only when every compared param has both banks live and inside its delta rule. */
  allInSync: boolean;
}

function pick(readings: EngineReading[], id: EngineId, param: string): EngineReading | undefined {
  return readings.find((row) => row.engineId === id && row.param === param);
}

function usable(row: EngineReading | undefined): row is EngineReading {
  return !!row && row.quality !== "missing" && Number.isFinite(row.value);
}

/**
 * Port vs starboard, param by param. Missing beats stale beats mismatch:
 * a dead or stale side is never reported as "in sync".
 */
export function dualSync(readings: EngineReading[], params: readonly string[], rules: Record<string, DeltaRule>): SyncSummary {
  const rows: SyncRow[] = params.map((param) => {
    const port = pick(readings, "port", param);
    const starboard = pick(readings, "starboard", param);
    const rule = rules[param];
    const delta = rule ? bankDelta(port, starboard, rule) : { text: "—", worse: null };
    let status: SyncStatus;
    if (!usable(port) || !usable(starboard)) status = "missing";
    else if (port.quality === "stale" || starboard.quality === "stale") status = "stale";
    else if (!rule) status = "sync";
    else status = delta.worse ? "mismatch" : "sync";
    return { param, port, starboard, delta, status };
  });
  const count = (s: SyncStatus) => rows.filter((row) => row.status === s).length;
  return {
    rows,
    sync: count("sync"),
    mismatch: count("mismatch"),
    stale: count("stale"),
    missing: count("missing"),
    allInSync: rows.length > 0 && rows.every((row) => row.status === "sync"),
  };
}

export type WidebandStatus = "agree" | "disagree" | "missing";

export interface WidebandCheck {
  engineId: EngineId;
  status: WidebandStatus;
  spread: number | null;
}

/** Same-engine cross-check of afrA vs afrB. Disagreement maps to reject_reason wideband_disagree. */
export function widebandCheck(readings: EngineReading[], engineId: EngineId, limitAfr: number): WidebandCheck {
  const a = pick(readings, engineId, "afrA");
  const b = pick(readings, engineId, "afrB");
  if (!usable(a) || !usable(b) || a.quality === "stale" || b.quality === "stale") {
    return { engineId, status: "missing", spread: null };
  }
  const spread = Math.abs(a.value - b.value);
  return { engineId, status: spread > limitAfr ? "disagree" : "agree", spread };
}
