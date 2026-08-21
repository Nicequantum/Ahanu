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
  "ENC in this pack is official NOAA S-57 (ISO 8211 .000 exchange set). Ahanu is an aid — not an ECDIS.";

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
  s57?: { iso8211?: boolean; official?: boolean; file000Bytes?: number; leader?: string; zipBase64?: string };
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
  if (packedEncOfficial()) return source === "noaa" || source === "r2" ? "ENC official S-57 · NOAA" : "ENC official S-57";
  if (source === "noaa") return "ENC catalog (aid · NOAA)";
  return "ENC catalog (aid)";
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

export function encCatalogLabelPoints(): { id: string; lon: number; lat: number }[] {
  return encOverlayCells()
    .filter(encCellHasBounds)
    .map((c) => ({
      id: c.id,
      lon: (c.west + c.east) / 2,
      lat: (c.north + c.south) / 2,
    }));
}
