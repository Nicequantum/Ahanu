/**
 * MapLibre GL JS v6 tiles GeoJSON in a separate worker module.
 * Bundlers do not see `new URL("./maplibre-gl-worker.mjs", import.meta.url)`,
 * so the worker 404s (or is served HTML). Image rasters still paint; vector
 * sources keep `_data` but never promote to tiles — 0 ENC pixels, loaded() stuck.
 * `?worker&url` emits a self-contained chunk (includes shared.mjs).
 */

export const MAPLIBRE_WORKER_SPECIFIER = "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

export function bindMaplibreWorkerUrl(
  maplibregl: { setWorkerUrl: (url: string) => void },
  workerUrl: string,
): string {
  const url = typeof workerUrl === "string" ? workerUrl.trim() : "";
  if (!url) {
    throw new Error("MapLibre worker URL is empty — GeoJSON sources will never tile");
  }
  maplibregl.setWorkerUrl(url);
  return url;
}

export async function loadMaplibreWorkerUrl(): Promise<string> {
  const mod = await import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url");
  return String((mod as { default?: string }).default ?? "");
}

export async function ensureMaplibreWorker(maplibregl: {
  setWorkerUrl: (url: string) => void;
}): Promise<string> {
  return bindMaplibreWorkerUrl(maplibregl, await loadMaplibreWorkerUrl());
}
