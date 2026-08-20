import { hoursToHm } from "./geo";
import type { BoatLimits } from "./types";

export interface FuelPlanInput {
  nm: number;
  cruiseKt: number;
  trollHours: number;
  boat: BoatLimits;
}

export interface FuelPlan {
  steamHours: number;
  trollHours: number;
  fuelUsed: number;
  fuelLeft: number;
  rangeNm: number;
  timeToDest: number;
  ok: boolean;
  note: string;
}

function gphAtSpeed(boat: BoatLimits, sogKt: number): number {
  const troll = Math.max(0.5, boat.trollKt);
  const cruise = Math.max(troll + 0.1, boat.cruiseKt);
  if (sogKt <= 0) return boat.gphTroll;
  if (sogKt <= troll) {
    return boat.gphTroll * Math.max(0.35, sogKt / troll);
  }
  if (sogKt <= cruise) {
    const u = (sogKt - troll) / (cruise - troll);
    return boat.gphTroll + u * (boat.gphCruise - boat.gphTroll);
  }
  const ratio = sogKt / cruise;
  return boat.gphCruise * ratio ** 2.6;
}

export function fuelPlan(input: FuelPlanInput): FuelPlan {
  const { nm, boat } = input;
  const cruiseKt = Math.max(0.1, input.cruiseKt || boat.cruiseKt);
  const trollHours = Math.max(0, input.trollHours);
  const steamHours = Math.max(0, nm) / cruiseKt;
  const fuelUsed = steamHours * boat.gphCruise + trollHours * boat.gphTroll;
  const fuelLeft = boat.fuelGal - fuelUsed;
  const usable = fuelLeft - boat.reserveGal;
  const rangeNm = usable > 0 ? (usable / boat.gphCruise) * cruiseKt : 0;
  const timeToDest = steamHours;
  const ok = fuelLeft >= boat.reserveGal - 1e-6;

  let note: string;
  if (ok) {
    note =
      `Steam ${hoursToHm(steamHours)} + troll ${hoursToHm(trollHours)}. ` +
      `Burn ${fuelUsed.toFixed(0)} gal, ${fuelLeft.toFixed(0)} gal remaining ` +
      `(${boat.reserveGal} gal reserve held). Range after arrival ${rangeNm.toFixed(0)} nm.`;
  } else {
    const short = boat.reserveGal - fuelLeft;
    note =
      `Plan burns ${fuelUsed.toFixed(0)} gal vs ${boat.fuelGal} gal capacity ` +
      `with ${boat.reserveGal} gal reserve. Short by ${short.toFixed(0)} gal — ` +
      `cut troll time or carry extra.`;
  }

  return {
    steamHours,
    trollHours,
    fuelUsed,
    fuelLeft,
    rangeNm,
    timeToDest,
    ok,
    note,
  };
}

/** Remaining range (nm) at `sogKt` assuming a full tank minus reserve. */
export function rangeRingNm(boat: BoatLimits, sogKt: number): number {
  if (sogKt <= 0) return 0;
  const gph = Math.max(0.05, gphAtSpeed(boat, sogKt));
  const usable = Math.max(0, boat.fuelGal - boat.reserveGal);
  return (usable / gph) * sogKt;
}
