import "./register-alias.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { sstC, chlorophyll, isTempBreak, sstGradient, sshCm } = await import(
  "../src/lib/ahanu/ocean.ts"
);
const { VEATCH_HEAD } = await import("../src/lib/ahanu/constants.ts");

describe("sstC", () => {
  it("Veatch in August is between 10 and 30 °C", () => {
    const t = sstC(VEATCH_HEAD.lat, VEATCH_HEAD.lon, 0);
    assert.ok(Number.isFinite(t), `sstC ${t}`);
    assert.ok(t >= 10 && t <= 30, `August-like SST ${t} °C, expected 10–30`);
  });

  it("land returns a finite shelf-ish temperature", () => {
    const t = sstC(42, -74, 0);
    assert.ok(Number.isFinite(t));
    assert.ok(t >= 10 && t <= 30);
  });
});

describe("chlorophyll", () => {
  it("is >= 0 at Veatch", () => {
    const chl = chlorophyll(VEATCH_HEAD.lat, VEATCH_HEAD.lon, 0);
    assert.ok(Number.isFinite(chl));
    assert.ok(chl >= 0, `chlorophyll ${chl}`);
  });

  it("is 0 over land", () => {
    assert.equal(chlorophyll(42, -74, 0), 0);
  });
});

describe("isTempBreak", () => {
  it("returns a boolean at Veatch", () => {
    const brk = isTempBreak(VEATCH_HEAD.lat, VEATCH_HEAD.lon, 0);
    assert.equal(typeof brk, "boolean");
  });

  it("respects sensitivity (higher threshold → fewer breaks)", () => {
    const easy = isTempBreak(VEATCH_HEAD.lat, VEATCH_HEAD.lon, 0, 0.2);
    const hard = isTempBreak(VEATCH_HEAD.lat, VEATCH_HEAD.lon, 0, 50);
    assert.equal(typeof easy, "boolean");
    assert.equal(hard, false);
  });
});

describe("sstGradient", () => {
  it("is >= 0 at Veatch", () => {
    const g = sstGradient(VEATCH_HEAD.lat, VEATCH_HEAD.lon, 0);
    assert.ok(Number.isFinite(g));
    assert.ok(g >= 0, `sstGradient ${g}`);
  });
});

describe("invariants", () => {
  it("fields are deterministic at a fixed hour", () => {
    assert.equal(
      sstC(VEATCH_HEAD.lat, VEATCH_HEAD.lon, 6),
      sstC(VEATCH_HEAD.lat, VEATCH_HEAD.lon, 6),
    );
    assert.equal(
      chlorophyll(VEATCH_HEAD.lat, VEATCH_HEAD.lon, 6),
      chlorophyll(VEATCH_HEAD.lat, VEATCH_HEAD.lon, 6),
    );
    assert.ok(Number.isFinite(sshCm(VEATCH_HEAD.lat, VEATCH_HEAD.lon, 0)));
  });
});
