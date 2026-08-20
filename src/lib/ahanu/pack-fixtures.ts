/**
 * Deterministic trip-pack fixtures.
 *
 * These are packed test objects — not live NOAA / CMEMS / ENC cells.
 * Production ingest (cloudflare/src/ingest/run.ts + cron) replaces the
 * bodies with clipped upstream bytes and SHA-256 of those bytes.
 * Do not pretend R2 already holds those objects.
 *
 * No habitat, species, or go/no-go scoring lives here. This module only
 * packages bytes (grids, GeoJSON, JSON windows) so the client can verify
 * hashes and score on device.
 *
 * Keep this file free of `@/` aliases so the ahanu-packs Worker can import it.
 */

export interface PackBBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Point Judith canyon overnight box — docs/DATA_PACKS.md */
export const POINT_JUDITH_CANYON_BBOX: PackBBox = {
  west: -72.8,
  south: 39.4,
  east: -68.8,
  north: 41.5,
};

export const NORTHEAST_BBOX: PackBBox = {
  west: -75.4,
  south: 36.4,
  east: -66.4,
  north: 42.6,
};

export const DEFAULT_PACK_HOURS = 72;

export type PackLayerId =
  | "enc"
  | "bathymetry"
  | "contours"
  | "canyons"
  | "sst"
  | "chlorophyll"
  | "altimetry"
  | "wind"
  | "waves"
  | "buoys"
  | "tides"
  | "hms_zones";

export interface PackLayerSpec {
  id: PackLayerId;
  label: string;
  hours: number;
  format: string;
  contentType: string;
  ext: string;
  required: boolean;
}

export const PACK_LAYER_SPECS: readonly PackLayerSpec[] = [
  { id: "enc", label: "NOAA ENC cells (clipped)", hours: 0, format: "enc-clip", contentType: "application/json", ext: "json", required: true },
  { id: "bathymetry", label: "Bathymetry (COG)", hours: 0, format: "grid", contentType: "application/json", ext: "json", required: true },
  { id: "contours", label: "Depth contours", hours: 0, format: "geojson", contentType: "application/geo+json", ext: "geojson", required: false },
  { id: "canyons", label: "Canyon axes & heads", hours: 0, format: "geojson", contentType: "application/geo+json", ext: "geojson", required: false },
  { id: "sst", label: "SST composite (MUR / CoastWatch)", hours: 24, format: "grid", contentType: "application/json", ext: "json", required: true },
  { id: "chlorophyll", label: "Chlorophyll-a L4", hours: 24, format: "grid", contentType: "application/json", ext: "json", required: false },
  { id: "altimetry", label: "SSH anomaly", hours: 24, format: "grid", contentType: "application/json", ext: "json", required: false },
  { id: "wind", label: "NDFD oceanic + GFS-Wave wind GRIB", hours: 72, format: "grid", contentType: "application/json", ext: "json", required: true },
  { id: "waves", label: "GFS-Wave / WW3 GRIB", hours: 72, format: "grid", contentType: "application/json", ext: "json", required: true },
  { id: "buoys", label: "NDBC buoy snapshot", hours: 3, format: "json", contentType: "application/json", ext: "json", required: false },
  { id: "tides", label: "CO-OPS tidal window", hours: 72, format: "json", contentType: "application/json", ext: "json", required: true },
  { id: "hms_zones", label: "HMS closed areas", hours: 0, format: "geojson", contentType: "application/geo+json", ext: "geojson", required: true },
];

export const REQUIRED_OFFSHORE_LAYERS: readonly PackLayerId[] = PACK_LAYER_SPECS.filter((s) => s.required).map(
  (s) => s.id,
);

export function specForLayer(id: string): PackLayerSpec | undefined {
  return PACK_LAYER_SPECS.find((s) => s.id === id);
}

export function clampBbox(b: PackBBox): PackBBox {
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

export function bboxKey(b: PackBBox): string {
  return `${b.west.toFixed(3)}_${b.south.toFixed(3)}_${b.east.toFixed(3)}_${b.north.toFixed(3)}`;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const buf = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hashesMatch(actualHex: string, expectedHex: string): boolean {
  if (!actualHex || !expectedHex || actualHex.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < actualHex.length; i++) {
    if (actualHex.charCodeAt(i) !== expectedHex.charCodeAt(i)) diff = 1;
  }
  return diff === 0;
}

function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Packed raster / GRIB-like grid. North is row 0. */
export interface PackedGrid {
  kind: "grid";
  layer: string;
  bbox: PackBBox;
  nx: number;
  ny: number;
  hours: number[];
  /** Honest coverage from hour 0. Gaps do not count as 72 h. */
  hoursCovered?: number;
  unit: string;
  values: number[][];
  live?: boolean;
  source?: string;
  fixture?: boolean;
  note?: string;
  /** Analysis / composite time (ISO). Used for SST age. */
  updatedAt?: string;
  dirValues?: number[][];
  dirUnit?: string;
  periodValues?: number[][];
  periodUnit?: string;
}

export interface PackedJson {
  kind: "json" | "enc-clip" | "geojson";
  layer: string;
  payload: unknown;
}

export type PackedBody = PackedGrid | PackedJson;

function cellLat(bbox: PackBBox, ny: number, y: number): number {
  return ny === 1 ? (bbox.north + bbox.south) / 2 : bbox.north - ((bbox.north - bbox.south) * y) / (ny - 1);
}

function cellLon(bbox: PackBBox, nx: number, x: number): number {
  return nx === 1 ? (bbox.west + bbox.east) / 2 : bbox.west + ((bbox.east - bbox.west) * x) / (nx - 1);
}

/**
 * Fixture SST (°C). Cooler north/shelf, warmer south and west of the Stream.
 * Not a habitat score — a temperature field the helm can sample.
 */
export function fixtureSstC(lat: number, lon: number, hour: number): number {
  const t =
    22.4 -
    (lat - 39.6) * 0.85 +
    (lon + 70.6) * 0.12 +
    2.6 * Math.exp(-((lat - 39.85) ** 2 + (lon + 70.22) ** 2) / 0.2) +
    1.8 * Math.exp(-((lat - 39.55) ** 2 + (lon + 72.4) ** 2) / 0.28) +
    0.4 * Math.sin(((hour + 8) / 24) * Math.PI * 2);
  return clamp(t, 16.2, 28.8);
}

export function fixtureChl(lat: number, lon: number, hour: number): number {
  const shelf = clamp((40.8 - lat) / 2.2, 0, 1);
  const edge = Math.exp(-((lon + 70.4) ** 2) / 0.35);
  return clamp(0.18 + shelf * 1.4 + edge * 0.55 + 0.05 * Math.sin(lat * 8 + hour * 0.02), 0.04, 6);
}

export function fixtureSshCm(lat: number, lon: number, hour: number): number {
  const ring = 16 * Math.exp(-((lat - 39.2) ** 2 + (lon + 69.5) ** 2) / 0.22);
  const step = Math.tanh((lon + 70.2) * 1.4) * 8;
  return clamp(step + ring + 1.2 * Math.sin(lat * 4 + hour * 0.01) - 2, -22, 22);
}

export function fixtureDepthM(lat: number, lon: number): number {
  const breakLon = -71.2 + (lat - 40) * 0.55;
  const beyond = lon - breakLon;
  if (beyond < -1.6) return clamp(18 + (-beyond - 1.6) * 12, 8, 80);
  if (beyond < 0) return clamp(40 + (-beyond) * 90, 20, 220);
  return clamp(180 + beyond * 1400, 180, 3800);
}

function frontIntensity(hour: number): number {
  if (hour < 20) return 0;
  if (hour < 36) return (hour - 20) / 16;
  if (hour < 40) return 1;
  if (hour < 54) return 1 - (hour - 40) / 14;
  return 0.05;
}

export function fixtureWindKt(lat: number, lon: number, hour: number): number {
  const front = frontIntensity(hour);
  const exp = clamp((39.9 - lat) * 0.15 + (-69.5 - lon) * 0.04, 0, 1);
  return clamp(12.2 + front * (13 + exp * 3) + 1.4 * Math.sin(lat * 2 + lon), 4, 34);
}

export function fixtureWindDir(lat: number, lon: number, hour: number): number {
  return (225 + frontIntensity(hour) * 60 + lat + lon + 360) % 360;
}

export function fixtureWaveFt(lat: number, lon: number, hour: number): number {
  const front = frontIntensity(hour);
  const exp = clamp((39.9 - lat) * 0.2, 0, 1);
  return clamp(2.2 + exp * 1.5 + front * (5 + exp * 3), 0.6, 14);
}

function buildGrid(
  layer: string,
  bbox: PackBBox,
  nx: number,
  ny: number,
  hours: number[],
  unit: string,
  sample: (lat: number, lon: number, hour: number) => number,
): PackedGrid {
  const values: number[][] = [];
  for (const hour of hours) {
    const row: number[] = [];
    for (let y = 0; y < ny; y++) {
      const lat = cellLat(bbox, ny, y);
      for (let x = 0; x < nx; x++) {
        const lon = cellLon(bbox, nx, x);
        row.push(r2(sample(lat, lon, hour)));
      }
    }
    values.push(row);
  }
  return { kind: "grid", layer, bbox, nx, ny, hours, unit, values };
}

function encClip(bbox: PackBBox): PackedJson {
  return {
    kind: "enc-clip",
    layer: "enc",
    payload: {
      fixture: true,
      note: "Fixture cell list — not official S-57. Production ingest writes clipped NOAA ENC zips to R2.",
      bbox,
      coverage: {
        harborApproach: ["Point Judith", "Montauk", "Newport"],
        coastalTo100fm: true,
      },
      cells: [
        { id: "US5RI10M", usage: 5, name: "Point Judith / Galilee" },
        { id: "US5RI11M", usage: 5, name: "Narragansett Bay entrance" },
        { id: "US5NY19M", usage: 5, name: "Montauk Harbor" },
        { id: "US4MA14M", usage: 4, name: "Block Island Sound" },
        { id: "US3NY01M", usage: 3, name: "Approaches to New York — canyons" },
        { id: "US3MA01M", usage: 3, name: "Approaches to Nantucket — 100-fathom" },
      ],
    },
  };
}

function canyonGeo(bbox: PackBBox): PackedJson {
  const heads = [
    { name: "Hudson", lat: 39.55, lon: -72.4 },
    { name: "Veatch", lat: 39.9, lon: -69.62 },
    { name: "Atlantis", lat: 39.85, lon: -70.22 },
    { name: "Hydrographer", lat: 40.15, lon: -69.0 },
  ].filter((h) => h.lat >= bbox.south && h.lat <= bbox.north && h.lon >= bbox.west && h.lon <= bbox.east);
  return {
    kind: "geojson",
    layer: "canyons",
    payload: {
      type: "FeatureCollection",
      features: heads.flatMap((h) => [
        {
          type: "Feature",
          properties: { name: h.name, kind: "head" },
          geometry: { type: "Point", coordinates: [h.lon, h.lat] },
        },
        {
          type: "Feature",
          properties: { name: h.name, kind: "axis" },
          geometry: {
            type: "LineString",
            coordinates: [
              [h.lon, h.lat],
              [h.lon + 0.15, h.lat - 0.22],
            ],
          },
        },
      ]),
    },
  };
}

function contourGeo(bbox: PackBBox): PackedJson {
  const midLat = (bbox.south + bbox.north) / 2;
  return {
    kind: "geojson",
    layer: "contours",
    payload: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { depthM: 183, label: "100 fm" },
          geometry: {
            type: "LineString",
            coordinates: [
              [bbox.west + 0.2, midLat + 0.35],
              [bbox.west + 1.2, midLat + 0.1],
              [bbox.east - 1.4, midLat - 0.05],
              [bbox.east - 0.3, midLat - 0.2],
            ],
          },
        },
      ],
    },
  };
}

function hmsGeo(): PackedJson {
  return {
    kind: "geojson",
    layer: "hms_zones",
    payload: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            name: "NE Canyons & Seamounts Monument (Canyon Unit, simplified)",
            legal: false,
          },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-68.4, 40.8],
                [-67.85, 40.78],
                [-67.22, 40.62],
                [-67.2, 40.28],
                [-67.55, 40.2],
                [-68.28, 40.22],
                [-68.42, 40.48],
                [-68.4, 40.8],
              ],
            ],
          },
        },
        {
          type: "Feature",
          properties: { name: "Illustrative HMS closed-area awareness box", legal: false },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-72.55, 39.72],
                [-72.05, 39.72],
                [-72.05, 39.38],
                [-72.55, 39.38],
                [-72.55, 39.72],
              ],
            ],
          },
        },
      ],
    },
  };
}

function tidesJson(start: string, hours: number): PackedJson {
  const t0 = Date.parse(start);
  const stations = [
    { id: "8452660", name: "Newport", lat: 41.49, lon: -71.327 },
    { id: "8452944", name: "Quonset Point", lat: 41.586, lon: -71.41 },
    { id: "8510560", name: "Montauk", lat: 41.048, lon: -71.959 },
  ];
  const window = stations.map((s) => {
    const series = [];
    for (let h = 0; h <= hours; h += 1) {
      const at = new Date(t0 + h * 3600000).toISOString();
      const heightFt = r2(1.4 * Math.cos((2 * Math.PI * (h + s.lon)) / 12.42));
      series.push({ at, heightFt });
    }
    const hilo = series.filter((_, i) => i % 6 === 0);
    return { ...s, interval: "h", datum: "MLLW", series, hilo };
  });
  return {
    kind: "json",
    layer: "tides",
    payload: {
      fixture: true,
      start,
      hours,
      harbor: "Point Judith / Newport / Montauk",
      stations: window,
    },
  };
}

function buoysJson(start: string): PackedJson {
  return {
    kind: "json",
    layer: "buoys",
    payload: {
      fixture: true,
      updatedAt: start,
      staleAfterH: 3,
      buoys: [
        { id: "44097", name: "Block Island", lat: 40.967, lon: -71.124, windKt: 12, waveFt: 3.1, sstC: 21.8 },
        { id: "44017", name: "Montauk Point", lat: 40.693, lon: -72.049, windKt: 11, waveFt: 3.4, sstC: 21.4 },
        { id: "44008", name: "Nantucket", lat: 40.504, lon: -69.248, windKt: 14, waveFt: 4.2, sstC: 22.6 },
        { id: "44066", name: "Texas Tower", lat: 39.61, lon: -72.62, windKt: 15, waveFt: 5.1, sstC: 24.1 },
      ],
    },
  };
}

export function generateLayerPayload(
  layerId: PackLayerId,
  bbox: PackBBox,
  start: string,
  hours: number,
): PackedBody {
  const box = clampBbox(bbox);
  switch (layerId) {
    case "enc":
      return encClip(box);
    case "bathymetry":
      return buildGrid("bathymetry", box, 36, 24, [0], "m", (lat, lon) => fixtureDepthM(lat, lon));
    case "contours":
      return contourGeo(box);
    case "canyons":
      return canyonGeo(box);
    case "sst":
      return buildGrid("sst", box, 32, 22, [0], "degC", (lat, lon, h) => fixtureSstC(lat, lon, h));
    case "chlorophyll":
      return buildGrid("chlorophyll", box, 28, 18, [0], "mg_m3", (lat, lon, h) => fixtureChl(lat, lon, h));
    case "altimetry":
      return buildGrid("altimetry", box, 24, 16, [0], "cm", (lat, lon, h) => fixtureSshCm(lat, lon, h));
    case "wind": {
      const steps: number[] = [];
      for (let h = 0; h <= hours; h += 3) steps.push(h);
      return buildGrid("wind", box, 16, 12, steps, "kt", (lat, lon, h) => fixtureWindKt(lat, lon, h));
    }
    case "waves": {
      const steps: number[] = [];
      for (let h = 0; h <= hours; h += 3) steps.push(h);
      return buildGrid("waves", box, 16, 12, steps, "ft", (lat, lon, h) => fixtureWaveFt(lat, lon, h));
    }
    case "buoys":
      return buoysJson(start);
    case "tides":
      return tidesJson(start, hours);
    case "hms_zones":
      return hmsGeo();
  }
}

/** Stable JSON body. Hash this UTF-8. */
export function encodeLayerBody(payload: PackedBody): string {
  return JSON.stringify(payload);
}

export function generateLayerBody(layerId: PackLayerId, bbox: PackBBox, start: string, hours: number): string {
  return encodeLayerBody(generateLayerPayload(layerId, bbox, start, hours));
}

export function parseLayerBody(text: string): PackedBody | null {
  try {
    const v = JSON.parse(text) as PackedBody;
    if (!v || typeof v !== "object" || !("kind" in v) || !("layer" in v)) return null;
    return v;
  } catch {
    return null;
  }
}

export function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
