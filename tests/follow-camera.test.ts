import "./register-alias.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const {
  followAfterSkipperMapMove,
  isUserPlotterGesture,
  shouldRecenterOnOwnship,
} = await import("../src/lib/ahanu/follow-camera.ts");

const CHART_MAP = fileURLToPath(new URL("../src/components/chartplotter/ChartMap.tsx", import.meta.url));

describe("Follow camera", () => {
  it("recenters only while Follow is armed and replay is off", () => {
    assert.equal(shouldRecenterOnOwnship(true, null), true);
    assert.equal(shouldRecenterOnOwnship(false, null), false);
    assert.equal(shouldRecenterOnOwnship(true, 0), false);
    assert.equal(shouldRecenterOnOwnship(true, 0.4), false);
    assert.equal(shouldRecenterOnOwnship(false, 0.4), false);
  });

  it("treats MapLibre originalEvent as a skipper gesture, not Follow easeTo", () => {
    assert.equal(isUserPlotterGesture({ originalEvent: { type: "pointerdown" } }), true);
    assert.equal(isUserPlotterGesture({ originalEvent: { type: "wheel" } }), true);
    assert.equal(isUserPlotterGesture({}), false);
    assert.equal(isUserPlotterGesture({ originalEvent: undefined }), false);
    assert.equal(isUserPlotterGesture(null), false);
    assert.equal(isUserPlotterGesture(undefined), false);
  });

  it("drops Follow after a skipper map move until the next Follow tap", () => {
    assert.equal(followAfterSkipperMapMove(), false);
    let follow = true;
    const setFollow = (v: boolean) => {
      follow = v;
    };
    if (isUserPlotterGesture({ originalEvent: { type: "pointerdown" } })) {
      setFollow(followAfterSkipperMapMove());
    }
    assert.equal(follow, false);
    assert.equal(shouldRecenterOnOwnship(follow, null), false);
    follow = true;
    assert.equal(shouldRecenterOnOwnship(follow, null), true);
  });

  it("ChartMap drops Follow on pan/zoom and never gates the ownship mark", async () => {
    const src = await readFile(CHART_MAP, "utf8");
    assert.match(src, /shouldRecenterOnOwnship\(follow, replayT\)/);
    assert.match(src, /map\.on\("dragstart"/);
    assert.match(src, /map\.on\("zoomstart"/);
    assert.match(src, /isUserPlotterGesture/);
    assert.match(src, /setFollow\(followAfterSkipperMapMove\(\)\)/);
    const markAt = src.indexOf("shipRef.current?.setLngLat");
    const easeAt = src.indexOf("shouldRecenterOnOwnship(follow, replayT)");
    assert.ok(markAt >= 0 && easeAt > markAt, "ownship marker must update before the Follow camera gate");
    const markBlock = src.slice(markAt, easeAt);
    assert.doesNotMatch(markBlock, /follow/, "ownship setLngLat must not sit behind Follow");
    assert.match(src, /el\.style\.transform = `rotate\(\$\{vessel\.heading\}deg\)`/);
  });
});
