/**
 * Merge live GFS hour-0 onto the 72 h fixture wind/wave stack.
 * Hour 0 is NOAA; hours 3–72 stay fixture. Not a live 72 h series.
 * Keep free of `@/` aliases so the Worker can import it.
 */

import type { PackBBox, PackedGrid } from "./pack-fixtures";

export const GFS_HOUR0_FIXTURE_NOTE = "gfs: hour-0 live; hours 3–72 fixture (series off)";

export function gfsHour0FixtureNote(kind: "off" | "incomplete" = "off"): string {
  return kind === "off"
    ? GFS_HOUR0_FIXTURE_NOTE
    : "gfs: hour-0 live; hours 3–72 fixture (series incomplete)";
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
 * Paint live hour-0 onto the fixture mesh. Hours 3–72 stay fixture.
 * hoursCovered is the combined stack (fixture horizon), not a live 72 h claim.
 */
export function mergeHour0IntoFixture(
  live: PackedGrid,
  fixture: PackedGrid,
  note = GFS_HOUR0_FIXTURE_NOTE,
): PackedGrid {
  const hours = fixture.hours.length ? [...fixture.hours] : [0];
  let idx = hours.indexOf(0);
  if (idx < 0) {
    hours.unshift(0);
    idx = 0;
  }
  const liveHour = hour0Plane(live);
  const livePlane = liveHour?.values[0];
  if (!livePlane || !liveHour) return fixture;

  const values = fixture.values.map((p) => p.slice());
  const tmpl = values[idx] ?? values[0] ?? [];
  while (values.length < hours.length) values.push(tmpl.slice());

  const painted = new Array<number>(fixture.nx * fixture.ny);
  if (sameMesh(liveHour, fixture) && livePlane.length === fixture.nx * fixture.ny) {
    for (let i = 0; i < livePlane.length; i++) painted[i] = livePlane[i]!;
  } else {
    for (let y = 0; y < fixture.ny; y++) {
      const lat = gridLat(fixture.bbox, fixture.ny, y);
      for (let x = 0; x < fixture.nx; x++) {
        const lon = gridLon(fixture.bbox, fixture.nx, x);
        const v = sampleNearest(liveHour, livePlane, lat, lon);
        const i = y * fixture.nx + x;
        painted[i] = v != null ? v : (tmpl[i] ?? 0);
      }
    }
  }
  values[idx] = painted;

  const hoursCovered = Math.max(fixture.hoursCovered ?? 0, hours.length ? Math.max(...hours) : 0);

  return {
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
}

