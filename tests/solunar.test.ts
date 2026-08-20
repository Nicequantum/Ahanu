import "./register-alias.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { moonPhase, sunTimes, solunarPeriods, formatClock } = await import(
  "../src/lib/ahanu/solunar.ts"
);
const { VEATCH_HEAD } = await import("../src/lib/ahanu/constants.ts");

const AUG_20 = new Date(2026, 7, 20, 12, 0, 0);
const PHASE_NAMES = new Set([
  "New",
  "Waxing Crescent",
  "First Quarter",
  "Waxing Gibbous",
  "Full",
  "Waning Gibbous",
  "Last Quarter",
  "Waning Crescent",
]);

describe("moonPhase", () => {
  it("is First Quarter around 2026-08-20", () => {
    const info = moonPhase(AUG_20);
    assert.equal(typeof info.phase, "number");
    assert.ok(info.phase >= 0 && info.phase < 1, `phase ${info.phase}`);
    assert.ok(PHASE_NAMES.has(info.name), `unknown name ${info.name}`);
    // Code maps 0.22–0.28 to First Quarter; 2026-08-20 sits in that window.
    assert.equal(info.name, "First Quarter");
    assert.ok(
      info.phase >= 0.22 && info.phase < 0.28,
      `2026-08-20 phase ${info.phase} expected in First Quarter band`,
    );
  });

  it("labels a known new moon near the 2000-01-06 epoch as New", () => {
    const knownNew = new Date(Date.UTC(2000, 0, 6, 18, 14, 0));
    const info = moonPhase(knownNew);
    assert.equal(info.name, "New");
    assert.ok(info.phase < 0.03 || info.phase >= 0.97);
  });
});

describe("sunTimes", () => {
  it("sunrise is before sunset at Veatch on 2026-08-20", () => {
    const sun = sunTimes(VEATCH_HEAD.lat, VEATCH_HEAD.lon, AUG_20);
    assert.ok(sun.sunrise instanceof Date);
    assert.ok(sun.sunset instanceof Date);
    assert.ok(sun.noon instanceof Date);
    assert.ok(
      sun.sunrise.getTime() < sun.sunset.getTime(),
      `sunrise ${sun.sunrise.toISOString()} vs sunset ${sun.sunset.toISOString()}`,
    );
    assert.ok(sun.sunrise.getTime() < sun.noon.getTime());
    assert.ok(sun.noon.getTime() < sun.sunset.getTime());
  });
});

describe("solunarPeriods", () => {
  it("has major and minor windows and a 0–100 score", () => {
    const sol = solunarPeriods(VEATCH_HEAD.lat, VEATCH_HEAD.lon, AUG_20);
    assert.ok(Array.isArray(sol.major));
    assert.ok(Array.isArray(sol.minor));
    assert.ok(sol.major.length >= 1, `major length ${sol.major.length}`);
    assert.ok(sol.minor.length >= 1, `minor length ${sol.minor.length}`);
    assert.equal(typeof sol.score, "number");
    assert.ok(sol.score >= 0 && sol.score <= 100, `score ${sol.score}`);
    assert.equal(typeof sol.rating, "string");
    assert.ok(sol.rating.length > 0);

    for (const [a, b] of [...sol.major, ...sol.minor]) {
      assert.ok(a instanceof Date && b instanceof Date);
      assert.ok(a.getTime() < b.getTime(), "window start before end");
    }
  });

  it("is deterministic", () => {
    const a = solunarPeriods(VEATCH_HEAD.lat, VEATCH_HEAD.lon, AUG_20);
    const b = solunarPeriods(VEATCH_HEAD.lat, VEATCH_HEAD.lon, AUG_20);
    assert.equal(a.score, b.score);
    assert.equal(a.rating, b.rating);
    assert.equal(a.major.length, b.major.length);
    assert.equal(a.minor.length, b.minor.length);
  });
});

describe("formatClock", () => {
  it("prints HH:MM", () => {
    const s = formatClock(new Date(2026, 7, 20, 7, 5, 0));
    assert.match(s, /^\d{2}:\d{2}$/);
    assert.equal(s, "07:05");
  });
});
