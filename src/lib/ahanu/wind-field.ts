import { gribAt, scoreGoNoGo } from "./grib";
import { DEFAULT_BOAT, POINT_JUDITH, REGION, VEATCH_HEAD } from "./constants";
import { isLand } from "./bathymetry";
import { destination } from "./geo";

function grid(
  step: number,
  hour: number,
  props: (g: ReturnType<typeof gribAt>) => Record<string, number | string>,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (let lat = REGION.south; lat <= REGION.north + 1e-9; lat += step) {
    for (let lon = REGION.west; lon <= REGION.east + 1e-9; lon += step) {
      if (isLand(lat, lon)) continue;
      const g = gribAt(lat, lon, hour);
      features.push({
        type: "Feature",
        properties: props(g),
        geometry: { type: "Point", coordinates: [lon, lat] },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

/** GRIB-sampled wind barbs ~0.55°; land skipped. */
export function windBarbGeo(hour: number): GeoJSON.FeatureCollection {
  return grid(0.55, hour, (g) => ({
    windKt: g.windKt,
    windDir: g.windDir,
    gustKt: g.gustKt,
  }));
}

/** Coarser ~0.7° wave field with go/no-go against DEFAULT_BOAT. */
export function waveFieldGeo(hour: number): GeoJSON.FeatureCollection {
  return grid(0.7, hour, (g) => ({
    waveFt: g.waveFt,
    periodS: g.periodS,
    swellFt: g.swellFt,
    swellDir: g.swellDir,
    go: scoreGoNoGo(g.windKt, g.waveFt, DEFAULT_BOAT),
  }));
}

/** Steam track Point Judith → mid-shelf waypoint → Veatch head. */
export function steamRouteGeo(): GeoJSON.FeatureCollection {
  const pts = [POINT_JUDITH, { lat: 40.55, lon: -70.85 }, VEATCH_HEAD];
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { kind: "steam" },
        geometry: {
          type: "LineString",
          coordinates: pts.map((p) => [p.lon, p.lat] as [number, number]),
        },
      },
    ],
  };
}

/** Regular polygon approximating a range or anchor ring. */
export function circleRingGeo(
  center: { lat: number; lon: number },
  radiusNm: number,
  n = 48,
): GeoJSON.FeatureCollection {
  const steps = Math.max(8, n);
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const p = destination(center, (360 * i) / steps, radiusNm);
    ring.push([p.lon, p.lat]);
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { radiusNm },
        geometry: { type: "Polygon", coordinates: [ring] },
      },
    ],
  };
}
