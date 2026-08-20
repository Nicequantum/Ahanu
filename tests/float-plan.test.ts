import "./register-alias.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  FLOAT_PLAN_AID_LINE,
  NOT_SET,
  blank,
  canyonsInBbox,
  floatPlanBasename,
  formatBbox,
  formatContactLine,
  formatFloatPlanHtml,
  formatFloatPlanText,
  formatReadyLine,
  formatSouls,
  formatWindow,
  snapshotFromState,
} = await import("../src/lib/ahanu/float-plan.ts");
const { POINT_JUDITH_CANYON_BBOX } = await import("../src/lib/ahanu/constants.ts");
const pack = await import("../src/lib/ahanu/pack.ts");
const { readyOffshoreBadge } = pack;

function ready(partial: Record<string, unknown> = {}) {
  return {
    ready: false,
    hoursOk: true,
    dayTrip: false,
    sstOverride: false,
    sstOverrideUsed: false,
    layers: [],
    failures: [],
    warnings: [],
    ...partial,
  };
}

const emptyPlan = {
  skipper: "",
  vessel: "",
  departure: "",
  returnEta: "",
  souls: Number.NaN,
  route: "",
  contacts: "",
  radio: "",
  notes: "",
};

describe("float-plan formatter — empty stays empty", () => {
  it("blank and souls use not set", () => {
    assert.equal(blank(""), NOT_SET);
    assert.equal(blank("  "), NOT_SET);
    assert.equal(blank(undefined), NOT_SET);
    assert.equal(blank("Laughing One"), "Laughing One");
    assert.equal(formatSouls(null), NOT_SET);
    assert.equal(formatSouls(Number.NaN), NOT_SET);
    assert.equal(formatSouls(0), "0");
    assert.equal(formatSouls(4), "4");
  });

  it("does not invent contacts", () => {
    assert.equal(formatContactLine({ name: "", role: "", phone: "" }), null);
    const text = formatFloatPlanText({
      vessel: "",
      skipper: "",
      departure: "",
      returnEta: "",
      souls: null,
      route: "",
      radio: "",
      notes: "",
      contacts: [],
      bbox: null,
      windowStart: null,
      windowHours: null,
      ready: null,
      sstStaleOverride: false,
    });
    assert.match(text, new RegExp(`Vessel: ${NOT_SET}`));
    assert.match(text, new RegExp(`Departure harbor: ${NOT_SET}`));
    assert.match(text, new RegExp(`Souls on board: ${NOT_SET}`));
    assert.match(text, new RegExp(`Radio: ${NOT_SET}`));
    assert.match(text, new RegExp(`Pack bbox: ${NOT_SET}`));
    assert.match(text, new RegExp(`Canyons: ${NOT_SET}`));
    assert.match(text, new RegExp(`Window: ${NOT_SET}`));
    assert.match(text, /EMERGENCY CONTACTS\nnot set/);
    assert.doesNotMatch(text, /USCG|401-435-2300|Sector Southeastern/i);
    assert.doesNotMatch(text, /ha ha|joke|lol|😂/i);
  });
});

describe("float-plan formatter — PJ box and window", () => {
  it("lists canyon heads inside the Point Judith pack bbox", () => {
    const names = canyonsInBbox(POINT_JUDITH_CANYON_BBOX);
    assert.ok(names.includes("Veatch"));
    assert.ok(names.includes("Atlantis"));
    assert.ok(names.includes("Hudson"));
    assert.ok(names.includes("Hydrographer"));
    assert.ok(!names.includes("Welker"));
    assert.ok(!names.includes("Toms"));
    assert.ok(!names.includes("Wilmington"));
  });

  it("empty bbox canyons stay not set", () => {
    const names = canyonsInBbox({ west: -10, south: 0, east: -9, north: 1 });
    assert.deepEqual(names, []);
  });

  it("formats bbox, window, and filename", () => {
    assert.equal(formatBbox(POINT_JUDITH_CANYON_BBOX), "39.40°N–41.50°N, 72.80°W–68.80°W");
    assert.equal(formatWindow("2026-08-20T21:40:00.000Z", 72), "2026-08-20T21:40:00.000Z · 72 h");
    assert.equal(formatWindow("", null), NOT_SET);
    assert.equal(floatPlanBasename("Laughing One", "2026-08-20T21:40:00Z"), "ahanu-float-plan-laughing-one-2026-08-20");
    assert.equal(floatPlanBasename("  ", undefined), "ahanu-float-plan-vessel-draft");
  });
});

describe("float-plan formatter — ready and stale SST", () => {
  it("reports not set when no pack", () => {
    assert.equal(formatReadyLine(null, false), NOT_SET);
    assert.match(formatReadyLine(null, true), /Stale-SST override is on/);
  });

  it("adds a stale-SST caution when override made Ready", () => {
    const r = ready({ ready: true, sstOverride: true, sstOverrideUsed: true });
    const badge = readyOffshoreBadge(r);
    assert.equal(badge.caution, true);
    const line = formatReadyLine(r, true);
    assert.match(line, /Ready/);
    assert.match(line, /stale-SST/i);
    assert.match(line, /24 h/);
  });

  it("does not claim Ready when the pack failed", () => {
    const r = ready({ ready: false, failures: ["sst missing"] });
    const line = formatReadyLine(r, false);
    assert.match(line, /Not ready/);
    assert.match(line, /sst missing/);
    assert.doesNotMatch(line, /stale-SST override/i);
  });
});

describe("float-plan text body", () => {
  it("includes vessel, harbor, bbox, canyons, window, souls, radios, contacts, aid line", () => {
    const snap = snapshotFromState({
      floatPlan: {
        skipper: "Chris",
        vessel: "Laughing One",
        departure: "Point Judith — Galilee",
        returnEta: "Sunday 18:00",
        souls: 4,
        route: "PJ → Veatch west wall",
        contacts: "",
        radio: "VHF 16 / 68",
        notes: "",
      },
      boatName: "Laughing One",
      contacts: [
        { name: "Dock / home", role: "Float plan", phone: "401-555-0100" },
      ],
      packBbox: POINT_JUDITH_CANYON_BBOX,
      packStart: "2026-08-20T21:40:00.000Z",
      packHours: 72,
      packReady: ready({ ready: true }),
      sstStaleOverride: false,
      clockMs: Date.parse("2026-08-20T21:40:00Z"),
    });
    const text = formatFloatPlanText(snap);
    assert.match(text, /^AHANU FLOAT PLAN/m);
    assert.match(text, /Vessel: Laughing One/);
    assert.match(text, /Skipper: Chris/);
    assert.match(text, /Departure harbor: Point Judith — Galilee/);
    assert.match(text, /Souls on board: 4/);
    assert.match(text, /Pack bbox: 39\.40°N–41\.50°N/);
    assert.match(text, /Canyons: .*Veatch/);
    assert.match(text, /Canyons: .*Atlantis/);
    assert.match(text, /Window: 2026-08-20T21:40:00.000Z · 72 h/);
    assert.match(text, /Radio: VHF 16 \/ 68/);
    assert.match(text, /Dock \/ home \(Float plan\): 401-555-0100/);
    assert.match(text, /Ready: Ready for offshore/);
    assert.match(text, new RegExp(FLOAT_PLAN_AID_LINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(text, /official ENC/);
    assert.doesNotMatch(text, /ha ha|lol|😉/i);
    assert.doesNotMatch(text, /USCG/);
  });

  it("prints only contacts the skipper entered", () => {
    const text = formatFloatPlanText({
      vessel: "Night Watch",
      skipper: "",
      departure: "Montauk",
      returnEta: "",
      souls: 2,
      route: "",
      radio: "",
      notes: "",
      contacts: [{ name: "Pat", role: "Shore", phone: "" }],
      bbox: POINT_JUDITH_CANYON_BBOX,
      windowStart: "2026-08-21T08:00:00.000Z",
      windowHours: 48,
      ready: ready({ ready: true, sstOverrideUsed: true }),
      sstStaleOverride: true,
    });
    assert.match(text, /Pat \(Shore\): not set/);
    assert.doesNotMatch(text, /USCG|401-435-2300/);
    assert.match(text, /stale-SST/i);
  });

  it("HTML is print-friendly and escapes notes", () => {
    const html = formatFloatPlanHtml({
      vessel: "A & B",
      skipper: "",
      departure: "",
      returnEta: "",
      souls: 1,
      route: "",
      radio: "",
      notes: "<script>alert(1)</script>",
      contacts: [],
      bbox: null,
      windowStart: null,
      windowHours: null,
      ready: null,
      sstStaleOverride: false,
    });
    assert.match(html, /<!DOCTYPE html>/);
    assert.match(html, /@media print/);
    assert.match(html, /A &amp; B/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /official ENC/);
  });

  it("snapshotFromState uses boat name only when vessel is empty", () => {
    const named = snapshotFromState({
      floatPlan: { ...emptyPlan, vessel: "Night Watch" },
      boatName: "Laughing One",
      contacts: [],
      packBbox: null,
      packStart: null,
      packHours: null,
      packReady: null,
      sstStaleOverride: false,
    });
    assert.equal(named.vessel, "Night Watch");
    const fallback = snapshotFromState({
      floatPlan: emptyPlan,
      boatName: "Laughing One",
      contacts: [],
      packBbox: null,
      packStart: null,
      packHours: null,
      packReady: null,
      sstStaleOverride: false,
    });
    assert.equal(fallback.vessel, "Laughing One");
  });
});
