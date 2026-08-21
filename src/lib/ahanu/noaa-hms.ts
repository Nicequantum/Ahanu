/**
 * Public no-key NMFS / NOAA HMS closed-area ingest.
 * Probe a few documented endpoints (KMZ / shapefile zip). First parseable
 * FeatureCollection that intersects the trip bbox paints pack layer
 * `hms_zones` as source: "noaa". Fetch or parse miss keeps the fixture.
 * Reminder overlay only — not a legal determination. Recreational trolling
 * is generally not the same as commercial pelagic-longline closures.
 * Keep free of `@/` aliases so the Worker can import it.
 */

import { sha256Hex, type PackBBox, type PackedJson } from "./pack-fixtures";
import { fetchNoaaBytes, NOAA_GRID_TIMEOUT_MS, type FetchLike } from "./noaa-http";

export const HMS_MAX_BYTES = 2_000_000;

export const HMS_REMINDER_NOTE =
  "Reminder overlay from a public NMFS/NOAA closed-area file — not a legal determination and not a substitute for the current Atlantic HMS Recreational Compliance Guide. Recreational trolling / rod-and-reel is generally not the same as commercial pelagic longline closures. The Northeast Canyons and Seamounts Marine National Monument and any all-permit HMS action still apply. Verify with NOAA HMS before you leave the dock.";

export type { FetchLike };

export type HmsKind = "kmz" | "shapefile-zip";

export interface HmsEndpoint {
  id: string;
  name: string;
  url: string;
  kind: HmsKind;
}

/**
 * Probe order. The Northeastern US pelagic-longline closed area KMZ is the
 * path that returned a polygon intersecting the Point Judith box from this
 * network (2026-08-20). Same bytes on S3. Amendment 15 shapefiles are the
 * current HMS spatial-management release (Mid-Atlantic shark / Charleston
 * Bump / East Florida / DeSoto) and sit south of this canyon box.
 */
export const HMS_ENDPOINTS: readonly HmsEndpoint[] = [
  {
    id: "pelagicll-ne-kmz",
    name: "Northeastern US pelagic longline closed area (KMZ)",
    url: "https://www.fisheries.noaa.gov/s3/2020-04/pelagicll_ne.kmz",
    kind: "kmz",
  },
  {
    id: "pelagicll-ne-kmz-s3",
    name: "Northeastern US pelagic longline closed area (S3 KMZ)",
    url: "https://s3.amazonaws.com/media.fisheries.noaa.gov/2020-04/pelagicll_ne.kmz",
    kind: "kmz",
  },
  {
    id: "hms-a15-shapefiles",
    name: "NMFS HMS Amendment 15 area shapefiles",
    url: "https://s3.amazonaws.com/media.fisheries.noaa.gov/2024-05/HMS-A15-Shapefiles.zip",
    kind: "shapefile-zip",
  },
];

export interface HmsIngest {
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

export interface HmsFeatureCollection extends GeoJSON.FeatureCollection {
  source?: string;
  live?: boolean;
  fixture?: boolean;
  legal?: boolean;
  note?: string;
}

function r6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (!m?.[1]) return undefined;
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseKmlCoords(raw: string): number[][] {
  const ring: number[][] = [];
  for (const tok of raw.trim().split(/[\s\n]+/)) {
    if (!tok) continue;
    const p = tok.split(",");
    const lon = Number(p[0]);
    const lat = Number(p[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) continue;
    ring.push([r6(lon), r6(lat)]);
  }
  if (ring.length >= 2) {
    const a = ring[0]!;
    const b = ring[ring.length - 1]!;
    if (a[0] !== b[0] || a[1] !== b[1]) ring.push([a[0]!, a[1]!]);
  }
  return ring;
}

/** KML placemark polygons → GeoJSON features. legal is always false. */
export function parseKmlPolygons(text: string): GeoJSON.Feature[] {
  const t = text.trim();
  if (!t || /^<!DOCTYPE|^<html/i.test(t)) return [];
  if (!/<kml[\s>]/i.test(t) && !/<Placemark[\s>]/i.test(t)) return [];
  const features: GeoJSON.Feature[] = [];
  const chunks = t.split(/<Placemark\b/i).slice(1);
  const blocks = chunks.length ? chunks : [t];
  for (const block of blocks) {
    const name = tag(block, "name") || "HMS closed area";
    const rings: number[][][] = [];
    for (const m of block.matchAll(/<coordinates>\s*([\s\S]*?)\s*<\/coordinates>/gi)) {
      const ring = parseKmlCoords(m[1] ?? "");
      if (ring.length >= 4) rings.push(ring);
    }
    if (!rings.length) continue;
    features.push({
      type: "Feature",
      properties: { name, legal: false },
      geometry:
        rings.length === 1
          ? { type: "Polygon", coordinates: rings }
          : { type: "MultiPolygon", coordinates: rings.map((r) => [r]) },
    });
  }
  return features;
}

function flattenCoords(geom: GeoJSON.Geometry | null): [number, number][] {
  if (!geom) return [];
  const out: [number, number][] = [];
  const walk = (v: unknown): void => {
    if (!Array.isArray(v)) return;
    if (typeof v[0] === "number" && typeof v[1] === "number") {
      out.push([v[0], v[1]]);
      return;
    }
    for (const c of v) walk(c);
  };
  if ("coordinates" in geom) walk(geom.coordinates);
  return out;
}

export function featureIntersectsBbox(feature: GeoJSON.Feature, bbox: PackBBox): boolean {
  const pts = flattenCoords(feature.geometry);
  if (!pts.length) return false;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [lon, lat] of pts) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return west <= bbox.east && east >= bbox.west && south <= bbox.north && north >= bbox.south;
}

export function clipHmsFeatures(features: GeoJSON.Feature[], bbox: PackBBox): GeoJSON.Feature[] {
  return features.filter((f) => featureIntersectsBbox(f, bbox));
}

async function inflateRaw(comp: Uint8Array): Promise<Uint8Array | null> {
  try {
    const ds = new DecompressionStream("deflate-raw");
    const copy = new Uint8Array(comp.byteLength);
    copy.set(comp);
    const stream = new Blob([copy]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function findNextSig(buf: Uint8Array): number {
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b) {
      const sig = buf[i + 2]! | (buf[i + 3]! << 8);
      if (sig === 0x0201 || sig === 0x0605 || sig === 0x0304 || sig === 0x0708) return i;
    }
  }
  return -1;
}

/** Minimal ZIP reader (store + deflate). Worker-safe. */
export async function unzipEntries(buf: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset + 30 <= buf.length) {
    const sig = view.getUint32(offset, true);
    if (sig === 0x02014b50 || sig === 0x06054b50 || sig === 0x08074b50) break;
    if (sig !== 0x04034b50) break;
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    let compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = new TextDecoder("utf-8", { fatal: false }).decode(
      buf.subarray(offset + 30, offset + 30 + nameLen),
    );
    const dataStart = offset + 30 + nameLen + extraLen;
    if ((flags & 0x8) !== 0 && compSize === 0) {
      const rest = buf.subarray(dataStart);
      const next = findNextSig(rest);
      compSize = next < 0 ? rest.length : next;
    }
    if (dataStart + compSize > buf.length) break;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    let data: Uint8Array | null = null;
    if (method === 0) data = comp;
    else if (method === 8) data = await inflateRaw(comp);
    if (data && name && !name.endsWith("/")) entries.push({ name, data });
    offset = dataStart + compSize;
    if ((flags & 0x8) !== 0) {
      if (offset + 4 <= buf.length && view.getUint32(offset, true) === 0x08074b50) offset += 16;
      else if (offset + 12 <= buf.length) offset += 12;
    }
  }
  return entries;
}

function dbfNames(dbf: Uint8Array): string[] {
  if (dbf.length < 32) return [];
  const view = new DataView(dbf.buffer, dbf.byteOffset, dbf.byteLength);
  const headerLen = view.getUint16(8, true);
  const recLen = view.getUint16(10, true);
  const nRec = view.getUint32(4, true);
  const fields: { offset: number; len: number }[] = [];
  let off = 32;
  let recOff = 1;
  while (off + 32 <= headerLen && dbf[off] !== 0x0d) {
    const fname = new TextDecoder("utf-8", { fatal: false })
      .decode(dbf.subarray(off, off + 11))
      .replace(/\0/g, "")
      .trim();
    const len = dbf[off + 16] ?? 0;
    if (/name|area|id/i.test(fname) && fields.length === 0) {
      fields.push({ offset: recOff, len });
    }
    recOff += len;
    off += 32;
  }
  if (!fields.length) return [];
  const field = fields[0]!;
  const names: string[] = [];
  let cursor = headerLen;
  for (let i = 0; i < nRec && cursor + recLen <= dbf.length; i++) {
    const raw = new TextDecoder("utf-8", { fatal: false })
      .decode(dbf.subarray(cursor + field.offset, cursor + field.offset + field.len))
      .replace(/\0/g, "")
      .trim();
    names.push(raw);
    cursor += recLen;
  }
  return names;
}

function parseShpPolygons(shp: Uint8Array, names: string[]): GeoJSON.Feature[] {
  if (shp.length < 100) return [];
  const view = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);
  if (view.getInt32(0, false) !== 9994) return [];
  const features: GeoJSON.Feature[] = [];
  let offset = 100;
  let idx = 0;
  while (offset + 8 <= shp.length) {
    const recWords = view.getInt32(offset + 4, false);
    const recBytes = recWords * 2;
    const body = offset + 8;
    if (body + recBytes > shp.length || recBytes < 4) break;
    const shapeType = view.getInt32(body, true);
    if (shapeType === 5 || shapeType === 15) {
      if (body + 44 > shp.length) break;
      const nParts = view.getInt32(body + 36, true);
      const nPoints = view.getInt32(body + 40, true);
      if (nParts < 1 || nPoints < 4 || nParts > 256 || nPoints > 200_000) {
        offset = body + recBytes;
        idx += 1;
        continue;
      }
      let p = body + 44;
      const parts: number[] = [];
      for (let k = 0; k < nParts && p + 4 <= shp.length; k++) {
        parts.push(view.getInt32(p, true));
        p += 4;
      }
      const points: [number, number][] = [];
      for (let k = 0; k < nPoints && p + 16 <= shp.length; k++) {
        points.push([r6(view.getFloat64(p, true)), r6(view.getFloat64(p + 8, true))]);
        p += 16;
      }
      const rings: number[][][] = [];
      for (let k = 0; k < parts.length; k++) {
        const a = parts[k]!;
        const b = k + 1 < parts.length ? parts[k + 1]! : points.length;
        const ring = points.slice(a, b);
        if (ring.length >= 4) rings.push(ring);
      }
      if (rings.length) {
        const name = names[idx] || "HMS closed area";
        features.push({
          type: "Feature",
          properties: { name, legal: false },
          geometry: { type: "Polygon", coordinates: rings },
        });
      }
    }
    offset = body + recBytes;
    idx += 1;
  }
  return features;
}

function humanizeStem(stem: string): string {
  return stem.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function groupShapefiles(entries: ZipEntry[]): { shp?: Uint8Array; dbf?: Uint8Array; stem: string }[] {
  const byStem = new Map<string, { shp?: Uint8Array; dbf?: Uint8Array; stem: string }>();
  for (const e of entries) {
    const base = e.name.replace(/\\/g, "/").split("/").pop() ?? e.name;
    const dot = base.lastIndexOf(".");
    if (dot < 0) continue;
    const stem = base.slice(0, dot);
    const ext = base.slice(dot + 1).toLowerCase();
    const key = e.name.replace(/\\/g, "/").replace(/\.[^.]+$/, "").toLowerCase();
    const row = byStem.get(key) ?? { stem, shp: undefined, dbf: undefined };
    if (ext === "shp") row.shp = e.data;
    if (ext === "dbf") row.dbf = e.data;
    byStem.set(key, row);
  }
  return [...byStem.values()];
}

export async function featuresFromZip(buf: Uint8Array): Promise<GeoJSON.Feature[]> {
  const entries = await unzipEntries(buf);
  if (!entries.length) return [];
  const out: GeoJSON.Feature[] = [];
  for (const e of entries) {
    if (/\.kml$/i.test(e.name)) {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(e.data);
      out.push(...parseKmlPolygons(text));
    }
  }
  if (out.length) return out;
  for (const group of groupShapefiles(entries)) {
    if (!group.shp) continue;
    const names = group.dbf ? dbfNames(group.dbf) : [];
    const label = names.length ? names : [humanizeStem(group.stem)];
    out.push(...parseShpPolygons(group.shp, label));
  }
  return out;
}

export function hmsToPackedJson(features: GeoJSON.Feature[], note: string): PackedJson {
  const payload: HmsFeatureCollection = {
    type: "FeatureCollection",
    source: "noaa",
    live: true,
    fixture: false,
    legal: false,
    note,
    features,
  };
  return { kind: "geojson", layer: "hms_zones", payload };
}

/**
 * Probe public NMFS/NOAA HMS closed-area files. Never throws.
 * Returns undefined when every path fails or no feature intersects the
 * bbox so the caller keeps the hashed fixture.
 */
export async function fetchLiveHms(options: {
  bbox: PackBBox;
  fetchImpl: FetchLike;
  timeoutMs?: number;
  endpoints?: readonly HmsEndpoint[];
  errors?: string[];
  sleep?: (ms: number) => Promise<void>;
}): Promise<HmsIngest | undefined> {
  const timeoutMs = options.timeoutMs ?? NOAA_GRID_TIMEOUT_MS;
  const errors = options.errors;
  const endpoints = options.endpoints ?? HMS_ENDPOINTS;
  for (const ep of endpoints) {
    const bytes = await fetchNoaaBytes({
      url: ep.url,
      fetchImpl: options.fetchImpl,
      timeoutMs,
      maxBytes: HMS_MAX_BYTES,
      sleep: options.sleep,
    });
    if (!bytes) {
      errors?.push(`hms ${ep.id}: fetch failed`);
      continue;
    }
    let features: GeoJSON.Feature[] = [];
    try {
      features = await featuresFromZip(bytes);
    } catch {
      features = [];
    }
    if (!features.length) {
      errors?.push(`hms ${ep.id}: parse failed`);
      continue;
    }
    const clipped = clipHmsFeatures(features, options.bbox);
    if (!clipped.length) {
      errors?.push(`hms ${ep.id}: no intersection with bbox`);
      continue;
    }
    const hash = await sha256Hex(bytes);
    const note = `${ep.name} — ${clipped.length} reminder polygon(s) in box. ${HMS_REMINDER_NOTE}`;
    return {
      live: true,
      source: "noaa",
      dataset: ep.id,
      url: ep.url,
      bytes: bytes.byteLength,
      sha256: hash,
      note,
      featureCount: clipped.length,
      body: hmsToPackedJson(clipped, note),
    };
  }
  errors?.push("hms: all public paths failed — fixture kept");
  return undefined;
}

/** Store-method ZIP (for tests). */
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length + f.data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(f.data, 30 + name.length);
    locals.push(local);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let p = 0;
  for (const l of locals) {
    out.set(l, p);
    p += l.length;
  }
  for (const c of centrals) {
    out.set(c, p);
    p += c.length;
  }
  out.set(eocd, p);
  return out;
}

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function sampleHmsKmlForTests(name = "Northeastern US closed area"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <Placemark>
    <name>${name}</name>
    <Polygon>
      <outerBoundaryIs><LinearRing><coordinates>
        -74.0,39.0,0 -68.0,39.0,0 -68.0,40.0,0 -74.0,40.0,0 -74.0,39.0,0
      </coordinates></LinearRing></outerBoundaryIs>
    </Polygon>
  </Placemark>
</Document>
</kml>
`;
}

export function sampleHmsKmzForTests(name = "Northeastern US closed area"): Uint8Array {
  return zipStore([{ name: "doc.kml", data: new TextEncoder().encode(sampleHmsKmlForTests(name)) }]);
}
