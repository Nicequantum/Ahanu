/**
 * NMEA 2000 payloads are little-endian. Fast-packet frames have no application checksum.
 * A gap drops that sequence and the next first-frame is still accepted.
 */

const FAST = new Set([127489]);

export function isFastPgn(pgn: number): boolean {
  return FAST.has(pgn);
}

/** Little-endian unsigned. All-ones means the field was never filled. */
export function readU(data: Uint8Array, offset: number, len: number): number | null {
  if (offset < 0 || len < 1 || offset + len > data.length) return null;
  let value = 0;
  let missing = true;
  for (let i = 0; i < len; i++) {
    const byte = data[offset + i] ?? 0;
    if (byte !== 0xff) missing = false;
    value += byte * 2 ** (8 * i);
  }
  return missing ? null : value;
}

/** Signed int16. 0x7FFF is the NMEA not-available sentinel. */
export function readS16(data: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 2 > data.length) return null;
  const word = (data[offset] ?? 0) + (data[offset + 1] ?? 0) * 256;
  if (word === 0x7fff) return null;
  return word > 0x7fff ? word - 0x10000 : word;
}

/** int8 tilt. 0x7F is the NMEA "not available" sentinel for this field. */
export function readTrim(data: Uint8Array, offset: number): number | null {
  if (offset >= data.length) return null;
  const byte = data[offset] ?? 0;
  if (byte === 0x7f || byte === 0xff) return null;
  return byte > 127 ? byte - 256 : byte;
}

interface Seq {
  expected: number;
  next: number;
  buf: number[];
}

export class FastPacketAssembler {
  private readonly seqs = new Map<number, Seq>();

  /** Push one 8-byte fast-packet frame. `data` is set only when the sequence completes. */
  push(frame: Uint8Array): { data: Uint8Array | null; reason?: string } {
    if (frame.length !== 8) return { data: null, reason: "short-frame" };
    const seq = frame[0]! >> 5;
    const idx = frame[0]! & 0x1f;
    if (idx === 0) {
      const len = frame[1] ?? 0;
      if (len < 1 || len > 223) {
        this.seqs.delete(seq);
        return { data: null, reason: "bad-length" };
      }
      const buf = Array.from(frame.slice(2, 8));
      if (buf.length >= len) {
        this.seqs.delete(seq);
        return { data: Uint8Array.from(buf.slice(0, len)) };
      }
      this.seqs.set(seq, { expected: len, next: 1, buf });
      return { data: null };
    }
    const cur = this.seqs.get(seq);
    if (!cur || idx !== cur.next) {
      this.seqs.delete(seq);
      return { data: null, reason: "gap" };
    }
    cur.buf.push(...frame.slice(1, 8));
    cur.next += 1;
    if (cur.buf.length >= cur.expected) {
      this.seqs.delete(seq);
      return { data: Uint8Array.from(cur.buf.slice(0, cur.expected)) };
    }
    return { data: null };
  }
}

export interface CanAccept {
  kind: "payload" | "wait" | "drop";
  pgn: number;
  data?: Uint8Array;
  reason?: string;
}

/**
 * 8-byte buffers on a fast PGN are frames. Any other length is already reassembled.
 * Single-frame PGNs (127488, 127493) use the 8 data bytes as the payload.
 */
export function acceptCan(assembler: FastPacketAssembler, pgn: number, bytes: Uint8Array): CanAccept {
  if (!isFastPgn(pgn) || bytes.length !== 8) {
    if (bytes.length < 1) return { kind: "drop", pgn, reason: "empty" };
    return { kind: "payload", pgn, data: bytes };
  }
  const step = assembler.push(bytes);
  if (step.reason) return { kind: "drop", pgn, reason: step.reason };
  if (!step.data) return { kind: "wait", pgn };
  return { kind: "payload", pgn, data: step.data };
}
