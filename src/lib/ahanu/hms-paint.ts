/**
 * HMS closed-area MapLibre paint from the skipper toggle + slider.
 * Off → fill and outline opacity 0. On → slider (outline slightly boosted).
 * Reminder overlay only — not a legal determination.
 */

export const HMS_PAINT_LAYERS = ["hms", "hms-outline"] as const;

export type HmsPaintLayerId = (typeof HMS_PAINT_LAYERS)[number];

export type HmsPaintProp = "fill-opacity" | "line-opacity";

export type HmsLayerPaint = Record<HmsPaintLayerId, { prop: HmsPaintProp; opacity: number }>;

export function hmsSliderOpacity(opacity: number | undefined | null): number {
  return typeof opacity === "number" && Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0.35;
}

export function hmsLayerPaint(visible: boolean, opacity?: number | null): HmsLayerPaint {
  const on = Boolean(visible);
  const op = hmsSliderOpacity(opacity);
  return {
    hms: { prop: "fill-opacity", opacity: on ? op : 0 },
    "hms-outline": { prop: "line-opacity", opacity: on ? Math.min(1, op + 0.35) : 0 },
  };
}

export function applyHmsLayerPaint(
  map: {
    getLayer: (id: string) => unknown;
    setPaintProperty: (id: string, prop: string, value: number) => void;
  },
  visible: boolean,
  opacity?: number | null,
): HmsLayerPaint {
  const paint = hmsLayerPaint(visible, opacity);
  for (const id of HMS_PAINT_LAYERS) {
    if (!map.getLayer(id)) continue;
    const { prop, opacity: value } = paint[id];
    map.setPaintProperty(id, prop, value);
  }
  return paint;
}
