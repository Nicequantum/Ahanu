/// Shared domain contract for Ahanu.
///
/// TypeScript in `src/lib/ahanu` remains the spec. This library is the Dart
/// port so a future Flutter helm can share types with the shipping web PWA.
/// Production bytes still come from Cloudflare. Scoring stays on-device.
library;

export 'src/constants.dart';
export 'src/geo.dart';
export 'src/nmea.dart';
export 'src/scoring.dart';
export 'src/types.dart';
