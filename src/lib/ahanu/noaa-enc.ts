/**
 * Public NOAA ENC catalog + official S-57 exchange-set zips (no secrets).
 * Catalog alone is a cell list / aid. Official S-57 is packed only when a
 * NOAA zip fetches and the .000 leader is ISO 8211. Not an ECDIS.
 * Keep free of `@/` aliases so the Worker can import it.
 */

import type { PackBBox } from "./pack-fixtures";
import type { PackedJson } from "./pack-fixtures";

export const ENC_PROD_CAT_URL = "https://charts.noaa.gov/ENCs/ENCProdCat.xml";
export const ENC_CELL_ZIP_BASE = "https://charts.noaa.gov/ENCs/";
export const ENC_DIRECT_TILE_TEMPLATE =
  "https://tileservice.charts.noaa.gov/tiles/encdirect/{z}/{x}/{y}.png";
export const ENC_ONLINE_MAPSERVER_URL =
  "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer?f=json";

export const ENC_AID_NOTE =
  "Live NOAA ENC product-catalog excerpt — cell list and zip URLs, not official S-57. Ahanu is an aid to navigation, not a substitute for a current official ENC.";

export const ENC_S57_NOTE =
  "Official NOAA S-57 exchange-set cells from charts.noaa.gov (ISO 8211 .000). Ahanu is an aid to navigation — not an ECDIS and not a substitute for a current official ENC on the bridge.";

/** Dock-to-offshore clip: harbor at PJ/Montauk/Newport + coastal + approach. */
export const ENC_S57_MAX_CELLS = 8;
export const ENC_S57_MAX_CELL_BYTES = 400_000;
export const ENC_S57_MAX_TOTAL_BYTES = 1_800_000;
export const ENC_S57_FETCH_MAX_BYTES = 600_000;

const HARBOR_POINTS = [
  { name: "Point Judith", lat: 41.3615, lon: -71.4814 },
  { name: "Montauk", lat: 41.048, lon: -71.959 },
  { name: "Newport", lat: 41.49, lon: -71.327 },
] as const;

/** Named heads already inside POINT_JUDITH_CANYON_BBOX. Used only to rank coastal cells. */
const CANYON_HEAD_POINTS = [
  { name: "Veatch", lat: 39.9, lon: -69.62 },
  { name: "Atlantis", lat: 39.85, lon: -70.22 },
  { name: "Hydrographer", lat: 40.15, lon: -69.0 },
] as const;

export interface EncCatalogCell {
  id: string;
  usage: number;
  name: string;
  scale?: number;
  status?: string;
  zipUrl?: string;
  zipBytes?: number;
  edition?: string;
  update?: string;
  issued?: string;
  west?: number;
  south?: number;
  east?: number;
  north?: number;
  zipSha256?: string;
  s57?: EncS57File;
}

export interface EncS57File {
  id: string;
  official: true;
  encoding: "s-57";
  iso8211: true;
  catalog031: boolean;
  file000: string;
  file000Bytes: number;
  leader: string;
  zipBytes: number;
  zipSha256: string;
  zipBase64: string;
  zipUrl?: string;
}

export interface EncTileMeta {
  template: string;
  legal: false;
  probe?: "ok" | "tls-failed" | "http-failed" | "skipped";
  mapServer?: { url: string; fetched: boolean; mapName?: string };
}

function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m?.[1]?.trim();
}

function usageFromCellId(id: string): number {
  const m = id.match(/^US(\d)/);
  return m ? Number(m[1]) : 0;
}

function coverageBox(block: string): { west: number; south: number; east: number; north: number } | undefined {
  const lats = [...block.matchAll(/<lat>([^<]+)<\/lat>/g)].map((m) => Number(m[1]));
  const lons = [...block.matchAll(/<long>([^<]+)<\/long>/g)].map((m) => Number(m[1]));
  if (!lats.length || !lons.length || lats.some((n) => !Number.isFinite(n)) || lons.some((n) => !Number.isFinite(n))) {
    return undefined;
  }
  return {
    west: Math.min(...lons),
    south: Math.min(...lats),
    east: Math.max(...lons),
    north: Math.max(...lats),
  };
}

function boxesOverlap(
  a: { west: number; south: number; east: number; north: number },
  b: PackBBox,
): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

function pointInBox(lat: number, lon: number, box: { west: number; south: number; east: number; north: number }): boolean {
  return lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;
}

/** Parse NOAA ENCProdCat.xml into Active usage 3–5 cells that intersect bbox. */
export function parseEncProductCatalog(xml: string, bbox?: PackBBox): EncCatalogCell[] {
  const out: EncCatalogCell[] = [];
  const seen = new Set<string>();
  const chunks = xml.split(/<\/cell>/i);
  for (const raw of chunks) {
    const start = raw.lastIndexOf("<cell");
    if (start < 0) continue;
    const block = raw.slice(start);
    const id = tag(block, "name");
    if (!id || seen.has(id)) continue;
    const status = tag(block, "status") ?? "";
    if (status && status.toLowerCase() !== "active") continue;
    const usage = usageFromCellId(id);
    if (usage < 3 || usage > 5) continue;
    const cov = coverageBox(block);
    if (bbox && cov && !boxesOverlap(cov, bbox)) continue;
    if (bbox && !cov) continue;
    seen.add(id);
    const zip = tag(block, "zipfile_location") ?? `${ENC_CELL_ZIP_BASE}${id}.zip`;
    const sizeRaw = tag(block, "zipfile_size");
    const size = sizeRaw ? Number(sizeRaw) : undefined;
    out.push({
      id,
      usage,
      name: tag(block, "lname") ?? id,
      scale: tag(block, "cscale") ? Number(tag(block, "cscale")) : undefined,
      status: status || "Active",
      zipUrl: zip,
      zipBytes: Number.isFinite(size) ? size : undefined,
      edition: tag(block, "edtn"),
      update: tag(block, "uadt"),
      issued: tag(block, "isdt") ?? tag(block, "zipfile_datetime_iso8601"),
      west: cov?.west,
      south: cov?.south,
      east: cov?.east,
      north: cov?.north,
    });
  }
  out.sort((a, b) => b.usage - a.usage || (a.scale ?? 0) - (b.scale ?? 0) || a.id.localeCompare(b.id));
  return out;
}

export function encCatalogDateValid(xml: string): string | undefined {
  return tag(xml, "dt_valid") ?? tag(xml, "date_valid");
}

export function harborApproachNames(cells: EncCatalogCell[]): string[] {
  const names: string[] = [];
  for (const h of HARBOR_POINTS) {
    const hit = cells.some(
      (c) =>
        c.usage >= 4 &&
        c.west != null &&
        c.south != null &&
        c.east != null &&
        c.north != null &&
        pointInBox(h.lat, h.lon, { west: c.west, south: c.south, east: c.east, north: c.north }),
    );
    if (hit) names.push(h.name);
  }
  return names;
}

export function pickSmallEncZip(cells: EncCatalogCell[], maxBytes = 80_000): EncCatalogCell | undefined {
  return cells.find((c) => c.usage >= 5 && (c.zipBytes ?? Infinity) > 0 && (c.zipBytes ?? Infinity) <= maxBytes);
}

function cellBox(cell: EncCatalogCell): { west: number; south: number; east: number; north: number } | undefined {
  if (cell.west == null || cell.south == null || cell.east == null || cell.north == null) return undefined;
  return { west: cell.west, south: cell.south, east: cell.east, north: cell.north };
}

function addOfficialCell(
  out: EncCatalogCell[],
  used: Set<string>,
  cell: EncCatalogCell | undefined,
  maxCells: number,
  maxTotal: number,
  maxEach: number,
): void {
  if (!cell || used.has(cell.id)) return;
  const n = cell.zipBytes ?? Infinity;
  if (!(n > 0) || n > maxEach) return;
  const soFar = out.reduce((s, c) => s + (c.zipBytes ?? 0), 0);
  if (out.length >= maxCells || soFar + n > maxTotal) return;
  used.add(cell.id);
  out.push(cell);
}

function coversPoint(cell: EncCatalogCell, lat: number, lon: number, pad = 0): boolean {
  const box = cellBox(cell);
  if (!box) return false;
  if (pad <= 0) return pointInBox(lat, lon, box);
  return pointInBox(lat, lon, {
    west: box.west - pad,
    south: box.south - pad,
    east: box.east + pad,
    north: box.north + pad,
  });
}

/**
 * Harbor cells covering PJ / Montauk / Newport, a nearby Harbor-named
 * usage-5 neighbor (inner basin can sit just outside the inlet point),
 * then usage-3 coastal that cover those harbors or canyon heads,
 * then usage-4 approach. Caps keep the Worker/R2 body small. Does not invent cells.
 */
export function pickOfficialEncCells(
  cells: EncCatalogCell[],
  opts?: { maxCells?: number; maxTotalBytes?: number; maxCellBytes?: number },
): EncCatalogCell[] {
  const maxCells = opts?.maxCells ?? ENC_S57_MAX_CELLS;
  const maxTotal = opts?.maxTotalBytes ?? ENC_S57_MAX_TOTAL_BYTES;
  const maxEach = opts?.maxCellBytes ?? ENC_S57_MAX_CELL_BYTES;
  const out: EncCatalogCell[] = [];
  const used = new Set<string>();
  const byDetail = (a: EncCatalogCell, b: EncCatalogCell) =>
    (a.scale ?? 9_999_999) - (b.scale ?? 9_999_999) || (a.zipBytes ?? 0) - (b.zipBytes ?? 0) || a.id.localeCompare(b.id);

  for (const h of HARBOR_POINTS) {
    const hits = cells.filter((c) => c.usage >= 5 && coversPoint(c, h.lat, h.lon)).sort(byDetail);
    addOfficialCell(out, used, hits[0], maxCells, maxTotal, maxEach);
    const neighbor = cells
      .filter(
        (c) =>
          c.usage >= 5 &&
          /harbor/i.test(c.name) &&
          coversPoint(c, h.lat, h.lon, 0.08),
      )
      .sort(byDetail);
    addOfficialCell(out, used, neighbor[0], maxCells, maxTotal, maxEach);
  }
  const coastal = cells.filter((c) => c.usage === 3);
  const coastalHarbor = coastal
    .filter((c) => HARBOR_POINTS.some((h) => coversPoint(c, h.lat, h.lon)))
    .sort(byDetail);
  const coastalCanyon = coastal
    .filter((c) => CANYON_HEAD_POINTS.some((h) => coversPoint(c, h.lat, h.lon)))
    .sort(byDetail);
  for (const c of [...coastalHarbor, ...coastalCanyon, ...coastal.sort(byDetail)]) {
    addOfficialCell(out, used, c, maxCells, maxTotal, maxEach);
  }
  for (const h of HARBOR_POINTS) {
    const hits = cells.filter((c) => c.usage === 4 && coversPoint(c, h.lat, h.lon)).sort(byDetail);
    addOfficialCell(out, used, hits[0], maxCells, maxTotal, maxEach);
  }
  return out;
}

export function isIso8211(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 24) return false;
  const leader = new TextDecoder("latin1").decode(bytes.subarray(0, 24));
  return /^[0-9]{5}3LE1/.test(leader);
}

export function iso8211Leader(bytes: Uint8Array): string {
  const n = Math.min(24, bytes.byteLength);
  return new TextDecoder("latin1").decode(bytes.subarray(0, n));
}

export function bytesToBase64(bytes: Uint8Array): string {
  const g = globalThis as { Buffer?: { from: (b: Uint8Array) => { toString: (e: string) => string } } };
  if (g.Buffer) return g.Buffer.from(bytes).toString("base64");
  let s = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    s += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const g = globalThis as { Buffer?: { from: (s: string, e: string) => Uint8Array } };
  if (g.Buffer) return new Uint8Array(g.Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]!;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

/** Stored (method 0) ZIP for tests. Not used on the live NOAA path. */
export function makeStoredZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = concatBytes([
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(f.data.byteLength),
      u32(f.data.byteLength),
      u16(name.byteLength),
      u16(0),
      name,
      f.data,
    ]);
    locals.push(local);
    const central = concatBytes([
      new Uint8Array([0x50, 0x4b, 0x01, 0x02]),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(f.data.byteLength),
      u32(f.data.byteLength),
      u16(name.byteLength),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    centrals.push(central);
    offset += local.byteLength;
  }
  const central = concatBytes(centrals);
  const eocd = concatBytes([
    new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.byteLength),
    u32(offset),
    u16(0),
  ]);
  return concatBytes([...locals, central, eocd]);
}

function dv(bytes: Uint8Array, i: number): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset + i);
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export async function unzipEntries(zip: Uint8Array): Promise<ZipEntry[]> {
  if (zip.byteLength < 30 || zip[0] !== 0x50 || zip[1] !== 0x4b) return [];
  const out: ZipEntry[] = [];
  let i = 0;
  while (i + 30 <= zip.byteLength) {
    if (zip[i] !== 0x50 || zip[i + 1] !== 0x4b) break;
    const sig = dv(zip, i).getUint32(0, true);
    if (sig === 0x02014b50 || sig === 0x06054b50) break;
    if (sig !== 0x04034b50) break;
    const flags = dv(zip, i).getUint16(6, true);
    const method = dv(zip, i).getUint16(8, true);
    const comp = dv(zip, i).getUint32(18, true);
    const nameLen = dv(zip, i).getUint16(26, true);
    const extraLen = dv(zip, i).getUint16(28, true);
    const name = new TextDecoder("latin1").decode(zip.subarray(i + 30, i + 30 + nameLen));
    const dataStart = i + 30 + nameLen + extraLen;
    if ((flags & 0x8) !== 0 || dataStart + comp > zip.byteLength) break;
    const raw = zip.subarray(dataStart, dataStart + comp);
    let data: Uint8Array;
    if (method === 0) data = raw;
    else if (method === 8) {
      try {
        data = await inflateRaw(raw);
      } catch {
        break;
      }
    } else {
      i = dataStart + comp;
      continue;
    }
    out.push({ name, data });
    i = dataStart + comp;
  }
  return out;
}

export async function parseS57ExchangeSet(zip: Uint8Array): Promise<{
  iso8211: boolean;
  catalog031: boolean;
  file000?: string;
  file000Bytes: number;
  leader: string;
} | null> {
  if (zip.byteLength < 4 || zip[0] !== 0x50 || zip[1] !== 0x4b || zip[2] !== 0x03 || zip[3] !== 0x04) {
    return null;
  }
  const entries = await unzipEntries(zip);
  if (!entries.length) return null;
  const file000 = entries.find((e) => e.name.toUpperCase().endsWith(".000"));
  if (!file000 || !isIso8211(file000.data)) return null;
  return {
    iso8211: true,
    catalog031: entries.some((e) => e.name.toUpperCase().endsWith("CATALOG.031")),
    file000: file000.name.split("/").pop(),
    file000Bytes: file000.data.byteLength,
    leader: iso8211Leader(file000.data),
  };
}

export function sampleIso8211Dot000(_cellId = "US5PVDBB"): Uint8Array {
  const leader = "015823LE1 0900201 ! 34040000123000000010";
  const pad = new Uint8Array(80);
  pad.set(new TextEncoder().encode(leader));
  return pad;
}

export function sampleS57Zip(cellId = "US5PVDBB"): Uint8Array {
  const dot = sampleIso8211Dot000(cellId);
  const cat = new TextEncoder().encode("002623LE1 0900073   66040000000019000000");
  return makeStoredZip([
    { name: `ENC_ROOT/${cellId}/${cellId}.000`, data: dot },
    { name: "ENC_ROOT/CATALOG.031", data: cat },
  ]);
}

export type EncCatalogBounds = { west: number; south: number; east: number; north: number };

/** Valid catalog coverage box for the aid overlay. Drops missing, NaN, or inverted. Not S-57. */
export function encCatalogBounds(cell: {
  west?: number;
  south?: number;
  east?: number;
  north?: number;
}): EncCatalogBounds | undefined {
  const { west, south, east, north } = cell;
  if (
    typeof west !== "number" ||
    typeof south !== "number" ||
    typeof east !== "number" ||
    typeof north !== "number" ||
    !Number.isFinite(west) ||
    !Number.isFinite(south) ||
    !Number.isFinite(east) ||
    !Number.isFinite(north) ||
    west >= east ||
    south >= north
  ) {
    return undefined;
  }
  return { west, south, east, north };
}

export function encToPackedJson(
  bbox: PackBBox,
  cells: EncCatalogCell[],
  extras: {
    catalogUrl: string;
    catalogDate?: string;
    tiles?: EncTileMeta;
    officialS57?: EncS57File[];
  },
): PackedJson {
  const harbor = harborApproachNames(cells);
  const official = extras.officialS57 ?? [];
  const byId = new Map(official.map((f) => [f.id, f]));
  const hasOfficial = official.length > 0;
  return {
    kind: "enc-clip",
    layer: "enc",
    payload: {
      fixture: false,
      live: true,
      official: hasOfficial,
      encoding: hasOfficial ? ("s-57" as const) : undefined,
      source: hasOfficial ? "noaa" : "noaa-enc-catalog",
      note: hasOfficial ? ENC_S57_NOTE : ENC_AID_NOTE,
      bbox,
      catalog: { url: extras.catalogUrl, dateValid: extras.catalogDate },
      tiles: extras.tiles ?? {
        template: ENC_DIRECT_TILE_TEMPLATE,
        legal: false as const,
        probe: "skipped",
      },
      coverage: {
        harborApproach: harbor,
        coastalTo100fm: cells.some((c) => c.usage === 3),
      },
      s57: hasOfficial
        ? {
            source: "noaa",
            encoding: "s-57" as const,
            official: true,
            cellIds: official.map((f) => f.id),
            zipBytes: official.reduce((s, f) => s + f.zipBytes, 0),
            files: official,
          }
        : undefined,
      cells: cells.map((c) => {
        const box = encCatalogBounds(c);
        const s57 = byId.get(c.id) ?? c.s57;
        return {
          id: c.id,
          usage: c.usage,
          name: c.name,
          scale: c.scale,
          status: c.status,
          zipUrl: c.zipUrl,
          zipBytes: s57?.zipBytes ?? c.zipBytes,
          zipSha256: s57?.zipSha256 ?? c.zipSha256,
          edition: c.edition,
          update: c.update,
          issued: c.issued,
          ...(box ?? {}),
          ...(s57 ? { s57 } : {}),
        };
      }),
    },
  };
}
