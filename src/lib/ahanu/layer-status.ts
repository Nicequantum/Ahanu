/**
 * Honest helm layer provenance.
 * packed / fixture = trip-pack grid. missing = pack loaded without that layer.
 * synthetic = demo field (no pack). derived = on-device from packed/synthetic.
 * local = chart/ops data that is not a downloaded ocean field.
 */

import type { LayerId } from "./types";
import { getPackedOcean, type PackFieldId, type PackedOcean } from "./packed-fields";

export type LayerPaintSource = "packed" | "fixture" | "synthetic" | "missing" | "derived" | "local";

const FIELD: Partial<Record<LayerId, PackFieldId>> = {
  sst: "sst",
  chlorophyll: "chl",
  altimetry: "ssh",
  wind: "windKt",
  waves: "waveFt",
};

function packLabel(ocean: PackedOcean): "packed" | "fixture" {
  return ocean.source === "r2" ? "packed" : "fixture";
}

export function layerPaintSource(id: LayerId): LayerPaintSource {
  const ocean = getPackedOcean();
  const field = FIELD[id];
  if (field) {
    if (ocean?.[field]) return packLabel(ocean);
    if (ocean) return "missing";
    return "synthetic";
  }
  if (id === "temp_breaks") {
    if (ocean?.sst) return "derived";
    if (ocean) return "missing";
    return "synthetic";
  }
  if (id === "chl_edges") {
    if (ocean?.chl) return "derived";
    if (ocean) return "missing";
    return "synthetic";
  }
  if (id === "habitat") {
    if (ocean?.sst || ocean?.chl || ocean?.ssh) return "derived";
    return "synthetic";
  }
  return "local";
}

export function layerPaintLabel(src: LayerPaintSource): string {
  return src;
}

export function layerPaintTone(
  src: LayerPaintSource,
): "muted" | "sunrise" | "lagoon" | "go" | "caution" | "nogo" {
  switch (src) {
    case "packed":
      return "go";
    case "fixture":
      return "sunrise";
    case "derived":
      return "lagoon";
    case "missing":
      return "nogo";
    case "synthetic":
      return "caution";
    case "local":
      return "muted";
  }
}
