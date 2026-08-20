/**
 * Vite 8 `ssrLoadModule` evaluates through SSRCompatModuleRunner (`hmr: false`).
 * A disk edit can refill environment `transformResult` via client HMR while the
 * runner still holds the old exports; fetchModule then returns `{ cache: true }`.
 * Hard-invalidate pack / noaa modules on that graph so the next GET /api/packs
 * reloads builder.rev from disk.
 */

import path from "node:path";

export const PACK_SSR_ENTRY = "/src/lib/ahanu/pack-http.ts";

const PACK_SSR_FILE = /(?:^|\/)src\/lib\/ahanu\/(pack[^/]*|noaa-[^/]+)\.ts$/i;

export type PackSsrModule = {
  url?: string;
  id?: string | null;
  file?: string | null;
  importedModules?: Iterable<PackSsrModule>;
  importers?: Iterable<PackSsrModule>;
};

export type PackSsrGraph = {
  urlToModuleMap?: Map<string, PackSsrModule>;
  idToModuleMap?: Map<string, PackSsrModule>;
  fileToModulesMap?: Map<string, Set<PackSsrModule>>;
  invalidateModule: (mod: PackSsrModule) => void;
};

export type PackSsrEvaluatedNode = {
  id: string;
  url: string;
  file?: string;
  importers?: Iterable<string>;
  imports?: Iterable<string>;
};

export type PackSsrRunner = {
  evaluatedModules?: {
    idToModuleMap?: Map<string, PackSsrEvaluatedNode>;
    invalidateModule: (node: PackSsrEvaluatedNode) => void;
  };
};

export function isAhanuPackSsrFile(file: string): boolean {
  const normalized = file.replace(/\\/g, "/").split("?")[0] ?? "";
  return PACK_SSR_FILE.test(normalized);
}

export function isAhanuPackSsrModule(mod: PackSsrModule): boolean {
  return [mod.file, mod.id, mod.url].some((v) => typeof v === "string" && isAhanuPackSsrFile(v));
}

export function listPackSsrModules(graph: PackSsrGraph): PackSsrModule[] {
  const uniq = new Set<PackSsrModule>();
  for (const src of [graph.urlToModuleMap, graph.idToModuleMap]) {
    if (!src) continue;
    for (const mod of src.values()) {
      if (isAhanuPackSsrModule(mod)) uniq.add(mod);
    }
  }
  return [...uniq];
}

export function invalidatePackSsrGraph(
  graph: PackSsrGraph,
  runner?: PackSsrRunner | null,
): { modules: number; runner: number } {
  const mods = listPackSsrModules(graph);
  for (const mod of mods) graph.invalidateModule(mod);
  let runnerCount = 0;
  const evaluated = runner?.evaluatedModules;
  if (evaluated?.idToModuleMap && typeof evaluated.invalidateModule === "function") {
    for (const node of evaluated.idToModuleMap.values()) {
      if (
        isAhanuPackSsrFile(node.file ?? "") ||
        isAhanuPackSsrFile(node.id) ||
        isAhanuPackSsrFile(node.url)
      ) {
        evaluated.invalidateModule(node);
        runnerCount += 1;
      }
    }
  }
  return { modules: mods.length, runner: runnerCount };
}

export function packSsrSurfaces(server: {
  environments?: { ssr?: { moduleGraph?: PackSsrGraph } };
  moduleGraph?: PackSsrGraph;
  _ssrCompatModuleRunner?: PackSsrRunner;
}): { graph: PackSsrGraph | undefined; runner: PackSsrRunner | undefined } {
  return {
    graph: server.environments?.ssr?.moduleGraph ?? server.moduleGraph,
    runner: server._ssrCompatModuleRunner,
  };
}

export function watchAhanuPackDir(watcher: { add: (p: string) => void }, root: string): string {
  const dir = path.resolve(root, "src/lib/ahanu");
  watcher.add(dir);
  return dir;
}
