import type { EngineReading } from "@/lib/ahanu/types";
import { displayValue } from "@/lib/ahanu/engine/quality";

export function shown(reading: EngineReading | undefined, digits: number): string {
  return displayValue(reading, digits);
}

export function fraction(reading: EngineReading | undefined, min: number, max: number): number {
  if (!reading || reading.quality === "missing" || !Number.isFinite(reading.value)) return 0;
  return Math.min(1, Math.max(0, (reading.value - min) / (max - min || 1)));
}

export function arcPoint(cx: number, cy: number, r: number, t: number): { x: number; y: number } {
  const angle = Math.PI * (1 - t);
  return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
}
