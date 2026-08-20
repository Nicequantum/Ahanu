# ahanu_domain

Pure Dart domain package for Ahanu. This is the **domain stub**, not a running
app. There are no widgets, no MapLibre view, and no SQLite store in this
folder.

The **shipping client today is the web PWA**. The production mobile helm is
**planned**. Cloudflare is the **data plane**. Scoring stays **on-device**.

TypeScript in `src/lib/ahanu` is the spec. This package is the Dart port
(Flutter roadmap Option A). Failures are Dart bugs.

## What this package is

Ahanu is an offline-first marine OS for captains who run the Northeast canyons.
The helm that will consume this package is a Flutter application that:

- Paints the same `LayerId`s on **MapLibre GL native**.
- Stores trip packs in **SQLite** plus the documents directory.
- Downloads those packs from **Cloudflare R2** (`ahanu-trip-packs`) via the
  `ahanu-packs` Worker. Zero R2 egress. Not Vercel.
- Scores habitat, breaks, edges, solunar, and go/no-go **on the device**,
  against packed rasters and the skipper’s own `BoatLimits`.
- Reads `VesselState` from a future NMEA 2000 / Wi-Fi gateway.

None of that is built here. This package freezes the shared brain: types,
constants, nautical math, habitat weight contract, NMEA 0183 XOR checksum.

## Layout

| Path | Mirrors |
| --- | --- |
| `lib/src/types.dart` | `src/lib/ahanu/types.ts` |
| `lib/src/constants.dart` | `src/lib/ahanu/constants.ts` |
| `lib/src/geo.dart` | `src/lib/ahanu/geo.ts` (Earth radius 3440.065 nm) |
| `lib/src/scoring.dart` | Weight contract from `src/lib/ahanu/scoring.ts` |
| `lib/src/nmea.dart` | XOR checksum; spec is `src/lib/ahanu/nmea.ts` |

Habitat scoring is **not** faked. Ocean rasters live in a trip pack; without
them a numeric score would be fiction. `HabitatWeights` is the contract the
on-device scorer must honor when Phase 4 lands.

## Use as a path dependency

A future Flutter helm (not this repo’s job) would add:

```yaml
dependencies:
  ahanu_domain:
    path: packages/ahanu_domain
```

Then:

```dart
import 'package:ahanu_domain/ahanu_domain.dart';

final steamNm = haversineNm(POINT_JUDITH, VEATCH_HEAD);
final framed = nmeaFrame(r'GPGLL,4121.690,N,07128.884,W');
```

Trip-pack bytes still come from `GET /api/packs` on the Cloudflare Worker,
then R2 objects verified by hash. This package only knows the shapes
(`TripPackLayer`, `Buoy`, `CatchRecord`, …).

## Verify

```bash
dart test
```

The geo fixture includes Point Judith → Veatch Head in the 120–140 nm band,
using the same haversine as `geo.ts`.

## What this is not

- Not a Flutter application.
- Not MapLibre GL native, SQLite, or an NMEA gateway.
- Not a second ocean. Do not grow species lists or bboxes here that the
  TypeScript domain does not already own.
