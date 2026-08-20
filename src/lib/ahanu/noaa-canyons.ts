/**
 * Public no-key NOAA MarineCadastre undersea feature names.
 * Probe the OCM MapServer (GeoJSON, then Esri JSON). First parseable
 * FeatureCollection of named canyon heads that intersects the trip bbox
 * paints pack layer `canyons` as source: "noaa". Heads only — no invented
 * axes. GEBCO SCUFN is NOAA-hosted too but lacks Veatch / Atlantis /
 * Hydrographer / Block / Alvin in this box, so it is not a first-success
 * fallback. Fetch / parse / no-intersection miss keeps the fixture.
 * Keep free of `@/` aliases so the Worker can import it.
 */

import { sha256Hex, type PackBBox, type PackedJson } from "./pack-fixtures";
import { featureIntersectsBbox } from "./noaa-hms";
import { fetchNoaaText, NOAA_GRID_TIMEOUT_MS, type FetchLike } from "./noaa-http";

export const CANYONS_MAX_BYTES = 500_000;

export const CANYON_AID_NOTE =
  "Named canyon heads from NOAA OCM / MarineCadastre undersea feature place names (GNS / ACUF). Heads only — no invented axes. Not official ENC.";

export type { FetchLike };

export type CanyonQueryFormat = "geojson" | "json";

export interface CanyonEndpoint {
  id: string;
  name: string;
  host: string;
  format: CanyonQueryFormat;
}

/**
 * Probe order. The NOAA OCM MarineCadastre undersea-names MapServer is the
 * path that returned named heads intersecting the Point Judith box from this
 * network (2026-08-20): Veatch, Atlantis, Hydrographer, Block, Alvin, Hudson.
 * Same service, Esri JSON, is the fallback. Not GEBCO SCUFN (incomplete
 * names here). Not Lautenberg coral polygons (wrong geometry type).
 */
export const CANYON_ENDPOINTS: readonly CanyonEndpoint[] = [
  {
    id: "mc-undersea-geojson",
    name: "MarineCadastre undersea feature place names (GeoJSON)",
    host: "https://coast.noaa.gov/arcgis/rest/services/MarineCadastre/UnderseaFeaturePlaceNames/MapServer/0",
    format: "geojson",
  },
  {
    id: "mc-undersea-json",
    name: "MarineCadastre undersea feature place names (Esri JSON)",
    host: "https://coast.noaa.gov/arcgis/rest/services/MarineCadastre/UnderseaFeaturePlaceNames/MapServer/0",
    format: "json",
  },
];

export interface CanyonIngest {
  live: true;
  source: "noaa";
  dataset: string;
  url: string;
  bytes: number;
  sha256: string;
  note: string;
  featureCount: number;
  body: PackedJson;
}

export interface CanyonFeatureCollection extends GeoJSON.FeatureCollection {
  source?: string;
  live?: boolean;
  fixture?: boolean;
  note?: string;
}

function r6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function canyonQueryUrl(ep: CanyonEndpoint, bbox: PackBBox): string {
  const params = new URLSearchParams({
    where: "1=1",
    geometry: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    f: ep.format,
  });
  return `${ep.host}/query?${params.toString()}`;
}

export function shortCanyonName(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  const stripped = t.replace(/\s+Canyon\s*$/i, "").trim();
  return stripped || t;
}

export function isCanyonName(raw: string): boolean {
  return /canyon/i.test(raw);
}

function featureName(props: Record<string, unknown> | null | undefined): string {
  if (!props) return "";
  for (const key of ["name", "NAME", "Name", "officialName"]) {
    const v = props[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function asPoint(geom: unknown): GeoJSON.Point | null {
  if (!geom || typeof geom !== "object") return null;
  const g = geom as { type?: string; coordinates?: unknown; x?: unknown; y?: unknown };
  if (g.type === "Point" && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
    const lon = Number(g.coordinates[0]);
    const lat = Number(g.coordinates[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
    return { type: "Point", coordinates: [r6(lon), r6(lat)] };
  }
  if (typeof g.x === "number" && typeof g.y === "number") {
    if (!Number.isFinite(g.x) || !Number.isFinite(g.y)) return null;
    if (Math.abs(g.x) > 180 || Math.abs(g.y) > 90) return null;
    return { type: "Point", coordinates: [r6(g.x), r6(g.y)] };
  }
  return null;
}

function headFeature(name: string, point: GeoJSON.Point): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: {
      name: shortCanyonName(name),
      officialName: name,
      kind: "head",
    },
    geometry: point,
  };
}

/** GeoJSON FeatureCollection or Esri query JSON → named canyon-head points. */
export function parseCanyonGazetteer(text: string): GeoJSON.Feature[] {
  const t = text.trim();
  if (!t || t.startsWith("<") || /^<!DOCTYPE|^<html/i.test(t)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(t) as unknown;
  } catch {
    return [];
  }
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as {
    type?: string;
    features?: unknown[];
    error?: unknown;
  };
  if (obj.error) return [];
  if (!Array.isArray(obj.features)) return [];
  const out: GeoJSON.Feature[] = [];
  const seen = new Set<string>();
  for (const item of obj.features) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      type?: string;
      properties?: Record<string, unknown>;
      attributes?: Record<string, unknown>;
      geometry?: unknown;
    };
    const name = featureName(row.properties) || featureName(row.attributes);
    if (!name || !isCanyonName(name)) continue;
    const point = asPoint(row.geometry);
    if (!point) continue;
    const key = `${shortCanyonName(name).toLowerCase()}|${point.coordinates[0]}|${point.coordinates[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(headFeature(name, point));
  }
  return out;
}

export function clipCanyonFeatures(features: GeoJSON.Feature[], bbox: PackBBox): GeoJSON.Feature[] {
  return features.filter((f) => featureIntersectsBbox(f, bbox));
}

export function canyonsToPackedJson(features: GeoJSON.Feature[], note: string): PackedJson {
  const payload: CanyonFeatureCollection = {
    type: "FeatureCollection",
    source: "noaa",
    live: true,
    fixture: false,
    note,
    features,
  };
  return { kind: "geojson", layer: "canyons", payload };
}

/**
 * Probe public NOAA MarineCadastre undersea names. Never throws.
 * Returns undefined when every path fails or no named canyon head
 * intersects the bbox so the caller keeps the hashed fixture.
 */
export async function fetchLiveCanyons(options: {
  bbox: PackBBox;
  fetchImpl: FetchLike;
  timeoutMs?: number;
  endpoints?: readonly CanyonEndpoint[];
  errors?: string[];
  sleep?: (ms: number) => Promise<void>;
}): Promise<CanyonIngest | undefined> {
  const timeoutMs = options.timeoutMs ?? NOAA_GRID_TIMEOUT_MS;
  const errors = options.errors;
  const endpoints = options.endpoints ?? CANYON_ENDPOINTS;
  for (const ep of endpoints) {
    const url = canyonQueryUrl(ep, options.bbox);
    const text = await fetchNoaaText({
      url,
      fetchImpl: options.fetchImpl,
      timeoutMs,
      maxBytes: CANYONS_MAX_BYTES,
      sleep: options.sleep,
    });
    if (!text) {
      errors?.push(`canyons ${ep.id}: fetch failed`);
      continue;
    }
    const features = parseCanyonGazetteer(text);
    if (!features.length) {
      errors?.push(`canyons ${ep.id}: parse failed`);
      continue;
    }
    const clipped = clipCanyonFeatures(features, options.bbox);
    if (!clipped.length) {
      errors?.push(`canyons ${ep.id}: no intersection with bbox`);
      continue;
    }
    const hash = await sha256Hex(text);
    const names = clipped.map((f) => String((f.properties as { name?: string } | null)?.name ?? "")).filter(Boolean);
    const note = `${ep.name} — ${clipped.length} named head(s) in box (${names.slice(0, 8).join(", ")}${
      names.length > 8 ? "…" : ""
    }). ${CANYON_AID_NOTE}`;
    return {
      live: true,
      source: "noaa",
      dataset: ep.id,
      url,
      bytes: new TextEncoder().encode(text).byteLength,
      sha256: hash,
      note,
      featureCount: clipped.length,
      body: canyonsToPackedJson(clipped, note),
    };
  }
  errors?.push("canyons: all public paths failed — fixture kept");
  return undefined;
}

export function sampleCanyonsGeojsonForTests(): string {
  return JSON.stringify({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "Veatch Canyon" },
        geometry: { type: "Point", coordinates: [-69.6, 39.866667] },
      },
      {
        type: "Feature",
        properties: { name: "Atlantis Canyon" },
        geometry: { type: "Point", coordinates: [-70.2, 39.866667] },
      },
      {
        type: "Feature",
        properties: { name: "Hydrographer Canyon" },
        geometry: { type: "Point", coordinates: [-69.05, 40.2] },
      },
      {
        type: "Feature",
        properties: { name: "Hudson Canyon" },
        geometry: { type: "Point", coordinates: [-72.2, 39.45] },
      },
      {
        type: "Feature",
        properties: { name: "Phelps Bank" },
        geometry: { type: "Point", coordinates: [-69.333, 40.833] },
      },
      {
        type: "Feature",
        properties: { name: "Norfolk Canyon" },
        geometry: { type: "Point", coordinates: [-74.65, 36.97] },
      },
    ],
  });
}
