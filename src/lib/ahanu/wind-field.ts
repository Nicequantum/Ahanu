import { gribAt, scoreGoNoGo } from "./grib";
import { DEFAULT_BOAT, POINT_JUDITH, REGION, VEATCH_HEAD } from "./constants";
import { isLand } from "./bathymetry";
import { destination } from "./geo";
import { getPackedOcean, packedGridFeatures } from "./packed-fields";

function emptyFc(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

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

/** Packed grid cells when present; empty if the pack is missing wind; else synthetic. */
export function windBarbGeo(hour: number): GeoJSON.FeatureCollection {
  const ocean = getPackedOcean();
  if (ocean?.windKt) {
    return packedGridFeatures(ocean.windKt, hour, (windKt, lat, lon) => {
      if (isLand(lat, lon)) return null;
      const g = gribAt(lat, lon, hour);
      return { windKt, windDir: g.windDir, gustKt: g.gustKt };
    });
  }
  if (ocean) return emptyFc();
  return grid(0.55, hour, (g) => ({
    windKt: g.windKt,
    windDir: g.windDir,
    gustKt: g.gustKt,
  }));
}

/** Packed wave cells when present; empty if the pack is missing waves; else synthetic. */
export function waveFieldGeo(hour: number): GeoJSON.FeatureCollection {
  const ocean = getPackedOcean();
  if (ocean?.waveFt) {
    return packedGridFeatures(ocean.waveFt, hour, (waveFt, lat, lon) => {
      if (isLand(lat, lon)) return null;
      const g = gribAt(lat, lon, hour);
      return {
        waveFt,
        periodS: g.periodS,
        swellFt: g.swellFt,
        swellDir: g.swellDir,
        go: scoreGoNoGo(g.windKt, waveFt, DEFAULT_BOAT),
      };
    });
  }
  if (ocean) return emptyFc();
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
