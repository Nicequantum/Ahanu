/**
 * Public NOAA ENC catalog + raster-tile metadata (no secrets).
 * This is a cell list / aid, never official S-57.
 * Keep free of `@/` aliases so the Worker can import it.
 */

import type { PackBBox } from "./pack-fixtures";
import type { PackedJson } from "./pack-fixtures";

export const ENC_PROD_CAT_URL = "https://charts.noaa.gov/ENCs/ENCProdCat.xml";
export const ENC_CELL_ZIP_BASE = "https://charts.noaa.gov/ENCs/";
export const ENC_DIRECT_TILE_TEMPLATE =
  "https://tileservice.charts.noaa.gov/tiles/encdirect/{z}/{x}/{y}.png";
export const ENC_ONLINE_MAPSERVER_URL =
  "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer?f=json";

export const ENC_AID_NOTE =
  "Live NOAA ENC product-catalog excerpt — cell list and zip URLs, not official S-57. Ahanu is an aid to navigation, not a substitute for a current official ENC.";

const HARBOR_POINTS = [
  { name: "Point Judith", lat: 41.3615, lon: -71.4814 },
  { name: "Montauk", lat: 41.048, lon: -71.959 },
  { name: "Newport", lat: 41.49, lon: -71.327 },
] as const;

export interface EncCatalogCell {
  id: string;
  usage: number;
  name: string;
  scale?: number;
  status?: string;
  zipUrl?: string;
  zipBytes?: number;
  edition?: string;
  update?: string;
  issued?: string;
  west?: number;
  south?: number;
  east?: number;
  north?: number;
  zipSha256?: string;
}

export interface EncTileMeta {
  template: string;
  legal: false;
  probe?: "ok" | "tls-failed" | "http-failed" | "skipped";
  mapServer?: { url: string; fetched: boolean; mapName?: string };
}

function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m?.[1]?.trim();
}

function usageFromCellId(id: string): number {
  const m = id.match(/^US(\d)/);
  return m ? Number(m[1]) : 0;
}

function coverageBox(block: string): { west: number; south: number; east: number; north: number } | undefined {
  const lats = [...block.matchAll(/<lat>([^<]+)<\/lat>/g)].map((m) => Number(m[1]));
  const lons = [...block.matchAll(/<long>([^<]+)<\/long>/g)].map((m) => Number(m[1]));
  if (!lats.length || !lons.length || lats.some((n) => !Number.isFinite(n)) || lons.some((n) => !Number.isFinite(n))) {
    return undefined;
  }
  return {
    west: Math.min(...lons),
    south: Math.min(...lats),
    east: Math.max(...lons),
    north: Math.max(...lats),
  };
}

function boxesOverlap(
  a: { west: number; south: number; east: number; north: number },
  b: PackBBox,
): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

function pointInBox(lat: number, lon: number, box: { west: number; south: number; east: number; north: number }): boolean {
  return lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;
}

/** Parse NOAA ENCProdCat.xml into Active usage 3–5 cells that intersect bbox. */
export function parseEncProductCatalog(xml: string, bbox?: PackBBox): EncCatalogCell[] {
  const out: EncCatalogCell[] = [];
  const seen = new Set<string>();
  const chunks = xml.split(/<\/cell>/i);
  for (const raw of chunks) {
    const start = raw.lastIndexOf("<cell");
    if (start < 0) continue;
    const block = raw.slice(start);
    const id = tag(block, "name");
    if (!id || seen.has(id)) continue;
    const status = tag(block, "status") ?? "";
    if (status && status.toLowerCase() !== "active") continue;
    const usage = usageFromCellId(id);
    if (usage < 3 || usage > 5) continue;
    const cov = coverageBox(block);
    if (bbox && cov && !boxesOverlap(cov, bbox)) continue;
    if (bbox && !cov) continue;
    seen.add(id);
    const zip = tag(block, "zipfile_location") ?? `${ENC_CELL_ZIP_BASE}${id}.zip`;
    const sizeRaw = tag(block, "zipfile_size");
    const size = sizeRaw ? Number(sizeRaw) : undefined;
    out.push({
      id,
      usage,
      name: tag(block, "lname") ?? id,
      scale: tag(block, "cscale") ? Number(tag(block, "cscale")) : undefined,
      status: status || "Active",
      zipUrl: zip,
      zipBytes: Number.isFinite(size) ? size : undefined,
      edition: tag(block, "edtn"),
      update: tag(block, "uadt"),
      issued: tag(block, "isdt") ?? tag(block, "zipfile_datetime_iso8601"),
      west: cov?.west,
      south: cov?.south,
      east: cov?.east,
      north: cov?.north,
    });
  }
  out.sort((a, b) => b.usage - a.usage || (a.scale ?? 0) - (b.scale ?? 0) || a.id.localeCompare(b.id));
  return out;
}

export function encCatalogDateValid(xml: string): string | undefined {
  return tag(xml, "dt_valid") ?? tag(xml, "date_valid");
}

export function harborApproachNames(cells: EncCatalogCell[]): string[] {
  const names: string[] = [];
  for (const h of HARBOR_POINTS) {
    const hit = cells.some(
      (c) =>
        c.usage >= 4 &&
        c.west != null &&
        c.south != null &&
        c.east != null &&
        c.north != null &&
        pointInBox(h.lat, h.lon, { west: c.west, south: c.south, east: c.east, north: c.north }),
    );
    if (hit) names.push(h.name);
  }
  return names;
}

export function pickSmallEncZip(cells: EncCatalogCell[], maxBytes = 80_000): EncCatalogCell | undefined {
  return cells.find((c) => c.usage >= 5 && (c.zipBytes ?? Infinity) > 0 && (c.zipBytes ?? Infinity) <= maxBytes);
}


export type EncCatalogBounds = { west: number; south: number; east: number; north: number };

/** Valid catalog coverage box for the aid overlay. Drops missing, NaN, or inverted. Not S-57. */
export function encCatalogBounds(cell: {
  west?: number;
  south?: number;
  east?: number;
  north?: number;
}): EncCatalogBounds | undefined {
  const { west, south, east, north } = cell;
  if (
    typeof west !== "number" ||
    typeof south !== "number" ||
    typeof east !== "number" ||
    typeof north !== "number" ||
    !Number.isFinite(west) ||
    !Number.isFinite(south) ||
    !Number.isFinite(east) ||
    !Number.isFinite(north) ||
    west >= east ||
    south >= north
  ) {
    return undefined;
  }
  return { west, south, east, north };
}

export function encToPackedJson(
  bbox: PackBBox,
  cells: EncCatalogCell[],
  extras: {
    catalogUrl: string;
    catalogDate?: string;
    tiles?: EncTileMeta;
  },
): PackedJson {
  const harbor = harborApproachNames(cells);
  return {
    kind: "enc-clip",
    layer: "enc",
    payload: {
      fixture: false,
      live: true,
      official: false,
      source: "noaa-enc-catalog",
      note: ENC_AID_NOTE,
      bbox,
      catalog: { url: extras.catalogUrl, dateValid: extras.catalogDate },
      tiles: extras.tiles ?? {
        template: ENC_DIRECT_TILE_TEMPLATE,
        legal: false as const,
        probe: "skipped",
      },
      coverage: {
        harborApproach: harbor,
        coastalTo100fm: cells.some((c) => c.usage === 3),
      },
      cells: cells.map((c) => {
        const box = encCatalogBounds(c);
        return {
          id: c.id,
          usage: c.usage,
          name: c.name,
          scale: c.scale,
          status: c.status,
          zipUrl: c.zipUrl,
          zipBytes: c.zipBytes,
          zipSha256: c.zipSha256,
          edition: c.edition,
          update: c.update,
          issued: c.issued,
          ...(box ?? {}),
        };
      }),
    },
  };
}
