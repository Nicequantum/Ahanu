import "./register-alias.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const {
  countS57ObjectClasses,
  extractS57FromDot000,
  extractS57FromZip,
  extractCapsForCell,
  sampleS57ExtractDot000,
  sampleS57UpdateDot001,
  S57_EXTRACT_NOTE,
  S57_UPDATES_APPLIED_NOTE,
  S57_BASE_ONLY_NOTE,
} = await import("../src/lib/ahanu/s57-extract.ts");
const { isIso8211, isS57UpdateFileName, makeStoredZip, parseS57DsidMeta, parseS57ExchangeSet, encOfficialNote, ENC_S57_BASE_ONLY_NOTE } = await import("../src/lib/ahanu/noaa-enc.ts");

const here = dirname(fileURLToPath(import.meta.url));
const harbor000 = join(here, "fixtures/US5PVDCB.000");

describe("S-57 extract caps", () => {
  it("keeps harbor fidelity and strides coastal soundings", () => {
    assert.equal(extractCapsForCell("US5PVDCB").soundg, 400);
    assert.equal(extractCapsForCell("US5PVDCB").depcnt, 10_000);
    assert.equal(extractCapsForCell("US4PVDAA").soundg, 120);
    assert.equal(extractCapsForCell("US3RI1AA").soundg, 40);
    assert.equal(extractCapsForCell("US3RI1AA").depare, 40);
  });
});

describe("S-57 extract from recorded official US5PVDCB .000", () => {
  const bytes = new Uint8Array(readFileSync(harbor000));

  it("is ISO 8211 and quotes classes actually in the file", () => {
    assert.equal(isIso8211(bytes), true);
    const classes = countS57ObjectClasses(bytes);
    const by = Object.fromEntries(classes.map((c) => [c.acronym, c.count]));
    assert.equal(by.COALNE, 141);
    assert.equal(by.DEPARE, 30);
    assert.equal(by.DEPCNT, 31);
    assert.equal(by.SLCONS, 407);
    assert.equal(by.LNDARE, 15);
    assert.equal(by.OBSTRN, 5);
    assert.equal(by.SOUNDG, 2);
    assert.equal(by.BOYSAW, 16);
    assert.equal(by.LIGHTS, undefined, "LIGHTS absent from US5PVDCB");
    assert.equal(by.WRECKS, undefined, "WRECKS absent from US5PVDCB");
    assert.equal(by.UWTROC, undefined, "UWTROC absent from US5PVDCB");
  });

  it("paints coastline, shoreline, depth, land, obstructions from real coordinates", () => {
    const extracted = extractS57FromDot000(bytes, "US5PVDCB");
    assert.ok(extracted);
    assert.equal(extracted.official, true);
    assert.equal(extracted.note, S57_EXTRACT_NOTE);
    assert.equal(extracted.cellId, "US5PVDCB");
    assert.equal(extracted.counts.coastline, 141);
    assert.equal(extracted.counts.shoreline, 407);
    assert.equal(extracted.counts.depthAreas, 30);
    assert.equal(extracted.counts.depthContours, 31);
    assert.equal(extracted.counts.landAreas, 15);
    assert.equal(extracted.counts.obstructions, 5);
    assert.equal(extracted.counts.wrecks, 0, "do not invent wrecks");
    assert.equal(extracted.counts.lights, 0, "do not invent lights");
    assert.equal(extracted.counts.aids, 23);
    assert.ok(extracted.counts.soundings > 0);
    assert.ok(extracted.counts.soundings <= 400);

    const kinds = new Map<string, number>();
    for (const f of extracted.features) {
      const k = String((f.properties as { kind?: string } | null)?.kind ?? "");
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
      assert.equal((f.properties as { extract?: string }).extract, S57_EXTRACT_NOTE);
      assert.equal((f.properties as { legal?: boolean }).legal, false);
    }
    assert.equal(kinds.get("enc-s57-coastline"), 141);
    assert.equal(kinds.get("enc-s57-shore"), 407);
    assert.equal(kinds.get("enc-s57-depth-area"), 30);
    assert.equal(kinds.get("enc-s57-depth-contour"), 31);
    assert.equal(kinds.get("enc-s57-land"), 15);
    assert.equal(kinds.get("enc-s57-obstruction"), 5);
    assert.equal(kinds.get("enc-s57-wreck"), undefined);

    const coast = extracted.features.find((f) => (f.properties as { kind?: string })?.kind === "enc-s57-coastline");
    assert.equal(coast?.geometry?.type, "LineString");
    const line = coast!.geometry as GeoJSON.LineString;
    assert.ok(line.coordinates.length >= 2);
    const [lon, lat] = line.coordinates[0]!;
    assert.ok(lon > -71.56 && lon < -71.46, `coast lon ${lon}`);
    assert.ok(lat > 41.39 && lat < 41.48, `coast lat ${lat}`);

    const area = extracted.features.find((f) => (f.properties as { kind?: string })?.kind === "enc-s57-depth-area");
    assert.equal(area?.geometry?.type, "Polygon");
    const ring = (area!.geometry as GeoJSON.Polygon).coordinates[0]!;
    assert.ok(ring.length >= 4);
    const [alon, alat] = ring[0]!;
    assert.ok(alon > -71.56 && alon < -71.46);
    assert.ok(alat > 41.39 && alat < 41.48);
  });
});

describe("S-57 extract sample (not NOAA)", () => {
  it("reconstructs coastline, depth area, and wreck from recorded ISO 8211", () => {
    const dot = sampleS57ExtractDot000("US5TESTA");
    const extracted = extractS57FromDot000(dot, "US5TESTA");
    assert.ok(extracted);
    assert.equal(extracted.counts.coastline, 1);
    assert.equal(extracted.counts.depthAreas, 1);
    assert.equal(extracted.counts.wrecks, 1);
    assert.equal(extracted.counts.lights, 1);
    const coast = extracted.features.find((f) => (f.properties as { kind?: string })?.kind === "enc-s57-coastline")!;
    const coords = (coast.geometry as GeoJSON.LineString).coordinates;
    assert.ok(coords.some(([lon, lat]) => Math.abs(lon - -71.51) < 1e-4 && Math.abs(lat - 41.36) < 1e-4));
    const depare = extracted.features.find((f) => (f.properties as { kind?: string })?.kind === "enc-s57-depth-area")!;
    assert.equal((depare.properties as { drval1?: number }).drval1, 0);
    assert.equal((depare.properties as { drval2?: number }).drval2, 5);
    const wreck = extracted.features.find((f) => (f.properties as { kind?: string })?.kind === "enc-s57-wreck")!;
    const [wlon, wlat] = (wreck.geometry as GeoJSON.Point).coordinates;
    assert.ok(Math.abs(wlon - -71.512) < 1e-5);
    assert.ok(Math.abs(wlat - 41.361) < 1e-5);
    assert.equal((wreck.properties as { valsou?: number }).valsou, 8.2);
  });
});

const harbor001 = join(here, "fixtures/US5PVDCB.001");

describe("S-57 update file names", () => {
  it("treats .001–.999 as updates and CATALOG.031 as catalog", () => {
    assert.equal(isS57UpdateFileName("ENC_ROOT/US5PVDCB/US5PVDCB.001"), true);
    assert.equal(isS57UpdateFileName("US5NY2GL.004"), true);
    assert.equal(isS57UpdateFileName("ENC_ROOT/US5PVDCB/US5PVDCB.000"), false);
    assert.equal(isS57UpdateFileName("ENC_ROOT/CATALOG.031"), false);
  });
});

describe("S-57 extract applies synthetic update records", () => {
  it("deletes LIGHTS and inserts BOYLAT, and only then says includes ENC updates", async () => {
    const base = sampleS57ExtractDot000("US5TESTA");
    const upd = sampleS57UpdateDot001("US5TESTA");
    assert.equal(isIso8211(upd), true);
    const before = extractS57FromDot000(base, "US5TESTA");
    assert.ok(before);
    assert.equal(before.counts.lights, 1);
    const zip = makeStoredZip([
      { name: "ENC_ROOT/US5TESTA/US5TESTA.000", data: base },
      { name: "ENC_ROOT/US5TESTA/US5TESTA.001", data: upd },
      { name: "ENC_ROOT/CATALOG.031", data: new TextEncoder().encode("002623LE1 0900073   66040000000019000000") },
    ]);
    const parsed = await parseS57ExchangeSet(zip);
    assert.ok(parsed);
    assert.equal(parsed.updateCount, 1);
    assert.equal(parsed.baseOnly, false);
    assert.equal(parsed.updates[0]?.file, "US5TESTA.001");
    assert.equal(parsed.updates[0]?.iso8211, true);
    const extracted = await extractS57FromZip(zip, "US5TESTA");
    assert.ok(extracted);
    assert.equal(extracted.updatesApplied, 1);
    assert.deepEqual(extracted.updateFiles, ["US5TESTA.001"]);
    assert.equal(extracted.applyNote, S57_UPDATES_APPLIED_NOTE);
    assert.equal(extracted.baseOnly, false);
    assert.equal(extracted.counts.lights, 0, "LIGHTS deleted by update");
    assert.ok(extracted.counts.aids >= before.counts.aids);
    const buoy = extracted.features.find((f) => (f.properties as { name?: string })?.name === "Update Buoy");
    assert.ok(buoy);
    const [lon, lat] = (buoy.geometry as GeoJSON.Point).coordinates;
    assert.ok(Math.abs(lon - -71.513) < 1e-4);
    assert.ok(Math.abs(lat - 41.362) < 1e-4);
    const baseZip = makeStoredZip([{ name: "ENC_ROOT/US5TESTA/US5TESTA.000", data: base }]);
    const baseOnly = await extractS57FromZip(baseZip, "US5TESTA");
    assert.ok(baseOnly);
    assert.equal(baseOnly.updatesApplied, 0);
    assert.equal(baseOnly.baseOnly, true);
    assert.equal(baseOnly.applyNote, S57_BASE_ONLY_NOTE);
    assert.equal(baseOnly.counts.lights, 1);
    assert.equal(encOfficialNote([{ id: "US5TESTA", official: true, encoding: "s-57", iso8211: true, catalog031: true, file000: "US5TESTA.000", file000Bytes: base.byteLength, leader: "015823LE1", zipBytes: 1, zipSha256: "x", zipBase64: "e", updateCount: 0, baseOnly: true }]).includes(ENC_S57_BASE_ONLY_NOTE), true);
  });
});

describe("S-57 extract applies recorded official US5PVDCB.001", () => {
  it("is ISO 8211 and changes the harbor extract vs base .000 only", async () => {
    const base = new Uint8Array(readFileSync(harbor000));
    const upd = new Uint8Array(readFileSync(harbor001));
    assert.equal(isIso8211(upd), true);
    assert.match(new TextDecoder("latin1").decode(upd.subarray(0, 24)), /^017903LE1/);
    const meta = parseS57DsidMeta(upd);
    assert.equal(meta.edition, "3");
    assert.equal(meta.update, "1");
    const before = extractS57FromDot000(base, "US5PVDCB");
    assert.ok(before);
    const zip = makeStoredZip([
      { name: "ENC_ROOT/US5PVDCB/US5PVDCB.000", data: base },
      { name: "ENC_ROOT/US5PVDCB/US5PVDCB.001", data: upd },
    ]);
    const parsed = await parseS57ExchangeSet(zip);
    assert.ok(parsed);
    assert.equal(parsed.updateCount, 1);
    assert.equal(parsed.updates[0]?.file, "US5PVDCB.001");
    assert.equal(parsed.updates[0]?.bytes, upd.byteLength);
    const extracted = await extractS57FromZip(zip, "US5PVDCB");
    assert.ok(extracted);
    assert.equal(extracted.applyNote, S57_UPDATES_APPLIED_NOTE);
    assert.equal(extracted.updatesApplied, 1);
    assert.equal(extracted.edition, "3");
    assert.equal(extracted.updn, "1");
    assert.notEqual(JSON.stringify(extracted.counts), JSON.stringify(before.counts), "update must change extract counts");
  });
});
