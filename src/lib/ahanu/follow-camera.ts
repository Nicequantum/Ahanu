/**
 * Plotter Follow. Camera tracks ownship until the skipper pans, drags,
 * pinches, or zooms. Then Follow drops. Tap Follow to re-arm and center.
 * Ownship marker is independent — this module never invents a GPS fix.
 */

export function shouldRecenterOnOwnship(followShip: boolean, replayT: number | null): boolean {
  return followShip && replayT == null;
}

/** MapLibre user pan/zoom/rotate carry originalEvent; Follow easeTo does not. */
export function isUserPlotterGesture(e: { originalEvent?: unknown } | null | undefined): boolean {
  return e != null && e.originalEvent != null;
}

/** Skipper moved the map. Follow is off until the next Follow tap. */
export function followAfterSkipperMapMove(): false {
  return false;
}
