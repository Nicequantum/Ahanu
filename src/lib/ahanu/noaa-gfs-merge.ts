/**
 * Merge live GFS hours onto the 72 h fixture wind/wave stack.
 * A complete 72 h series is used as-is (no fixture tail).
 * A short live prefix paints those hours; the remainder stays fixture.
 * hoursCovered on a mixed stack is the fixture horizon so Ready does not
 * fail 1 h < 72 h. That is not a live 72 h NOAA claim — the note says so.
 * Keep free of `@/` aliases so the Worker can import it.
 */

import type { PackBBox, PackedGrid } from "./pack-fixtures";

export const GFS_HOUR0_FIXTURE_NOTE = "gfs: hour-0 live; hours 3–72 fixture (series off)";

export function gfsHour0FixtureNote(kind: "off" | "incomplete" = "off"): string {
  return kind === "off"
    ? GFS_HOUR0_FIXTURE_NOTE
    : "gfs: hour-0 live; hours 3–72 fixture (series incomplete)";
}

/** Honest live-vs-fixture line. Empty when every requested hour is live. */
export function gfsLiveHoursNote(liveHours: number[], maxHour = 72): string {
  const sorted = [...new Set(liveHours)].filter((h) => Number.isFinite(h)).sort((a, b) => a - b);
  if (!sorted.length) return GFS_HOUR0_FIXTURE_NOTE;
  if (sorted.length === 1 && sorted[0] === 0) return gfsHour0FixtureNote("incomplete");
  const last = sorted[sorted.length - 1]!;
  const step = sorted.length > 1 ? Math.max(1, sorted[1]! - sorted[0]!) : 3;
  const expected = Math.floor(maxHour / step) + 1;
  if (sorted[0] === 0 && last >= maxHour && sorted.length >= expected) return "";
  return `gfs: hours ${sorted.join(",")} live; remaining hours through ${maxHour} fixture (series incomplete)`;
}

export function isGfsHonestyNote(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith("gfs:")) return false;
  if (t === GFS_HOUR0_FIXTURE_NOTE || t === gfsHour0FixtureNote("incomplete")) return true;
  return /fixture/.test(t) && !/f000–f072/.test(t);
}

function gridLat(bbox: PackBBox, ny: number, y: number): number {
  return ny === 1 ? (bbox.north + bbox.south) / 2 : bbox.north - ((bbox.north - bbox.south) * y) / (ny - 1);
}

function gridLon(bbox: PackBBox, nx: number, x: number): number {
  return nx === 1 ? (bbox.west + bbox.east) / 2 : bbox.west + ((bbox.east - bbox.west) * x) / (nx - 1);
}

function sampleNearest(grid: PackedGrid, plane: number[], lat: number, lon: number): number | null {
  const { west, east, south, north } = grid.bbox;
  if (lat < south || lat > north || lon < west || lon > east) return null;
  const fx = grid.nx === 1 ? 0 : ((lon - west) / (east - west)) * (grid.nx - 1);
  const fy = grid.ny === 1 ? 0 : ((north - lat) / (north - south)) * (grid.ny - 1);
  const x = Math.max(0, Math.min(grid.nx - 1, Math.round(fx)));
  const y = Math.max(0, Math.min(grid.ny - 1, Math.round(fy)));
  const v = plane[y * grid.nx + x];
  return v == null ? null : v;
}

function sameMesh(a: PackedGrid, b: PackedGrid): boolean {
  return (
    a.nx === b.nx &&
    a.ny === b.ny &&
    a.bbox.west === b.bbox.west &&
    a.bbox.east === b.bbox.east &&
    a.bbox.south === b.bbox.south &&
    a.bbox.north === b.bbox.north
  );
}

function paintPlane(live: PackedGrid, livePlane: number[], fixture: PackedGrid, tmpl: number[]): number[] {
  const painted = new Array<number>(fixture.nx * fixture.ny);
  if (sameMesh(live, fixture) && livePlane.length === fixture.nx * fixture.ny) {
    for (let i = 0; i < livePlane.length; i++) painted[i] = livePlane[i]!;
    return painted;
  }
  for (let y = 0; y < fixture.ny; y++) {
    const lat = gridLat(fixture.bbox, fixture.ny, y);
    for (let x = 0; x < fixture.nx; x++) {
      const lon = gridLon(fixture.bbox, fixture.nx, x);
      const v = sampleNearest(live, livePlane, lat, lon);
      const i = y * fixture.nx + x;
      painted[i] = v != null ? v : (tmpl[i] ?? 0);
    }
  }
  return painted;
}

/** Hour-0 plane only. Undefined if the stack has no hour 0. */
export function hour0Plane(grid: PackedGrid | undefined | null): PackedGrid | undefined {
  if (!grid?.values?.length) return undefined;
  const found = grid.hours.indexOf(0);
  const idx = found >= 0 ? found : grid.hours.length <= 1 && (grid.hours[0] ?? 0) === 0 ? 0 : -1;
  if (idx < 0) return undefined;
  const plane = grid.values[idx];
  if (!plane) return undefined;
  const out: PackedGrid = {
    kind: "grid",
    layer: grid.layer,
    bbox: grid.bbox,
    nx: grid.nx,
    ny: grid.ny,
    hours: [0],
    hoursCovered: 1,
    unit: grid.unit,
    values: [plane],
    live: true,
    source: "noaa",
    fixture: false,
    note: "NCEP Atlantic 0p16 hour 0 only — not a 72 h forecast.",
  };
  if (grid.dirValues?.[idx]) {
    out.dirUnit = grid.dirUnit ?? "deg";
    out.dirValues = [grid.dirValues[idx]!];
  }
  if (grid.periodValues?.[idx]) {
    out.periodUnit = grid.periodUnit ?? "s";
    out.periodValues = [grid.periodValues[idx]!];
  }
  return out;
}

/**
 * Paint every live hour onto the matching fixture hour.
 * Hours the live grid does not have stay fixture.
 * hoursCovered is the combined stack (fixture horizon), not a live 72 h claim.
 */
export function mergeLiveHoursIntoFixture(
  live: PackedGrid,
  fixture: PackedGrid,
  note: string,
): PackedGrid {
  const hours = fixture.hours.length ? [...fixture.hours] : [0];
  const values = fixture.values.map((p) => p.slice());
  const tmpl = values[0] ?? [];
  while (values.length < hours.length) values.push(tmpl.slice());

  const liveIndex = new Map<number, number>();
  live.hours.forEach((h, i) => liveIndex.set(h, i));

  const dirValues = fixture.dirValues?.map((p) => p.slice());
  const periodValues = fixture.periodValues?.map((p) => p.slice());
  if (dirValues) while (dirValues.length < hours.length) dirValues.push((dirValues[0] ?? []).slice());
  if (periodValues) while (periodValues.length < hours.length) periodValues.push((periodValues[0] ?? []).slice());

  for (let fi = 0; fi < hours.length; fi++) {
    const li = liveIndex.get(hours[fi]!);
    if (li == null) continue;
    const livePlane = live.values[li];
    if (!livePlane) continue;
    values[fi] = paintPlane(live, livePlane, fixture, values[fi] ?? tmpl);
    if (dirValues && live.dirValues?.[li]) {
      dirValues[fi] = paintPlane(live, live.dirValues[li]!, fixture, dirValues[fi] ?? []);
    }
    if (periodValues && live.periodValues?.[li]) {
      periodValues[fi] = paintPlane(live, live.periodValues[li]!, fixture, periodValues[fi] ?? []);
    }
  }

  const hoursCovered = Math.max(fixture.hoursCovered ?? 0, hours.length ? Math.max(...hours) : 0);
  const out: PackedGrid = {
    kind: "grid",
    layer: fixture.layer,
    bbox: fixture.bbox,
    nx: fixture.nx,
    ny: fixture.ny,
    hours,
    hoursCovered,
    unit: fixture.unit,
    values,
    live: true,
    source: "noaa",
    fixture: true,
    note,
  };
  if (dirValues && (live.dirValues || fixture.dirValues)) {
    out.dirUnit = live.dirUnit ?? fixture.dirUnit ?? "deg";
    out.dirValues = dirValues;
  }
  if (periodValues && (live.periodValues || fixture.periodValues)) {
    out.periodUnit = live.periodUnit ?? fixture.periodUnit ?? "s";
    out.periodValues = periodValues;
  }
  return out;
}

/**
 * Paint live hour-0 onto the fixture mesh. Hours 3–72 stay fixture.
 * hoursCovered is the combined stack (fixture horizon), not a live 72 h claim.
 */
export function mergeHour0IntoFixture(
  live: PackedGrid,
  fixture: PackedGrid,
  note = GFS_HOUR0_FIXTURE_NOTE,
): PackedGrid {
  const liveHour = hour0Plane(live);
  if (!liveHour) return fixture;
  return mergeLiveHoursIntoFixture(liveHour, fixture, note);
}
