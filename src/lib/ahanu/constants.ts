import type { BoatLimits, DisplayMode, LayerId, SpeciesId } from "./types";

/** Northeast U.S. shelf + canyon operating box. */
export const REGION = {
  west: -75.4,
  east: -66.4,
  south: 36.4,
  north: 42.6,
} as const;

export const POINT_JUDITH = { lat: 41.3615, lon: -71.4814 };

/** Point Judith canyon overnight box — docs/DATA_PACKS.md */
export const POINT_JUDITH_CANYON_BBOX = {
  west: -72.8,
  south: 39.4,
  east: -68.8,
  north: 41.5,
} as const;
export const MONTAUK = { lat: 41.048, lon: -71.959 };
export const NEWPORT = { lat: 41.49, lon: -71.327 };
export const VEATCH_HEAD = { lat: 39.9, lon: -69.62 };
export const ATLANTIS_HEAD = { lat: 39.85, lon: -70.22 };
export const HYDRO_HEAD = { lat: 40.15, lon: -69.0 };
export const HUDSON_HEAD = { lat: 39.55, lon: -72.4 };

export const DEFAULT_CENTER = { lat: 39.92, lon: -69.85 };
export const DEFAULT_ZOOM = 7.35;

export const NM_PER_DEG_LAT = 60;
export const METERS_PER_NM = 1852;

export const SPECIES_ORDER: SpeciesId[] = [
  "bigeye",
  "yellowfin",
  "bluefin",
  "mahi",
  "white_marlin",
  "blue_marlin",
  "swordfish",
  "albacore",
];

export const LAYER_META: Record<
  LayerId,
  { label: string; group: "chart" | "ocean" | "weather" | "intel" | "ops" }
> = {
  bathymetry: { label: "Bathymetry", group: "chart" },
  contours: { label: "Depth contours", group: "chart" },
  canyons: { label: "Canyon labels", group: "chart" },
  sst: { label: "Sea surface temp", group: "ocean" },
  chlorophyll: { label: "Chlorophyll", group: "ocean" },
  altimetry: { label: "SSH anomaly", group: "ocean" },
  temp_breaks: { label: "Temperature breaks", group: "intel" },
  chl_edges: { label: "Color edges", group: "intel" },
  habitat: { label: "Habitat score", group: "intel" },
  wind: { label: "Wind barbs", group: "weather" },
  waves: { label: "Wave height", group: "weather" },
  buoys: { label: "NDBC buoys", group: "weather" },
  spots: { label: "Marks & spots", group: "ops" },
  tracks: { label: "Track", group: "ops" },
  routes: { label: "Routes", group: "ops" },
  hms_zones: { label: "HMS closed areas", group: "ops" },
  enc: { label: "ENC catalog (aid)", group: "ops" },
  ais: { label: "AIS (gateway)", group: "ops" },
};

export const DEFAULT_LAYERS: Record<LayerId, { visible: boolean; opacity: number }> = {
  bathymetry: { visible: true, opacity: 0.92 },
  contours: { visible: true, opacity: 0.7 },
  canyons: { visible: true, opacity: 1 },
  sst: { visible: false, opacity: 0.55 },
  chlorophyll: { visible: false, opacity: 0.5 },
  altimetry: { visible: false, opacity: 0.45 },
  temp_breaks: { visible: true, opacity: 0.9 },
  chl_edges: { visible: false, opacity: 0.85 },
  habitat: { visible: true, opacity: 0.48 },
  wind: { visible: false, opacity: 0.85 },
  waves: { visible: false, opacity: 0.45 },
  buoys: { visible: true, opacity: 1 },
  spots: { visible: true, opacity: 1 },
  tracks: { visible: true, opacity: 0.9 },
  routes: { visible: true, opacity: 1 },
  hms_zones: { visible: false, opacity: 0.35 },
  enc: { visible: true, opacity: 0.32 },
  ais: { visible: false, opacity: 0.8 },
};

export const DEFAULT_BOAT: BoatLimits = {
  name: "Laughing One",
  cruiseKt: 21,
  trollKt: 7.4,
  maxWindKt: 24,
  maxWaveFt: 7,
  fuelGal: 420,
  gphCruise: 28,
  gphTroll: 12,
  reserveGal: 60,
};

export const DISPLAY_MODES: { id: DisplayMode; label: string }[] = [
  { id: "night", label: "Night bridge" },
  { id: "high-contrast", label: "High contrast" },
  { id: "pure-black", label: "Pure black" },
  { id: "day", label: "Daylight" },
];

export const FORECAST_HOURS = 72;
export const GRID_NX = 140;
export const GRID_NY = 96;
