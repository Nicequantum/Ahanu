/**
 * ENC MapLibre source/layer contract.
 * Data + skipper opacity is not enough: layer type must match geometry,
 * source id must match addSource, and ENC must sit above opaque rasters.
 * Does not invent S-57 geometry. Not an ECDIS.
 */

import type { EncPaintLayerId, EncPaintProp } from "./enc-paint";

export type EncMapLayerType = "fill" | "line" | "circle";

export type EncMapGeometry = "Polygon" | "LineString" | "Point";

export type EncMapLayerSpec = {
  id: EncPaintLayerId;
  source: string;
  type: EncMapLayerType;
  /** Geometry the source must carry for this layer type to commit pixels. */
  geometry: EncMapGeometry;
  paintProp: EncPaintProp;
};

export const ENC_MAP_LAYERS: readonly EncMapLayerSpec[] = [
  { id: "enc-land", source: "enc-land", type: "fill", geometry: "Polygon", paintProp: "fill-opacity" },
  { id: "enc-depth-areas", source: "enc-depth-areas", type: "fill", geometry: "Polygon", paintProp: "fill-opacity" },
  { id: "enc-coast", source: "enc-coast", type: "line", geometry: "LineString", paintProp: "line-opacity" },
  { id: "enc-shore", source: "enc-shore", type: "line", geometry: "LineString", paintProp: "line-opacity" },
  { id: "enc-depth-contours", source: "enc-depth-contours", type: "line", geometry: "LineString", paintProp: "line-opacity" },
  { id: "enc-hazard-areas", source: "enc-hazard-areas", type: "fill", geometry: "Polygon", paintProp: "fill-opacity" },
  { id: "enc-hazard-lines", source: "enc-hazard-areas", type: "line", geometry: "LineString", paintProp: "line-opacity" },
  { id: "enc", source: "enc", type: "fill", geometry: "Polygon", paintProp: "fill-opacity" },
  { id: "enc-outline", source: "enc", type: "line", geometry: "Polygon", paintProp: "line-opacity" },
  { id: "enc-aids", source: "enc-aids", type: "circle", geometry: "Point", paintProp: "circle-opacity" },
  { id: "enc-soundings", source: "enc-soundings", type: "circle", geometry: "Point", paintProp: "circle-opacity" },
  { id: "enc-hazards", source: "enc-hazards", type: "circle", geometry: "Point", paintProp: "circle-opacity" },
];

/** Opaque / full-viewport layers ENC must not sit under. */
export const ENC_MUST_PAINT_ABOVE = ["land", "bathy", "sst", "chl", "ssh", "habitat"] as const;

export function encMapLayerIds(): EncPaintLayerId[] {
  return ENC_MAP_LAYERS.map((l) => l.id);
}

export function paintPropForLayerType(type: EncMapLayerType): EncPaintProp {
  if (type === "fill") return "fill-opacity";
  if (type === "line") return "line-opacity";
  return "circle-opacity";
}

export function geometryFitsLayer(layerType: EncMapLayerType, geometryType: string): boolean {
  if (layerType === "fill") return geometryType === "Polygon" || geometryType === "MultiPolygon";
  if (layerType === "line") {
    return (
      geometryType === "LineString" ||
      geometryType === "MultiLineString" ||
      geometryType === "Polygon" ||
      geometryType === "MultiPolygon"
    );
  }
  return geometryType === "Point" || geometryType === "MultiPoint";
}
