import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { armoredToBits, bitsToArmored, sixbitValue, writeSigned, writeSixbitText, writeUnsigned } from "../src/lib/ahanu/ais/bits.ts";
import { cpaTcpa } from "../src/lib/ahanu/ais/cpa.ts";
import { parseOwnShip } from "../src/lib/ahanu/ais/ownship.ts";
import { AisStream } from "../src/lib/ahanu/ais/vdm.ts";
import { encodeRMC, nmeaChecksum } from "../src/lib/ahanu/nmea.ts";
import { BLOCK_ISLAND, MARTHAS_VINEYARD, MONTAUK, POINT_JUDITH, RHODE_ISLAND_BOX } from "../src/lib/ahanu/constants.ts";

function frameVdm(payload: string, fill: number, total = 1, frag = 1, seq = ""): string {
  const body = `AIVDM,${total},${frag},${seq},A,${payload},${fill}`;
  return `!${body}*${nmeaChecksum(body)}`;
}

function positionSentence(opts: {
  mmsi: number;
  lat: number;
  lon: number;
  sog: number;
  cog: number;
  heading: number;
}): string {
  const bits: number[] = [];
  writeUnsigned(bits, 1, 6);
  writeUnsigned(bits, 0, 2);
  writeUnsigned(bits, opts.mmsi, 30);
  writeUnsigned(bits, 0, 4);
  writeUnsigned(bits, 0, 8);
  writeUnsigned(bits, Math.round(opts.sog * 10), 10);
  writeUnsigned(bits, 1, 1);
  writeSigned(bits, Math.round(opts.lon * 600000), 28);
  writeSigned(bits, Math.round(opts.lat * 600000), 27);
  writeUnsigned(bits, Math.round(opts.cog * 10), 12);
  writeUnsigned(bits, opts.heading, 9);
  writeUnsigned(bits, 0, 6);
  writeUnsigned(bits, 0, 23);
  const { payload, fill } = bitsToArmored(bits);
  return frameVdm(payload, fill);
}

describe("AIS armor", () => {
  it("round-trips every 6-bit value", () => {
    for (let v = 0; v < 64; v++) {
      const { payload, fill } = bitsToArmored([((v >> 5) & 1), ((v >> 4) & 1), ((v >> 3) & 1), ((v >> 2) & 1), ((v >> 1) & 1), v & 1]);
      assert.equal(fill, 0);
      assert.equal(sixbitValue(payload), v);
      assert.deepEqual(armoredToBits(payload, 0), [((v >> 5) & 1), ((v >> 4) & 1), ((v >> 3) & 1), ((v >> 2) & 1), ((v >> 1) & 1), v & 1]);
    }
  });
});

describe("VDM parser", () => {
  it("decodes a class A position near Point Judith", () => {
    const line = positionSentence({
      mmsi: 367812041,
      lat: POINT_JUDITH.lat,
      lon: POINT_JUDITH.lon,
      sog: 7.2,
      cog: 145,
      heading: 145,
    });
    const ev = new AisStream().pushLine(line, 1_700_000_000_000);
    assert.equal(ev.kind, "target");
    if (ev.kind !== "target") return;
    assert.equal(ev.target.mmsi, "367812041");
    assert.ok(Math.abs(ev.target.lat - POINT_JUDITH.lat) < 1e-4);
    assert.ok(Math.abs(ev.target.lon - POINT_JUDITH.lon) < 1e-4);
    assert.ok(Math.abs(ev.target.sog - 7.2) < 0.05);
    assert.ok(Math.abs(ev.target.cog - 145) < 0.1);
    assert.equal(ev.target.provenance, "nmea-vdm");
  });

  it("drops a bad checksum and does not invent a position", () => {
    const line = positionSentence({
      mmsi: 367812041,
      lat: 41,
      lon: -71,
      sog: 5,
      cog: 10,
      heading: 10,
    });
    const flipped = `${line.slice(0, -1)}${line.endsWith("0") ? "1" : "0"}`;
    const ev = new AisStream().pushLine(flipped);
    assert.equal(ev.kind, "drop");
    if (ev.kind === "drop") assert.equal(ev.reason, "bad-checksum");
  });

  it("reads message 24 part B dimensions after the 42-bit vendor id", () => {
    const bits: number[] = [];
    writeUnsigned(bits, 24, 6);
    writeUnsigned(bits, 0, 2);
    writeUnsigned(bits, 338124011, 30);
    writeUnsigned(bits, 1, 2);
    writeUnsigned(bits, 37, 8);
    writeUnsigned(bits, 0, 30);
    writeUnsigned(bits, 0, 12);
    writeSixbitText(bits, "WXY1234", 7);
    writeUnsigned(bits, 10, 9);
    writeUnsigned(bits, 4, 9);
    writeUnsigned(bits, 2, 6);
    writeUnsigned(bits, 2, 6);
    writeUnsigned(bits, 0, 6);
    const { payload, fill } = bitsToArmored(bits);
    const stream = new AisStream();
    const ev = stream.pushLine(frameVdm(payload, fill));
    assert.equal(ev.kind, "static");
    const pos = stream.pushLine(
      positionSentence({ mmsi: 338124011, lat: 41.1, lon: -71.2, sog: 8, cog: 90, heading: 90 }),
    );
    assert.equal(pos.kind, "target");
    if (pos.kind === "target") {
      assert.equal(pos.target.type, "pleasure");
      assert.equal(pos.target.lengthM, 14);
    }
  });

  it("reassembles a two-fragment sentence and keeps the static name", () => {
    const bits: number[] = [];
    writeUnsigned(bits, 5, 6);
    writeUnsigned(bits, 0, 2);
    writeUnsigned(bits, 367812108, 30);
    writeUnsigned(bits, 0, 2);
    writeUnsigned(bits, 0, 30);
    writeSixbitText(bits, "WDB1234", 7);
    writeSixbitText(bits, "TWO COVES", 20);
    writeUnsigned(bits, 30, 8);
    writeUnsigned(bits, 12, 9);
    writeUnsigned(bits, 6, 9);
    writeUnsigned(bits, 3, 6);
    writeUnsigned(bits, 3, 6);
    writeUnsigned(bits, 1, 4);
    writeUnsigned(bits, 0, 4);
    writeUnsigned(bits, 0, 5);
    writeUnsigned(bits, 0, 5);
    writeUnsigned(bits, 0, 6);
    writeUnsigned(bits, 0, 8);
    writeSixbitText(bits, "BLOCK IS", 20);
    const { payload, fill } = bitsToArmored(bits);
    const mid = Math.floor(payload.length / 2);
    const a = frameVdm(payload.slice(0, mid), 0, 2, 1, "1");
    const b = frameVdm(payload.slice(mid), fill, 2, 2, "1");
    const stream = new AisStream();
    const first = stream.pushLine(a);
    assert.equal(first.kind, "drop");
    const second = stream.pushLine(b);
    assert.equal(second.kind, "static");
    const pos = stream.pushLine(
      positionSentence({ mmsi: 367812108, lat: 41.05, lon: -71.5, sog: 6.8, cog: 200, heading: 200 }),
    );
    assert.equal(pos.kind, "target");
    if (pos.kind === "target") {
      assert.equal(pos.target.name, "TWO COVES");
      assert.equal(pos.target.type, "fishing");
      assert.equal(pos.target.destination, "BLOCK IS");
      assert.equal(pos.target.lengthM, 18);
    }
  });
});

describe("own-ship RMC/GGA", () => {
  it("accepts a valid RMC and rejects void", () => {
    const ok = encodeRMC({ lat: 41.3615, lon: -71.4814, sog: 7.4, cog: 145 }, new Date("2026-08-20T21:40:00Z"));
    const fix = parseOwnShip(ok);
    assert.ok(fix);
    assert.equal(fix!.source, "RMC");
    assert.ok(Math.abs(fix!.lat - 41.3615) < 1e-3);
    const voided = ok.replace(",A,", ",V,");
    const body = voided.slice(1, voided.lastIndexOf("*"));
    const resigned = `$${body}*${nmeaChecksum(body)}`;
    assert.equal(parseOwnShip(resigned), null);
  });

  it("rejects GGA quality 0", () => {
    const body = "GPGGA,214000.00,4136.090,N,07128.884,W,0,08,1.0,0.0,M,0.0,M,,";
    assert.equal(parseOwnShip(`$${body}*${nmeaChecksum(body)}`), null);
    const good = body.replace(",0,08,", ",1,08,");
    const fix = parseOwnShip(`$${good}*${nmeaChecksum(good)}`);
    assert.equal(fix?.source, "GGA");
  });
});

describe("CPA", () => {
  it("closes on a stopped target dead ahead", () => {
    const cpa = cpaTcpa(
      { lat: 41, lon: -71, sog: 10, cog: 0 },
      { lat: 41.1, lon: -71, sog: 0, cog: 0 },
    );
    assert.ok(Math.abs(cpa.rangeNm - 6) < 0.05);
    assert.ok(cpa.tcpaMin != null && Math.abs(cpa.tcpaMin - 36) < 1);
    assert.ok(cpa.cpaNm < 0.05);
  });
});

describe("Rhode Island box", () => {
  it("contains Point Judith, Montauk, Block Island, and Martha's Vineyard", () => {
    for (const p of [POINT_JUDITH, MONTAUK, BLOCK_ISLAND, MARTHAS_VINEYARD]) {
      assert.ok(p.lon >= RHODE_ISLAND_BOX.west && p.lon <= RHODE_ISLAND_BOX.east);
      assert.ok(p.lat >= RHODE_ISLAND_BOX.south && p.lat <= RHODE_ISLAND_BOX.north);
    }
  });
});
