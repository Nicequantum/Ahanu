/** Display units. Both adapters call these. Wire units never reach a gauge. */

const PA_PER_PSI = 6894.757293168361;
const GPH_PER_M3H = 264.1720523581484;

export function kToF(kelvin: number): number {
  return (kelvin - 273.15) * (9 / 5) + 32;
}

export function fToK(fahrenheit: number): number {
  return ((fahrenheit - 32) * 5) / 9 + 273.15;
}

export function paToPsi(pa: number): number {
  return pa / PA_PER_PSI;
}

export function psiToPa(psi: number): number {
  return psi * PA_PER_PSI;
}

export function m3hToGph(m3h: number): number {
  return m3h * GPH_PER_M3H;
}

export function gphToM3h(gph: number): number {
  return gph / GPH_PER_M3H;
}

export function secondsToHours(seconds: number): number {
  return seconds / 3600;
}

export function hoursToSeconds(hours: number): number {
  return hours * 3600;
}

/** PGN oil / transmission temperature: uint16, 0.1 K. All-ones is missing. */
export function tempDeciK(raw: number | null): number | null {
  if (raw == null) return null;
  return kToF(raw * 0.1);
}

/** PGN 127489 engine temperature: uint16, 0.01 K. Not the 0.1 K oil field. */
export function tempCentiK(raw: number | null): number | null {
  if (raw == null) return null;
  return kToF(raw * 0.01);
}

/** Oil, boost, coolant, transmission pressure: uint16, 100 Pa. */
export function pressure100Pa(raw: number | null): number | null {
  if (raw == null) return null;
  return paToPsi(raw * 100);
}

/** Fuel pressure: uint16, 1000 Pa. */
export function fuelPressureFromRaw(raw: number | null): number | null {
  if (raw == null) return null;
  return paToPsi(raw * 1000);
}

/** Fuel rate: uint16, 0.0001 m³/h. */
export function fuelRateFromRaw(raw: number | null): number | null {
  if (raw == null) return null;
  return m3hToGph(raw * 0.0001);
}

export function rpmFromRaw(raw: number | null): number | null {
  if (raw == null) return null;
  return raw * 0.25;
}

export function voltsFromRaw(raw: number | null): number | null {
  if (raw == null) return null;
  return raw * 0.01;
}

export function hoursFromRaw(raw: number | null): number | null {
  if (raw == null) return null;
  return secondsToHours(raw);
}
