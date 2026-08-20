import type { TripPackLayer } from "@/lib/ahanu/types";

const READY = "2026-08-20T08:00:00Z";
const CHL_STALE = "2026-08-17T11:40:00Z";

/**
 * Pre-departure pack for a Point Judith canyon overnight.
 * Most layers ready; chlorophyll is stale; AIS is missing — that is the dashboard story.
 */
export const DEFAULT_PACK_LAYERS: TripPackLayer[] = [
  {
    id: "enc-northeast",
    label: "ENC Northeast (US1–US5, RI to canyons)",
    sizeMb: 180,
    status: "ready",
    updatedAt: READY,
    hours: 0,
  },
  {
    id: "raster-charts",
    label: "Raster charts (Point Judith to Hudson / Veatch / Atlantis)",
    sizeMb: 96,
    status: "ready",
    updatedAt: READY,
    hours: 0,
  },
  {
    id: "ww3-grib-72h",
    label: "WW3 GRIB 72h (wind / waves / swell)",
    sizeMb: 12,
    status: "ready",
    updatedAt: READY,
    hours: 72,
  },
  {
    id: "ndfd",
    label: "NDFD coastal wind & weather 72h",
    sizeMb: 8,
    status: "ready",
    updatedAt: READY,
    hours: 72,
  },
  {
    id: "ghrsst-1km",
    label: "GHRSST 1km sea surface temperature",
    sizeMb: 40,
    status: "ready",
    updatedAt: READY,
    hours: 24,
  },
  {
    id: "chlorophyll",
    label: "Chlorophyll-a (VIIRS / MODIS composite)",
    sizeMb: 22,
    status: "stale",
    updatedAt: CHL_STALE,
    hours: 72,
  },
  {
    id: "altimetry",
    label: "Altimetry SSH anomaly (warm-core / cold-core)",
    sizeMb: 15,
    status: "ready",
    updatedAt: READY,
    hours: 48,
  },
  {
    id: "ndbc-snapshot",
    label: "NDBC buoy snapshot (44008, 44017, 44025, 44066)",
    sizeMb: 2.4,
    status: "ready",
    updatedAt: READY,
    hours: 6,
  },
  {
    id: "tides",
    label: "Tides & currents (Point Judith, Block, Montauk)",
    sizeMb: 1.2,
    status: "ready",
    updatedAt: READY,
    hours: 168,
  },
  {
    id: "hms-regs",
    label: "HMS regs snapshot (August 2026 educational)",
    sizeMb: 0.4,
    status: "ready",
    updatedAt: READY,
    hours: 0,
  },
  {
    id: "knowledge-base",
    label: "Ahanu knowledge base (canyon tactics)",
    sizeMb: 3.6,
    status: "ready",
    updatedAt: READY,
    hours: 0,
  },
  {
    id: "community-freeze",
    label: "Community freeze (reports, tracks, marks)",
    sizeMb: 0.8,
    status: "ready",
    updatedAt: READY,
    hours: 12,
  },
  {
    id: "ais",
    label: "AIS gateway snapshot",
    sizeMb: 0,
    status: "missing",
    updatedAt: "",
    hours: 0,
  },
];
