/**
 * Honest helm layer provenance.
 * packed / fixture = trip-pack grid or vector. missing = pack loaded without that layer.
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
  bathymetry: "depth",
};

function packLabel(ocean: PackedOcean, layerSource?: PackedOcean["source"]): "packed" | "fixture" {
  const src = layerSource ?? ocean.source;
  return src === "r2" || src === "noaa" ? "packed" : "fixture";
}

export function layerPaintSource(id: LayerId): LayerPaintSource {
  const ocean = getPackedOcean();
  const field = FIELD[id];
  if (field) {
    if (ocean?.[field]) {
      const layerSrc =
        field === "windKt"
          ? ocean.windSource
          : field === "waveFt"
            ? ocean.waveSource
            : field === "sst"
              ? ocean.sstSource
              : field === "chl"
                ? ocean.chlSource
                : field === "ssh"
                  ? ocean.sshSource
                  : field === "depth"
                    ? ocean.depthSource
                    : undefined;
      return packLabel(ocean, layerSrc);
    }
    if (ocean) return "missing";
    return id === "bathymetry" ? "local" : "synthetic";
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
  if (id === "canyons") {
    if (ocean?.canyons) return packLabel(ocean);
    if (ocean) return "missing";
    return "local";
  }
  if (id === "contours") {
    if (ocean?.contours) return packLabel(ocean, ocean.contoursSource);
    if (ocean) return "missing";
    return "local";
  }
  if (id === "hms_zones") {
    if (ocean?.hms) return packLabel(ocean, ocean.hmsSource);
    if (ocean) return "missing";
    return "local";
  }
  if (id === "buoys") {
    if (ocean?.buoys) return packLabel(ocean, ocean.buoySource);
    if (ocean) return "missing";
    return "local";
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
