/**
 * One-tap Frame harbor. Always easeTo the documented official
 * US5PVDCB ∪ US5PVDBB pin (Point Judith Harbor + inlet) so Galilee
 * stays in view. Never the tide-harbor store (Newport). Never
 * US5PVDCD / US3RI1AA / US5PVDDD / whole bay. Huge or wrong extract
 * footprints are rejected — ENCProdCat 2026-08-21 / official .000
 * vertices, not invented. Drops Follow the same way a skipper pan
 * does. Camera persist is moveend → ahanu-camera. easeTo the pin
 * (flyTo from Veatch zooms out through the bay). No fitBounds,
 * no offset, no asymmetric padding — leftover east of −71.45
 * (US5PVDCD at the landscape edge) is acceptable. Not ECDIS.
 */

import { NEWPORT, POINT_JUDITH_HARBOR_BBOX } from "./constants";
import { parsePackBbox } from "./frame-pack";
import type { PackBBox } from "./pack-fixtures";

export const FRAME_HARBOR_LABEL = "Frame harbor";

/** Official Point Judith Harbor cell (pond). South edge is 41.4 — Galilee is south of this. */
export const HARBOR_FRAME_CELL = "US5PVDCB";

/** Official inlet / Block Island Sound approach that covers Galilee. */
export const HARBOR_FRAME_INLET = "US5PVDBB";

/** Packed official harbor + inlet. The only cells Frame harbor may use. */
export const HARBOR_FRAME_UNION = ["US5PVDCB", "US5PVDBB"] as const;

/**
 * Narragansett Bay East Pass. Never framed — official footprint
 * pulls north of the harbor (41.475–41.55).
 */
export const HARBOR_FRAME_BAY_CELL = "US5PVDDD";

/** East Passage / Newport approach. Never framed. */
export const HARBOR_FRAME_EAST_PASS = "US5PVDCD";

/** Usage-3 Rhode Island overview. Never framed. */
export const HARBOR_FRAME_RI_OVERVIEW = "US3RI1AA";

export const HARBOR_FRAME_BANNED = ["US5PVDCD", "US3RI1AA", "US5PVDDD"] as const;

/** Official ENCProdCat / US5PVDCB.000 extract. Pond only — Galilee is south of 41.4. */
export const US5PVDCB_OFFICIAL_BBOX: PackBBox = {
  west: -71.55,
  south: 41.4,
  east: -71.475,
  north: 41.475,
};

/** Official ENCProdCat / US5PVDBB.000 extract. Same as POINT_JUDITH_HARBOR_BBOX. */
export const US5PVDBB_OFFICIAL_BBOX: PackBBox = { ...POINT_JUDITH_HARBOR_BBOX };

/**
 * Official US5PVDCB ∪ US5PVDBB. This is the documented Frame harbor pin box.
 * west -71.55, south 41.325, east -71.475, north 41.475.
 * Galilee (41.3615) inside. Newport (41.49) outside.
 */
export const HARBOR_FRAME_BBOX: PackBBox = {
  west: -71.55,
  south: 41.325,
  east: -71.475,
  north: 41.475,
};

/** Galilee / Point Judith Harbor dock. South of US5PVDCB-only (41.4). */
export const GALILEE_DOCK = { lon: -71.51, lat: 41.3615 };

/** Documented harbor-scale cap. Camera is the pin zoom, not fitBounds. */
export const FRAME_HARBOR_MAX_ZOOM = 14;

/** Documented pin zoom — Galilee stays readable on a laptop plotter. */
export const FRAME_HARBOR_ZOOM = 12.5;

/** Midpoint of HARBOR_FRAME_BBOX. Literals so the camera is exact. */
export const FRAME_HARBOR_CENTER: [number, number] = [-71.5125, 41.4];

export const FRAME_HARBOR_FIT = {
  padding: 32,
  duration: 500,
  maxZoom: FRAME_HARBOR_MAX_ZOOM,
  /** easeTo is already linear — flyTo from Veatch zooms out through Narragansett. */
  linear: true,
  essential: true,
} as const;

/** Documented official pin corners (SW, NE). Official US5PVDCB ∪ US5PVDBB. */
export const FRAME_HARBOR_FIT_BOUNDS: [[number, number], [number, number]] = [
  [HARBOR_FRAME_BBOX.west, HARBOR_FRAME_BBOX.south],
  [HARBOR_FRAME_BBOX.east, HARBOR_FRAME_BBOX.north],
];

/** East of this is US5PVDCD / Newport approach. Landscape leftover there is acceptable. */
export const HARBOR_VIEW_EAST_MAX = -71.45;

export type HarborFrameSource = "US5PVDCB" | "harbor-union" | "pj-harbor-box";

export interface HarborFrame {
  bbox: PackBBox;
  source: HarborFrameSource;
  cellIds: string[];
}

export interface HarborFrameInput {
  extract?: {
    cells?: Array<{ cellId?: string; bounds?: unknown }>;
    features?: GeoJSON.Feature[];
  } | null;
  cells?: Array<{
    id?: string;
    west?: unknown;
    south?: unknown;
    east?: unknown;
    north?: unknown;
  }> | null;
  /** Ignored. Frame harbor is not the tide-harbor picker. */
  tideHarbor?: unknown;
}

function bboxFromRing(ring: GeoJSON.Position[] | undefined): PackBBox | null {
  if (!ring?.length) return null;
  const lons = ring
    .map((p) => p[0])
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  const lats = ring
    .map((p) => p[1])
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (!lons.length || !lats.length) return null;
  return parsePackBbox({
    west: Math.min(...lons),
    south: Math.min(...lats),
    east: Math.max(...lons),
    north: Math.max(...lats),
  });
}

function bboxFromGeometry(geom: GeoJSON.Geometry | null | undefined): PackBBox | null {
  if (!geom) return null;
  if (geom.type === "Polygon") return bboxFromRing(geom.coordinates[0]);
  if (geom.type === "MultiPolygon") {
    const boxes = geom.coordinates
      .map((poly) => bboxFromRing(poly[0]))
      .filter((b): b is PackBBox => b != null);
    return unionBoxes(boxes);
  }
  return null;
}

function unionBoxes(boxes: PackBBox[]): PackBBox | null {
  if (!boxes.length) return null;
  return {
    west: Math.min(...boxes.map((b) => b.west)),
    south: Math.min(...boxes.map((b) => b.south)),
    east: Math.max(...boxes.map((b) => b.east)),
    north: Math.max(...boxes.map((b) => b.north)),
  };
}

function isUnionCell(id: string): id is (typeof HARBOR_FRAME_UNION)[number] {
  return id === HARBOR_FRAME_CELL || id === HARBOR_FRAME_INLET;
}

/** Extract bounds first, then enc-s57-cell polygons, then pack catalog boxes. */
export function harborFootprints(input?: HarborFrameInput | null): Map<string, PackBBox> {
  const out = new Map<string, PackBBox>();
  for (const cell of input?.cells ?? []) {
    if (!cell?.id || !isUnionCell(cell.id)) continue;
    const bbox = parsePackBbox(cell);
    if (bbox) out.set(cell.id, bbox);
  }
  for (const f of input?.extract?.features ?? []) {
    const props = (f.properties ?? {}) as { id?: string; cellId?: string; kind?: string };
    const id = props.id || props.cellId;
    if (!id || !isUnionCell(id)) continue;
    if (props.kind && props.kind !== "enc-s57-cell") continue;
    const bbox = bboxFromGeometry(f.geometry);
    if (bbox) out.set(id, bbox);
  }
  for (const cell of input?.extract?.cells ?? []) {
    if (!cell?.cellId || !isUnionCell(cell.cellId)) continue;
    const bbox = parsePackBbox(cell.bounds);
    if (bbox) out.set(cell.cellId, bbox);
  }
  return out;
}

/** Span stays z12–14 harbor-scale, not a Narragansett Bay / canyon overview. */
export function isHarborScaleBbox(bbox: PackBBox): boolean {
  return bbox.north - bbox.south < 0.2 && bbox.east - bbox.west < 0.2;
}

export function bboxContainsLonLat(bbox: PackBBox, lon: number, lat: number): boolean {
  return lon >= bbox.west && lon <= bbox.east && lat >= bbox.south && lat <= bbox.north;
}

/**
 * Accept only a harbor-scale US5PVDCB / US5PVDBB print that stays on
 * the Point Judith cells. Huge extract hulls, Newport, and the bay fail.
 */
export function isAcceptedHarborPrint(id: string, box: PackBBox): boolean {
  if (!isUnionCell(id)) return false;
  if (!isHarborScaleBbox(box)) return false;
  if (bboxContainsLonLat(box, NEWPORT.lon, NEWPORT.lat)) return false;
  if (box.north > 41.48) return false;
  if (box.east > -71.45) return false;
  return true;
}

function sourceOf(ids: string[]): HarborFrameSource {
  if (!ids.length) return "pj-harbor-box";
  if (ids.length === 1 && ids[0] === HARBOR_FRAME_CELL) return "US5PVDCB";
  return "harbor-union";
}

/**
 * Camera box is always the official US5PVDCB ∪ US5PVDBB union.
 * Packed prints only label which of those two cells landed.
 * Tide harbor is ignored. Banned cells never join the box.
 */
export function harborFrameOf(input?: HarborFrameInput | null): HarborFrame {
  const prints = harborFootprints(input);
  const ids = HARBOR_FRAME_UNION.filter((id) => {
    const box = prints.get(id);
    return box != null && isAcceptedHarborPrint(id, box);
  });
  return {
    bbox: { ...HARBOR_FRAME_BBOX },
    source: sourceOf(ids),
    cellIds: ids,
  };
}

export function bboxToFrameHarbor(input?: HarborFrameInput | null): PackBBox {
  return harborFrameOf(input).bbox;
}

function mercatorX(lon: number): number {
  return (lon + 180) / 360;
}

function mercatorY(lat: number): number {
  const rad = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

function lonFromMercatorX(x: number): number {
  return x * 360 - 180;
}

function latFromMercatorY(y: number): number {
  const n = Math.PI * (1 - 2 * y);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

export type HarborFitPadding =
  number | { top: number; bottom: number; left: number; right: number };

function paddingEdges(padding: HarborFitPadding): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  if (typeof padding === "number") {
    return { top: padding, bottom: padding, left: padding, right: padding };
  }
  return padding;
}

/** Visible plotter after fitBounds of `box`. Landscape width can spill past the pin. */
export function viewportAfterHarborFit(
  box: PackBBox,
  mapSize: { width: number; height: number },
  opts: { padding: HarborFitPadding; maxZoom: number } = FRAME_HARBOR_FIT,
): PackBBox {
  const pad = paddingEdges(opts.padding);
  const availW = Math.max(1, mapSize.width - pad.left - pad.right);
  const availH = Math.max(1, mapSize.height - pad.top - pad.bottom);
  const tile = 512;
  const xSpan = Math.abs(mercatorX(box.east) - mercatorX(box.west));
  const ySpan = Math.abs(mercatorY(box.south) - mercatorY(box.north));
  const zoomW = Math.log2(availW / (xSpan * tile));
  const zoomH = Math.log2(availH / (ySpan * tile));
  const zoom = Math.min(zoomW, zoomH, opts.maxZoom);
  const world = tile * 2 ** zoom;
  // MapLibre cameraForBoxAndBearing: paddingOffset = ((left-right)/2, (top-bottom)/2)
  // is subtracted from the bounds midpoint. _fitInternal then deletes padding,
  // so this is the actual easeTo camera — no second shift.
  const padOffX = (pad.left - pad.right) / 2;
  const padOffY = (pad.top - pad.bottom) / 2;
  const cx = (mercatorX(box.west) + mercatorX(box.east)) / 2 - padOffX / world;
  const cy = (mercatorY(box.south) + mercatorY(box.north)) / 2 - padOffY / world;
  const halfW = mapSize.width / 2 / world;
  const halfH = mapSize.height / 2 / world;
  return {
    west: lonFromMercatorX(cx - halfW),
    east: lonFromMercatorX(cx + halfW),
    north: latFromMercatorY(cy - halfH),
    south: latFromMercatorY(cy + halfH),
  };
}

export function shiftViewportWest(view: PackBBox, shiftDeg: number): PackBBox {
  return {
    west: view.west - shiftDeg,
    east: view.east - shiftDeg,
    south: view.south,
    north: view.north,
  };
}

/** Visible plotter at a fixed center/zoom. Used to prove Galilee is on screen. */
export function viewportAtCamera(
  center: [number, number],
  zoom: number,
  mapSize: { width: number; height: number },
): PackBBox {
  const tile = 512;
  const world = tile * 2 ** zoom;
  const cx = mercatorX(center[0]);
  const cy = mercatorY(center[1]);
  const halfW = mapSize.width / 2 / world;
  const halfH = mapSize.height / 2 / world;
  return {
    west: lonFromMercatorX(cx - halfW),
    east: lonFromMercatorX(cx + halfW),
    north: latFromMercatorY(cy - halfH),
    south: latFromMercatorY(cy + halfH),
  };
}

export function applyFrameHarbor(
  map: {
    easeTo: (opts: {
      center: [number, number];
      zoom: number;
      duration: number;
      essential: boolean;
    }) => void;
  },
  input?: HarborFrameInput | null,
): HarborFrame {
  const framed = harborFrameOf(input);
  map.easeTo({
    center: FRAME_HARBOR_CENTER,
    zoom: FRAME_HARBOR_ZOOM,
    duration: 500,
    essential: true,
  });
  return framed;
}
