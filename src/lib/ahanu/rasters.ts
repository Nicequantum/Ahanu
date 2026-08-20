import { REGION } from "./constants";
import { isLand } from "./bathymetry";
import {
  buildRaster,
  colorizerFor,
  rasterToDataUrl,
  type Colorizer,
  type OceanRaster,
  type RasterKind,
} from "./ocean";
import { habitatScore } from "./scoring";
import type { SpeciesId } from "./types";
import type { LayerPaintSource } from "./layer-status";
import {
  getPackedOcean,
  packedBBox,
  samplePacked,
  type SampleGrid,
} from "./packed-fields";
import type { PackBBox } from "./pack-fixtures";

export type OverlayBounds = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
];

export function overlayBounds(
  bbox: { west: number; east: number; south: number; north: number } = REGION,
): OverlayBounds {
  return [
    [bbox.west, bbox.north],
    [bbox.east, bbox.north],
    [bbox.east, bbox.south],
    [bbox.west, bbox.south],
  ];
}

/** 1×1 transparent PNG — hide a raster without removing the MapLibre source. */
export const EMPTY_RASTER_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export interface FieldImage {
  url: string | null;
  bounds: OverlayBounds;
  source: LayerPaintSource;
  bbox: PackBBox;
}

const RASTER_FIELD: Record<RasterKind, "sst" | "chl" | "ssh" | "depth"> = {
  sst: "sst",
  chl: "chl",
  ssh: "ssh",
  depth: "depth",
};

/** Colorized packed grid. Transparent over land. Does not fill outside the bbox. */
export function buildPackedRaster(
  grid: SampleGrid,
  hour: number,
  colorizer: Colorizer,
  width?: number,
  height?: number,
): OceanRaster {
  const w = Math.max(1, Math.floor(width ?? grid.nx));
  const h = Math.max(1, Math.floor(height ?? grid.ny));
  const { west, east, south, north } = grid.bbox;
  const data = new Uint8ClampedArray(w * h * 4);
  const dLon = w === 1 ? 0 : (east - west) / (w - 1);
  const dLat = h === 1 ? 0 : (north - south) / (h - 1);
  for (let y = 0; y < h; y++) {
    const lat = north - dLat * y;
    for (let x = 0; x < w; x++) {
      const lon = west + dLon * x;
      const i = (y * w + x) * 4;
      if (isLand(lat, lon)) {
        data[i + 3] = 0;
        continue;
      }
      const v = samplePacked(grid, lat, lon, hour);
      if (v == null) {
        data[i + 3] = 0;
        continue;
      }
      const [r, g, b, a] = colorizer(v);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { data, width: w, height: h, west, east, south, north };
}

export function fieldImage(kind: RasterKind, hour: number, w: number, h: number): FieldImage | null {
  const ocean = getPackedOcean();
  const grid = ocean?.[RASTER_FIELD[kind]];
  if (grid) {
    const r = buildPackedRaster(grid, hour, colorizerFor(kind), w, h);
    return {
      url: rasterToDataUrl(r.data, r.width, r.height),
      bounds: overlayBounds(grid.bbox),
      source: ocean.source === "r2" || ocean.source === "noaa" ? "packed" : "fixture",
      bbox: grid.bbox,
    };
  }
  if (ocean) return null;
  const r = buildRaster(kind, hour, w, h);
  return {
    url: rasterToDataUrl(r.data, r.width, r.height),
    bounds: overlayBounds(REGION),
    source: kind === "depth" ? "local" : "synthetic",
    bbox: { ...REGION },
  };
}

export function fieldUrl(kind: RasterKind, hour: number, w: number, h: number): string | null {
  return fieldImage(kind, hour, w, h)?.url ?? null;
}

export function habitatImage(
  species: SpeciesId,
  hour: number,
  date: Date,
  w: number,
  h: number,
): FieldImage {
  const box = packedBBox("sst") ?? packedBBox("chl") ?? packedBBox("ssh") ?? { ...REGION };
  const ocean = getPackedOcean();
  const source: LayerPaintSource =
    ocean?.sst || ocean?.chl || ocean?.ssh ? "derived" : "synthetic";
  return {
    url: habitatUrl(species, hour, date, w, h, box),
    bounds: overlayBounds(box),
    source,
    bbox: box,
  };
}

export function habitatUrl(
  species: SpeciesId,
  hour: number,
  date: Date,
  w: number,
  h: number,
  bbox: { west: number; east: number; south: number; north: number } = REGION,
): string | null {
  if (typeof document === "undefined") return null;
  const { west, east, south, north } = bbox;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const lat = north - ((north - south) * y) / Math.max(1, h - 1);
    for (let x = 0; x < w; x++) {
      const lon = west + ((east - west) * x) / Math.max(1, w - 1);
      const i = (y * w + x) * 4;
      if (isLand(lat, lon)) {
        data[i + 3] = 0;
        continue;
      }
      const s = habitatScore(lat, lon, species, hour, date);
      const t = s / 100;
      data[i] = Math.round(7 + t * 221);
      data[i + 1] = Math.round(16 + t * 165);
      data[i + 2] = Math.round(22 + t * 84);
      data[i + 3] = t < 0.28 ? 0 : Math.round(40 + t * 150);
    }
  }
  return rasterToDataUrl(data, w, h);
}
