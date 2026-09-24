import type { EngineReading } from "@/lib/ahanu/types";
import type { DeltaRule } from "./config";

export interface BankDelta {
  text: string;
  worse: "port" | "starboard" | null;
}

function live(reading: EngineReading | undefined): reading is EngineReading {
  return !!reading && reading.quality !== "missing" && reading.engineId !== "unmapped" && Number.isFinite(reading.value);
}

/** Port minus starboard. Either unmapped or missing side is an em dash, never a guess. */
export function bankDelta(
  port: EngineReading | undefined,
  starboard: EngineReading | undefined,
  rule: DeltaRule,
): BankDelta {
  if (!live(port) || !live(starboard)) return { text: "—", worse: null };
  const diff = port.value - starboard.value;
  const worse =
    Math.abs(diff) < rule.warn
      ? null
      : rule.direction === "high"
        ? diff > 0
          ? "port"
          : "starboard"
        : diff < 0
          ? "port"
          : "starboard";
  const sign = diff > 0 ? "+" : "";
  return { text: `${sign}${diff.toFixed(rule.digits)}`, worse };
}
