/// Habitat weight contract. Mirrors `src/lib/ahanu/scoring.ts`.
///
/// The TypeScript `habitatScore` consumes on-device ocean rasters (SST,
/// chlorophyll, bathymetry) plus solunar and a small historical table. This
/// package does **not** reimplement that scorer: without packed rasters a
/// numeric score would be a fake. The Flutter helm (Phase 4) must apply these
/// weights to real pack bytes, on device. Cloudflare Workers must not score.
///
/// Standard mix (sums to 1.00):
///
/// | Term | Weight |
/// | --- | --- |
/// | SST fit | 0.30 |
/// | Temperature gradient / breaks | 0.18 |
/// | Structure (depth band, canyon head, 100-fm, wall) | 0.22 |
/// | Chlorophyll edge / weed | 0.12 |
/// | Solunar | 0.08 |
/// | Historical cells | 0.10 |
///
/// The TS scorer injects a caller-supplied historical weight `histW` (default
/// 0.10, clamped 0–0.40) and renormalizes the other five by their sum 0.90:
/// `rest * (termWeight / 0.9)` where `rest = 1 - histW`. Dart callers that
/// later port the scorer must keep that renormalization.
library;

/// Contract weights for on-device habitat scoring.
class HabitatWeights {
  const HabitatWeights({
    this.sst = 0.30,
    this.gradient = 0.18,
    this.structure = 0.22,
    this.chlorophyll = 0.12,
    this.solunar = 0.08,
    this.historical = 0.10,
  });

  /// Published mix. SST 0.30, gradient 0.18, structure 0.22, chl 0.12,
  /// solunar 0.08, historical 0.10.
  static const standard = HabitatWeights();

  final double sst;
  final double gradient;
  final double structure;
  final double chlorophyll;
  final double solunar;
  final double historical;

  /// Sum of the five non-historical terms (0.90 in the standard contract).
  double get nonHistoricalSum =>
      sst + gradient + structure + chlorophyll + solunar;

  /// Coefficient applied to a non-historical term after injecting historical
  /// weight. Matches `rest * (weight / 0.9)` in TypeScript `habitatScore`.
  double restShare(double weight, {double? historicalWeight}) {
    final histW = (historicalWeight ?? historical).clamp(0.0, 0.4);
    final rest = 1.0 - histW;
    return rest * (weight / nonHistoricalSum);
  }
}

/// Zone labels used by the TypeScript briefing. Thresholds are part of the
/// contract; they do not require rasters.
enum HabitatZone {
  fire('Fire'),
  warm('Warm'),
  worthALook('Worth a look'),
  cold('Cold');

  const HabitatZone(this.label);
  final String label;
}

/// Fire ≥ 78, Warm ≥ 62, Worth a look ≥ 45, else Cold.
HabitatZone zoneLabel(num score) {
  if (score >= 78) return HabitatZone.fire;
  if (score >= 62) return HabitatZone.warm;
  if (score >= 45) return HabitatZone.worthALook;
  return HabitatZone.cold;
}

/// Night window used by the TS scorer: hour ≥ 20 or hour < 6 (local clock).
bool isNightHour(num hour) {
  final h = ((hour % 24) + 24) % 24;
  return h >= 20 || h < 6;
}
