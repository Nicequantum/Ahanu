/** AIS 6-bit armor (ITU-R M.1371). Receive-side only — nothing here builds a transmit sentence. */

export function sixbitValue(ch: string): number | null {
  if (ch.length !== 1) return null;
  let v = ch.charCodeAt(0) - 48;
  if (v < 0) return null;
  if (v > 40) v -= 8;
  if (v < 0 || v > 63) return null;
  return v;
}

export function armoredChar(value: number): string {
  if (value < 0 || value > 63) throw new Error("sixbit out of range");
  return String.fromCharCode(value < 40 ? value + 48 : value + 56);
}

/** Bit string with the trailing fill bits already removed. Fail closed on a bad character. */
export function armoredToBits(payload: string, fill: number): number[] | null {
  if (!Number.isInteger(fill) || fill < 0 || fill > 5) return null;
  const bits: number[] = [];
  for (const ch of payload) {
    const v = sixbitValue(ch);
    if (v == null) return null;
    for (let b = 5; b >= 0; b--) bits.push((v >> b) & 1);
  }
  if (fill > bits.length) return null;
  bits.length -= fill;
  return bits;
}

export function bitsToArmored(bits: readonly number[]): { payload: string; fill: number } {
  const fill = (6 - (bits.length % 6)) % 6;
  const padded = bits.slice();
  for (let i = 0; i < fill; i++) padded.push(0);
  let payload = "";
  for (let i = 0; i < padded.length; i += 6) {
    let v = 0;
    for (let b = 0; b < 6; b++) v = v * 2 + (padded[i + b] ?? 0);
    payload += armoredChar(v);
  }
  return { payload, fill };
}

export class BitReader {
  private i = 0;
  private readonly bits: readonly number[];
  constructor(bits: readonly number[]) {
    this.bits = bits;
  }

  get remaining(): number {
    return this.bits.length - this.i;
  }

  u(width: number): number | null {
    if (width < 0 || this.i + width > this.bits.length) return null;
    let v = 0;
    for (let n = 0; n < width; n++) v = v * 2 + (this.bits[this.i++] ?? 0);
    return v;
  }

  /** Two's-complement. Width must be 1..30 so the sign bit stays inside JS safe integers. */
  s(width: number): number | null {
    const v = this.u(width);
    if (v == null || width < 1 || width > 30) return null;
    const sign = 1 << (width - 1);
    return v & sign ? v - (sign << 1) : v;
  }
}

export function writeUnsigned(bits: number[], value: number, width: number): void {
  if (width < 0 || width > 30) throw new Error("bit width");
  const max = 2 ** width;
  const v = ((value % max) + max) % max;
  for (let i = width - 1; i >= 0; i--) bits.push((Math.floor(v / 2 ** i) & 1) as 0 | 1);
}

export function writeSigned(bits: number[], value: number, width: number): void {
  if (width < 1 || width > 30) throw new Error("bit width");
  const span = 2 ** width;
  let v = value;
  if (v < 0) v = span + v;
  writeUnsigned(bits, v, width);
}

export function writeSixbitText(bits: number[], text: string, chars: number): void {
  const padded = `${text.toUpperCase()}${"@".repeat(chars)}`.slice(0, chars);
  for (const ch of padded) {
    const c = ch.charCodeAt(0);
    const v = c >= 64 && c <= 95 ? c - 64 : c >= 32 && c <= 63 ? c : 0;
    writeUnsigned(bits, v, 6);
  }
}
export function readSixbitText(reader: BitReader, chars: number): string | null {
  let s = "";
  for (let i = 0; i < chars; i++) {
    const c = reader.u(6);
    if (c == null) return null;
    if (c === 0) continue;
    s += c < 32 ? String.fromCharCode(c + 64) : String.fromCharCode(c);
  }
  return s.replace(/@+$/g, "").trim();
}
