/**
 * Re-export the shared fixture packer so Worker hashes match the PWA.
 * Production cron (run.ts) writes these — or live NOAA/CMEMS clips — to R2.
 */
export {
  generateLayerBody,
  sha256Hex,
  PACK_LAYER_SPECS,
  REQUIRED_OFFSHORE_LAYERS,
  specForLayer,
  clampBbox,
  cycleStamp,
  bboxKey,
  POINT_JUDITH_CANYON_BBOX,
  utf8Bytes,
} from "../../../src/lib/ahanu/pack-fixtures";
