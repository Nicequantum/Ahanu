import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decodeSentence,
  encodeDBT,
  encodeHDT,
  encodeRMC,
  gatewayFeed,
  nmeaChecksum,
} from "../src/lib/ahanu/nmea.ts";

describe("nmeaChecksum", () => {
  it("XOR of body, two uppercase hex digits", () => {
    assert.equal(nmeaChecksum("GPGGA"), nmeaChecksum("GPGGA"));
    assert.match(nmeaChecksum("HEHDT,145.0,T"), /^[0-9A-F]{2}$/);
  });
});

describe("encode + decode", () => {
  const date = new Date("2026-08-20T21:40:00Z");
  it("RMC round-trips checksum", () => {
    const s = encodeRMC({ lat: 39.9, lon: -69.62, sog: 7.4, cog: 145 }, date);
    assert.equal(s[0], "$");
    const d = decodeSentence(s);
    assert.ok(d);
    assert.equal(d.ok, true);
    assert.equal(d.type, "RMC");
  });
  it("DBT includes feet, meters, fathoms fields", () => {
    const s = encodeDBT(183);
    const d = decodeSentence(s);
    assert.ok(d?.ok);
    assert.ok(d!.fields.length >= 5);
  });
  it("HDT wraps heading", () => {
    const s = encodeHDT(145);
    assert.match(s, /145\.0,T/);
    assert.equal(decodeSentence(s)?.ok, true);
  });
  it("gatewayFeed emits six sentences in order", () => {
    const lines = gatewayFeed({
      lat: 39.9,
      lon: -69.62,
      sog: 7.4,
      cog: 145,
      heading: 145,
      depthM: 188,
      windKt: 12,
      windDir: 220,
      date,
    });
    assert.equal(lines.length, 6);
    assert.ok(lines[0]!.includes("RMC"));
    assert.ok(lines[1]!.includes("GGA"));
    assert.ok(lines[2]!.includes("VTG"));
    assert.ok(lines[3]!.includes("DBT"));
    assert.ok(lines[4]!.includes("MWV"));
    assert.ok(lines[5]!.includes("HDT"));
    for (const l of lines) assert.equal(decodeSentence(l)?.ok, true);
  });
});
