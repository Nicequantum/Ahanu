/// Shared domain contract for Ahanu. Mirrors `src/lib/ahanu/types.ts`.
///
/// Wire values on enums match the TypeScript string unions exactly. Do not
/// substitute display names (`"Yellowfin tuna"`) for ids.
library;

/// Geographic position. Lat/lon in decimal degrees, WGS84.
class LatLon {
  const LatLon({required this.lat, required this.lon});

  final double lat;
  final double lon;

  @override
  bool operator ==(Object other) =>
      other is LatLon && other.lat == lat && other.lon == lon;

  @override
  int get hashCode => Object.hash(lat, lon);

  @override
  String toString() => 'LatLon($lat, $lon)';
}

/// HMS species ids. Wire strings match the TypeScript `SpeciesId` union.
enum SpeciesId {
  bigeye('bigeye'),
  yellowfin('yellowfin'),
  bluefin('bluefin'),
  mahi('mahi'),
  whiteMarlin('white_marlin'),
  blueMarlin('blue_marlin'),
  swordfish('swordfish'),
  albacore('albacore');

  const SpeciesId(this.wire);
  final String wire;

  static SpeciesId fromWire(String value) =>
      SpeciesId.values.firstWhere((e) => e.wire == value);
}

/// Map / pack layer ids. Wire strings match the TypeScript `LayerId` union.
enum LayerId {
  bathymetry('bathymetry'),
  contours('contours'),
  sst('sst'),
  chlorophyll('chlorophyll'),
  altimetry('altimetry'),
  tempBreaks('temp_breaks'),
  chlEdges('chl_edges'),
  habitat('habitat'),
  wind('wind'),
  waves('waves'),
  buoys('buoys'),
  spots('spots'),
  tracks('tracks'),
  routes('routes'),
  canyons('canyons'),
  hmsZones('hms_zones'),
  ais('ais');

  const LayerId(this.wire);
  final String wire;

  static LayerId fromWire(String value) =>
      LayerId.values.firstWhere((e) => e.wire == value);
}

/// Helm paint modes. Wire strings match TypeScript (`high-contrast`, `pure-black`).
enum DisplayMode {
  night('night'),
  highContrast('high-contrast'),
  pureBlack('pure-black'),
  day('day');

  const DisplayMode(this.wire);
  final String wire;

  static DisplayMode fromWire(String value) =>
      DisplayMode.values.firstWhere((e) => e.wire == value);
}

/// Go / caution / no-go against the skipper's [BoatLimits] and packed GRIB.
enum GoNoGo {
  go('go'),
  caution('caution'),
  noGo('no-go');

  const GoNoGo(this.wire);
  final String wire;

  static GoNoGo fromWire(String value) =>
      GoNoGo.values.firstWhere((e) => e.wire == value);
}

/// Open panel on the web shell. Dart uses `PanelId?` where TypeScript uses `| null`.
enum PanelId {
  layers('layers'),
  weather('weather'),
  intel('intel'),
  log('log'),
  knowledge('knowledge'),
  plan('plan'),
  safety('safety'),
  packs('packs'),
  species('species'),
  settings('settings'),
  solunar('solunar');

  const PanelId(this.wire);
  final String wire;

  static PanelId fromWire(String value) =>
      PanelId.values.firstWhere((e) => e.wire == value);
}

enum NavMode {
  trolling('trolling'),
  steaming('steaming'),
  gps('gps'),
  anchor('anchor');

  const NavMode(this.wire);
  final String wire;

  static NavMode fromWire(String value) =>
      NavMode.values.firstWhere((e) => e.wire == value);
}

class LayerState {
  const LayerState({required this.visible, required this.opacity});

  final bool visible;
  final double opacity;

  @override
  bool operator ==(Object other) =>
      other is LayerState &&
      other.visible == visible &&
      other.opacity == opacity;

  @override
  int get hashCode => Object.hash(visible, opacity);
}

class Waypoint {
  const Waypoint({
    required this.id,
    required this.name,
    required this.lat,
    required this.lon,
    this.depthM,
    this.notes,
    this.tags,
    required this.createdAt,
    this.color,
  });

  final String id;
  final String name;
  final double lat;
  final double lon;
  final double? depthM;
  final String? notes;
  final List<String>? tags;
  final String createdAt;
  final String? color;

  @override
  bool operator ==(Object other) =>
      other is Waypoint &&
      other.id == id &&
      other.name == name &&
      other.lat == lat &&
      other.lon == lon &&
      other.depthM == depthM &&
      other.notes == notes &&
      _listEq(other.tags, tags) &&
      other.createdAt == createdAt &&
      other.color == color;

  @override
  int get hashCode => Object.hash(
        id,
        name,
        lat,
        lon,
        depthM,
        notes,
        tags == null ? null : Object.hashAll(tags!),
        createdAt,
        color,
      );
}

class RouteLeg {
  const RouteLeg({
    required this.id,
    required this.name,
    required this.waypoints,
    required this.nm,
  });

  final String id;
  final String name;
  final List<LatLon> waypoints;
  final double nm;

  @override
  bool operator ==(Object other) =>
      other is RouteLeg &&
      other.id == id &&
      other.name == name &&
      _listEq(other.waypoints, waypoints) &&
      other.nm == nm;

  @override
  int get hashCode => Object.hash(id, name, Object.hashAll(waypoints), nm);
}

class CatchRecord {
  const CatchRecord({
    required this.id,
    this.userId,
    required this.species,
    required this.lat,
    required this.lon,
    required this.at,
    this.lengthIn,
    this.weightLb,
    required this.released,
    this.photoDataUrl,
    this.notes,
    this.sstC,
    this.depthM,
    this.conditions,
    this.synced,
  });

  final String id;
  final String? userId;
  final SpeciesId species;
  final double lat;
  final double lon;
  final String at;
  final double? lengthIn;
  final double? weightLb;
  final bool released;
  final String? photoDataUrl;
  final String? notes;
  final double? sstC;
  final double? depthM;
  final String? conditions;
  final bool? synced;

  @override
  bool operator ==(Object other) =>
      other is CatchRecord &&
      other.id == id &&
      other.userId == userId &&
      other.species == species &&
      other.lat == lat &&
      other.lon == lon &&
      other.at == at &&
      other.lengthIn == lengthIn &&
      other.weightLb == weightLb &&
      other.released == released &&
      other.photoDataUrl == photoDataUrl &&
      other.notes == notes &&
      other.sstC == sstC &&
      other.depthM == depthM &&
      other.conditions == conditions &&
      other.synced == synced;

  @override
  int get hashCode => Object.hash(
        id,
        userId,
        species,
        lat,
        lon,
        at,
        lengthIn,
        weightLb,
        released,
        photoDataUrl,
        notes,
        sstC,
        depthM,
        conditions,
        synced,
      );
}

class Canyon {
  const Canyon({
    required this.id,
    required this.name,
    required this.head,
    required this.axis,
    required this.headDepthM,
    required this.maxDepthM,
    required this.notes,
    required this.fromRiNm,
  });

  final String id;
  final String name;
  final LatLon head;
  final List<LatLon> axis;
  final double headDepthM;
  final double maxDepthM;
  final String notes;
  final double fromRiNm;

  @override
  bool operator ==(Object other) =>
      other is Canyon &&
      other.id == id &&
      other.name == name &&
      other.head == head &&
      _listEq(other.axis, axis) &&
      other.headDepthM == headDepthM &&
      other.maxDepthM == maxDepthM &&
      other.notes == notes &&
      other.fromRiNm == fromRiNm;

  @override
  int get hashCode => Object.hash(
        id,
        name,
        head,
        Object.hashAll(axis),
        headDepthM,
        maxDepthM,
        notes,
        fromRiNm,
      );
}

class Buoy {
  const Buoy({
    required this.id,
    required this.name,
    required this.lat,
    required this.lon,
    required this.windKt,
    required this.windDir,
    required this.gustKt,
    required this.waveFt,
    required this.periodS,
    required this.sstC,
    required this.pressureMb,
    required this.updatedAt,
  });

  final String id;
  final String name;
  final double lat;
  final double lon;
  final double windKt;
  final double windDir;
  final double gustKt;
  final double waveFt;
  final double periodS;
  final double sstC;
  final double pressureMb;
  final String updatedAt;

  @override
  bool operator ==(Object other) =>
      other is Buoy &&
      other.id == id &&
      other.name == name &&
      other.lat == lat &&
      other.lon == lon &&
      other.windKt == windKt &&
      other.windDir == windDir &&
      other.gustKt == gustKt &&
      other.waveFt == waveFt &&
      other.periodS == periodS &&
      other.sstC == sstC &&
      other.pressureMb == pressureMb &&
      other.updatedAt == updatedAt;

  @override
  int get hashCode => Object.hash(
        id,
        name,
        lat,
        lon,
        windKt,
        windDir,
        gustKt,
        waveFt,
        periodS,
        sstC,
        pressureMb,
        updatedAt,
      );
}

class SpeciesProfile {
  const SpeciesProfile({
    required this.id,
    required this.common,
    required this.scientific,
    required this.sstMinC,
    required this.sstMaxC,
    required this.sstPrefC,
    required this.depthMinM,
    required this.depthMaxM,
    required this.likesBreaks,
    required this.likesChlEdge,
    required this.likesWeed,
    required this.nightBonus,
    required this.tactics,
    required this.idNotes,
  });

  final SpeciesId id;
  final String common;
  final String scientific;
  final double sstMinC;
  final double sstMaxC;

  /// Preferred SST window `[min, max]` °C. Length 2, matching TypeScript `[number, number]`.
  final List<double> sstPrefC;
  final double depthMinM;
  final double depthMaxM;
  final bool likesBreaks;
  final bool likesChlEdge;
  final bool likesWeed;
  final double nightBonus;
  final String tactics;
  final String idNotes;
}

/// Knowledge-article category. Wire value `reading-water` is [readingWater].
enum KnowledgeCategory {
  canyon('canyon'),
  trolling('trolling'),
  bait('bait'),
  night('night'),
  weather('weather'),
  safety('safety'),
  readingWater('reading-water'),
  species('species');

  const KnowledgeCategory(this.wire);
  final String wire;

  static KnowledgeCategory fromWire(String value) =>
      KnowledgeCategory.values.firstWhere((e) => e.wire == value);
}

class KnowledgeArticle {
  const KnowledgeArticle({
    required this.id,
    required this.title,
    required this.category,
    required this.minutes,
    required this.body,
    required this.tags,
  });

  final String id;
  final String title;
  final KnowledgeCategory category;
  final int minutes;
  final String body;
  final List<String> tags;
}

class CommunityReport {
  const CommunityReport({
    required this.id,
    required this.who,
    required this.species,
    required this.lat,
    required this.lon,
    required this.at,
    required this.note,
    this.size,
  });

  final String id;
  final String who;
  final SpeciesId species;
  final double lat;
  final double lon;
  final String at;
  final String note;
  final String? size;
}

/// Per-layer status inside a trip-pack manifest (distinct from [PackStatus]).
enum TripPackLayerStatus {
  ready('ready'),
  stale('stale'),
  missing('missing'),
  downloading('downloading');

  const TripPackLayerStatus(this.wire);
  final String wire;

  static TripPackLayerStatus fromWire(String value) =>
      TripPackLayerStatus.values.firstWhere((e) => e.wire == value);
}

class TripPackLayer {
  const TripPackLayer({
    required this.id,
    required this.label,
    required this.sizeMb,
    required this.status,
    required this.updatedAt,
    required this.hours,
  });

  final String id;
  final String label;
  final double sizeMb;
  final TripPackLayerStatus status;
  final String updatedAt;
  final double hours;
}

class FloatPlan {
  const FloatPlan({
    required this.skipper,
    required this.vessel,
    required this.departure,
    required this.returnEta,
    required this.souls,
    required this.route,
    required this.contacts,
    required this.radio,
    required this.notes,
  });

  final String skipper;
  final String vessel;
  final String departure;
  final String returnEta;
  final int souls;
  final String route;
  final String contacts;
  final String radio;
  final String notes;
}

class EmergencyContact {
  const EmergencyContact({
    required this.id,
    required this.name,
    required this.role,
    required this.phone,
  });

  final String id;
  final String name;
  final String role;
  final String phone;
}

class VesselState {
  const VesselState({
    required this.lat,
    required this.lon,
    required this.cog,
    required this.sog,
    required this.heading,
    required this.depthM,
    required this.mode,
    required this.simulating,
    required this.anchored,
    this.anchor,
    required this.anchorRadiusM,
  });

  final double lat;
  final double lon;
  final double cog;
  final double sog;
  final double heading;
  final double depthM;
  final NavMode mode;
  final bool simulating;
  final bool anchored;
  final LatLon? anchor;
  final double anchorRadiusM;
}

class BoatLimits {
  const BoatLimits({
    required this.name,
    required this.cruiseKt,
    required this.trollKt,
    required this.maxWindKt,
    required this.maxWaveFt,
    required this.fuelGal,
    required this.gphCruise,
    required this.gphTroll,
    required this.reserveGal,
  });

  final String name;
  final double cruiseKt;
  final double trollKt;
  final double maxWindKt;
  final double maxWaveFt;
  final double fuelGal;
  final double gphCruise;
  final double gphTroll;
  final double reserveGal;

  @override
  bool operator ==(Object other) =>
      other is BoatLimits &&
      other.name == name &&
      other.cruiseKt == cruiseKt &&
      other.trollKt == trollKt &&
      other.maxWindKt == maxWindKt &&
      other.maxWaveFt == maxWaveFt &&
      other.fuelGal == fuelGal &&
      other.gphCruise == gphCruise &&
      other.gphTroll == gphTroll &&
      other.reserveGal == reserveGal;

  @override
  int get hashCode => Object.hash(
        name,
        cruiseKt,
        trollKt,
        maxWindKt,
        maxWaveFt,
        fuelGal,
        gphCruise,
        gphTroll,
        reserveGal,
      );
}

class MeasureState {
  const MeasureState({required this.active, required this.points});

  final bool active;
  final List<LatLon> points;
}

class ForecastHour {
  const ForecastHour({
    required this.hour,
    required this.windKt,
    required this.windDir,
    required this.gustKt,
    required this.waveFt,
    required this.swellFt,
    required this.swellDir,
    required this.periodS,
    required this.pressureMb,
    required this.precipMm,
    required this.visNm,
    required this.go,
  });

  final int hour;
  final double windKt;
  final double windDir;
  final double gustKt;
  final double waveFt;
  final double swellFt;
  final double swellDir;
  final double periodS;
  final double pressureMb;
  final double precipMm;
  final double visNm;
  final GoNoGo go;
}

/// Whole-pack readiness (distinct from [TripPackLayerStatus]).
enum PackStatus {
  ready('ready'),
  partial('partial'),
  offline('offline');

  const PackStatus(this.wire);
  final String wire;

  static PackStatus fromWire(String value) =>
      PackStatus.values.firstWhere((e) => e.wire == value);
}

bool _listEq<T>(List<T>? a, List<T>? b) {
  if (identical(a, b)) return true;
  if (a == null || b == null || a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}
