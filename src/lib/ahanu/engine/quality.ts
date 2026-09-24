import type { EngineReading } from "@/lib/ahanu/types";

/** Stale is per PGN family. A slow 127489 must not use the 127488 timeout. */
export function applyStale(readings: EngineReading[], nowMs: number, staleMs: Record<string, number>): EngineReading[] {
  return readings.map((reading) => {
    if (reading.quality === "missing" || reading.pgn == null) return reading;
    const limit = staleMs[String(reading.pgn)];
    if (limit == null) return reading;
    const age = nowMs - Date.parse(reading.ts);
    if (!Number.isFinite(age) || age > limit) return { ...reading, quality: "stale" };
    return reading;
  });
}

export function displayValue(reading: EngineReading | undefined, digits = 0): string {
  if (!reading || reading.quality === "missing" || !Number.isFinite(reading.value)) return "—";
  if (reading.param === "gear") {
    if (reading.value === 0) return "FWD";
    if (reading.value === 1) return "N";
    if (reading.value === 2) return "REV";
    return "—";
  }
  const text = reading.value.toFixed(digits);
  return reading.quality === "stale" ? `${text}·stale` : text;
}
