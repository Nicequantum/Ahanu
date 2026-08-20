import "./register-alias.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  isAhanuPackSsrFile,
  isAhanuPackSsrModule,
  invalidatePackSsrGraph,
  listPackSsrModules,
  packSsrSurfaces,
  PACK_SSR_ENTRY,
} = await import("../scripts/pack-ssr-invalidate.ts");

describe("isAhanuPackSsrFile", () => {
  it("matches pack* and noaa-* under src/lib/ahanu", () => {
    assert.equal(isAhanuPackSsrFile("/repo/src/lib/ahanu/pack.ts"), true);
    assert.equal(isAhanuPackSsrFile("/repo/src/lib/ahanu/pack-http.ts"), true);
    assert.equal(isAhanuPackSsrFile("/repo/src/lib/ahanu/pack-fixtures.ts"), true);
    assert.equal(isAhanuPackSsrFile("/repo/src/lib/ahanu/noaa-sst.ts"), true);
    assert.equal(isAhanuPackSsrFile("/repo/src/lib/ahanu/noaa-live.ts"), true);
    assert.equal(isAhanuPackSsrFile("C:\\repo\\src\\lib\\ahanu\\pack.ts"), true);
    assert.equal(isAhanuPackSsrFile("/repo/src/lib/ahanu/pack.ts?t=1"), true);
    assert.equal(isAhanuPackSsrFile(PACK_SSR_ENTRY), true);
    assert.equal(isAhanuPackSsrFile("/repo/src/lib/ahanu/constants.ts"), false);
    assert.equal(isAhanuPackSsrFile("/repo/src/lib/ahanu/scoring.ts"), false);
    assert.equal(isAhanuPackSsrFile("/repo/src/components/panels/PacksPanel.tsx"), false);
  });
});

describe("invalidatePackSsrGraph", () => {
  it("hard-invalidates pack-http, pack.ts, and noaa modules; leaves constants", () => {
    const packHttp = {
      url: PACK_SSR_ENTRY,
      id: "/repo/src/lib/ahanu/pack-http.ts",
      file: "/repo/src/lib/ahanu/pack-http.ts",
    };
    const pack = {
      url: "/src/lib/ahanu/pack.ts",
      id: "/repo/src/lib/ahanu/pack.ts",
      file: "/repo/src/lib/ahanu/pack.ts",
    };
    const noaa = {
      url: "/src/lib/ahanu/noaa-live.ts",
      id: "/repo/src/lib/ahanu/noaa-live.ts",
      file: "/repo/src/lib/ahanu/noaa-live.ts",
    };
    const constants = {
      url: "/src/lib/ahanu/constants.ts",
      id: "/repo/src/lib/ahanu/constants.ts",
      file: "/repo/src/lib/ahanu/constants.ts",
    };
    const invalidated: string[] = [];
    const graph = {
      urlToModuleMap: new Map([
        [packHttp.url, packHttp],
        [pack.url, pack],
        [noaa.url, noaa],
        [constants.url, constants],
      ]),
      idToModuleMap: new Map([
        [packHttp.id, packHttp],
        [pack.id, pack],
        [noaa.id, noaa],
        [constants.id, constants],
      ]),
      invalidateModule(mod: { file?: string }) {
        invalidated.push(mod.file ?? "");
      },
    };
    const runnerInvalidated: string[] = [];
    const runner = {
      evaluatedModules: {
        idToModuleMap: new Map([
          [pack.id, { id: pack.id, url: pack.url, file: pack.file }],
          [packHttp.id, { id: packHttp.id, url: packHttp.url, file: packHttp.file }],
          [constants.id, { id: constants.id, url: constants.url, file: constants.file }],
        ]),
        invalidateModule(node: { file?: string }) {
          runnerInvalidated.push(node.file ?? "");
        },
      },
    };

    assert.deepEqual(
      listPackSsrModules(graph)
        .map((m) => m.file)
        .sort(),
      [noaa.file, pack.file, packHttp.file].sort(),
    );
    assert.equal(isAhanuPackSsrModule(constants), false);

    const stats = invalidatePackSsrGraph(graph, runner);
    assert.equal(stats.modules, 3);
    assert.equal(stats.runner, 2);
    assert.deepEqual(invalidated.sort(), [noaa.file, pack.file, packHttp.file].sort());
    assert.deepEqual(runnerInvalidated.sort(), [pack.file, packHttp.file].sort());
    assert.ok(!invalidated.includes(constants.file));
    assert.ok(!runnerInvalidated.includes(constants.file));
  });

  it("reads the ssr environment graph and the compat runner off the Vite server", () => {
    const graph = { invalidateModule() {} };
    const runner = { evaluatedModules: { idToModuleMap: new Map(), invalidateModule() {} } };
    const surfaces = packSsrSurfaces({
      environments: { ssr: { moduleGraph: graph } },
      moduleGraph: { invalidateModule() {} },
      _ssrCompatModuleRunner: runner,
    });
    assert.equal(surfaces.graph, graph);
    assert.equal(surfaces.runner, runner);
  });
});
