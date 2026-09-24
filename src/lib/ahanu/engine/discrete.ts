/**
 * PGN 127489 discrete status, 1-indexed bits from Yacht Devices YDEG-04 Appendix B.
 * Bit 1 is the least significant bit of status word 1. Status word 2 starts at bit 17.
 * These are Tier 1 alarms. They are not DTCs.
 */

export interface DiscreteFlag {
  word: 1 | 2;
  bit: number;
  code: string;
  description: string;
}

export const DISCRETE_STATUS_1: readonly DiscreteFlag[] = [
  { word: 1, bit: 0, code: "check-engine", description: "Check engine" },
  { word: 1, bit: 1, code: "over-temp", description: "Over temperature" },
  { word: 1, bit: 2, code: "low-oil-pressure", description: "Low oil pressure" },
  { word: 1, bit: 3, code: "low-oil-level", description: "Low oil level" },
  { word: 1, bit: 4, code: "low-fuel-pressure", description: "Low fuel pressure" },
  { word: 1, bit: 5, code: "low-voltage", description: "Low system voltage" },
  { word: 1, bit: 6, code: "low-coolant", description: "Low coolant level" },
  { word: 1, bit: 7, code: "water-flow", description: "Water flow" },
  { word: 1, bit: 8, code: "water-in-fuel", description: "Water in fuel" },
  { word: 1, bit: 9, code: "charge", description: "Charge indicator" },
  { word: 1, bit: 10, code: "preheat", description: "Preheat indicator" },
  { word: 1, bit: 11, code: "high-boost", description: "High boost pressure" },
  { word: 1, bit: 12, code: "over-rev", description: "Rev limit exceeded" },
  { word: 1, bit: 13, code: "egr", description: "EGR system" },
  { word: 1, bit: 14, code: "tps", description: "Throttle position sensor" },
  { word: 1, bit: 15, code: "e-stop", description: "Engine emergency stop" },
];

export const DISCRETE_STATUS_2: readonly DiscreteFlag[] = [
  { word: 2, bit: 0, code: "warn-1", description: "Warning level 1" },
  { word: 2, bit: 1, code: "warn-2", description: "Warning level 2" },
  { word: 2, bit: 2, code: "power-reduction", description: "Power reduction" },
  { word: 2, bit: 3, code: "maintenance", description: "Maintenance needed" },
  { word: 2, bit: 4, code: "comm-error", description: "Engine comm error" },
  { word: 2, bit: 5, code: "secondary-throttle", description: "Sub or secondary throttle" },
  { word: 2, bit: 6, code: "neutral-start", description: "Neutral start protect" },
  { word: 2, bit: 7, code: "shutting-down", description: "Engine shutting down" },
];

export function activeFlags(word: number | null, table: readonly DiscreteFlag[]): DiscreteFlag[] {
  if (word == null) return [];
  return table.filter((flag) => (word & (1 << flag.bit)) !== 0);
}
