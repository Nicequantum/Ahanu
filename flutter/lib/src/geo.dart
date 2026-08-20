/// Nautical geometry. Same formulas as `src/lib/ahanu/geo.ts`.
///
/// Earth radius is **3440.065 nautical miles**. Distances returned by
/// [haversineNm] are nautical miles. Depth helpers convert metres.
library;

import 'dart:math' as math;

import 'constants.dart';
import 'types.dart';

/// Earth radius in nautical miles. Matches `R_NM` in `geo.ts`.
const earthRadiusNm = 3440.065;

double toRad(double d) => (d * math.pi) / 180;
double toDeg(double r) => (r * 180) / math.pi;

double haversineNm(LatLon a, LatLon b) {
  final dLat = toRad(b.lat - a.lat);
  final dLon = toRad(b.lon - a.lon);
  final s = math.sin(dLat / 2) * math.sin(dLat / 2) +
      math.cos(toRad(a.lat)) *
          math.cos(toRad(b.lat)) *
          math.sin(dLon / 2) *
          math.sin(dLon / 2);
  return 2 * earthRadiusNm * math.asin(math.min(1.0, math.sqrt(s)));
}

double initialBearing(LatLon a, LatLon b) {
  final y = math.sin(toRad(b.lon - a.lon)) * math.cos(toRad(b.lat));
  final x = math.cos(toRad(a.lat)) * math.sin(toRad(b.lat)) -
      math.sin(toRad(a.lat)) *
          math.cos(toRad(b.lat)) *
          math.cos(toRad(b.lon - a.lon));
  return (toDeg(math.atan2(y, x)) + 360) % 360;
}

LatLon destination(LatLon start, double bearingDeg, double nm) {
  final dR = nm / earthRadiusNm;
  final br = toRad(bearingDeg);
  final lat1 = toRad(start.lat);
  final lon1 = toRad(start.lon);
  final lat2 = math.asin(
    math.sin(lat1) * math.cos(dR) +
        math.cos(lat1) * math.sin(dR) * math.cos(br),
  );
  final lon2 = lon1 +
      math.atan2(
        math.sin(br) * math.sin(dR) * math.cos(lat1),
        math.cos(dR) - math.sin(lat1) * math.sin(lat2),
      );
  return LatLon(
    lat: toDeg(lat2),
    lon: ((toDeg(lon2) + 540) % 360) - 180,
  );
}

LatLon alongTrack(LatLon a, LatLon b, double t) {
  final nm = haversineNm(a, b);
  if (nm < 1e-6) return a;
  return destination(a, initialBearing(a, b), nm * t);
}

double pathLengthNm(List<LatLon> pts) {
  var n = 0.0;
  for (var i = 1; i < pts.length; i++) {
    n += haversineNm(pts[i - 1], pts[i]);
  }
  return n;
}

class PathSample {
  const PathSample({required this.pos, required this.cog});

  final LatLon pos;
  final double cog;
}

PathSample interpolatePath(List<LatLon> pts, double t) {
  if (pts.isEmpty) {
    return const PathSample(pos: LatLon(lat: 0, lon: 0), cog: 0);
  }
  if (pts.length == 1) return PathSample(pos: pts.first, cog: 0);
  final total = pathLengthNm(pts);
  var remain = t.clamp(0.0, 1.0) * total;
  for (var i = 1; i < pts.length; i++) {
    final a = pts[i - 1];
    final b = pts[i];
    final seg = haversineNm(a, b);
    if (remain <= seg || i == pts.length - 1) {
      final u = seg < 1e-6 ? 0.0 : remain / seg;
      return PathSample(pos: alongTrack(a, b, u), cog: initialBearing(a, b));
    }
    remain -= seg;
  }
  final last = pts.last;
  return PathSample(
    pos: last,
    cog: initialBearing(pts[pts.length - 2], last),
  );
}

LatLon nmToLatLonDelta(double lat, double dNmNorth, double dNmEast) {
  return LatLon(
    lat: dNmNorth / NM_PER_DEG_LAT,
    lon: dNmEast / (NM_PER_DEG_LAT * math.cos(toRad(lat))),
  );
}

String formatLat(double lat) {
  final hem = lat >= 0 ? 'N' : 'S';
  final a = lat.abs();
  final d = a.floor();
  final m = (a - d) * 60;
  return "$d°${m.toStringAsFixed(3).padLeft(6, '0')}'$hem";
}

String formatLon(double lon) {
  final hem = lon >= 0 ? 'E' : 'W';
  final a = lon.abs();
  final d = a.floor();
  final m = (a - d) * 60;
  return "$d°${m.toStringAsFixed(3).padLeft(6, '0')}'$hem";
}

String formatCoord(LatLon p) => '${formatLat(p.lat)}  ${formatLon(p.lon)}';

const _compassDirs = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];

String compass(double deg) {
  final idx = ((((deg % 360) + 360) % 360) / 22.5).round() % 16;
  return _compassDirs[idx];
}

double metersToFathoms(double m) => m / 1.8288;

double metersToFeet(double m) => m * 3.28084;

String hoursToHm(double h) {
  final s = math.max(0.0, h);
  final hh = s.floor();
  final mm = ((s - hh) * 60).round();
  return '${hh}h ${mm.toString().padLeft(2, '0')}m';
}

class MetresXY {
  const MetresXY({required this.x, required this.y});

  final double x;
  final double y;
}

MetresXY lonLatToXY(LatLon p, LatLon origin) {
  final dLat = p.lat - origin.lat;
  final dLon = p.lon - origin.lon;
  return MetresXY(
    x: dLon * NM_PER_DEG_LAT * math.cos(toRad(origin.lat)) * METERS_PER_NM,
    y: dLat * NM_PER_DEG_LAT * METERS_PER_NM,
  );
}
