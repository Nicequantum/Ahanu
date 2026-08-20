/** NMEA 0183 encoder/decoder — Wi-Fi instrument gateway adapter. */

function pad2(n: number): string {
  return String(Math.floor(n)).padStart(2, "0");
}

function wrap360(d: number): number {
  return ((d % 360) + 360) % 360;
}

export function nmeaChecksum(body: string): string {
  let x = 0;
  for (let i = 0; i < body.length; i++) x ^= body.charCodeAt(i);
  return x.toString(16).toUpperCase().padStart(2, "0");
}

function sentence(body: string): string {
  return `$${body}*${nmeaChecksum(body)}`;
}

/** ddmm.mmm,N/S or dddmm.mmm,E/W */
function dmHemi(deg: number, lat: boolean): [string, string] {
  const hemi = lat ? (deg >= 0 ? "N" : "S") : deg >= 0 ? "E" : "W";
  const abs = Math.abs(deg);
  let d = Math.floor(abs);
  let m = (abs - d) * 60;
  if (m >= 59.9995) {
    d += 1;
    m = 0;
  }
  return [`${String(d).padStart(lat ? 2 : 3, "0")}${m.toFixed(3).padStart(6, "0")}`, hemi];
}

function hhmmss(date: Date): string {
  return `${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}.${pad2(Math.floor(date.getUTCMilliseconds() / 10))}`;
}

function ddmmyy(date: Date): string {
  return `${pad2(date.getUTCDate())}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCFullYear() % 100)}`;
}

export function encodeRMC(
  v: { lat: number; lon: number; sog: number; cog: number },
  date: Date,
): string {
  const [la, ns] = dmHemi(v.lat, true);
  const [lo, ew] = dmHemi(v.lon, false);
  return sentence(
    `GPRMC,${hhmmss(date)},A,${la},${ns},${lo},${ew},${Math.max(0, v.sog).toFixed(1)},${wrap360(v.cog).toFixed(1)},${ddmmyy(date)},,,A`,
  );
}

export function encodeGLL(v: { lat: number; lon: number }, date: Date): string {
  const [la, ns] = dmHemi(v.lat, true);
  const [lo, ew] = dmHemi(v.lon, false);
  return sentence(`GPGLL,${la},${ns},${lo},${ew},${hhmmss(date)},A,A`);
}

export function encodeVTG(cog: number, sog: number): string {
  const k = Math.max(0, sog);
  return sentence(`GPVTG,${wrap360(cog).toFixed(1)},T,,M,${k.toFixed(1)},N,${(k * 1.852).toFixed(1)},K,A`);
}

export function encodeDBT(depthM: number): string {
  const m = Math.max(0, depthM);
  const ft = m * 3.28084;
  const fa = m / 1.8288;
  return sentence(`SDDBT,${ft.toFixed(1)},f,${m.toFixed(1)},M,${fa.toFixed(1)},F`);
}

export function encodeMWV(windKt: number, windDir: number, trueWind?: boolean): string {
  const ref = trueWind ? "T" : "R";
  return sentence(`WIMWV,${wrap360(windDir).toFixed(1)},${ref},${Math.max(0, windKt).toFixed(1)},N,A`);
}

export function encodeHDT(heading: number): string {
  return sentence(`HEHDT,${wrap360(heading).toFixed(1)},T`);
}

export function encodeGGA(v: { lat: number; lon: number; depthM?: number }, date: Date): string {
  const [la, ns] = dmHemi(v.lat, true);
  const [lo, ew] = dmHemi(v.lon, false);
  return sentence(`GPGGA,${hhmmss(date)},${la},${ns},${lo},${ew},1,08,1.0,0.0,M,0.0,M,,`);
}

export interface DecodedNmea {
  talker: string;
  type: string;
  fields: string[];
  ok: boolean;
}

export function decodeSentence(sentenceStr: string): DecodedNmea | null {
  const raw = sentenceStr.trim();
  if (!raw.startsWith("$") || raw.length < 6) return null;
  const star = raw.lastIndexOf("*");
  const body = star >= 0 ? raw.slice(1, star) : raw.slice(1);
  if (body.length < 5) return null;
  const parts = body.split(",");
  const tag = parts[0] ?? "";
  if (tag.length < 5) return null;
  const given = star >= 0 ? raw.slice(star + 1).trim().slice(0, 2).toUpperCase() : "";
  const ok = star >= 0 && given.length === 2 && nmeaChecksum(body) === given;
  return { talker: tag.slice(0, 2), type: tag.slice(2, 5), fields: parts.slice(1), ok };
}

export function gatewayFeed(input: {
  lat: number;
  lon: number;
  sog: number;
  cog: number;
  heading: number;
  depthM: number;
  windKt: number;
  windDir: number;
  date: Date;
}): string[] {
  return [
    encodeRMC(input, input.date),
    encodeGGA(input, input.date),
    encodeVTG(input.cog, input.sog),
    encodeDBT(input.depthM),
    encodeMWV(input.windKt, input.windDir, true),
    encodeHDT(input.heading),
  ];
}
