import "./register-alias.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { habitatScore, rankCells, briefing, zoneLabel } = await import(
  "../src/lib/ahanu/scoring.ts"
);
const { POINT_JUDITH, VEATCH_HEAD } = await import("../src/lib/ahanu/constants.ts");

const DATE = new Date(2026, 7, 20, 12, 0, 0);
const SPECIES = "bigeye" as const;

function inScoreRange(n: number, label: string) {
  assert.equal(typeof n, "number", `${label} type`);
  assert.ok(Number.isFinite(n), `${label} finite`);
  assert.ok(n >= 0 && n <= 100, `${label} ${n} outside 0–100`);
}

describe("habitatScore", () => {
  it("returns a 0–100 number (integer) over water", () => {
    const s = habitatScore(VEATCH_HEAD.lat, VEATCH_HEAD.lon, SPECIES, 2, DATE);
    inScoreRange(s, "veatch");
    assert.ok(Number.isInteger(s), `habitatScore should be rounded, got ${s}`);
  });

  it("scores land (inland NY) at 0", () => {
    const land = habitatScore(42, -74, SPECIES, 2, DATE);
    assert.equal(land, 0);
    const pj = habitatScore(POINT_JUDITH.lat, POINT_JUDITH.lon, SPECIES, 2, DATE);
    assert.equal(pj, 0, "Point Judith is classified land / too shallow");
  });

  it("is deterministic for a fixed date and hour", () => {
    const a = habitatScore(VEATCH_HEAD.lat, VEATCH_HEAD.lon, "yellowfin", 8, DATE);
    const b = habitatScore(VEATCH_HEAD.lat, VEATCH_HEAD.lon, "yellowfin", 8, DATE);
    assert.equal(a, b);
    inScoreRange(a, "yellowfin");
  });
});

describe("rankCells", () => {
  it("returns descending scores", () => {
    const cells = rankCells(SPECIES, 2, DATE, 0.25);
    assert.ok(Array.isArray(cells));
    assert.ok(cells.length >= 1, "expected at least one ranked cell");
    for (let i = 1; i < cells.length; i++) {
      assert.ok(
        cells[i - 1]!.score >= cells[i]!.score,
        `not descending at ${i}: ${cells[i - 1]!.score} then ${cells[i]!.score}`,
      );
    }
    for (const c of cells) {
      inScoreRange(c.score, `cell ${c.lat},${c.lon}`);
      assert.ok(Number.isFinite(c.lat) && Number.isFinite(c.lon));
    }
  });
});

describe("briefing", () => {
  it("is a non-empty string mentioning the species or a canyon", () => {
    const text = briefing(SPECIES, 2, DATE, VEATCH_HEAD);
    assert.equal(typeof text, "string");
    assert.ok(text.length > 20, "briefing too short");
    assert.match(
      text,
      /bigeye|tuna|canyon|veatch|atlantis|hudson|block|hydro/i,
      `briefing should mention species or canyon, got: ${text.slice(0, 180)}`,
    );
  });

  it("mentions the common name from Point Judith too", () => {
    const text = briefing("yellowfin", 10, DATE, POINT_JUDITH);
    assert.ok(text.length > 20);
    assert.match(text, /yellowfin|canyon|veatch|atlantis|block|hudson/i);
  });
});

describe("zoneLabel", () => {
  it("buckets scores", () => {
    assert.equal(zoneLabel(90), "Fire");
    assert.equal(zoneLabel(70), "Warm");
    assert.equal(zoneLabel(50), "Worth a look");
    assert.equal(zoneLabel(10), "Cold");
    assert.equal(zoneLabel(0), "Cold");
  });
});
