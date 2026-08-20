import "./register-alias.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { fuelPlan, rangeRingNm } = await import("../src/lib/ahanu/fuel.ts");
const { DEFAULT_BOAT } = await import("../src/lib/ahanu/constants.ts");

describe("fuelPlan — 240 nm round trip at 21 kt + 10 h troll", () => {
  const plan = fuelPlan({
    nm: 240,
    cruiseKt: 21,
    trollHours: 10,
    boat: DEFAULT_BOAT,
  });

  it("burns a positive amount of fuel", () => {
    assert.ok(plan.fuelUsed > 0, `fuelUsed ${plan.fuelUsed}`);
    assert.equal(plan.fuelUsed, 240 / 21 * DEFAULT_BOAT.gphCruise + 10 * DEFAULT_BOAT.gphTroll);
    assert.equal(plan.trollHours, 10);
    assert.ok(plan.steamHours > 0);
    assert.equal(typeof plan.note, "string");
    assert.ok(plan.note.length > 0);
  });

  it("is NOT ok: 440 gal burn vs 420 gal tank / 60 gal reserve (documented)", () => {
    // 240 nm / 21 kt * 28 gph + 10 h * 12 gph = 320 + 120 = 440 gal.
    // Capacity 420, reserve 60 → short of reserve. ok must be false.
    assert.equal(plan.fuelUsed, 440);
    assert.equal(plan.ok, false);
    assert.ok(plan.fuelLeft < DEFAULT_BOAT.reserveGal);
    assert.match(plan.note, /short|reserve|extra|cut troll/i);
  });

  it("a shorter hop does come back ok", () => {
    const short = fuelPlan({
      nm: 80,
      cruiseKt: 21,
      trollHours: 2,
      boat: DEFAULT_BOAT,
    });
    assert.equal(short.ok, true);
    assert.ok(short.fuelUsed > 0);
    assert.ok(short.fuelLeft >= DEFAULT_BOAT.reserveGal - 1e-6);
  });
});

describe("rangeRingNm", () => {
  it("is > 0 at 21 kt on DEFAULT_BOAT", () => {
    const nm = rangeRingNm(DEFAULT_BOAT, 21);
    assert.ok(nm > 0, `rangeRingNm(21) = ${nm}`);
    assert.equal(nm, ((DEFAULT_BOAT.fuelGal - DEFAULT_BOAT.reserveGal) / DEFAULT_BOAT.gphCruise) * 21);
  });

  it("is 0 at 0 kt", () => {
    assert.equal(rangeRingNm(DEFAULT_BOAT, 0), 0);
    assert.equal(rangeRingNm(DEFAULT_BOAT, -3), 0);
  });
});
