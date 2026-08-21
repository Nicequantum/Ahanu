/**
 * ENC MapLibre paint from the skipper toggle + slider.
 * Off → every ENC paint opacity is 0. On → slider (and kind-specific boosts).
 * Does not invent features. Not an ECDIS.
 */

export const ENC_PAINT_LAYERS = [
  "enc-land",
  "enc-depth-areas",
  "enc-coast",
  "enc-shore",
  "enc-depth-contours",
  "enc-hazard-areas",
  "enc-hazard-lines",
  "enc",
  "enc-outline",
  "enc-aids",
  "enc-soundings",
  "enc-hazards",
] as const;

export type EncPaintLayerId = (typeof ENC_PAINT_LAYERS)[number];

export type EncPaintProp = "fill-opacity" | "line-opacity" | "circle-opacity";

export type EncLayerPaint = Record<EncPaintLayerId, { prop: EncPaintProp; opacity: number }>;

export function encSliderOpacity(opacity: number | undefined | null): number {
  return typeof opacity === "number" && Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0.32;
}

export function encLayerPaint(visible: boolean, opacity?: number | null): EncLayerPaint {
  const on = Boolean(visible);
  const op = encSliderOpacity(opacity);
  const v = (n: number) => (on ? n : 0);
  return {
    "enc-land": { prop: "fill-opacity", opacity: v(Math.min(0.55, op + 0.15)) },
    "enc-depth-areas": { prop: "fill-opacity", opacity: v(Math.min(0.28, op * 0.7)) },
    "enc-coast": { prop: "line-opacity", opacity: v(Math.min(1, op + 0.5)) },
    "enc-shore": { prop: "line-opacity", opacity: v(Math.min(1, op + 0.4)) },
    "enc-depth-contours": { prop: "line-opacity", opacity: v(Math.min(0.85, op + 0.25)) },
    "enc-hazard-areas": { prop: "fill-opacity", opacity: v(Math.min(0.35, op)) },
    "enc-hazard-lines": { prop: "line-opacity", opacity: v(Math.min(1, op + 0.35)) },
    enc: { prop: "fill-opacity", opacity: v(op) },
    "enc-outline": { prop: "line-opacity", opacity: v(Math.min(1, op + 0.4)) },
    "enc-aids": { prop: "circle-opacity", opacity: v(Math.min(1, op + 0.45)) },
    "enc-soundings": { prop: "circle-opacity", opacity: v(Math.min(0.75, op + 0.2)) },
    "enc-hazards": { prop: "circle-opacity", opacity: v(Math.min(1, op + 0.5)) },
  };
}

export function applyEncLayerPaint(
  map: {
    getLayer: (id: string) => unknown;
    setPaintProperty: (id: string, prop: string, value: number) => void;
  },
  visible: boolean,
  opacity?: number | null,
): EncLayerPaint {
  const paint = encLayerPaint(visible, opacity);
  for (const id of ENC_PAINT_LAYERS) {
    if (!map.getLayer(id)) continue;
    const { prop, opacity: value } = paint[id];
    map.setPaintProperty(id, prop, value);
  }
  return paint;
}
