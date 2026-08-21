/**
 * One-tap Frame pack. Fits the existing plotter to the downloaded pack
 * bbox (west/south/east/north) or POINT_JUDITH_CANYON_BBOX when no pack.
 * Drops Follow the same way a skipper pan does. Camera persist is
 * moveend → ahanu-camera. Not a second map. Not ECDIS.
 */

import { POINT_JUDITH_CANYON_BBOX, PLOTTER_MAX_ZOOM } from "./constants";
import type { PackBBox } from "./pack-fixtures";

export const FRAME_PACK_LABEL = "Frame pack";

export const FRAME_PACK_FIT = {
  padding: 32,
  duration: 500,
  maxZoom: PLOTTER_MAX_ZOOM,
  essential: true,
} as const;

function finite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Valid west<east, south<north box. Garbage → null (caller uses PJ default). */
export function parsePackBbox(value: unknown): PackBBox | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const west = finite(o.west);
  const south = finite(o.south);
  const east = finite(o.east);
  const north = finite(o.north);
  if (west == null || south == null || east == null || north == null) return null;
  if (west >= east || south >= north) return null;
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;
  return { west, south, east, north };
}

/** Downloaded pack bbox, else the Point Judith canyon box. */
export function bboxToFrame(pack?: { bbox?: unknown } | null): PackBBox {
  return parsePackBbox(pack?.bbox) ?? { ...POINT_JUDITH_CANYON_BBOX };
}

export function fitBoundsFromBbox(bbox: PackBBox): [[number, number], [number, number]] {
  return [
    [bbox.west, bbox.south],
    [bbox.east, bbox.north],
  ];
}

export function applyFramePack(
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
  pack?: { bbox?: unknown } | null,
): PackBBox {
  const bbox = bboxToFrame(pack);
  map.fitBounds(fitBoundsFromBbox(bbox), { ...FRAME_PACK_FIT });
  return bbox;
}
