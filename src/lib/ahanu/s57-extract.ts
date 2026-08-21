/**
 * Honest S-57 extract from packed official ISO 8211 .000 bytes.
 * Not an ECDIS. Only geometry that is actually in the file.
 * Isolated-node aids/lights + SG3D soundings + connected-node/edge
 * coastline, shoreline, depth, land, lakes, seabed, slope, wrecks, rocks,
 * and obstructions. Not place-name points as fake polygons.
 */

import { base64ToBytes, isIso8211, isS57UpdateFileName, parseS57DsidMeta, s57UpdateNumber, unzipEntries } from "./noaa-enc";
import type { EncClip, EncS57Packed } from "./packed-fields";

export const S57_EXTRACT_NOTE = "S-57 extract — not ECDIS";
export const S57_UPDATES_APPLIED_NOTE = "includes ENC updates";
export const S57_BASE_ONLY_NOTE = "base .000 only — no update files in this exchange set";
export const ENC_OFFICIAL_ROW_LABEL = "NOAA ENC (official S-57)";
export const ENC_CATALOG_ROW_LABEL = "NOAA ENC (catalog aid)";

const FT = 0x1e;
const UT = 0x1f;
const RCNM_FE = 100;
const RCNM_VI = 110;
const RCNM_VC = 120;
const RCNM_VE = 130;
const PRIM_POINT = 1;
const PRIM_LINE = 2;
const PRIM_AREA = 3;

const OBJL_BCNCAR = 5;
const OBJL_BCNISD = 6;
const OBJL_BCNLAT = 7;
const OBJL_BCNSPP = 8;
const OBJL_BRIDGE = 11;
const OBJL_BOYCAR = 13;
const OBJL_BOYINB = 14;
const OBJL_BOYISD = 15;
const OBJL_BOYLAT = 16;
const OBJL_BOYSAW = 17;
const OBJL_BOYSPP = 18;
const OBJL_COALNE = 30;
const OBJL_DEPARE = 42;
const OBJL_DEPCNT = 43;
const OBJL_BUISGL = 12;
const OBJL_LAKARE = 69;
const OBJL_LNDARE = 71;
const OBJL_LNDRGN = 73;
const OBJL_LIGHTS = 75;
const OBJL_OBSTRN = 86;
const OBJL_PILPNT = 90;
const OBJL_RIVERS = 114;
const OBJL_ROADWY = 116;
const OBJL_SEAARE = 119;
const OBJL_SBDARE = 121;
const OBJL_SLCONS = 122;
const OBJL_SLOTOP = 126;
const OBJL_SOUNDG = 129;
const OBJL_TS_PRH = 136;
const OBJL_UWTROC = 153;
const OBJL_WRECKS = 159;

const ATTL_CATWRK = 29;
const ATTL_CATOBS = 24;
const ATTL_CATLND = 34;
const ATTL_CATSLO = 64;
const ATTL_DRVAL1 = 87;
const ATTL_DRVAL2 = 88;
const ATTL_NATSUR = 113;
const ATTL_NATQUA = 114;
const ATTL_OBJNAM = 116;
const ATTL_VALDCO = 174;
const ATTL_VALSOU = 179;
const ATTL_WATLEV = 187;

const AID_OBJL = new Set([
  OBJL_BCNCAR,
  OBJL_BCNISD,
  OBJL_BCNLAT,
  OBJL_BCNSPP,
  OBJL_BOYCAR,
  OBJL_BOYINB,
  OBJL_BOYISD,
  OBJL_BOYLAT,
  OBJL_BOYSAW,
  OBJL_BOYSPP,
  OBJL_PILPNT,
]);

export const OBJ_NAME: Record<number, string> = {
  5: "BCNCAR",
  6: "BCNISD",
  7: "BCNLAT",
  8: "BCNSPP",
  11: "BRIDGE",
  13: "BOYCAR",
  14: "BOYINB",
  15: "BOYISD",
  16: "BOYLAT",
  17: "BOYSAW",
  18: "BOYSPP",
  30: "COALNE",
  42: "DEPARE",
  43: "DEPCNT",
  12: "BUISGL",
  69: "LAKARE",
  71: "LNDARE",
  73: "LNDRGN",
  75: "LIGHTS",
  86: "OBSTRN",
  90: "PILPNT",
  114: "RIVERS",
  116: "ROADWY",
  119: "SEAARE",
  121: "SBDARE",
  122: "SLCONS",
  126: "SLOTOP",
  129: "SOUNDG",
  136: "TS_PRH",
  153: "UWTROC",
  159: "WRECKS",
};

export type S57ExtractKind =
  | "enc-s57-cell"
  | "enc-s57-aid"
  | "enc-s57-light"
  | "enc-s57-sounding"
  | "enc-s57-coastline"
  | "enc-s57-shore"
  | "enc-s57-depth-area"
  | "enc-s57-depth-contour"
  | "enc-s57-land"
  | "enc-s57-lake"
  | "enc-s57-slope"
  | "enc-s57-seabed"
  | "enc-s57-wreck"
  | "enc-s57-obstruction"
  | "enc-s57-bridge";

export interface S57ExtractBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface S57ExtractCounts {
  aids: number;
  lights: number;
  soundings: number;
  soundingsOmitted: number;
  coastline: number;
  shoreline: number;
  depthAreas: number;
  depthAreasOmitted: number;
  depthContours: number;
  depthContoursOmitted: number;
  landAreas: number;
  landRegions: number;
  lakes: number;
  slopes: number;
  seabed: number;
  wrecks: number;
  obstructions: number;
  bridges: number;
}

export interface S57Extract {
  cellId: string;
  file000?: string;
  official: true;
  note: typeof S57_EXTRACT_NOTE;
  applyNote?: string;
  edition?: string;
  updn?: string;
  updatesApplied?: number;
  updateFiles?: string[];
  baseOnly?: boolean;
  bounds?: S57ExtractBounds;
  features: GeoJSON.Feature[];
  counts: S57ExtractCounts;
  classesPresent: { acronym: string; objl: number; count: number }[];
}

export interface S57ExtractSet {
  official: true;
  note: string;
  updatesApplied?: number;
  cells: S57Extract[];
  features: GeoJSON.Feature[];
}

export interface IsoRecord {
  ident: string;
  fields: Record<string, Uint8Array>;
}

interface Pt {
  lon: number;
  lat: number;
  depthM?: number;
}

interface EdgeRec {
  mid: Pt[];
  start?: string;
  end?: string;
}

interface FsptPtr {
  rcnm: number;
  rcid: number;
  ornt: number;
  usag: number;
  mask: number;
}

function latin1(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

function dv(bytes: Uint8Array, i: number): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset + i);
}

function u16(bytes: Uint8Array, i: number): number {
  return dv(bytes, i).getUint16(0, true);
}

function u32(bytes: Uint8Array, i: number): number {
  return dv(bytes, i).getUint32(0, true);
}

function i32(bytes: Uint8Array, i: number): number {
  return dv(bytes, i).getInt32(0, true);
}

function parseLeader(rec: Uint8Array): {
  ident: string;
  base: number;
  sizeLen: number;
  sizePos: number;
  sizeTag: number;
  len: number;
} | null {
  if (rec.byteLength < 24) return null;
  const leader = latin1(rec.subarray(0, 24));
  const len = Number(leader.slice(0, 5));
  const base = Number(leader.slice(12, 17));
  const sizeLen = Number(leader[20]);
  const sizePos = Number(leader[21]);
  const sizeTag = Number(leader[23]);
  if (!Number.isFinite(len) || !Number.isFinite(base) || !Number.isFinite(sizeLen) || !Number.isFinite(sizePos) || !Number.isFinite(sizeTag)) {
    return null;
  }
  if (len < 24 || base < 24 || sizeTag < 1) return null;
  return { ident: leader[6] ?? "", base, sizeLen, sizePos, sizeTag, len };
}

function parseIso8211Records(bytes: Uint8Array): IsoRecord[] {
  const out: IsoRecord[] = [];
  let off = 0;
  while (off + 24 <= bytes.byteLength) {
    const head = latin1(bytes.subarray(off, off + 5));
    const ln = Number(head);
    if (!Number.isFinite(ln) || ln < 24 || off + ln > bytes.byteLength) break;
    const rec = bytes.subarray(off, off + ln);
    const meta = parseLeader(rec);
    off += ln;
    if (!meta) continue;
    const directory = rec.subarray(24, Math.min(meta.base, rec.byteLength));
    const entries: { tag: string; flen: number; fpos: number }[] = [];
    const es = meta.sizeTag + meta.sizeLen + meta.sizePos;
    let i = 0;
    while (i + es <= directory.byteLength) {
      if (directory[i] === FT) break;
      const tag = latin1(directory.subarray(i, i + meta.sizeTag));
      const flen = Number(latin1(directory.subarray(i + meta.sizeTag, i + meta.sizeTag + meta.sizeLen)));
      const fpos = Number(latin1(directory.subarray(i + meta.sizeTag + meta.sizeLen, i + es)));
      if (!Number.isFinite(flen) || !Number.isFinite(fpos)) break;
      entries.push({ tag, flen, fpos });
      i += es;
    }
    const area = rec.subarray(meta.base, meta.len);
    const fields: Record<string, Uint8Array> = {};
    for (const e of entries) {
      if (e.fpos < 0 || e.flen < 0 || e.fpos + e.flen > area.byteLength) continue;
      let raw = area.subarray(e.fpos, e.fpos + e.flen);
      if (raw.byteLength && raw[raw.byteLength - 1] === FT) raw = raw.subarray(0, raw.byteLength - 1);
      fields[e.tag.trim()] = raw;
    }
    out.push({ ident: meta.ident, fields });
  }
  return out;
}

function parseAttrs(att: Uint8Array): Record<number, string> {
  const attrs: Record<number, string> = {};
  let i = 0;
  while (i + 2 < att.byteLength) {
    const attl = u16(att, i);
    i += 2;
    let end = i;
    while (end < att.byteLength && att[end] !== UT) end += 1;
    attrs[attl] = latin1(att.subarray(i, end));
    i = end < att.byteLength ? end + 1 : att.byteLength;
  }
  return attrs;
}

function numAttr(attrs: Record<number, string>, attl: number): number | undefined {
  const s = attrs[attl];
  if (s == null || s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function cellIdFromDsid(dsid: Uint8Array | undefined, fallback: string): string {
  if (!dsid) return fallback;
  const m = latin1(dsid).match(/US[0-9A-Z]{5,}/);
  return m?.[0]?.replace(/\.000$/i, "") ?? fallback;
}

function usageFromCellId(id: string): number {
  const m = id.match(/^US(\d)/);
  return m ? Number(m[1]) : 5;
}

/** Harbor cells keep full line/area fidelity. Coastal soundings/contours are strided. */
export function extractCapsForCell(cellId: string): {
  soundg: number;
  depcnt: number;
  depare: number;
  coalne: number;
  slcons: number;
} {
  const u = usageFromCellId(cellId);
  if (u >= 5) return { soundg: 400, depcnt: 10_000, depare: 10_000, coalne: 10_000, slcons: 10_000 };
  if (u >= 4) return { soundg: 120, depcnt: 200, depare: 80, coalne: 10_000, slcons: 10_000 };
  return { soundg: 40, depcnt: 80, depare: 40, coalne: 200, slcons: 200 };
}

function parseSg2(sg2: Uint8Array | undefined, comf: number): Pt[] {
  if (!sg2) return [];
  const pts: Pt[] = [];
  for (let i = 0; i + 8 <= sg2.byteLength; i += 8) {
    const lat = i32(sg2, i) / comf;
    const lon = i32(sg2, i + 4) / comf;
    if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push({ lon, lat });
  }
  return pts;
}

function parseSg3(sg3: Uint8Array | undefined, comf: number, somf: number): Pt[] {
  if (!sg3) return [];
  const pts: Pt[] = [];
  for (let i = 0; i + 12 <= sg3.byteLength; i += 12) {
    const lat = i32(sg3, i) / comf;
    const lon = i32(sg3, i + 4) / comf;
    const depthM = i32(sg3, i + 8) / somf;
    if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push({ lon, lat, depthM });
  }
  return pts;
}

/** VRPT: NAME B(40) + ORNT + USAG + TOPI + MASK = 9 bytes. */
function parseVrpt(vrpt: Uint8Array): { rcnm: number; rcid: number; topi: number }[] {
  const out: { rcnm: number; rcid: number; topi: number }[] = [];
  for (let i = 0; i + 9 <= vrpt.byteLength; i += 9) {
    out.push({ rcnm: vrpt[i]!, rcid: u32(vrpt, i + 1), topi: vrpt[i + 7]! });
  }
  return out;
}

/** FSPT: NAME B(40) + ORNT + USAG + MASK = 8 bytes. */
function parseFspt(fspt: Uint8Array): FsptPtr[] {
  const out: FsptPtr[] = [];
  for (let i = 0; i + 8 <= fspt.byteLength; i += 8) {
    out.push({
      rcnm: fspt[i]!,
      rcid: u32(fspt, i + 1),
      ornt: fspt[i + 5]!,
      usag: fspt[i + 6]!,
      mask: fspt[i + 7]!,
    });
  }
  return out;
}

function samePt(a: Pt, b: Pt): boolean {
  return Math.abs(a.lon - b.lon) < 1e-7 && Math.abs(a.lat - b.lat) < 1e-7;
}

function resolveEdge(edges: Map<string, EdgeRec>, connected: Map<string, Pt>, rcnm: number, rcid: number, reverse: boolean): Pt[] {
  const e = edges.get(`${rcnm}:${rcid}`);
  if (!e) return [];
  const start = e.start ? connected.get(e.start) : undefined;
  const end = e.end ? connected.get(e.end) : undefined;
  const pts: Pt[] = [];
  if (start) pts.push(start);
  pts.push(...e.mid);
  if (end) pts.push(end);
  return reverse ? pts.slice().reverse() : pts;
}

function chainLines(ptrs: FsptPtr[], edges: Map<string, EdgeRec>, connected: Map<string, Pt>): Pt[][] {
  const parts: Pt[][] = [];
  let cur: Pt[] = [];
  for (const p of ptrs) {
    if (p.rcnm !== RCNM_VE) continue;
    const pts = resolveEdge(edges, connected, p.rcnm, p.rcid, p.ornt === 2);
    if (pts.length < 1) continue;
    if (!cur.length) {
      cur = pts.slice();
      continue;
    }
    const last = cur[cur.length - 1]!;
    const first = pts[0]!;
    if (samePt(last, first)) cur.push(...pts.slice(1));
    else {
      parts.push(cur);
      cur = pts.slice();
    }
  }
  if (cur.length) parts.push(cur);
  return parts;
}

function closeRing(pts: Pt[]): Pt[] | null {
  if (pts.length < 3) return null;
  const ring = pts.slice();
  const a = ring[0]!;
  const b = ring[ring.length - 1]!;
  if (!samePt(a, b)) ring.push(a);
  return ring.length >= 4 ? ring : null;
}

function areaRings(ptrs: FsptPtr[], edges: Map<string, EdgeRec>, connected: Map<string, Pt>): number[][][] | null {
  const exterior = ptrs.filter((p) => p.usag !== 2);
  const interior = ptrs.filter((p) => p.usag === 2);
  const outers = chainLines(exterior.length ? exterior : ptrs, edges, connected)
    .map(closeRing)
    .filter((r): r is Pt[] => Boolean(r));
  if (!outers.length) return null;
  const holes = chainLines(interior, edges, connected)
    .map(closeRing)
    .filter((r): r is Pt[] => Boolean(r));
  const toCoords = (r: Pt[]) => r.map((p) => [p.lon, p.lat] as [number, number]);
  if (outers.length === 1) return [toCoords(outers[0]!), ...holes.map(toCoords)];
  return null;
}

function areaPolygons(ptrs: FsptPtr[], edges: Map<string, EdgeRec>, connected: Map<string, Pt>): GeoJSON.Polygon[] {
  const rings = areaRings(ptrs, edges, connected);
  if (rings) return [{ type: "Polygon", coordinates: rings }];
  const exterior = ptrs.filter((p) => p.usag !== 2);
  const outers = chainLines(exterior.length ? exterior : ptrs, edges, connected)
    .map(closeRing)
    .filter((r): r is Pt[] => Boolean(r));
  return outers.map((r) => ({
    type: "Polygon" as const,
    coordinates: [r.map((p) => [p.lon, p.lat] as [number, number])],
  }));
}

function boxFeature(id: string, name: string, b: S57ExtractBounds): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: {
      id,
      name,
      legal: false,
      kind: "enc-s57-cell",
      extract: S57_EXTRACT_NOTE,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [b.west, b.south],
          [b.east, b.south],
          [b.east, b.north],
          [b.west, b.north],
          [b.west, b.south],
        ],
      ],
    },
  };
}

function pointFeature(
  kind: S57ExtractKind,
  cellId: string,
  acronym: string,
  lon: number,
  lat: number,
  extra: Record<string, string | number | boolean | null>,
): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: {
      id: `${cellId}:${acronym}:${lon.toFixed(5)},${lat.toFixed(5)}`,
      cellId,
      acronym,
      legal: false,
      kind,
      extract: S57_EXTRACT_NOTE,
      ...extra,
    },
    geometry: { type: "Point", coordinates: [lon, lat] },
  };
}

function lineFeature(
  kind: S57ExtractKind,
  cellId: string,
  acronym: string,
  pts: Pt[],
  extra: Record<string, string | number | boolean | null>,
): GeoJSON.Feature | null {
  if (pts.length < 2) return null;
  const coords = pts.map((p) => [p.lon, p.lat] as [number, number]);
  return {
    type: "Feature",
    properties: {
      id: `${cellId}:${acronym}:${coords[0]![0]!.toFixed(5)},${coords[0]![1]!.toFixed(5)}`,
      cellId,
      acronym,
      legal: false,
      kind,
      extract: S57_EXTRACT_NOTE,
      ...extra,
    },
    geometry: { type: "LineString", coordinates: coords },
  };
}

function polyFeature(
  kind: S57ExtractKind,
  cellId: string,
  acronym: string,
  poly: GeoJSON.Polygon,
  extra: Record<string, string | number | boolean | null>,
): GeoJSON.Feature {
  const first = poly.coordinates[0]?.[0];
  return {
    type: "Feature",
    properties: {
      id: `${cellId}:${acronym}:${first ? `${first[0]!.toFixed(5)},${first[1]!.toFixed(5)}` : "poly"}`,
      cellId,
      acronym,
      legal: false,
      kind,
      extract: S57_EXTRACT_NOTE,
      ...extra,
    },
    geometry: poly,
  };
}

function strideTake<T>(items: T[], cap: number): { kept: T[]; omitted: number } {
  if (items.length <= cap) return { kept: items, omitted: 0 };
  const stride = Math.ceil(items.length / cap);
  const kept: T[] = [];
  for (let i = 0; i < items.length; i += stride) kept.push(items[i]!);
  return { kept, omitted: items.length - kept.length };
}

function acronymOf(objl: number): string {
  return OBJ_NAME[objl] ?? `OBJ${objl}`;
}

/** Present in these cells but not painted: buildings, named water, roads, rivers, tidal harmonics. */
export const S57_SKIPPED_OBJL = {
  BUISGL: OBJL_BUISGL,
  RIVERS: OBJL_RIVERS,
  ROADWY: OBJL_ROADWY,
  SEAARE: OBJL_SEAARE,
  TS_PRH: OBJL_TS_PRH,
} as const;

export function countS57ObjectClasses(bytes: Uint8Array): { acronym: string; objl: number; count: number }[] {
  const records = parseIso8211Records(bytes);
  const map = new Map<number, number>();
  for (const rec of records) {
    if (rec.ident !== "D" || !rec.fields.FRID || rec.fields.FRID[0] !== RCNM_FE || rec.fields.FRID.byteLength < 9) continue;
    const objl = u16(rec.fields.FRID, 7);
    map.set(objl, (map.get(objl) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([objl, count]) => ({ acronym: acronymOf(objl), objl, count }));
}

const RUIN_INSERT = 1;
const RUIN_DELETE = 2;
const RUIN_MODIFY = 3;
const ATTR_DELETED = "\x7f";

function cloneRec(rec: IsoRecord): IsoRecord {
  const fields: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(rec.fields)) fields[k] = v.slice();
  return { ident: rec.ident, fields };
}

function recNameKey(field: Uint8Array | undefined): string | null {
  if (!field || field.byteLength < 5) return null;
  return `${field[0]}:${u32(field, 1)}`;
}

function ruinOf(field: Uint8Array, offset: number): number {
  return field.byteLength > offset ? field[offset]! : RUIN_INSERT;
}

function encodeAttrs(attrs: Record<number, string>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    parts.push(concatBytes([u16le(Number(k)), ascii(`${v}\x1f`)]));
  }
  return concatBytes(parts);
}

function mergeAttrField(prev: Uint8Array | undefined, patch: Uint8Array | undefined): Uint8Array | undefined {
  if (!patch) return prev;
  if (!prev) return patch.slice();
  const a = parseAttrs(prev);
  const b = parseAttrs(patch);
  for (const [k, v] of Object.entries(b)) {
    const id = Number(k);
    if (v === ATTR_DELETED || (v.length > 0 && v.charCodeAt(0) === 0x7f)) delete a[id];
    else a[id] = v;
  }
  return encodeAttrs(a);
}

function applyPointerControl(
  existing: Uint8Array | undefined,
  stride: number,
  control: Uint8Array,
  incoming: Uint8Array | undefined,
): Uint8Array {
  const items: Uint8Array[] = [];
  if (existing) {
    for (let i = 0; i + stride <= existing.byteLength; i += stride) items.push(existing.subarray(i, i + stride));
  }
  if (control.byteLength < 5) return existing?.slice() ?? new Uint8Array();
  const ui = control[0]!;
  const ix = u16(control, 1);
  const n = u16(control, 3);
  const start = Math.max(0, ix - 1);
  const neu: Uint8Array[] = [];
  if (incoming) {
    for (let i = 0; i + stride <= incoming.byteLength; i += stride) neu.push(incoming.subarray(i, i + stride));
  }
  if (ui === RUIN_DELETE) items.splice(start, n);
  else if (ui === RUIN_INSERT) items.splice(start, 0, ...neu);
  else if (ui === RUIN_MODIFY) items.splice(start, n, ...neu);
  return concatBytes(items.map((p) => p.slice()));
}

function modifyRecord(prev: IsoRecord, patch: IsoRecord, kind: "feature" | "vector"): IsoRecord {
  const out = cloneRec(prev);
  if (kind === "feature" && patch.fields.FRID) out.fields.FRID = patch.fields.FRID.slice();
  if (kind === "vector" && patch.fields.VRID) out.fields.VRID = patch.fields.VRID.slice();
  if (patch.fields.FOID) out.fields.FOID = patch.fields.FOID.slice();
  if (patch.fields.ATTF) {
    const merged = mergeAttrField(prev.fields.ATTF, patch.fields.ATTF);
    if (merged) out.fields.ATTF = merged;
  }
  if (patch.fields.ATTV) {
    const merged = mergeAttrField(prev.fields.ATTV, patch.fields.ATTV);
    if (merged) out.fields.ATTV = merged;
  }
  if (patch.fields.NATF) {
    const merged = mergeAttrField(prev.fields.NATF, patch.fields.NATF);
    if (merged) out.fields.NATF = merged;
  }
  if (kind === "feature") {
    if (patch.fields.FSPC) out.fields.FSPT = applyPointerControl(prev.fields.FSPT, 8, patch.fields.FSPC, patch.fields.FSPT);
    else if (patch.fields.FSPT) out.fields.FSPT = patch.fields.FSPT.slice();
    if (patch.fields.FFPC) out.fields.FFPT = applyPointerControl(prev.fields.FFPT, 9, patch.fields.FFPC, patch.fields.FFPT);
    else if (patch.fields.FFPT) out.fields.FFPT = patch.fields.FFPT.slice();
  } else {
    if (patch.fields.VRPC) out.fields.VRPT = applyPointerControl(prev.fields.VRPT, 9, patch.fields.VRPC, patch.fields.VRPT);
    else if (patch.fields.VRPT) out.fields.VRPT = patch.fields.VRPT.slice();
    const use3 = Boolean(patch.fields.SG3D || prev.fields.SG3D);
    const sgKey = use3 ? "SG3D" : "SG2D";
    const sgStride = use3 ? 12 : 8;
    if (patch.fields.SGCC) {
      const src = patch.fields[sgKey] ?? patch.fields.SG2D ?? patch.fields.SG3D;
      out.fields[sgKey] = applyPointerControl(prev.fields[sgKey], sgStride, patch.fields.SGCC, src);
    } else {
      if (patch.fields.SG2D) out.fields.SG2D = patch.fields.SG2D.slice();
      if (patch.fields.SG3D) out.fields.SG3D = patch.fields.SG3D.slice();
    }
  }
  return out;
}

/** Apply one ISO 8211 update file's records onto the base/previous cell records. */
export function applyS57UpdateRecords(base: IsoRecord[], update: IsoRecord[]): IsoRecord[] {
  const other: IsoRecord[] = [];
  const vMap = new Map<string, IsoRecord>();
  const fMap = new Map<string, IsoRecord>();
  for (const rec of base) {
    if (rec.ident !== "D") {
      other.push(cloneRec(rec));
      continue;
    }
    const fk = rec.fields.FRID && rec.fields.FRID[0] === RCNM_FE ? recNameKey(rec.fields.FRID) : null;
    const vk = rec.fields.VRID ? recNameKey(rec.fields.VRID) : null;
    if (fk) fMap.set(fk, cloneRec(rec));
    else if (vk) vMap.set(vk, cloneRec(rec));
    else other.push(cloneRec(rec));
  }
  for (const rec of update) {
    if (rec.ident !== "D") continue;
    if (rec.fields.FRID && rec.fields.FRID[0] === RCNM_FE) {
      const key = recNameKey(rec.fields.FRID);
      if (!key) continue;
      const ruin = ruinOf(rec.fields.FRID, 11);
      if (ruin === RUIN_DELETE) fMap.delete(key);
      else if (ruin === RUIN_INSERT) fMap.set(key, cloneRec(rec));
      else if (ruin === RUIN_MODIFY) {
        const prev = fMap.get(key);
        fMap.set(key, prev ? modifyRecord(prev, rec, "feature") : cloneRec(rec));
      }
    } else if (rec.fields.VRID) {
      const key = recNameKey(rec.fields.VRID);
      if (!key) continue;
      const ruin = ruinOf(rec.fields.VRID, 7);
      if (ruin === RUIN_DELETE) vMap.delete(key);
      else if (ruin === RUIN_INSERT) vMap.set(key, cloneRec(rec));
      else if (ruin === RUIN_MODIFY) {
        const prev = vMap.get(key);
        vMap.set(key, prev ? modifyRecord(prev, rec, "vector") : cloneRec(rec));
      }
    }
  }
  return [...other, ...vMap.values(), ...fMap.values()];
}

export function extractS57FromDot000(bytes: Uint8Array, cellId = "UNKNOWN"): S57Extract | null {
  if (!isIso8211(bytes) && !/^[0-9]{5}[ 3][LD]/.test(latin1(bytes.subarray(0, 8)))) return null;
  const records = parseIso8211Records(bytes);
  if (!records.length) return null;
  return extractS57FromRecords(records, cellId);
}

export function extractS57FromRecords(records: IsoRecord[], cellId = "UNKNOWN"): S57Extract | null {

  let comf = 10_000_000;
  let somf = 10;
  let id = cellId;
  const isolated = new Map<string, Pt[]>();
  const connected = new Map<string, Pt>();
  const edges = new Map<string, EdgeRec>();
  const classMap = new Map<number, number>();

  for (const rec of records) {
    if (rec.ident !== "D") continue;
    if (rec.fields.DSPM && rec.fields.DSPM.byteLength >= 24) {
      const c = u32(rec.fields.DSPM, 16);
      const s = u32(rec.fields.DSPM, 20);
      if (c > 1000 && c < 1e9) comf = c;
      if (s > 0 && s < 1e6) somf = s;
    }
    if (rec.fields.DSID) id = cellIdFromDsid(rec.fields.DSID, id);
    if (!rec.fields.VRID || rec.fields.VRID.byteLength < 5) continue;
    const rcnm = rec.fields.VRID[0]!;
    const rcid = u32(rec.fields.VRID, 1);
    const key = `${rcnm}:${rcid}`;
    const pts2 = parseSg2(rec.fields.SG2D, comf);
    const pts3 = parseSg3(rec.fields.SG3D, comf, somf);
    const pts = pts3.length ? pts3 : pts2;
    if (rcnm === RCNM_VI) isolated.set(key, pts);
    else if (rcnm === RCNM_VC && pts[0]) connected.set(key, pts[0]);
    else if (rcnm === RCNM_VE) {
      const ptrs = rec.fields.VRPT ? parseVrpt(rec.fields.VRPT) : [];
      const start = ptrs.find((p) => p.topi === 1);
      const end = ptrs.find((p) => p.topi === 2);
      edges.set(key, {
        mid: pts2,
        start: start ? `${start.rcnm}:${start.rcid}` : ptrs[0] ? `${ptrs[0].rcnm}:${ptrs[0].rcid}` : undefined,
        end: end ? `${end.rcnm}:${end.rcid}` : ptrs[1] ? `${ptrs[1].rcnm}:${ptrs[1].rcid}` : undefined,
      });
    }
  }

  const lons: number[] = [];
  const lats: number[] = [];
  const consider = (p: Pt) => {
    if (p.lon >= -180 && p.lon <= 180 && p.lat >= -90 && p.lat <= 90) {
      lons.push(p.lon);
      lats.push(p.lat);
    }
  };
  for (const pts of isolated.values()) for (const p of pts) consider(p);
  for (const p of connected.values()) consider(p);
  for (const e of edges.values()) for (const p of e.mid) consider(p);
  const bounds: S57ExtractBounds | undefined =
    lons.length && lats.length
      ? { west: Math.min(...lons), south: Math.min(...lats), east: Math.max(...lons), north: Math.max(...lats) }
      : undefined;

  const features: GeoJSON.Feature[] = [];
  if (bounds && bounds.west < bounds.east && bounds.south < bounds.north) {
    features.push(boxFeature(id, id, bounds));
  }

  const caps = extractCapsForCell(id);
  const pendingCoast: GeoJSON.Feature[] = [];
  const pendingShore: GeoJSON.Feature[] = [];
  const pendingDepare: GeoJSON.Feature[] = [];
  const pendingDepcnt: GeoJSON.Feature[] = [];
  const pendingSoundings: Pt[] = [];

  let aids = 0;
  let lights = 0;
  let soundings = 0;
  let soundingsOmitted = 0;
  let landAreas = 0;
  let landRegions = 0;
  let lakes = 0;
  let slopes = 0;
  let seabed = 0;
  let wrecks = 0;
  let obstructions = 0;
  let bridges = 0;

  const spatialPts = (spatial: FsptPtr[]): Pt[] => {
    const out: Pt[] = [];
    for (const s of spatial) {
      if (s.rcnm === RCNM_VI) out.push(...(isolated.get(`${s.rcnm}:${s.rcid}`) ?? []));
      else if (s.rcnm === RCNM_VC) {
        const p = connected.get(`${s.rcnm}:${s.rcid}`);
        if (p) out.push(p);
      }
    }
    return out;
  };

  for (const rec of records) {
    if (rec.ident !== "D" || !rec.fields.FRID || rec.fields.FRID[0] !== RCNM_FE || rec.fields.FRID.byteLength < 9) continue;
    const prim = rec.fields.FRID[5]!;
    const objl = u16(rec.fields.FRID, 7);
    classMap.set(objl, (classMap.get(objl) ?? 0) + 1);
    const attrs = rec.fields.ATTF ? parseAttrs(rec.fields.ATTF) : {};
    const name = attrs[ATTL_OBJNAM] || undefined;
    const spatial = rec.fields.FSPT ? parseFspt(rec.fields.FSPT) : [];
    const extraBase = {
      name: name ?? acronymOf(objl),
      drval1: numAttr(attrs, ATTL_DRVAL1) ?? null,
      drval2: numAttr(attrs, ATTL_DRVAL2) ?? null,
      valdco: numAttr(attrs, ATTL_VALDCO) ?? null,
      valsou: numAttr(attrs, ATTL_VALSOU) ?? null,
      catwrk: numAttr(attrs, ATTL_CATWRK) ?? null,
      catobs: numAttr(attrs, ATTL_CATOBS) ?? null,
      catlnd: numAttr(attrs, ATTL_CATLND) ?? null,
      catslo: numAttr(attrs, ATTL_CATSLO) ?? null,
      natsur: attrs[ATTL_NATSUR] || null,
      natqua: attrs[ATTL_NATQUA] || null,
      watlev: numAttr(attrs, ATTL_WATLEV) ?? null,
    };

    if (objl === OBJL_SOUNDG) {
      const pts = spatialPts(spatial);
      const vi = spatial.filter((s) => s.rcnm === RCNM_VI).flatMap((s) => isolated.get(`${s.rcnm}:${s.rcid}`) ?? []);
      const poolSrc = vi.length ? vi : pts;
      const depths = poolSrc.filter((p) => typeof p.depthM === "number");
      const pool = depths.length ? depths : poolSrc;
      pendingSoundings.push(...pool);
      continue;
    }

    const emitPoint = (kind: S57ExtractKind, acronym: string) => {
      const viPts = spatial.filter((s) => s.rcnm === RCNM_VI).flatMap((s) => isolated.get(`${s.rcnm}:${s.rcid}`) ?? []);
      const p = viPts[0] ?? spatialPts(spatial)[0];
      if (!p) return false;
      features.push(pointFeature(kind, id, acronym, p.lon, p.lat, extraBase));
      return true;
    };

    const emitLines = (kind: S57ExtractKind, acronym: string, bucket?: GeoJSON.Feature[]) => {
      const parts = chainLines(spatial, edges, connected);
      let n = 0;
      for (const part of parts) {
        const f = lineFeature(kind, id, acronym, part, extraBase);
        if (!f) continue;
        (bucket ?? features).push(f);
        n += 1;
      }
      return n;
    };

    const emitAreas = (kind: S57ExtractKind, acronym: string, bucket?: GeoJSON.Feature[]) => {
      const polys = areaPolygons(spatial, edges, connected);
      for (const poly of polys) (bucket ?? features).push(polyFeature(kind, id, acronym, poly, extraBase));
      return polys.length;
    };

    if (objl === OBJL_LIGHTS) {
      if (emitPoint("enc-s57-light", "LIGHTS")) lights += 1;
      continue;
    }
    if (AID_OBJL.has(objl)) {
      if (prim === PRIM_POINT || prim === 255) {
        if (emitPoint("enc-s57-aid", acronymOf(objl))) aids += 1;
      }
      continue;
    }
    if (objl === OBJL_COALNE) {
      emitLines("enc-s57-coastline", "COALNE", pendingCoast);
      continue;
    }
    if (objl === OBJL_SLCONS) {
      if (prim === PRIM_AREA) emitAreas("enc-s57-shore", "SLCONS", pendingShore);
      else emitLines("enc-s57-shore", "SLCONS", pendingShore);
      continue;
    }
    if (objl === OBJL_DEPCNT) {
      emitLines("enc-s57-depth-contour", "DEPCNT", pendingDepcnt);
      continue;
    }
    if (objl === OBJL_DEPARE) {
      emitAreas("enc-s57-depth-area", "DEPARE", pendingDepare);
      continue;
    }
    if (objl === OBJL_LNDARE) {
      if (prim === PRIM_AREA) landAreas += emitAreas("enc-s57-land", "LNDARE");
      else if (prim === PRIM_POINT && emitPoint("enc-s57-land", "LNDARE")) landAreas += 1;
      continue;
    }
    if (objl === OBJL_LNDRGN) {
      // Area land/marsh/reef only. Point LNDRGN is a place name — do not invent a polygon.
      if (prim === PRIM_AREA) landRegions += emitAreas("enc-s57-land", "LNDRGN");
      continue;
    }
    if (objl === OBJL_LAKARE) {
      if (prim === PRIM_AREA) lakes += emitAreas("enc-s57-lake", "LAKARE");
      continue;
    }
    if (objl === OBJL_SLOTOP) {
      if (prim === PRIM_LINE) slopes += emitLines("enc-s57-slope", "SLOTOP");
      continue;
    }
    if (objl === OBJL_SBDARE) {
      if (prim === PRIM_AREA) seabed += emitAreas("enc-s57-seabed", "SBDARE");
      else if (prim === PRIM_LINE) seabed += emitLines("enc-s57-seabed", "SBDARE");
      else if (prim === PRIM_POINT && emitPoint("enc-s57-seabed", "SBDARE")) seabed += 1;
      continue;
    }
    if (objl === OBJL_WRECKS) {
      if (prim === PRIM_AREA) wrecks += emitAreas("enc-s57-wreck", "WRECKS");
      else if (emitPoint("enc-s57-wreck", "WRECKS")) wrecks += 1;
      continue;
    }
    if (objl === OBJL_OBSTRN || objl === OBJL_UWTROC) {
      const acr = acronymOf(objl);
      if (prim === PRIM_AREA) obstructions += emitAreas("enc-s57-obstruction", acr);
      else if (prim === PRIM_LINE) obstructions += emitLines("enc-s57-obstruction", acr);
      else if (emitPoint("enc-s57-obstruction", acr)) obstructions += 1;
      continue;
    }
    if (objl === OBJL_BRIDGE) {
      if (prim === PRIM_AREA) bridges += emitAreas("enc-s57-bridge", "BRIDGE");
      else if (prim === PRIM_LINE) bridges += emitLines("enc-s57-bridge", "BRIDGE");
      else if (emitPoint("enc-s57-bridge", "BRIDGE")) bridges += 1;
    }
  }

  const coast = strideTake(pendingCoast, caps.coalne);
  const shore = strideTake(pendingShore, caps.slcons);
  const depare = strideTake(pendingDepare, caps.depare);
  const depcnt = strideTake(pendingDepcnt, caps.depcnt);
  const snd = strideTake(pendingSoundings, caps.soundg);
  for (const p of snd.kept) {
    features.push(pointFeature("enc-s57-sounding", id, "SOUNDG", p.lon, p.lat, { depthM: p.depthM ?? null }));
  }
  soundings = snd.kept.length;
  soundingsOmitted = snd.omitted;
  features.push(...coast.kept, ...shore.kept, ...depare.kept, ...depcnt.kept);

  const classesPresent = [...classMap.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([objl, count]) => ({ acronym: acronymOf(objl), objl, count }));

  if (!features.length) return null;
  return {
    cellId: id,
    official: true,
    note: S57_EXTRACT_NOTE,
    bounds,
    features,
    counts: {
      aids,
      lights,
      soundings,
      soundingsOmitted,
      coastline: coast.kept.length,
      shoreline: shore.kept.length,
      depthAreas: depare.kept.length,
      depthAreasOmitted: depare.omitted,
      depthContours: depcnt.kept.length,
      depthContoursOmitted: depcnt.omitted,
      landAreas,
      landRegions,
      lakes,
      slopes,
      seabed,
      wrecks,
      obstructions,
      bridges,
    },
    classesPresent,
  };
}

export async function extractS57FromZip(zip: Uint8Array, cellId?: string): Promise<S57Extract | null> {
  const entries = await unzipEntries(zip);
  const file000 = entries.find((e) => e.name.toUpperCase().endsWith(".000"));
  if (!file000 || !isIso8211(file000.data)) return null;
  const id = cellId ?? file000.name.split("/").pop()?.replace(/\.000$/i, "") ?? "UNKNOWN";
  let records = parseIso8211Records(file000.data);
  const updateEntries = entries
    .filter((e) => isS57UpdateFileName(e.name) && isIso8211(e.data))
    .sort((a, b) => (s57UpdateNumber(a.name) ?? 0) - (s57UpdateNumber(b.name) ?? 0));
  const applied: string[] = [];
  for (const u of updateEntries) {
    const next = parseIso8211Records(u.data);
    if (!next.length) continue;
    records = applyS57UpdateRecords(records, next);
    applied.push(u.name.split("/").pop() ?? u.name);
  }
  const extracted = extractS57FromRecords(records, id);
  if (!extracted) return null;
  extracted.file000 = file000.name.split("/").pop();
  extracted.updatesApplied = applied.length;
  extracted.updateFiles = applied;
  extracted.baseOnly = applied.length === 0;
  extracted.applyNote = applied.length ? S57_UPDATES_APPLIED_NOTE : S57_BASE_ONLY_NOTE;
  const baseMeta = parseS57DsidMeta(file000.data);
  const lastUp = updateEntries[updateEntries.length - 1];
  const upMeta = lastUp ? parseS57DsidMeta(lastUp.data) : undefined;
  extracted.edition = upMeta?.edition ?? baseMeta.edition;
  extracted.updn = applied.length ? (upMeta?.update ?? String(applied.length)) : (baseMeta.update ?? "0");
  return extracted;
}

function zipSources(enc: EncClip): { id: string; zipBase64: string }[] {
  const files = (enc.s57?.files ?? []).filter((f): f is EncS57Packed & { zipBase64: string; id: string } =>
    Boolean(f?.id && f.zipBase64),
  );
  if (files.length) return files.map((f) => ({ id: f.id, zipBase64: f.zipBase64 }));
  return (enc.cells ?? [])
    .filter((c) => c.s57?.zipBase64)
    .map((c) => ({ id: c.id, zipBase64: c.s57!.zipBase64! }));
}

export async function extractPackedS57(enc: EncClip): Promise<S57ExtractSet | undefined> {
  if (!enc.official) return undefined;
  const cells: S57Extract[] = [];
  for (const src of zipSources(enc)) {
    try {
      const zip = base64ToBytes(src.zipBase64);
      const one = await extractS57FromZip(zip, src.id);
      if (one) cells.push(one);
    } catch {
      /* packed zip that does not parse stays unused — no invented geometry */
    }
  }
  if (!cells.length) return undefined;
  const updatesApplied = cells.reduce((n, c) => n + (c.updatesApplied ?? 0), 0);
  return {
    official: true,
    note: updatesApplied ? `${S57_EXTRACT_NOTE} — ${S57_UPDATES_APPLIED_NOTE}` : S57_EXTRACT_NOTE,
    updatesApplied,
    cells,
    features: cells.flatMap((c) => c.features),
  };
}

export async function applyOfficialS57Extract(enc: EncClip | undefined): Promise<void> {
  if (!enc?.official) return;
  enc.extract = await extractPackedS57(enc);
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

function ascii(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function i32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, n, true);
  return b;
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function u16le(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function padNum(n: number, w: number): string {
  return String(n).padStart(w, "0");
}

/** ISO 8211 data record. Used by tests. Not a NOAA product. */
export function makeIso8211DataRecord(fields: { tag: string; data: Uint8Array }[]): Uint8Array {
  const sizeLen = 4;
  const sizePos = 4;
  const sizeTag = 4;
  const dir: Uint8Array[] = [];
  const area: Uint8Array[] = [];
  let pos = 0;
  for (const f of fields) {
    const payload = concatBytes([f.data, new Uint8Array([FT])]);
    const tag = (f.tag + "    ").slice(0, sizeTag);
    dir.push(ascii(`${tag}${padNum(payload.byteLength, sizeLen)}${padNum(pos, sizePos)}`));
    area.push(payload);
    pos += payload.byteLength;
  }
  dir.push(new Uint8Array([FT]));
  const directory = concatBytes(dir);
  const fieldArea = concatBytes(area);
  const base = 24 + directory.byteLength;
  const recLen = base + fieldArea.byteLength;
  const leader = ascii(`${padNum(recLen, 5)} D     ${padNum(base, 5)}   ${sizeLen}${sizePos}0${sizeTag}`);
  return concatBytes([leader, directory, fieldArea]);
}

/** Minimal DDR so isIso8211 accepts the file. Record length matches the bytes. */
export function makeIso8211Ddr(): Uint8Array {
  const sizeLen = 3;
  const sizePos = 4;
  const sizeTag = 4;
  const dir = concatBytes([ascii("000001230000"), new Uint8Array([FT])]);
  const field = concatBytes([ascii("0000;&   \x1f"), new Uint8Array([FT])]);
  const base = 24 + dir.byteLength;
  const recLen = base + field.byteLength;
  const leader = ascii(`${padNum(recLen, 5)}3LE1 09${padNum(base, 5)} ! ${sizeLen}${sizePos}0${sizeTag}`);
  return concatBytes([leader, dir, field]);
}

function dspmField(comf: number, somf: number): Uint8Array {
  return concatBytes([
    new Uint8Array([0x14]),
    u32le(1),
    new Uint8Array([0x02, 0x10, 0x0c]),
    u32le(12_000),
    new Uint8Array([0x01, 0x01, 0x01, 0x01]),
    u32le(comf),
    u32le(somf),
    ascii("test\x1f"),
  ]);
}

function vridNode(rcnm: number, rcid: number, ruin = 1): Uint8Array {
  return concatBytes([new Uint8Array([rcnm]), u32le(rcid), u16le(1), new Uint8Array([ruin])]);
}

function fridGeom(rcid: number, prim: number, objl: number, ruin = 1): Uint8Array {
  return concatBytes([new Uint8Array([RCNM_FE]), u32le(rcid), new Uint8Array([prim, 2]), u16le(objl), u16le(1), new Uint8Array([ruin])]);
}

function fsptEdge(rcid: number, ornt = 1, usag = 255): Uint8Array {
  return concatBytes([new Uint8Array([RCNM_VE]), u32le(rcid), new Uint8Array([ornt, usag, 2])]);
}

function fsptIsolated(rcid: number): Uint8Array {
  return concatBytes([new Uint8Array([RCNM_VI]), u32le(rcid), new Uint8Array([255, 1, 2])]);
}

function vrptEnds(start: number, end: number): Uint8Array {
  const one = (rcid: number, topi: number) =>
    concatBytes([new Uint8Array([RCNM_VC]), u32le(rcid), new Uint8Array([255, 255, topi, 255])]);
  return concatBytes([one(start, 1), one(end, 2)]);
}

function attfName(name: string): Uint8Array {
  return concatBytes([u16le(ATTL_OBJNAM), ascii(`${name}\x1f`)]);
}

function attfPairs(pairs: [number, string][]): Uint8Array {
  return concatBytes(pairs.map(([k, v]) => concatBytes([u16le(k), ascii(`${v}\x1f`)])));
}

function dsidField(cellId: string): Uint8Array {
  return ascii(`\n\x01\x00\x00\x00\x01\x05${cellId}.000\x1f5\x1f0\x1f`);
}

function sg2(lat: number, lon: number, comf: number): Uint8Array {
  return concatBytes([i32le(Math.round(lat * comf)), i32le(Math.round(lon * comf))]);
}

/**
 * Parseable ISO 8211 S-57 subset for tests. Not a NOAA exchange set.
 * Light, named buoy, sounding, coastline, depth area, wreck at known PJ-harbor coordinates.
 */
export function sampleS57ExtractDot000(cellId = "US5TESTA"): Uint8Array {
  const comf = 10_000_000;
  const somf = 10;
  const lightLon = -71.5147222;
  const lightLat = 41.3656111;
  const buoyLon = -71.5165726;
  const buoyLat = 41.3852666;
  const sndLon = -71.51;
  const sndLat = 41.35;
  const depthM = 12.6;
  const wreckLon = -71.512;
  const wreckLat = 41.361;
  const a = { lat: 41.36, lon: -71.52 };
  const b = { lat: 41.36, lon: -71.50 };
  const c = { lat: 41.37, lon: -71.50 };
  const mid = { lat: 41.36, lon: -71.51 };
  return concatBytes([
    makeIso8211Ddr(),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([1, 0]) },
      { tag: "DSID", data: dsidField(cellId) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([2, 0]) },
      { tag: "DSPM", data: dspmField(comf, somf) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([3, 0]) },
      { tag: "VRID", data: vridNode(RCNM_VI, 1) },
      { tag: "SG2D", data: sg2(lightLat, lightLon, comf) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([4, 0]) },
      { tag: "VRID", data: vridNode(RCNM_VI, 2) },
      { tag: "SG2D", data: sg2(buoyLat, buoyLon, comf) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([5, 0]) },
      { tag: "VRID", data: vridNode(RCNM_VI, 3) },
      {
        tag: "SG3D",
        data: concatBytes([
          i32le(Math.round(sndLat * comf)),
          i32le(Math.round(sndLon * comf)),
          i32le(Math.round(depthM * somf)),
        ]),
      },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([6, 0]) },
      { tag: "VRID", data: vridNode(RCNM_VI, 4) },
      { tag: "SG2D", data: sg2(wreckLat, wreckLon, comf) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([7, 0]) },
      { tag: "VRID", data: vridNode(RCNM_VC, 10) },
      { tag: "SG2D", data: sg2(a.lat, a.lon, comf) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([8, 0]) },
      { tag: "VRID", data: vridNode(RCNM_VC, 11) },
      { tag: "SG2D", data: sg2(b.lat, b.lon, comf) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([9, 0]) },
      { tag: "VRID", data: vridNode(RCNM_VC, 12) },
      { tag: "SG2D", data: sg2(c.lat, c.lon, comf) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([10, 0]) },
      { tag: "VRID", data: vridNode(RCNM_VE, 10) },
      { tag: "VRPT", data: vrptEnds(10, 11) },
      { tag: "SG2D", data: sg2(mid.lat, mid.lon, comf) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([11, 0]) },
      { tag: "VRID", data: vridNode(RCNM_VE, 11) },
      { tag: "VRPT", data: vrptEnds(11, 12) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([12, 0]) },
      { tag: "VRID", data: vridNode(RCNM_VE, 12) },
      { tag: "VRPT", data: vrptEnds(12, 10) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([13, 0]) },
      { tag: "FRID", data: fridGeom(1, PRIM_POINT, OBJL_LIGHTS) },
      { tag: "ATTF", data: attfName("Test Light") },
      { tag: "FSPT", data: fsptIsolated(1) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([14, 0]) },
      { tag: "FRID", data: fridGeom(2, PRIM_POINT, OBJL_BOYSAW) },
      { tag: "ATTF", data: attfName("Test Channel Buoy 7") },
      { tag: "FSPT", data: fsptIsolated(2) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([15, 0]) },
      { tag: "FRID", data: fridGeom(3, PRIM_POINT, OBJL_SOUNDG) },
      { tag: "FSPT", data: fsptIsolated(3) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([16, 0]) },
      { tag: "FRID", data: fridGeom(4, PRIM_POINT, OBJL_WRECKS) },
      { tag: "ATTF", data: attfPairs([[ATTL_OBJNAM, "Test Wreck"], [ATTL_VALSOU, "8.2"]]) },
      { tag: "FSPT", data: fsptIsolated(4) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([17, 0]) },
      { tag: "FRID", data: fridGeom(5, PRIM_LINE, OBJL_COALNE) },
      { tag: "FSPT", data: fsptEdge(10, 1, 255) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([18, 0]) },
      { tag: "FRID", data: fridGeom(6, PRIM_AREA, OBJL_DEPARE) },
      { tag: "ATTF", data: attfPairs([[ATTL_DRVAL1, "0"], [ATTL_DRVAL2, "5"]]) },
      { tag: "FSPT", data: concatBytes([fsptEdge(10, 1, 1), fsptEdge(11, 1, 1), fsptEdge(12, 1, 1)]) },
    ]),
  ]);
}

/**
 * Synthetic ISO 8211 update (not NOAA). Deletes the sample LIGHTS and inserts a BOYLAT.
 */
export function sampleS57UpdateDot001(cellId = "US5TESTA"): Uint8Array {
  const comf = 10_000_000;
  const lon = -71.513;
  const lat = 41.362;
  return concatBytes([
    makeIso8211Ddr(),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([1, 0]) },
      { tag: "DSID", data: ascii(`\n\x01\x00\x00\x00\x02\x05${cellId}.001\x1f1\x1f1\x1f`) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([2, 0]) },
      { tag: "FRID", data: fridGeom(1, PRIM_POINT, OBJL_LIGHTS, RUIN_DELETE) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([3, 0]) },
      { tag: "VRID", data: vridNode(RCNM_VI, 20, RUIN_INSERT) },
      { tag: "SG2D", data: sg2(lat, lon, comf) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([4, 0]) },
      { tag: "FRID", data: fridGeom(20, PRIM_POINT, OBJL_BOYLAT, RUIN_INSERT) },
      { tag: "ATTF", data: attfName("Update Buoy") },
      { tag: "FSPT", data: fsptIsolated(20) },
    ]),
  ]);
}
