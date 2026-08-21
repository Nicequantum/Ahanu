import "./register-alias.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { COMMUNITY_HELM_LINE, communityForChart, communityHelmReports } = await import(
  "../src/lib/ahanu/packed-chart.ts"
);
const { COMMUNITY_REPORTS } = await import("../src/lib/data/community.ts");

describe("leftover community freeze is not skipper paint", () => {
  it("demo file still exists and helm never paints it", () => {
    assert.ok(COMMUNITY_REPORTS.length > 0, "demo leftover stays for tests only");
    assert.ok(COMMUNITY_REPORTS.some((r) => /Relentless|Hot Tuna|Fish Tales/i.test(r.who)));
    const painted = communityForChart();
    assert.equal(painted.type, "FeatureCollection");
    assert.equal(painted.features.length, 0);
    assert.equal(communityHelmReports().length, 0);
    assert.match(COMMUNITY_HELM_LINE, /leftover demo/i);
    assert.match(COMMUNITY_HELM_LINE, /not live radio/i);
    assert.doesNotMatch(COMMUNITY_HELM_LINE, /packed with the trip/i);
  });

  it("plotter and Log do not import leftover COMMUNITY_REPORTS", async () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const chart = await readFile(new URL("../src/components/chartplotter/ChartMap.tsx", import.meta.url), "utf8");
    const log = await readFile(new URL("../src/components/panels/LogPanel.tsx", import.meta.url), "utf8");
    const panels = await readFile(new URL("../src/components/ahanu/Panels.tsx", import.meta.url), "utf8");
    const demo = await readFile(new URL("../src/lib/data/community.ts", import.meta.url), "utf8");
    assert.match(demo, /DEMO leftover community freeze/);
    assert.match(chart, /communityForChart\(\)/);
    assert.doesNotMatch(chart, /COMMUNITY_REPORTS/);
    assert.match(log, /COMMUNITY_HELM_LINE/);
    assert.doesNotMatch(log, /communityHelmReports/);
    assert.doesNotMatch(log, /COMMUNITY_REPORTS/);
    assert.doesNotMatch(log, /packed with the trip/);
    assert.match(panels, /COMMUNITY_HELM_LINE/);
    assert.doesNotMatch(panels, /COMMUNITY_REPORTS/);
    assert.ok(root);
  });
});
