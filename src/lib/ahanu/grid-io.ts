/**
 * Tight parser for the NCEP Atlantic 0p16 hour-0 subset.
 * Lat/lon template 3.0, product 4.0, simple packing 5.0, optional bitmap.
 * Other packing is a hard fail. No @/ aliases (Worker import).
 */

import type { PackBBox, PackedGrid } from "./pack-fixtures";

export const MS_TO_KT = 1.943844;
export const M_TO_FT = 3.28084;

export type NcepFieldId = "windMs" | "windDir" | "htsgwM" | "perpwS" | "dirpw";

export interface NcepField {
  id: NcepFieldId;
  discipline: number;
  category: number;
  parameter: number;
  forecastHour: number;
  bbox: PackBBox;
  nx: number;
  ny: number;
  values: number[];
  missing: boolean[];
}

export interface NcepParse {
  fields: NcepField[];
  error?: string;
}


function u16(b: Uint8Array, o: number): number {
  return ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0);
}
function u32(b: Uint8Array, o: number): number {
  return (((b[o] ?? 0) << 24) | ((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0)) >>> 0;
}
function u64(b: Uint8Array, o: number): number {
  return u32(b, o) * 0x1_0000_0000 + u32(b, o + 4);
}
function sm16(b: Uint8Array, o: number): number {
  const v = u16(b, o);
  const mag = v & 0x7fff;
  return v & 0x8000 ? -mag : mag;
}
function sm32(b: Uint8Array, o: number): number {
  const v = u32(b, o);
  const mag = v & 0x7fffffff;
  return v & 0x80000000 ? -mag : mag;
}
function f32(b: Uint8Array, o: number): number {
  return new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0, false);
}
function wrapLon(lon: number): number {
  let x = lon;
  if (x > 180) x -= 360;
  if (x < -180) x += 360;
  return x;
}
function identify(disc: number, cat: number, param: number): NcepFieldId | null {
  if (disc === 0 && cat === 2 && param === 1) return "windMs";
  if (disc === 0 && cat === 2 && param === 0) return "windDir";
  if (disc === 10 && cat === 0 && param === 3) return "htsgwM";
  if (disc === 10 && cat === 0 && param === 11) return "perpwS";
  if (disc === 10 && cat === 0 && param === 10) return "dirpw";
  return null;
}
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
class StreamBits {
  private pos = 0;
  private bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  take(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.bytes[this.pos >> 3] ?? 0;
      const bit = (byte >> (7 - (this.pos & 7))) & 1;
      v = (v << 1) | bit;
      this.pos += 1;
    }
    return v;
  }
}
function flagAt(flags: Uint8Array, i: number): boolean {
  const byte = flags[i >> 3] ?? 0;
  return ((byte >> (7 - (i & 7))) & 1) === 1;
}
interface Mesh {
  nx: number; ny: number; ndp: number;
  la1: number; lo1: number; la2: number; lo2: number; scan: number;
}
function boxOf(g: Mesh): PackBBox {
  return { west: Math.min(g.lo1, g.lo2), east: Math.max(g.lo1, g.lo2), south: Math.min(g.la1, g.la2), north: Math.max(g.la1, g.la2) };
}
// mesh helper
function readMesh(buf: Uint8Array): Mesh | string {
  const tmpl = u16(buf, 12);
  if (tmpl !== 0) return "grid tmpl " + tmpl;
  if (buf.byteLength < 72) return "short mesh";
  const ndp = u32(buf, 6);
  const nx = u32(buf, 30);
  const ny = u32(buf, 34);
  const la1 = sm32(buf, 46) / 1e6;
  const lo1 = wrapLon(sm32(buf, 50) / 1e6);
  const la2 = sm32(buf, 55) / 1e6;
  const lo2 = wrapLon(sm32(buf, 59) / 1e6);
  const scan = buf[71] ?? 0;
  if (!nx || !ny || nx * ny !== ndp) return "bad mesh";
  return { nx, ny, ndp, la1, lo1, la2, lo2, scan };
}
function pullPacked(meta: Uint8Array, body: Uint8Array, n: number): number[] | string {
  const kind = u16(meta, 9);
  if (kind !== 0) return "need simple pack";
  if (meta.byteLength < 21) return "short pack meta";
  const R = f32(meta, 11);
  const E = sm16(meta, 15);
  const D = sm16(meta, 17);
  const width = meta[19] ?? 0;
  const data = body.subarray(5);
  const scale = 10 ** D;
  const step = 2 ** E;
  const out: number[] = [];
  if (width === 0) {
    const y = R / scale;
    for (let i = 0; i < n; i++) out.push(y);
    return out;
  }
  const bits = new StreamBits(data);
  for (let i = 0; i < n; i++) out.push((R + bits.take(width) * step) / scale);
  return out;
}
function placeOnMesh(nx: number, ny: number, scan: number, packed: number[], flags: Uint8Array | null): { values: number[]; missing: boolean[] } {
  const values = new Array<number>(nx * ny).fill(0);
  const missing = new Array<boolean>(nx * ny).fill(true);
  const iNeg = (scan & 128) !== 0;
  const jPos = (scan & 64) !== 0;
  const byCol = (scan & 32) !== 0;
  let k = 0;
  const visit = (i: number, j: number, p: number) => {
    if (flags && !flagAt(flags, p)) return;
    const v = packed[k++];
    if (v == null) return;
    const x = iNeg ? nx - 1 - i : i;
    const yS = jPos ? j : ny - 1 - j;
    const yN = ny - 1 - yS;
    values[yN * nx + x] = v;
    missing[yN * nx + x] = false;
  };
  if (byCol) {
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) visit(i, j, i * ny + j);
  } else {
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) visit(i, j, j * nx + i);
  }
  return { values, missing };
}
const HEAD = String.fromCharCode(71, 82, 73, 66);
const TAIL = String.fromCharCode(55, 55, 55, 55);
function tag4(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o] ?? 0, b[o + 1] ?? 0, b[o + 2] ?? 0, b[o + 3] ?? 0);
}
function walkOne(bytes: Uint8Array, start: number): { field: NcepField | null; next: number; skip?: string } {
  if (tag4(bytes, start) !== HEAD || bytes[start + 7] !== 2) {
    return { field: null, next: start + 1, skip: "not edition 2" };
  }
  const total = u64(bytes, start + 8);
  const next = start + total;
  const disc = bytes[start + 6] ?? 0;
  let s3: Uint8Array | null = null;
  let s4: Uint8Array | null = null;
  let s5: Uint8Array | null = null;
  let s6: Uint8Array | null = null;
  let s7: Uint8Array | null = null;
  let o = start + 16;
  while (o + 4 <= next) {
    if (tag4(bytes, o) === TAIL) break;
    const len = u32(bytes, o);
    if (len < 5 || o + len > next) break;
    const num = bytes[o + 4];
    const sec = bytes.subarray(o, o + len);
    if (num === 3) s3 = sec;
    else if (num === 4) s4 = sec;
    else if (num === 5) s5 = sec;
    else if (num === 6) s6 = sec;
    else if (num === 7) s7 = sec;
    o += len;
  }
  if (!s3 || !s4 || !s5 || !s7) return { field: null, next, skip: "incomplete" };
  const pdt = u16(s4, 7);
  if (pdt !== 0) return { field: null, next, skip: "pdt " + pdt };
  const id = identify(disc, s4[9] ?? 0, s4[10] ?? 0);
  if (!id) return { field: null, next, skip: "unmapped" };
  const mesh = readMesh(s3);
  if (typeof mesh === "string") return { field: null, next, skip: mesh };
  const nPacked = u32(s5, 5);
  const unpacked = pullPacked(s5, s7, nPacked);
  if (typeof unpacked === "string") return { field: null, next, skip: unpacked };
  let flags: Uint8Array | null = null;
  if (s6 && (s6[5] ?? 255) === 0) flags = s6.subarray(6);
  const tfUnit = s4[17] ?? 1;
  let forecastHour = u32(s4, 18);
  if (tfUnit === 0) forecastHour = Math.round(forecastHour / 60);
  else if (tfUnit === 2) forecastHour *= 24;
  const placed = placeOnMesh(mesh.nx, mesh.ny, mesh.scan, unpacked, flags);
  return {
    field: {
      id, discipline: disc, category: s4[9] ?? 0, parameter: s4[10] ?? 0,
      forecastHour, bbox: boxOf(mesh), nx: mesh.nx, ny: mesh.ny,
      values: placed.values, missing: placed.missing,
    },
    next,
  };
}
export function parseNcep(bytes: Uint8Array): NcepParse {
  if (bytes.byteLength < 16 || tag4(bytes, 0) !== HEAD) return { fields: [], error: "not NCEP edition 2" };
  const fields: NcepField[] = [];
  const skips: string[] = [];
  let o = 0;
  let guard = 0;
  while (o + 16 <= bytes.byteLength && guard++ < 64) {
    if (tag4(bytes, o) !== HEAD) { o += 1; continue; }
    const { field, next, skip } = walkOne(bytes, o);
    if (field) fields.push(field);
    else if (skip) skips.push(skip);
    if (next <= o) break;
    o = next;
  }
  if (!fields.length) return { fields: [], error: skips[0] ?? "no fields" };
  return { fields };
}
export interface Hour0Packed {
  windKt?: PackedGrid;
  waveFt?: PackedGrid;
}
function asGrid(layer: string, unit: string, field: NcepField, scale: (v: number) => number, extra?: { dir?: NcepField; period?: NcepField }): PackedGrid {
  const values = field.values.map((v, i) => (field.missing[i] ? 0 : r2(scale(v))));
  const grid: PackedGrid = {
    kind: "grid",
    layer,
    bbox: field.bbox,
    nx: field.nx,
    ny: field.ny,
    hours: [field.forecastHour],
    unit,
    values: [values],
    live: true,
    source: "noaa",
    fixture: false,
    note: "NCEP Atlantic 0p16 hour 0 only — not a 72 h forecast.",
  };
  if (extra?.dir) {
    grid.dirUnit = "deg";
    grid.dirValues = [extra.dir.values.map((v, i) => (extra.dir!.missing[i] ? 0 : r2(((v % 360) + 360) % 360)))];
  }
  if (extra?.period) {
    grid.periodUnit = "s";
    grid.periodValues = [extra.period.values.map((v, i) => (extra.period!.missing[i] ? 0 : r2(v)))];
  }
  return grid;
}
export function ncepToPacked(parsed: NcepParse): Hour0Packed {
  const by = new Map(parsed.fields.map((f) => [f.id, f]));
  const out: Hour0Packed = {};
  const wind = by.get("windMs");
  if (wind) out.windKt = asGrid("wind", "kt", wind, (v) => v * MS_TO_KT, { dir: by.get("windDir") });
  const wave = by.get("htsgwM");
  if (wave) out.waveFt = asGrid("waves", "ft", wave, (v) => v * M_TO_FT, { dir: by.get("dirpw"), period: by.get("perpwS") });
  return out;
}
export function sampleNcep(field: NcepField, lat: number, lon: number): number | null {
  const { west, east, south, north } = field.bbox;
  if (lat < south || lat > north || lon < west || lon > east) return null;
  const fx = field.nx === 1 ? 0 : ((lon - west) / (east - west)) * (field.nx - 1);
  const fy = field.ny === 1 ? 0 : ((north - lat) / (north - south)) * (field.ny - 1);
  const x = Math.max(0, Math.min(field.nx - 1, Math.round(fx)));
  const y = Math.max(0, Math.min(field.ny - 1, Math.round(fy)));
  const i = y * field.nx + x;
  if (field.missing[i]) return null;
  return field.values[i] ?? null;
}

function putU16(b: number[], v: number): void {
  b.push((v >> 8) & 0xff, v & 0xff);
}
function putU32(b: number[], v: number): void {
  b.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
}
function putI32(b: number[], v: number): void {
  const mag = Math.abs(Math.round(v)) & 0x7fffffff;
  const n = v < 0 ? (0x80000000 | mag) : mag;
  putU32(b, n);
}
function putF32(b: number[], v: number): void {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, v, false);
  b.push(...new Uint8Array(buf));
}

export function encodeConstantField(opts: {
  disc: number; cat: number; param: number; value: number;
  nx: number; ny: number;
  la1: number; lo1: number; la2: number; lo2: number;
  scan?: number;
  forecastHour?: number;
}): Uint8Array {
  const scan = opts.scan ?? 0;
  const ndp = opts.nx * opts.ny;
  const s1: number[] = [];
  putU32(s1, 21); s1.push(1);
  putU16(s1, 7); putU16(s1, 0);
  s1.push(2, 1, 1);
  putU16(s1, 2026);
  s1.push(8, 20, 12, 0, 0, 0, 1);
  const s3: number[] = [];
  putU32(s3, 72); s3.push(3, 0);
  putU32(s3, ndp); s3.push(0, 0);
  putU16(s3, 0); s3.push(6);
  for (let i = 0; i < 15; i++) s3.push(0);
  putU32(s3, opts.nx); putU32(s3, opts.ny);
  putU32(s3, 0); putU32(s3, 0);
  putI32(s3, Math.round(opts.la1 * 1e6));
  putI32(s3, Math.round(((opts.lo1 < 0 ? opts.lo1 + 360 : opts.lo1) * 1e6)));
  s3.push(48);
  putI32(s3, Math.round(opts.la2 * 1e6));
  putI32(s3, Math.round(((opts.lo2 < 0 ? opts.lo2 + 360 : opts.lo2) * 1e6)));
  putU32(s3, 166667); putU32(s3, 166667); s3.push(scan);
  while (s3.length < 72) s3.push(0);
  s3[0] = 0; s3[1] = 0; s3[2] = 0; s3[3] = 72;
  const s4 = new Array(34).fill(0);
  s4[3] = 34; s4[4] = 4;
  s4[9] = opts.cat; s4[10] = opts.param;
  s4[17] = 1;
  const fh = Math.max(0, Math.round(opts.forecastHour ?? 0));
  s4[18] = (fh >>> 24) & 0xff;
  s4[19] = (fh >>> 16) & 0xff;
  s4[20] = (fh >>> 8) & 0xff;
  s4[21] = fh & 0xff;
  const s5: number[] = [];
  putU32(s5, 21); s5.push(5); putU32(s5, ndp); putU16(s5, 0);
  putF32(s5, opts.value); putU16(s5, 0); putU16(s5, 0); s5.push(0, 0);
  const s6 = [0, 0, 0, 6, 6, 255];
  const s7 = [0, 0, 0, 5, 7];
  const body = [...s1, ...s3, ...s4, ...s5, ...s6, ...s7, 55, 55, 55, 55];
  const total = 16 + body.length;
  const s0: number[] = [71, 82, 73, 66, 0, 0, opts.disc, 2];
  putU32(s0, 0); putU32(s0, total);
  s0[6] = opts.disc; s0[7] = 2;
  return new Uint8Array([...s0, ...body]);
}

export function encodeHourSample(forecastHour = 0, windMs = 5, htsgwM = 1): Uint8Array {
  const box = { nx: 2, ny: 2, la1: 41, lo1: -72, la2: 40, lo2: -71, scan: 0, forecastHour };
  const wind = encodeConstantField({ disc: 0, cat: 2, param: 1, value: windMs, ...box });
  const dir = encodeConstantField({ disc: 0, cat: 2, param: 0, value: 220, ...box });
  const hs = encodeConstantField({ disc: 10, cat: 0, param: 3, value: htsgwM, ...box });
  const out = new Uint8Array(wind.length + dir.length + hs.length);
  out.set(wind, 0); out.set(dir, wind.length); out.set(hs, wind.length + dir.length);
  return out;
}

export function encodeHour0Sample(): Uint8Array {
  return encodeHourSample(0);
}
