/// Named positions, layer defaults, and vessel limits.
///
/// Mirrors `src/lib/ahanu/constants.ts`. Numbers are the contract: do not
/// silently change units.
library;

import 'types.dart';

/// Northeast U.S. shelf + canyon operating box.
class RegionBBox {
  const RegionBBox({
    required this.west,
    required this.east,
    required this.south,
    required this.north,
  });

  final double west;
  final double east;
  final double south;
  final double north;
}

const REGION = RegionBBox(
  west: -75.4,
  east: -66.4,
  south: 36.4,
  north: 42.6,
);

const POINT_JUDITH = LatLon(lat: 41.3615, lon: -71.4814);
const MONTAUK = LatLon(lat: 41.048, lon: -71.959);
const NEWPORT = LatLon(lat: 41.49, lon: -71.327);
const VEATCH_HEAD = LatLon(lat: 39.9, lon: -69.62);
const ATLANTIS_HEAD = LatLon(lat: 39.85, lon: -70.22);
const HYDRO_HEAD = LatLon(lat: 40.15, lon: -69.0);
const HUDSON_HEAD = LatLon(lat: 39.55, lon: -72.4);

const DEFAULT_CENTER = LatLon(lat: 39.92, lon: -69.85);
const DEFAULT_ZOOM = 7.35;

const NM_PER_DEG_LAT = 60.0;
const METERS_PER_NM = 1852.0;

const SPECIES_ORDER = <SpeciesId>[
  SpeciesId.bigeye,
  SpeciesId.yellowfin,
  SpeciesId.bluefin,
  SpeciesId.mahi,
  SpeciesId.whiteMarlin,
  SpeciesId.blueMarlin,
  SpeciesId.swordfish,
  SpeciesId.albacore,
];

enum LayerGroup { chart, ocean, weather, intel, ops }

class LayerMeta {
  const LayerMeta({required this.label, required this.group});

  final String label;
  final LayerGroup group;
}

const LAYER_META = <LayerId, LayerMeta>{
  LayerId.bathymetry: LayerMeta(label: 'Bathymetry', group: LayerGroup.chart),
  LayerId.contours: LayerMeta(label: 'Depth contours', group: LayerGroup.chart),
  LayerId.canyons: LayerMeta(label: 'Canyon labels', group: LayerGroup.chart),
  LayerId.sst: LayerMeta(label: 'Sea surface temp', group: LayerGroup.ocean),
  LayerId.chlorophyll: LayerMeta(label: 'Chlorophyll', group: LayerGroup.ocean),
  LayerId.altimetry: LayerMeta(label: 'SSH anomaly', group: LayerGroup.ocean),
  LayerId.tempBreaks:
      LayerMeta(label: 'Temperature breaks', group: LayerGroup.intel),
  LayerId.chlEdges: LayerMeta(label: 'Color edges', group: LayerGroup.intel),
  LayerId.habitat: LayerMeta(label: 'Habitat score', group: LayerGroup.intel),
  LayerId.wind: LayerMeta(label: 'Wind barbs', group: LayerGroup.weather),
  LayerId.waves: LayerMeta(label: 'Wave height', group: LayerGroup.weather),
  LayerId.buoys: LayerMeta(label: 'NDBC buoys', group: LayerGroup.weather),
  LayerId.spots: LayerMeta(label: 'Marks & spots', group: LayerGroup.ops),
  LayerId.tracks: LayerMeta(label: 'Track', group: LayerGroup.ops),
  LayerId.routes: LayerMeta(label: 'Routes', group: LayerGroup.ops),
  LayerId.hmsZones: LayerMeta(label: 'HMS closed areas', group: LayerGroup.ops),
  LayerId.ais: LayerMeta(label: 'AIS (gateway)', group: LayerGroup.ops),
};

const DEFAULT_LAYERS = <LayerId, LayerState>{
  LayerId.bathymetry: LayerState(visible: true, opacity: 0.92),
  LayerId.contours: LayerState(visible: true, opacity: 0.7),
  LayerId.canyons: LayerState(visible: true, opacity: 1),
  LayerId.sst: LayerState(visible: false, opacity: 0.55),
  LayerId.chlorophyll: LayerState(visible: false, opacity: 0.5),
  LayerId.altimetry: LayerState(visible: false, opacity: 0.45),
  LayerId.tempBreaks: LayerState(visible: true, opacity: 0.9),
  LayerId.chlEdges: LayerState(visible: false, opacity: 0.85),
  LayerId.habitat: LayerState(visible: true, opacity: 0.48),
  LayerId.wind: LayerState(visible: false, opacity: 0.85),
  LayerId.waves: LayerState(visible: false, opacity: 0.45),
  LayerId.buoys: LayerState(visible: true, opacity: 1),
  LayerId.spots: LayerState(visible: true, opacity: 1),
  LayerId.tracks: LayerState(visible: true, opacity: 0.9),
  LayerId.routes: LayerState(visible: true, opacity: 1),
  LayerId.hmsZones: LayerState(visible: false, opacity: 0.35),
  LayerId.ais: LayerState(visible: false, opacity: 0.8),
};

const DEFAULT_BOAT = BoatLimits(
  name: 'Laughing One',
  cruiseKt: 21,
  trollKt: 7.4,
  maxWindKt: 24,
  maxWaveFt: 7,
  fuelGal: 420,
  gphCruise: 28,
  gphTroll: 12,
  reserveGal: 60,
);

class DisplayModeOption {
  const DisplayModeOption({required this.id, required this.label});

  final DisplayMode id;
  final String label;
}

const DISPLAY_MODES = <DisplayModeOption>[
  DisplayModeOption(id: DisplayMode.night, label: 'Night bridge'),
  DisplayModeOption(id: DisplayMode.highContrast, label: 'High contrast'),
  DisplayModeOption(id: DisplayMode.pureBlack, label: 'Pure black'),
  DisplayModeOption(id: DisplayMode.day, label: 'Daylight'),
];

const FORECAST_HOURS = 72;
const GRID_NX = 140;
const GRID_NY = 96;
