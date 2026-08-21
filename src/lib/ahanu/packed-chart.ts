/**
 * Chart helpers: prefer packed vectors when a session is loaded.
 * Missing pack layers stay empty. No pack → seed / local models.
 */

import { contourLines } from "./bathymetry";
import { CANYONS } from "@/lib/data/canyons";
import { BUOYS } from "@/lib/data/buoys";
import { CLOSED_AREAS } from "@/lib/data/regs";
import type { Buoy } from "./types";
import { getPackedOcean } from "./packed-fields";
import type { PackedBuoyRow } from "./noaa-live";
import { encCatalogBounds } from "./noaa-enc";

export const ENC_AID_DISCLAIMER =
  "ENC in this pack is a cell list (fixture or live NOAA catalog), not official S-57. Ahanu is an aid to navigation — not a substitute for current official ENC.";

export const ENC_S57_DISCLAIMER =
  "ENC in this pack is official NOAA S-57 (ISO 8211 .000 exchange set, plus .00n updates when present). Ahanu is an aid — not an ECDIS.";

export const ENC_S57_EXTRACT_NOTE = "S-57 extract — not ECDIS";

export { ENC_OFFICIAL_ROW_LABEL, ENC_CATALOG_ROW_LABEL } from "./s57-extract";

export const HMS_AID_DISCLAIMER =
  "HMS closed areas are a reminder overlay, not a legal determination. Recreational trolling is generally not the same as commercial pelagic longline closures. Verify with NOAA HMS before you leave the dock.";

function emptyFc(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function seedCanyons(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: CANYONS.flatMap((c) => [
      {
        type: "Feature" as const,
        properties: { name: c.name, kind: "axis" },
        geometry: {
          type: "LineString" as const,
          coordinates: c.axis.map((p) => [p.lon, p.lat] as [number, number]),
        },
      },
      {
        type: "Feature" as const,
        properties: { name: c.name, kind: "head" },
        geometry: { type: "Point" as const, coordinates: [c.head.lon, c.head.lat] },
      },
    ]),
  };
}

function seedHms(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: CLOSED_AREAS.map((a) => ({
      type: "Feature" as const,
      properties: { name: a.name, legal: false },
      geometry: {
        type: "Polygon" as const,
        coordinates: [a.ring.map((p) => [p.lon, p.lat] as [number, number])],
      },
    })),
  };
}

export function canyonsForChart(): GeoJSON.FeatureCollection {
  const ocean = getPackedOcean();
  if (ocean?.canyons) return ocean.canyons;
  if (ocean) return emptyFc();
  return seedCanyons();
}

function contourDepthM(f: GeoJSON.Feature): number | null {
  const props = f.properties as { depthM?: number; depth?: number } | null;
  const d = props?.depthM ?? props?.depth;
  return typeof d === "number" && Number.isFinite(d) ? d : null;
}

function splitPackedContours(fc: GeoJSON.FeatureCollection): {
  c100: GeoJSON.FeatureCollection;
  c200: GeoJSON.FeatureCollection;
} {
  const c100: GeoJSON.Feature[] = [];
  const c200: GeoJSON.Feature[] = [];
  for (const f of fc.features) {
    const d = contourDepthM(f);
    if (d != null && d >= 300 && d <= 450) c200.push(f);
    else c100.push(f);
  }
  return {
    c100: { type: "FeatureCollection", features: c100 },
    c200: { type: "FeatureCollection", features: c200 },
  };
}

export function contoursForChart(): { c100: GeoJSON.FeatureCollection; c200: GeoJSON.FeatureCollection } {
  const ocean = getPackedOcean();
  if (ocean?.contours) return splitPackedContours(ocean.contours);
  if (ocean) return { c100: emptyFc(), c200: emptyFc() };
  return { c100: contourLines(183, 2), c200: contourLines(366, 3) };
}

export function hmsForChart(): GeoJSON.FeatureCollection {
  const ocean = getPackedOcean();
  if (ocean?.hms) return ocean.hms;
  if (ocean) return emptyFc();
  return seedHms();
}

export function normalizePackedBuoy(row: PackedBuoyRow): Buoy {
  return {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lon: row.lon,
    windKt: row.windKt ?? 0,
    windDir: row.windDir ?? 0,
    gustKt: row.gustKt ?? row.windKt ?? 0,
    waveFt: row.waveFt ?? 0,
    periodS: row.periodS ?? 0,
    sstC: row.sstC ?? 0,
    pressureMb: row.pressureMb ?? 0,
    updatedAt: row.updatedAt ?? "",
  };
}

export function buoysForChart(): Buoy[] {
  const ocean = getPackedOcean();
  if (ocean?.buoys) return ocean.buoys.map(normalizePackedBuoy);
  if (ocean) return [];
  return BUOYS;
}

export function buoyPointsGeo(buoys: Buoy[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: buoys.map((b) => ({
      type: "Feature" as const,
      properties: {
        id: b.id,
        name: b.name,
        windKt: b.windKt,
        waveFt: b.waveFt,
        sstC: b.sstC,
      },
      geometry: { type: "Point" as const, coordinates: [b.lon, b.lat] },
    })),
  };
}

export function canyonHeadsForLabels(): { name: string; lon: number; lat: number }[] {
  const ocean = getPackedOcean();
  if (ocean?.canyons) {
    return ocean.canyons.features
      .filter((f) => f.geometry?.type === "Point" && (f.properties as { kind?: string } | null)?.kind === "head")
      .map((f) => {
        const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
        const name = String((f.properties as { name?: string } | null)?.name ?? "");
        return { name, lon, lat };
      })
      .filter((h) => h.name);
  }
  if (ocean) return [];
  const MAJOR = new Set([
    "hudson",
    "block",
    "atlantis",
    "veatch",
    "hydro",
    "hydrographer",
    "wilmington",
    "baltimore",
    "norfolk",
  ]);
  return CANYONS.filter((c) => MAJOR.has(c.id) || MAJOR.has(c.name.toLowerCase().split(" ")[0]!)).map((c) => ({
    name: c.name.replace(" Canyon", ""),
    lon: c.head.lon,
    lat: c.head.lat,
  }));
}

export type PackedEncCell = {
  id: string;
  usage: number;
  name: string;
  west?: number;
  south?: number;
  east?: number;
  north?: number;
  s57?: {
    iso8211?: boolean;
    official?: boolean;
    file000Bytes?: number;
    leader?: string;
    zipBase64?: string;
    edition?: string;
    updn?: string;
    updateCount?: number;
    baseOnly?: boolean;
    updates?: { file: string; bytes: number }[];
  };
};

export function packedEncCells(): PackedEncCell[] {
  return getPackedOcean()?.enc?.cells ?? [];
}

export function packedEncNote(): string | null {
  const enc = getPackedOcean()?.enc;
  if (!enc) return null;
  return enc.note || (enc.official ? ENC_S57_DISCLAIMER : ENC_AID_DISCLAIMER);
}

export function packedEncOfficial(): boolean {
  return Boolean(getPackedOcean()?.enc?.official);
}

export function packedOfficialEncCells(): PackedEncCell[] {
  const enc = getPackedOcean()?.enc;
  if (!enc?.official) return [];
  const fromS57 = (enc.s57?.cellIds ?? []).filter(Boolean);
  if (fromS57.length) {
    const byId = new Map((enc.cells ?? []).map((c) => [c.id, c]));
    return fromS57.map((id) => byId.get(id)).filter((c): c is PackedEncCell => Boolean(c));
  }
  return (enc.cells ?? []).filter((c) => c.s57?.iso8211);
}

export function encHelmLabel(source?: string): string {
  if (packedEncOfficial()) {
    const applied = packedEncExtract()?.updatesApplied ?? 0;
    const base = source === "noaa" || source === "r2" ? "ENC official S-57 · NOAA" : "ENC official S-57";
    return applied > 0 ? `${base} · includes ENC updates` : base;
  }
  if (source === "noaa") return "ENC catalog (aid · NOAA)";
  return "ENC catalog (aid)";
}

/** Per-cell edition / update line. Does not say "includes ENC updates" unless extract applied them. */
export function encCellUpdateLine(cell: PackedEncCell): string {
  const extract = packedEncExtract()?.cells.find((c) => c.cellId === cell.id);
  const bits: string[] = [];
  const edition = extract?.edition ?? cell.s57?.edition;
  const updn = extract?.updn ?? cell.s57?.updn;
  if (edition) bits.push(`ed ${edition}`);
  if (extract) {
    const n = extract.updatesApplied ?? 0;
    if (n > 0) bits.push(`${n} update${n === 1 ? "" : "s"} applied`);
    else bits.push("base .000 only");
  } else if ((cell.s57?.updateCount ?? 0) > 0) {
    bits.push(`${cell.s57!.updateCount} update file${cell.s57!.updateCount === 1 ? "" : "s"} in zip`);
  } else if (cell.s57?.baseOnly || cell.s57?.iso8211) {
    bits.push("base .000 only");
  }
  if (updn != null && updn !== "" && (extract?.updatesApplied ?? cell.s57?.updateCount ?? 0) > 0) {
    bits.push(`UPDN ${updn}`);
  }
  return bits.join(" · ");
}

export function encPackRowLabel(stored?: string): string {
  if (packedEncOfficial()) return "NOAA ENC (official S-57)";
  if (stored && !/catalog or S-57/i.test(stored)) return stored;
  return "NOAA ENC (catalog aid)";
}

export function packedEncExtract() {
  return getPackedOcean()?.enc?.extract;
}

export function encOverlayCells(): PackedEncCell[] {
  return packedEncOfficial() ? packedOfficialEncCells() : packedEncCells();
}

export function encCellHasBounds(
  cell: PackedEncCell,
): cell is PackedEncCell & { west: number; south: number; east: number; north: number } {
  return encCatalogBounds(cell) != null;
}

/** Coverage boxes from west/south/east/north. Missing/empty/no-bounds → no features. */
export function encCatalogFeatures(
  cells: PackedEncCell[],
  kind: "enc-catalog" | "enc-s57" = "enc-catalog",
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: cells.filter(encCellHasBounds).map((c) => ({
      type: "Feature" as const,
      properties: {
        id: c.id,
        name: c.name,
        usage: c.usage,
        legal: false,
        kind,
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [c.west, c.south],
            [c.east, c.south],
            [c.east, c.north],
            [c.west, c.north],
            [c.west, c.south],
          ],
        ],
      },
    })),
  };
}

export function encCatalogForChart(): GeoJSON.FeatureCollection {
  const official = packedEncOfficial();
  return encCatalogFeatures(encOverlayCells(), official ? "enc-s57" : "enc-catalog");
}

function extractFeatures(kind: string): GeoJSON.Feature[] {
  return (packedEncExtract()?.features ?? []).filter((f) => (f.properties as { kind?: string } | null)?.kind === kind);
}

const POLY = ["Polygon", "MultiPolygon"] as const;
const LINE = ["LineString", "MultiLineString"] as const;
const POINT = ["Point", "MultiPoint"] as const;

function featuresOfTypes(features: GeoJSON.Feature[], types: readonly string[]): GeoJSON.Feature[] {
  return features.filter((f) => f.geometry != null && types.includes(f.geometry.type));
}

function extractTyped(kind: string, types: readonly string[]): GeoJSON.Feature[] {
  return featuresOfTypes(extractFeatures(kind), types);
}

/** Cell footprints: parsed .000 extent when official extract landed, else catalog boxes. */
export function encForChart(): GeoJSON.FeatureCollection {
  const cells = extractTyped("enc-s57-cell", POLY);
  if (cells.length) return { type: "FeatureCollection", features: cells };
  return encCatalogForChart();
}

export function encAidsForChart(): GeoJSON.FeatureCollection {
  const features = [...extractTyped("enc-s57-aid", POINT), ...extractTyped("enc-s57-light", POINT)];
  return { type: "FeatureCollection", features };
}

export function encSoundingsForChart(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: extractTyped("enc-s57-sounding", POINT) };
}

export function encCoastForChart(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: extractTyped("enc-s57-coastline", LINE) };
}

export function encShoreForChart(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [...extractTyped("enc-s57-shore", LINE), ...extractTyped("enc-s57-slope", LINE)],
  };
}

export function encDepthAreasForChart(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [...extractTyped("enc-s57-depth-area", POLY), ...extractTyped("enc-s57-lake", POLY)],
  };
}

export function encDepthContoursForChart(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: extractTyped("enc-s57-depth-contour", LINE) };
}

export function encLandForChart(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: extractTyped("enc-s57-land", POLY) };
}

export function encHazardsForChart(): GeoJSON.FeatureCollection {
  const features = [
    ...extractFeatures("enc-s57-wreck"),
    ...extractFeatures("enc-s57-obstruction"),
    ...extractFeatures("enc-s57-seabed"),
    ...extractFeatures("enc-s57-bridge"),
  ];
  return { type: "FeatureCollection", features };
}

export function encLandPolygons(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: featuresOfTypes(encLandForChart().features, POLY),
  };
}

export function encHazardPoints(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: featuresOfTypes(encHazardsForChart().features, POINT),
  };
}

export function encHazardAreas(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: featuresOfTypes(encHazardsForChart().features, [...POLY, ...LINE]),
  };
}

export function encCatalogLabelPoints(): { id: string; lon: number; lat: number }[] {
  const extractCells = extractFeatures("enc-s57-cell");
  if (extractCells.length) {
    return extractCells
      .map((f) => {
        const ring = f.geometry?.type === "Polygon" ? f.geometry.coordinates[0] : undefined;
        if (!ring?.length) return null;
        const lons = ring.map((p) => p[0]!);
        const lats = ring.map((p) => p[1]!);
        return {
          id: String((f.properties as { id?: string } | null)?.id ?? ""),
          lon: (Math.min(...lons) + Math.max(...lons)) / 2,
          lat: (Math.min(...lats) + Math.max(...lats)) / 2,
        };
      })
      .filter((c): c is { id: string; lon: number; lat: number } => Boolean(c?.id));
  }
  return encOverlayCells()
    .filter(encCellHasBounds)
    .map((c) => ({
      id: c.id,
      lon: (c.west + c.east) / 2,
      lat: (c.north + c.south) / 2,
    }));
}
