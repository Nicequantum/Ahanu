/**
 * Helm wall clock. Default Date.now().
 * Tide next high/low and the now-marker use this — not a leftover demo stamp.
 * Tests inject a frozen now; they do not invent NOAA water levels.
 */

let nowFn: (() => number) | null = null;

export function helmNowMs(): number {
  return nowFn ? nowFn() : Date.now();
}

/** Tests only. Pass null to restore Date.now(). */
export function setHelmNowMs(fn: (() => number) | null): void {
  nowFn = fn;
}
