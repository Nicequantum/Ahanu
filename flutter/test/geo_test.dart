import 'package:ahanu_domain/ahanu_domain.dart';
import 'package:test/test.dart';

void main() {
  test('haversine Point Judith to Veatch Head is 120–140 nm', () {
    final nm = haversineNm(POINT_JUDITH, VEATCH_HEAD);
    expect(nm, inInclusiveRange(120, 140));
    // Same formula as geo.ts (R_NM = 3440.065). Fixture ~122.03 nm.
    expect(nm, closeTo(122.03, 0.05));
  });

  test('initial bearing Point Judith to Veatch is southeast', () {
    final deg = initialBearing(POINT_JUDITH, VEATCH_HEAD);
    expect(deg, closeTo(135.36, 0.05));
    expect(compass(deg), 'SE');
  });

  test('destination along that bearing lands on Veatch Head', () {
    final nm = haversineNm(POINT_JUDITH, VEATCH_HEAD);
    final brg = initialBearing(POINT_JUDITH, VEATCH_HEAD);
    final dest = destination(POINT_JUDITH, brg, nm);
    expect(dest.lat, closeTo(VEATCH_HEAD.lat, 1e-6));
    expect(dest.lon, closeTo(VEATCH_HEAD.lon, 1e-6));
  });

  test('100 fathoms is 182.88 metres', () {
    expect(metersToFathoms(182.88), closeTo(100, 1e-6));
  });

  test('DEFAULT_BOAT is Laughing One with the published limits', () {
    expect(DEFAULT_BOAT.name, 'Laughing One');
    expect(DEFAULT_BOAT.cruiseKt, 21);
    expect(DEFAULT_BOAT.trollKt, 7.4);
    expect(DEFAULT_BOAT.fuelGal, 420);
    expect(DEFAULT_BOAT.gphCruise, 28);
    expect(DEFAULT_BOAT.gphTroll, 12);
    expect(DEFAULT_BOAT.reserveGal, 60);
    expect(DEFAULT_BOAT.maxWindKt, 24);
    expect(DEFAULT_BOAT.maxWaveFt, 7);
  });
}
