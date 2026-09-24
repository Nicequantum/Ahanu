/**
 * Yacht Devices YDEG-04 translation notes. This is not a guess at unpublished bytes.
 *
 * Compatibility, quoted from Yacht Devices U.S. (https://yachtdevicesus.com/products/engine-gateway-ydeg-04):
 * incompatible — "All mechanically controlled / analog engines."
 * incompatible — "Gasoline electronically controlled engines with MEFI1, 2, 3, or 4 ECUs."
 * incompatible — "Mercury SmartCraft engines with ECM555 / PCM555 ECUs."
 * compatible — "MEFI 4B and later are compatible."
 * The manual (https://www.yachtd.com/downloads/ydeg04.pdf) describes the gateway as
 * SmartCraft 2.0 / MEFI4B-or-later into standard NMEA 2000 PGNs. A 1976 carbureted
 * Mercruiser is in the incompatible set. Do not pretend a YDEG-04 hears it.
 *
 * Appendix C Table 2 of that manual lists the NMEA 2000 PGNs the gateway transmits,
 * including 127488, 127489, and 127493. It does not publish field numbers for
 * commanded AFR, actual AFR, knock counts, injector pulse width, or per-cylinder trims.
 * Those are not inside 127489. Proprietary J1939 PGNs the same table does name are
 * 65280 (Cummins genset status), 65373 (Volvo tilt/trim), and 65417 (Volvo MDI warnings).
 * None of those are a Mercury AFR or knock map.
 *
 * Boost is the standard 127488 "Engine Boost Pressure" field (uint16, 100 Pa),
 * which the gateway fills from SmartCraft manifold pressure when the ECM has it.
 */

export interface YdegField {
  param: string;
  pgn: number | null;
  /** Published NMEA/J1939 field name, or null when Yacht Devices never numbered it. */
  field: string | null;
  published: boolean;
}

export const YDEG04_COMPAT = {
  ecm555: false,
  pcm555: false,
  carburetedGasoline: false,
  mechanicalAnalog: false,
  mefi1: false,
  mefi2: false,
  mefi3: false,
  mefi4: false,
  mefi4bOrLater: true,
  smartcraftCanP: true,
} as const;

/** Standard NMEA fields the gateway is documented to emit. Offsets match the NMEA layout, not a vendor frame. */
export const YDEG04_STANDARD: readonly YdegField[] = [
  { param: "rpm", pgn: 127488, field: "Engine Speed", published: true },
  { param: "boost", pgn: 127488, field: "Engine Boost Pressure", published: true },
  { param: "trim", pgn: 127488, field: "Engine Tilt/Trim", published: true },
  { param: "oilPressure", pgn: 127489, field: "Engine Oil Pressure", published: true },
  { param: "coolantTemp", pgn: 127489, field: "Engine Temperature", published: true },
  { param: "voltage", pgn: 127489, field: "Alternator Potential", published: true },
  { param: "hours", pgn: 127489, field: "Total Engine Hours", published: true },
  { param: "fuelRate", pgn: 127489, field: "Fuel Rate", published: true },
  { param: "fuelPressure", pgn: 127489, field: "Fuel Pressure", published: true },
  { param: "transTemp", pgn: 127493, field: "Transmission Oil Temperature", published: true },
  { param: "transPressure", pgn: 127493, field: "Transmission Oil Pressure", published: true },
  { param: "gear", pgn: 127493, field: "Transmission Gear", published: true },
];

/** EFI richness the bulletin does not number. Leave these missing. Do not invent a PGN offset. */
export const YDEG04_UNPUBLISHED: readonly YdegField[] = [
  { param: "afrCommanded", pgn: null, field: null, published: false },
  { param: "afrActual", pgn: null, field: null, published: false },
  { param: "knock", pgn: null, field: null, published: false },
  { param: "injectorPw", pgn: null, field: null, published: false },
  { param: "cylTrim1", pgn: null, field: null, published: false },
  { param: "egt", pgn: null, field: null, published: false },
];

export const YDEG04_PROPRIETARY_NAMED = [
  { pgn: 65280, field: "Cummins proprietary (Genset Status)" },
  { pgn: 65373, field: "Volvo Penta proprietary (engine tilt/trim)" },
  { pgn: 65417, field: "Volvo Penta proprietary (MDI warnings)" },
] as const;
