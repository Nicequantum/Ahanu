/// NMEA 0183 XOR checksum.
///
/// TypeScript source of truth: `src/lib/ahanu/nmea.ts`. This Dart module is
/// the port of that design. When the TypeScript module lands or changes, this
/// file follows it; failures are Dart bugs.
///
/// The checksum is the exclusive-or of every character between the start
/// delimiter (`$` or `!`) and the `*` that precedes the two hex digits. The
/// `$`/`!`, `*`, and hex digits themselves are not included. Hex is uppercase
/// and zero-padded to two characters.
///
/// Ahanu does not talk to an NMEA 2000 backbone. A future Wi-Fi gateway
/// publishes JSON `VesselState`. These helpers cover 0183 sentences that
/// gateway may still emit.
library;

bool _hasStartDelim(String s) => s.startsWith(r'$') || s.startsWith('!');

/// XOR checksum of an NMEA 0183 payload, as two uppercase hex digits.
///
/// [sentence] may be a full framed sentence (`$GPGLL,...*HH`), a payload
/// (`GPGLL,...`), or a payload still wearing its `$`/`!`.
String nmeaChecksum(String sentence) {
  final payload = nmeaPayload(sentence);
  var cs = 0;
  for (final unit in payload.codeUnits) {
    cs ^= unit;
  }
  return cs.toRadixString(16).toUpperCase().padLeft(2, '0');
}

/// Characters that participate in the XOR (between delimiter and `*`).
String nmeaPayload(String sentence) {
  var s = sentence.trim().replaceAll(RegExp(r'[\r\n]+$'), '');
  if (_hasStartDelim(s)) s = s.substring(1);
  final star = s.indexOf('*');
  if (star >= 0) s = s.substring(0, star);
  return s;
}

/// True when [sentence] carries a `*HH` trailer that matches the XOR of its payload.
bool nmeaChecksumValid(String sentence) {
  final trimmed = sentence.trim().replaceAll(RegExp(r'[\r\n]+$'), '');
  final star = trimmed.lastIndexOf('*');
  if (star < 0 || star + 3 > trimmed.length) return false;
  final given = trimmed.substring(star + 1, star + 3).toUpperCase();
  return given == nmeaChecksum(trimmed);
}

/// Frame [payload] as `$payload*HH`. Strips an existing delimiter or checksum.
String nmeaFrame(String payload) {
  final body = nmeaPayload(payload);
  return '\$$body*${nmeaChecksum(body)}';
}
