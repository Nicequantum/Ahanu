/** CPA / TCPA in the local north-east frame. Knots and nautical miles. On-device only. */

export interface Motion {
  lat: number;
  lon: number;
  sog: number;
  cog: number;
}

export interface Cpa {
  /** Distance at closest approach. If TCPA is already past, this is the range now. */
  cpaNm: number;
  /** Minutes until closest approach. Negative means the targets are opening. */
  tcpaMin: number | null;
  rangeNm: number;
}

function en(own: Motion, tgt: Motion): { e: number; n: number } {
  const latMid = ((own.lat + tgt.lat) / 2) * (Math.PI / 180);
  return {
    e: (tgt.lon - own.lon) * 60 * Math.cos(latMid),
    n: (tgt.lat - own.lat) * 60,
  };
}

function vel(sog: number, cog: number): { e: number; n: number } {
  const r = (cog * Math.PI) / 180;
  return { e: sog * Math.sin(r), n: sog * Math.cos(r) };
}

export function cpaTcpa(own: Motion, tgt: Motion): Cpa {
  const { e, n } = en(own, tgt);
  const rangeNm = Math.hypot(e, n);
  const vo = vel(own.sog, own.cog);
  const vt = vel(tgt.sog, tgt.cog);
  const vrx = vt.e - vo.e;
  const vrn = vt.n - vo.n;
  const v2 = vrx * vrx + vrn * vrn;
  if (v2 < 1e-8) return { cpaNm: rangeNm, tcpaMin: null, rangeNm };
  const tcpaH = -(e * vrx + n * vrn) / v2;
  if (tcpaH < 0) return { cpaNm: rangeNm, tcpaMin: tcpaH * 60, rangeNm };
  const ce = e + vrx * tcpaH;
  const cn = n + vrn * tcpaH;
  return { cpaNm: Math.hypot(ce, cn), tcpaMin: tcpaH * 60, rangeNm };
}
