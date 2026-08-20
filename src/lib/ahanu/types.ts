/** Shared domain contract for Ahanu. All subsystems import from here. */

export type LatLon = { lat: number; lon: number };

export type SpeciesId =
  | "bigeye"
  | "yellowfin"
  | "bluefin"
  | "mahi"
  | "white_marlin"
  | "blue_marlin"
  | "swordfish"
  | "albacore";

export type LayerId =
  | "bathymetry"
  | "contours"
  | "sst"
  | "chlorophyll"
  | "altimetry"
  | "temp_breaks"
  | "chl_edges"
  | "habitat"
  | "wind"
  | "waves"
  | "buoys"
  | "spots"
  | "tracks"
  | "routes"
  | "canyons"
  | "hms_zones"
  | "ais";

export type DisplayMode = "night" | "high-contrast" | "pure-black" | "day";

export type GoNoGo = "go" | "caution" | "no-go";

export type PanelId =
  | "layers"
  | "weather"
  | "intel"
  | "log"
  | "knowledge"
  | "plan"
  | "safety"
  | "packs"
  | "species"
  | "settings"
  | "solunar"
  | null;

export type NavMode = "trolling" | "steaming" | "gps" | "anchor";

export interface LayerState {
  visible: boolean;
  opacity: number;
}

export interface Waypoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  depthM?: number;
  notes?: string;
  tags?: string[];
  createdAt: string;
  color?: string;
}

export interface RouteLeg {
  id: string;
  name: string;
  waypoints: LatLon[];
  nm: number;
}

export interface CatchRecord {
  id: string;
  userId?: string;
  species: SpeciesId;
  lat: number;
  lon: number;
  at: string;
  lengthIn?: number;
  weightLb?: number;
  released: boolean;
  photoDataUrl?: string;
  notes?: string;
  sstC?: number;
  depthM?: number;
  conditions?: string;
  synced?: boolean;
}

export interface Canyon {
  id: string;
  name: string;
  head: LatLon;
  axis: LatLon[];
  headDepthM: number;
  maxDepthM: number;
  notes: string;
  fromRiNm: number;
}

export interface Buoy {
  id: string;
  name: string;
  lat: number;
  lon: number;
  windKt: number;
  windDir: number;
  gustKt: number;
  waveFt: number;
  periodS: number;
  sstC: number;
  pressureMb: number;
  updatedAt: string;
}

export interface SpeciesProfile {
  id: SpeciesId;
  common: string;
  scientific: string;
  sstMinC: number;
  sstMaxC: number;
  sstPrefC: [number, number];
  depthMinM: number;
  depthMaxM: number;
  likesBreaks: boolean;
  likesChlEdge: boolean;
  likesWeed: boolean;
  nightBonus: number;
  tactics: string;
  idNotes: string;
}

export interface KnowledgeArticle {
  id: string;
  title: string;
  category:
    | "canyon"
    | "trolling"
    | "bait"
    | "night"
    | "weather"
    | "safety"
    | "reading-water"
    | "species";
  minutes: number;
  body: string;
  tags: string[];
}

export interface CommunityReport {
  id: string;
  who: string;
  species: SpeciesId;
  lat: number;
  lon: number;
  at: string;
  note: string;
  size?: string;
}

export interface TripPackLayer {
  id: string;
  label: string;
  sizeMb: number;
  status: "ready" | "stale" | "missing" | "downloading";
  updatedAt: string;
  hours: number;
}

export interface FloatPlan {
  skipper: string;
  vessel: string;
  departure: string;
  returnEta: string;
  souls: number;
  route: string;
  contacts: string;
  radio: string;
  notes: string;
}

export interface EmergencyContact {
  id: string;
  name: string;
  role: string;
  phone: string;
}

export interface VesselState {
  lat: number;
  lon: number;
  cog: number;
  sog: number;
  heading: number;
  depthM: number;
  mode: NavMode;
  simulating: boolean;
  anchored: boolean;
  anchor: LatLon | null;
  anchorRadiusM: number;
}

export interface BoatLimits {
  name: string;
  cruiseKt: number;
  trollKt: number;
  maxWindKt: number;
  maxWaveFt: number;
  fuelGal: number;
  gphCruise: number;
  gphTroll: number;
  reserveGal: number;
}

export interface MeasureState {
  active: boolean;
  points: LatLon[];
}

export interface ForecastHour {
  hour: number;
  windKt: number;
  windDir: number;
  gustKt: number;
  waveFt: number;
  swellFt: number;
  swellDir: number;
  periodS: number;
  pressureMb: number;
  precipMm: number;
  visNm: number;
  go: GoNoGo;
}

export type PackStatus = "ready" | "partial" | "offline";
