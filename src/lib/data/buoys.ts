import type { Buoy } from "@/lib/ahanu/types";

const SNAPSHOT = "2026-08-20T12:00:00Z";

/** August 20 1200Z snapshot — SW-SSW Bermuda-high flow, 2–6 ft, 18–26 °C SST. */
export const BUOYS: Buoy[] = [
  {
    id: "44017",
    name: "Montauk Point",
    lat: 40.693,
    lon: -72.049,
    windKt: 12.0,
    windDir: 210,
    gustKt: 15.0,
    waveFt: 3.5,
    periodS: 7.0,
    sstC: 21.4,
    pressureMb: 1016.2,
    updatedAt: SNAPSHOT,
  },
  {
    id: "44025",
    name: "Long Island",
    lat: 40.258,
    lon: -73.175,
    windKt: 11.0,
    windDir: 215,
    gustKt: 14.0,
    waveFt: 3.2,
    periodS: 6.0,
    sstC: 22.1,
    pressureMb: 1016.8,
    updatedAt: SNAPSHOT,
  },
  {
    id: "44008",
    name: "Nantucket",
    lat: 40.5,
    lon: -69.254,
    windKt: 14.0,
    windDir: 205,
    gustKt: 18.0,
    waveFt: 4.8,
    periodS: 8.0,
    sstC: 20.6,
    pressureMb: 1015.4,
    updatedAt: SNAPSHOT,
  },
  {
    id: "44066",
    name: "Texas Tower / Hudson",
    lat: 39.618,
    lon: -72.644,
    windKt: 16.0,
    windDir: 200,
    gustKt: 20.0,
    waveFt: 5.5,
    periodS: 8.0,
    sstC: 23.8,
    pressureMb: 1015.1,
    updatedAt: SNAPSHOT,
  },
  {
    id: "44097",
    name: "Block Island",
    lat: 40.967,
    lon: -71.124,
    windKt: 10.0,
    windDir: 220,
    gustKt: 13.0,
    waveFt: 2.8,
    periodS: 6.0,
    sstC: 21.8,
    pressureMb: 1016.5,
    updatedAt: SNAPSHOT,
  },
  {
    id: "44020",
    name: "Nantucket Sound",
    lat: 41.497,
    lon: -70.283,
    windKt: 8.0,
    windDir: 230,
    gustKt: 11.0,
    waveFt: 2.0,
    periodS: 5.0,
    sstC: 22.8,
    pressureMb: 1017.2,
    updatedAt: SNAPSHOT,
  },
  {
    id: "44018",
    name: "Cape Cod",
    lat: 42.203,
    lon: -70.154,
    windKt: 11.0,
    windDir: 225,
    gustKt: 14.0,
    waveFt: 2.6,
    periodS: 6.0,
    sstC: 19.4,
    pressureMb: 1017.0,
    updatedAt: SNAPSHOT,
  },
  {
    id: "44011",
    name: "Georges Bank",
    lat: 41.088,
    lon: -66.546,
    windKt: 15.0,
    windDir: 195,
    gustKt: 19.0,
    waveFt: 5.8,
    periodS: 9.0,
    sstC: 18.2,
    pressureMb: 1014.6,
    updatedAt: SNAPSHOT,
  },
  {
    id: "44065",
    name: "NY Harbor Entrance",
    lat: 40.368,
    lon: -73.701,
    windKt: 9.0,
    windDir: 215,
    gustKt: 12.0,
    waveFt: 2.4,
    periodS: 5.0,
    sstC: 23.2,
    pressureMb: 1017.4,
    updatedAt: SNAPSHOT,
  },
  {
    id: "44009",
    name: "Delaware Bay",
    lat: 38.46,
    lon: -74.692,
    windKt: 13.0,
    windDir: 210,
    gustKt: 16.0,
    waveFt: 4.0,
    periodS: 7.0,
    sstC: 24.6,
    pressureMb: 1016.0,
    updatedAt: SNAPSHOT,
  },
  {
    id: "44014",
    name: "Virginia Beach",
    lat: 36.603,
    lon: -74.837,
    windKt: 14.0,
    windDir: 200,
    gustKt: 18.0,
    waveFt: 4.5,
    periodS: 8.0,
    sstC: 25.8,
    pressureMb: 1015.8,
    updatedAt: SNAPSHOT,
  },
  {
    id: "44091",
    name: "Barnegat",
    lat: 39.772,
    lon: -73.769,
    windKt: 12.0,
    windDir: 218,
    gustKt: 15.0,
    waveFt: 3.4,
    periodS: 6.0,
    sstC: 23.4,
    pressureMb: 1016.4,
    updatedAt: SNAPSHOT,
  },
];

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function isoHoursAfter(iso: string, hour: number): string {
  const ms = Date.parse(iso) + hour * 3_600_000;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Inshore / sound buoys do not feel the full open-ocean sea. */
function exposure(id: string): number {
  switch (id) {
    case "44020":
      return 0.4;
    case "44065":
      return 0.5;
    case "44018":
      return 0.6;
    case "44097":
      return 0.75;
    case "44091":
      return 0.8;
    default:
      return 1;
  }
}

/**
 * Snapshot plus a cold front crossing west-to-east, passage near hour 36
 * on 71°W. Western buoys see it first; waves and wind peak on the front,
 * then the breeze veers WNW and the sea settles.
 */
export function buoyAtHour(id: string, hour: number): Buoy {
  const base = BUOYS.find((b) => b.id === id);
  if (!base) throw new Error(`Unknown buoy ${id}`);
  const h = clamp(hour, 0, 72);
  const exp = exposure(id);

  // ~20 kt ENE motion. Passage at hour 36 on 71W; ~2.4 h per degree of longitude.
  const passage = 36 + (base.lon + 71) * 2.4;
  const dt = h - passage;
  const frontBump = Math.exp(-0.5 * (dt / 7) ** 2);
  const swell = Math.sin((h + 3) / 7) * 0.35;

  const windKt = clamp(
    base.windKt + frontBump * 8 * exp + swell * 0.8 - (dt > 14 ? 1.8 : 0),
    6,
    28,
  );

  let windDir: number;
  if (dt < -10) windDir = 205 + Math.sin(h / 8) * 8;
  else if (dt < 0) windDir = 205 + ((dt + 10) / 10) * 30;
  else if (dt < 12) windDir = 235 + (dt / 12) * 70;
  else windDir = 305 - Math.min(1, (dt - 12) / 24) * 85;
  windDir = ((windDir % 360) + 360) % 360;

  const gustKt = windKt + 3 + frontBump * 5 * exp;
  const waveFt = clamp(base.waveFt + frontBump * 3.6 * exp + swell, 1.4, 10);
  const periodS = clamp(base.periodS + frontBump * 2.2 * exp, 4.5, 12);
  const pressureMb = clamp(
    base.pressureMb - frontBump * 8 + (dt > 0 ? Math.min(dt, 18) * 0.16 : 0),
    1004,
    1024,
  );
  const sstC = clamp(base.sstC - (dt > 0 ? Math.min(dt, 24) * 0.03 : 0), 16, 27);

  return {
    ...base,
    windKt: round1(windKt),
    windDir: Math.round(windDir),
    gustKt: round1(gustKt),
    waveFt: round1(waveFt),
    periodS: round1(periodS),
    sstC: round1(sstC),
    pressureMb: round1(pressureMb),
    updatedAt: isoHoursAfter(SNAPSHOT, h),
  };
}
