/**
 * Trip-pack assembler.
 *
 * Builds a content-addressed manifest for a bbox + forecast window.
 * Workers package bytes. This module never scores habitat, detects
 * temperature breaks, computes solunar, or evaluates go/no-go.
 *
 * `sha256` is SHA-256 of the fixture (or ingested) object bytes.
 * Production ingest replaces fixture bodies with NOAA/CMEMS clips.
 */

import { generateLayerBody, type PackLayerId } from "./fixtures";

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface TripPackLayer {
  id: string;
  r2Key: string;
  bytes: number;
  sha256: string;
  hours: number;
}

export interface TripPackManifest {
  layers: TripPackLayer[];
  bbox: BBox;
  createdAt: string;
}

/** Default operating box: Northeast U.S. shelf + canyons. */
export const NORTHEAST: BBox = { west: -75.4, south: 36.4, east: -66.4, north: 42.6 };

export const DEFAULT_PACK_HOURS = 72;

export interface PackLayerSpec {
  id: string;
  label: string;
  hours: number;
  /** Nominal megabytes for the full Northeast box; scaled by bbox area. */
  baseMb: number;
  format: string;
  contentType: string;
  ext: string;
}

/**
 * Source layers only. Habitat, temp_breaks, and chl_edges are derived on
 * the device from SST / chlorophyll rasters and are intentionally absent.
 */
export const PACK_LAYER_SPECS: readonly PackLayerSpec[] = [
  { id: "enc", label: "NOAA ENC cells (clipped)", hours: 0, baseMb: 52, format: "s57-zip", contentType: "application/zip", ext: "zip" },
  { id: "bathymetry", label: "Bathymetry (COG)", hours: 0, baseMb: 38, format: "cog", contentType: "image/tiff", ext: "tif" },
  { id: "contours", label: "Depth contours", hours: 0, baseMb: 6.4, format: "geojsonseq", contentType: "application/geo+json-seq", ext: "geojsonl" },
  { id: "canyons", label: "Canyon axes & heads", hours: 0, baseMb: 0.28, format: "geojson", contentType: "application/geo+json", ext: "geojson" },
  { id: "sst", label: "SST composite (MUR / CoastWatch)", hours: 24, baseMb: 14.2, format: "cog", contentType: "image/tiff", ext: "tif" },
  { id: "chlorophyll", label: "Chlorophyll-a L4", hours: 24, baseMb: 5.6, format: "cog", contentType: "image/tiff", ext: "tif" },
  { id: "altimetry", label: "SSH anomaly", hours: 24, baseMb: 2.1, format: "cog", contentType: "image/tiff", ext: "tif" },
  { id: "wind", label: "NDFD oceanic + GFS-Wave wind GRIB", hours: 72, format: "grib2", contentType: "application/wmo-grib", ext: "grib2", baseMb: 7.8 },
  { id: "waves", label: "GFS-Wave / WW3 GRIB", hours: 72, format: "grib2", contentType: "application/wmo-grib", ext: "grib2", baseMb: 11.4 },
  { id: "buoys", label: "NDBC buoy snapshot", hours: 3, format: "json", contentType: "application/json", ext: "json", baseMb: 0.04 },
  { id: "tides", label: "CO-OPS tidal window", hours: 72, format: "json", contentType: "application/json", ext: "json", baseMb: 0.12 },
  { id: "hms_zones", label: "HMS closed areas", hours: 0, format: "geojson", contentType: "application/geo+json", ext: "geojson", baseMb: 0.18 },
];

export const REQUIRED_OFFSHORE_LAYERS: readonly string[] = [
  "enc",
  "bathymetry",
  "sst",
  "wind",
  "waves",
  "tides",
  "hms_zones",
];

export interface BuildTripPackOptions {
  bbox: BBox;
  hours?: number;
  start?: string;
  createdAt?: string;
}

/** Worker-facing extras on top of the byte manifest. */
export interface BuiltTripPack extends TripPackManifest {
  packId: string;
  r2Prefix: string;
  start: string;
  hours: number;
  totalBytes: number;
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function clampBbox(b: BBox): BBox {
  const west = Math.min(b.west, b.east);
  const east = Math.max(b.west, b.east);
  const south = Math.min(b.south, b.north);
  const north = Math.max(b.south, b.north);
  return {
    west: Math.max(-180, Math.min(180, west)),
    east: Math.max(-180, Math.min(180, east)),
    south: Math.max(-90, Math.min(90, south)),
    north: Math.max(-90, Math.min(90, north)),
  };
}

export function cycleStamp(startIso: string): string {
  const d = new Date(startIso);
  const h = Math.floor(d.getUTCHours() / 6) * 6;
  const c = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h));
  const y = c.getUTCFullYear();
  const m = String(c.getUTCMonth() + 1).padStart(2, "0");
  const day = String(c.getUTCDate()).padStart(2, "0");
  const hh = String(c.getUTCHours()).padStart(2, "0");
  return `${y}${m}${day}${hh}`;
}

export function bboxKey(b: BBox): string {
  return `${b.west.toFixed(3)}_${b.south.toFixed(3)}_${b.east.toFixed(3)}_${b.north.toFixed(3)}`;
}

export function specForLayer(id: string): PackLayerSpec | undefined {
  return PACK_LAYER_SPECS.find((s) => s.id === id);
}

/**
 * Assemble a trip pack for `bbox` covering `hours` (default 72).
 *
 * Object keys: `packs/{packId}/{layerId}/{sha256[0..12]}.{ext}`
 * under R2 bucket `ahanu-trip-packs`.
 */
export async function buildTripPack(options: BuildTripPackOptions): Promise<BuiltTripPack> {
  const bbox = clampBbox(options.bbox);
  const hours = options.hours ?? DEFAULT_PACK_HOURS;
  const start = options.start ?? new Date().toISOString();
  const createdAt = options.createdAt ?? new Date().toISOString();
  const cycle = cycleStamp(start);
  const key = bboxKey(bbox);
  const packId = (await sha256Hex(`ahanu|${key}|${cycle}|${hours}`)).slice(0, 16);
  const r2Prefix = `packs/${packId}`;

  const layers: TripPackLayer[] = [];
  for (const spec of PACK_LAYER_SPECS) {
    const layerHours = spec.hours === 0 ? 0 : Math.max(spec.hours, hours);
    const body = generateLayerBody(spec.id as PackLayerId, bbox, start, hours);
    const sha256 = await sha256Hex(body);
    const bytes = new TextEncoder().encode(body).byteLength;
    layers.push({
      id: spec.id,
      r2Key: `${r2Prefix}/${spec.id}/${sha256.slice(0, 12)}.${spec.ext}`,
      bytes,
      sha256,
      hours: layerHours,
    });
  }

  const totalBytes = layers.reduce((n, l) => n + l.bytes, 0);
  return {
    layers,
    bbox,
    createdAt,
    packId,
    r2Prefix,
    start,
    hours,
    totalBytes,
  };
}
