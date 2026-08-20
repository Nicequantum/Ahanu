import { REGION } from "./constants";
import { buildRaster, rasterToDataUrl, type RasterKind } from "./ocean";
import { habitatScore } from "./scoring";
import { isLand } from "./bathymetry";
import type { SpeciesId } from "./types";

export function overlayBounds(): [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
] {
  return [
    [REGION.west, REGION.north],
    [REGION.east, REGION.north],
    [REGION.east, REGION.south],
    [REGION.west, REGION.south],
  ];
}

export function fieldUrl(kind: RasterKind, hour: number, w: number, h: number): string | null {
  const r = buildRaster(kind, hour, w, h);
  return rasterToDataUrl(r.data, r.width, r.height);
}

export function habitatUrl(
  species: SpeciesId,
  hour: number,
  date: Date,
  w: number,
  h: number,
): string | null {
  if (typeof document === "undefined") return null;
  const { west, east, south, north } = REGION;
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
