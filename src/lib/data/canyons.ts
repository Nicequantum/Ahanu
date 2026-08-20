import { POINT_JUDITH } from "@/lib/ahanu/constants";
import { destination, haversineNm } from "@/lib/ahanu/geo";
import type { Canyon, LatLon } from "@/lib/ahanu/types";

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

function dest(start: LatLon, brg: number, nm: number): LatLon {
  const p = destination(start, brg, nm);
  return { lat: round5(p.lat), lon: round5(p.lon) };
}

/** Axis from the head seaward, distances in nautical miles along `brg`. */
function canyon(
  id: string,
  name: string,
  head: LatLon,
  brg: number,
  headDepthM: number,
  maxDepthM: number,
  notes: string,
  axisNm: number[],
): Canyon {
  return {
    id,
    name,
    head,
    axis: axisNm.map((nm) => dest(head, brg, nm)),
    headDepthM,
    maxDepthM,
    notes,
    fromRiNm: Math.round(haversineNm(POINT_JUDITH, head) * 10) / 10,
  };
}

export const CANYONS: Canyon[] = [
  canyon(
    "hudson",
    "Hudson",
    { lat: 39.55, lon: -72.4 },
    145,
    110,
    3500,
    "Largest canyon on the U.S. Atlantic margin. North wall 85–120 fathom fishes yellowfin by day; the 300–500 fathom dump is the overnight bigeye program shared by Montauk and Point Judith.",
    [0, 7, 15, 25, 38, 52, 68],
  ),
  canyon(
    "toms",
    "Toms",
    { lat: 39.15, lon: -72.78 },
    148,
    120,
    2800,
    "Next hole south of Hudson, mostly a Jersey and Cape May stop. West wall holds mahi on weed and yellowfin when 72-degree water parks on the 100s.",
    [0, 6, 14, 24, 36],
  ),
  canyon(
    "block",
    "Block",
    { lat: 39.87, lon: -71.55 },
    150,
    105,
    2600,
    "The close one for Rhode Island — about 90 nm from Galilee. Steep west wall, honest 95–110 fathom trolling, and it fills up on a Saturday weather window.",
    [0, 5, 12, 22, 34, 48],
  ),
  canyon(
    "clipper",
    "Clipper",
    { lat: 39.78, lon: -71.88 },
    152,
    100,
    2200,
    "Narrow slot and a few lumps between Block and Fish Tales. Night bigeye when 22-degree water sits on the 105; skip it if the fleet is already stacked in Block.",
    [0, 5, 12, 22, 32],
  ),
  canyon(
    "fish-tales",
    "Fish Tales",
    { lat: 39.72, lon: -72.05 },
    150,
    100,
    2400,
    "Broken ground and a shallow head west of Block. Captains mark bait and temp, not the chart label — yellowfin and the odd eye when Hudson is blown out.",
    [0, 5, 12, 22, 34],
  ),
  canyon(
    "alvin",
    "Alvin",
    { lat: 39.88, lon: -70.5 },
    155,
    110,
    2700,
    "Quiet sister west of Atlantis, named for the WHOI submersible. Same 100-fathom troll with fewer boats on a weekday, and a clean 200-fathom night dump.",
    [0, 6, 14, 24, 36, 50],
  ),
  canyon(
    "atlantis",
    "Atlantis",
    { lat: 39.85, lon: -70.22 },
    156,
    100,
    2900,
    "The Rhode Island home canyon. West wall at first light on 100–110 fathom, then slide to the 200 if the eyes want depth. Temperature breaks stall here more often than they should.",
    [0, 6, 13, 22, 34, 48],
  ),
  canyon(
    "veatch",
    "Veatch",
    { lat: 39.9, lon: -69.62 },
    158,
    100,
    3100,
    "The 120-mile dream and Ahanu's home water. West wall 105-fathom ledge is legendary for bigeye; overnight dump-and-wind along the south finger. Persistent eddies make this a two-night commitment.",
    [0, 6, 13, 22, 34, 48, 62],
  ),
  canyon(
    "hydrographer",
    "Hydrographer",
    { lat: 40.15, lon: -69.0 },
    160,
    105,
    3000,
    "A little farther, a little lonelier. The 100-fathom corner is a yellowfin magnet when a warm-core filament wraps the head; white marlin show in August on the edge.",
    [0, 6, 14, 24, 36, 50],
  ),
  canyon(
    "welker",
    "Welker",
    { lat: 40.25, lon: -68.52 },
    162,
    110,
    2800,
    "The slide between Hydrographer and Oceanographer. Fish it when the break walks east — a 105-fathom stop for yellowfin and mahi on the way to monument country.",
    [0, 6, 14, 24, 36],
  ),
  canyon(
    "oceanographer",
    "Oceanographer",
    { lat: 40.42, lon: -68.12 },
    165,
    120,
    3800,
    "Far-east monument country, a 160 nm steam from Galilee. Steep walls, upwelling, and Gulf Stream ring water — blue-marlin territory when 78-degree water sits on the 100. Know the closed area.",
    [0, 6, 14, 24, 36, 50, 66],
  ),
  canyon(
    "gilbert",
    "Gilbert",
    { lat: 40.38, lon: -67.85 },
    166,
    130,
    3300,
    "Just east of Oceanographer, inside the Canyons Unit of the Northeast Canyons and Seamounts monument. Outstanding structure — check the regs before you wet a line.",
    [0, 6, 14, 24, 38],
  ),
  canyon(
    "lydonia",
    "Lydonia",
    { lat: 40.52, lon: -67.67 },
    168,
    130,
    3500,
    "Easternmost of the working canyon chain from Rhode Island. Georges influence on the north side, tropicals on the south wall, and a fuel decision you make the night before.",
    [0, 6, 14, 24, 36, 50],
  ),
  canyon(
    "wilmington",
    "Wilmington",
    { lat: 38.42, lon: -73.58 },
    140,
    110,
    3200,
    "Mid-Atlantic classic out of Ocean City and Cape May. August is white marlin and mahi on the 100-fathom curve; yellowfin when a break hangs on the west wall.",
    [0, 6, 14, 26, 40],
  ),
  canyon(
    "baltimore",
    "Baltimore",
    { lat: 38.15, lon: -73.85 },
    138,
    110,
    3000,
    "South of Wilmington and a white-marlin factory when the 76-degree edge sits right. Longer steam from Galilee — more Ocean City than Point Judith, but the water is real.",
    [0, 6, 14, 26, 40],
  ),
  canyon(
    "norfolk",
    "Norfolk",
    { lat: 36.97, lon: -74.65 },
    135,
    100,
    2900,
    "Southern end of the canyon chain, stronger Gulf Stream influence and a different weather picture. Swordfish, yellowfin, and white marlin — a long way from Rhode Island.",
    [0, 6, 14, 26, 40, 55],
  ),
];

export const CANYON_HEADS: Record<string, LatLon> = Object.fromEntries(
  CANYONS.map((c) => [c.id, c.head]),
);

export function nearestCanyon(p: LatLon): Canyon {
  let best = CANYONS[0]!;
  let bestNm = Infinity;
  for (const c of CANYONS) {
    const n = haversineNm(p, c.head);
    if (n < bestNm) {
      bestNm = n;
      best = c;
    }
  }
  return best;
}
