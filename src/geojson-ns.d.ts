import type {
  Feature as GJFeature,
  FeatureCollection as GJFeatureCollection,
  Geometry as GJGeometry,
} from "geojson";

declare global {
  namespace GeoJSON {
    type Feature = GJFeature;
    type FeatureCollection = GJFeatureCollection;
    type Geometry = GJGeometry;
  }
}

export {};
