import { MONTAUK, NEWPORT, POINT_JUDITH } from "@/lib/ahanu/constants";
import type { LatLon } from "@/lib/ahanu/types";

export type HomePort = LatLon & { id: string; name: string; state: string };

export const PORTS: HomePort[] = [
  {
    id: "point-judith",
    name: "Point Judith",
    state: "RI",
    lat: POINT_JUDITH.lat,
    lon: POINT_JUDITH.lon,
  },
  {
    id: "newport",
    name: "Newport",
    state: "RI",
    lat: NEWPORT.lat,
    lon: NEWPORT.lon,
  },
  {
    id: "montauk",
    name: "Montauk",
    state: "NY",
    lat: MONTAUK.lat,
    lon: MONTAUK.lon,
  },
  {
    id: "new-bedford",
    name: "New Bedford",
    state: "MA",
    lat: 41.6355,
    lon: -70.923,
  },
  {
    id: "cape-may",
    name: "Cape May",
    state: "NJ",
    lat: 38.9486,
    lon: -74.891,
  },
  {
    id: "ocean-city-md",
    name: "Ocean City",
    state: "MD",
    lat: 38.331,
    lon: -75.1025,
  },
];
