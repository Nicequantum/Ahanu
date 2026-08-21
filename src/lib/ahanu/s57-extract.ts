/**
 * Honest S-57 extract from packed official ISO 8211 .000 bytes.
 * Not an ECDIS. Only geometry that is actually in the file.
 * Isolated-node aids/lights + SG3D soundings + coordinate-extent cell boxes.
 */

import { base64ToBytes, isIso8211, unzipEntries } from "./noaa-enc";
import type { EncClip, EncS57Packed } from "./packed-fields";

export const S57_EXTRACT_NOTE = "S-57 extract — not ECDIS";
export const ENC_OFFICIAL_ROW_LABEL = "NOAA ENC (official S-57)";
export const ENC_CATALOG_ROW_LABEL = "NOAA ENC (catalog aid)";

const FT = 0x1e;
const UT = 0x1f;
const RCNM_VI = 110;
const RCNM_FE = 100;
const OBJL_LIGHTS = 75;
const OBJL_SOUNDG = 129;
const ATTL_OBJNAM = 116;
const SOUNDG_CAP = 800;

const AID_OBJL = new Set([5, 6, 7, 8, 13, 14, 15, 16, 17, 18]);

const OBJ_NAME: Record<number, string> = {
  5: "BCNCAR",
  6: "BCNISD",
  7: "BCNLAT",
  8: "BCNSPP",
  13: "BOYCAR",
  14: "BOYINB",
  15: "BOYISD",
  16: "BOYLAT",
  17: "BOYSAW",
  18: "BOYSPP",
  75: "LIGHTS",
  129: "SOUNDG",
};

export type S57ExtractKind = "enc-s57-cell" | "enc-s57-aid" | "enc-s57-light" | "enc-s57-sounding";

export interface S57ExtractBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface S57Extract {
  cellId: string;
  file000?: string;
  official: true;
  note: typeof S57_EXTRACT_NOTE;
  bounds?: S57ExtractBounds;
  features: GeoJSON.Feature[];
  counts: { aids: number; lights: number; soundings: number; soundingsOmitted: number };
}

export interface S57ExtractSet {
  official: true;
  note: typeof S57_EXTRACT_NOTE;
  cells: S57Extract[];
  features: GeoJSON.Feature[];
}

interface IsoRecord {
  ident: string;
  fields: Record<string, Uint8Array>;
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

function cellIdFromDsid(dsid: Uint8Array | undefined, fallback: string): string {
  if (!dsid) return fallback;
  const m = latin1(dsid).match(/US[0-9A-Z]{5,}/);
  return m?.[0]?.replace(/\.000$/i, "") ?? fallback;
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

export function extractS57FromDot000(bytes: Uint8Array, cellId = "UNKNOWN"): S57Extract | null {
  if (!isIso8211(bytes) && !/^[0-9]{5}[ 3][LD]/.test(latin1(bytes.subarray(0, 8)))) return null;
  const records = parseIso8211Records(bytes);
  if (!records.length) return null;

  let comf = 10_000_000;
  let somf = 10;
  let id = cellId;
  const nodes = new Map<string, { lon: number; lat: number; depthM?: number }[]>();

  for (const rec of records) {
    if (rec.ident !== "D") continue;
    if (rec.fields.DSPM && rec.fields.DSPM.byteLength >= 24) {
      const cscl = u32(rec.fields.DSPM, 8);
      const c = u32(rec.fields.DSPM, 16);
      const s = u32(rec.fields.DSPM, 20);
      if (c > 1000 && c < 1e9) comf = c;
      if (s > 0 && s < 1e6) somf = s;
      if (cscl === 0 && c === 0) {
        /* keep defaults */
      }
    }
    if (rec.fields.DSID) id = cellIdFromDsid(rec.fields.DSID, id);
    if (!rec.fields.VRID || rec.fields.VRID.byteLength < 5) continue;
    const rcnm = rec.fields.VRID[0]!;
    const rcid = u32(rec.fields.VRID, 1);
    const pts: { lon: number; lat: number; depthM?: number }[] = [];
    const sg2 = rec.fields.SG2D;
    if (sg2) {
      for (let i = 0; i + 8 <= sg2.byteLength; i += 8) {
        const lat = i32(sg2, i) / comf;
        const lon = i32(sg2, i + 4) / comf;
        if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push({ lon, lat });
      }
    }
    const sg3 = rec.fields.SG3D;
    if (sg3) {
      for (let i = 0; i + 12 <= sg3.byteLength; i += 12) {
        const lat = i32(sg3, i) / comf;
        const lon = i32(sg3, i + 4) / comf;
        const depthM = i32(sg3, i + 8) / somf;
        if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push({ lon, lat, depthM });
      }
    }
    nodes.set(`${rcnm}:${rcid}`, pts);
  }

  const lons: number[] = [];
  const lats: number[] = [];
  for (const pts of nodes.values()) {
    for (const p of pts) {
      if (p.lon >= -180 && p.lon <= 180 && p.lat >= -90 && p.lat <= 90) {
        lons.push(p.lon);
        lats.push(p.lat);
      }
    }
  }
  const bounds: S57ExtractBounds | undefined =
    lons.length && lats.length
      ? { west: Math.min(...lons), south: Math.min(...lats), east: Math.max(...lons), north: Math.max(...lats) }
      : undefined;

  const features: GeoJSON.Feature[] = [];
  if (bounds && bounds.west < bounds.east && bounds.south < bounds.north) {
    features.push(boxFeature(id, id, bounds));
  }

  let aids = 0;
  let lights = 0;
  let soundings = 0;
  let soundingsOmitted = 0;

  for (const rec of records) {
    if (rec.ident !== "D" || !rec.fields.FRID || rec.fields.FRID[0] !== RCNM_FE || rec.fields.FRID.byteLength < 9) continue;
    const prim = rec.fields.FRID[5]!;
    const objl = u16(rec.fields.FRID, 7);
    const attrs = rec.fields.ATTF ? parseAttrs(rec.fields.ATTF) : {};
    const name = attrs[ATTL_OBJNAM] || undefined;
    const spatial: { rcnm: number; rcid: number }[] = [];
    const fspt = rec.fields.FSPT;
    if (fspt) {
      for (let i = 0; i + 8 <= fspt.byteLength; i += 8) {
        spatial.push({ rcnm: fspt[i]!, rcid: u32(fspt, i + 1) });
      }
    }
    const pts = spatial.flatMap((s) => nodes.get(`${s.rcnm}:${s.rcid}`) ?? []);

    if (objl === OBJL_SOUNDG) {
      const depths = pts.filter((p) => typeof p.depthM === "number");
      const pool = depths.length ? depths : pts;
      const stride = pool.length > SOUNDG_CAP ? Math.ceil(pool.length / SOUNDG_CAP) : 1;
      for (let i = 0; i < pool.length; i += stride) {
        const p = pool[i]!;
        features.push(
          pointFeature("enc-s57-sounding", id, "SOUNDG", p.lon, p.lat, {
            depthM: p.depthM ?? null,
          }),
        );
        soundings += 1;
      }
      if (stride > 1) soundingsOmitted += pool.length - soundings;
      continue;
    }

    if (prim !== 1) continue;
    const viPts = spatial
      .filter((s) => s.rcnm === RCNM_VI)
      .flatMap((s) => nodes.get(`${s.rcnm}:${s.rcid}`) ?? []);
    const p = viPts[0] ?? pts[0];
    if (!p) continue;
    if (objl === OBJL_LIGHTS) {
      features.push(
        pointFeature("enc-s57-light", id, "LIGHTS", p.lon, p.lat, {
          name: name ?? "light",
        }),
      );
      lights += 1;
    } else if (AID_OBJL.has(objl)) {
      features.push(
        pointFeature("enc-s57-aid", id, OBJ_NAME[objl] ?? `OBJ${objl}`, p.lon, p.lat, {
          name: name ?? OBJ_NAME[objl] ?? `OBJ${objl}`,
        }),
      );
      aids += 1;
    }
  }

  if (!features.length) return null;
  return {
    cellId: id,
    official: true,
    note: S57_EXTRACT_NOTE,
    bounds,
    features,
    counts: { aids, lights, soundings, soundingsOmitted },
  };
}

export async function extractS57FromZip(zip: Uint8Array, cellId?: string): Promise<S57Extract | null> {
  const entries = await unzipEntries(zip);
  const file000 = entries.find((e) => e.name.toUpperCase().endsWith(".000"));
  if (!file000 || !isIso8211(file000.data)) return null;
  const id = cellId ?? file000.name.split("/").pop()?.replace(/\.000$/i, "") ?? "UNKNOWN";
  const extracted = extractS57FromDot000(file000.data, id);
  if (extracted) extracted.file000 = file000.name.split("/").pop();
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
  return {
    official: true,
    note: S57_EXTRACT_NOTE,
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

function vridIsolated(rcid: number): Uint8Array {
  return concatBytes([new Uint8Array([RCNM_VI]), u32le(rcid), u16le(1), new Uint8Array([1])]);
}

function fridPoint(rcid: number, objl: number): Uint8Array {
  return concatBytes([new Uint8Array([RCNM_FE]), u32le(rcid), new Uint8Array([1, 2]), u16le(objl), u16le(1)]);
}

function fsptIsolated(rcid: number): Uint8Array {
  return concatBytes([new Uint8Array([RCNM_VI]), u32le(rcid), new Uint8Array([255, 1, 2])]);
}

function attfName(name: string): Uint8Array {
  return concatBytes([u16le(ATTL_OBJNAM), ascii(`${name}\x1f`)]);
}

function dsidField(cellId: string): Uint8Array {
  return ascii(`\n\x01\x00\x00\x00\x01\x05${cellId}.000\x1f5\x1f0\x1f`);
}

/**
 * Parseable ISO 8211 S-57 subset for tests. Not a NOAA exchange set.
 * One light, one named buoy, one sounding at known PJ-harbor coordinates.
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
      { tag: "VRID", data: vridIsolated(1) },
      { tag: "SG2D", data: concatBytes([i32le(Math.round(lightLat * comf)), i32le(Math.round(lightLon * comf))]) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([4, 0]) },
      { tag: "VRID", data: vridIsolated(2) },
      { tag: "SG2D", data: concatBytes([i32le(Math.round(buoyLat * comf)), i32le(Math.round(buoyLon * comf))]) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([5, 0]) },
      { tag: "VRID", data: vridIsolated(3) },
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
      { tag: "FRID", data: fridPoint(1, OBJL_LIGHTS) },
      { tag: "ATTF", data: attfName("Test Light") },
      { tag: "FSPT", data: fsptIsolated(1) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([7, 0]) },
      { tag: "FRID", data: fridPoint(2, 17) },
      { tag: "ATTF", data: attfName("Test Channel Buoy 7") },
      { tag: "FSPT", data: fsptIsolated(2) },
    ]),
    makeIso8211DataRecord([
      { tag: "0001", data: new Uint8Array([8, 0]) },
      { tag: "FRID", data: fridPoint(3, OBJL_SOUNDG) },
      { tag: "FSPT", data: fsptIsolated(3) },
    ]),
  ]);
}
