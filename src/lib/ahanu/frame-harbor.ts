/**
 * One-tap Frame harbor. Fits the existing plotter to packed official
 * harbor-scale ENC cells: prefer US5PVDCB (Point Judith Harbor), else
 * the union of US5PVDCB+US5PVDBB+US5PVDDD footprints from extract/pack,
 * else the documented US5PVDBB / PJ harbor box. Drops Follow the same
 * way a skipper pan does. Camera persist is moveend → ahanu-camera.
 * maxZoom 14 so shoreline is readable (z12–14), not the canyon. Not ECDIS.
 */

import { POINT_JUDITH_HARBOR_BBOX } from "./constants";
import { fitBoundsFromBbox, parsePackBbox } from "./frame-pack";
import type { PackBBox } from "./pack-fixtures";

export const FRAME_HARBOR_LABEL = "Frame harbor";

/** Official Point Judith Harbor cell. Prefer this footprint when packed. */
export const HARBOR_FRAME_CELL = "US5PVDCB";

/** Packed official harbor-scale neighbors when US5PVDCB is missing. */
export const HARBOR_FRAME_UNION = ["US5PVDCB", "US5PVDBB", "US5PVDDD"] as const;

/** Cap fitBounds so ENC shoreline is readable, not a canyon overview. */
export const FRAME_HARBOR_MAX_ZOOM = 14;

export const FRAME_HARBOR_FIT = {
  padding: 32,
  duration: 500,
  maxZoom: FRAME_HARBOR_MAX_ZOOM,
  essential: true,
} as const;

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
}

function bboxFromRing(ring: GeoJSON.Position[] | undefined): PackBBox | null {
  if (!ring?.length) return null;
  const lons = ring.map((p) => p[0]).filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  const lats = ring.map((p) => p[1]).filter((n): n is number => typeof n === "number" && Number.isFinite(n));
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

/** Extract bounds first, then enc-s57-cell polygons, then pack catalog boxes. */
export function harborFootprints(input?: HarborFrameInput | null): Map<string, PackBBox> {
  const out = new Map<string, PackBBox>();
  for (const cell of input?.cells ?? []) {
    if (!cell?.id) continue;
    const bbox = parsePackBbox(cell);
    if (bbox) out.set(cell.id, bbox);
  }
  for (const f of input?.extract?.features ?? []) {
    const props = (f.properties ?? {}) as { id?: string; cellId?: string; kind?: string };
    const id = props.id || props.cellId;
    if (!id) continue;
    if (props.kind && props.kind !== "enc-s57-cell") continue;
    const bbox = bboxFromGeometry(f.geometry);
    if (bbox) out.set(id, bbox);
  }
  for (const cell of input?.extract?.cells ?? []) {
    if (!cell?.cellId) continue;
    const bbox = parsePackBbox(cell.bounds);
    if (bbox) out.set(cell.cellId, bbox);
  }
  return out;
}

export function harborFrameOf(input?: HarborFrameInput | null): HarborFrame {
  const prints = harborFootprints(input);
  const preferred = prints.get(HARBOR_FRAME_CELL);
  if (preferred) {
    return { bbox: preferred, source: "US5PVDCB", cellIds: [HARBOR_FRAME_CELL] };
  }
  const ids: string[] = [];
  const boxes: PackBBox[] = [];
  for (const id of HARBOR_FRAME_UNION) {
    const box = prints.get(id);
    if (!box) continue;
    ids.push(id);
    boxes.push(box);
  }
  const union = unionBoxes(boxes);
  if (union) {
    return { bbox: union, source: "harbor-union", cellIds: ids };
  }
  return { bbox: { ...POINT_JUDITH_HARBOR_BBOX }, source: "pj-harbor-box", cellIds: [] };
}

export function bboxToFrameHarbor(input?: HarborFrameInput | null): PackBBox {
  return harborFrameOf(input).bbox;
}

export function applyFrameHarbor(
  map: {
    fitBounds: (
      bounds: [[number, number], [number, number]],
      opts?: {
        padding?: number;
        duration?: number;
        maxZoom?: number;
        essential?: boolean;
      },
    ) => void;
  },
  input?: HarborFrameInput | null,
): HarborFrame {
  const framed = harborFrameOf(input);
  map.fitBounds(fitBoundsFromBbox(framed.bbox), { ...FRAME_HARBOR_FIT });
  return framed;
}
