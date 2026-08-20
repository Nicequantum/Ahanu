/**
 * Packed CO-OPS / fixture tide curve. No live fetch. No invented water levels.
 */

import { STORE_PERSIST_KEY } from "./display-mode";
import type { PackedTideStation } from "./noaa-live";
import { getPackedOcean } from "./packed-fields";

export const DEFAULT_TIDE_HARBOR = "Newport";
export const TIDE_HARBOR_KEY = "ahanu-tide-harbor";

export interface PersistedTideHarbor {
  id?: string;
  name: string;
}

export interface PackedTidePoint {
  at: string;
  heightFt: number;
}

export interface PackedTideExtreme extends PackedTidePoint {
  kind: "high" | "low";
}

export interface PackedTideCurve {
  harbor: string;
  stationId: string;
  datum: string;
  live: boolean;
  source?: string;
  points: PackedTidePoint[];
  nextHigh: PackedTideExtreme | null;
  nextLow: PackedTideExtreme | null;
}

function validPoint(p: { at?: string; heightFt?: number } | null | undefined): PackedTidePoint | null {
  if (!p || typeof p.at !== "string") return null;
  if (!Number.isFinite(p.heightFt)) return null;
  const t = Date.parse(p.at);
  if (!Number.isFinite(t)) return null;
  return { at: p.at, heightFt: p.heightFt as number };
}

function stationMatches(st: PackedTideStation, want: string): boolean {
  const w = want.trim().toLowerCase();
  if (!w) return false;
  if (st.id.toLowerCase() === w) return true;
  const name = st.name.toLowerCase();
  return name === w || name.includes(w) || w.includes(name);
}

export function packedTideHarbors(): string[] {
  const stations = getPackedOcean()?.tides?.stations ?? [];
  return stations.map((s) => s.name).filter((n) => n.length > 0);
}

export function selectPackedTideStation(harbor = DEFAULT_TIDE_HARBOR): PackedTideStation | null {
  const stations = getPackedOcean()?.tides?.stations;
  if (!stations?.length) return null;
  return (
    stations.find((s) => stationMatches(s, harbor)) ??
    stations.find((s) => stationMatches(s, DEFAULT_TIDE_HARBOR)) ??
    stations[0] ??
    null
  );
}

/** Match id or name against the packed list only. No Newport / first-station fallback. */
export function findPackedTideStation(harbor: string): PackedTideStation | null {
  const want = harbor.trim();
  if (!want) return null;
  const stations = getPackedOcean()?.tides?.stations ?? [];
  return stations.find((s) => stationMatches(s, want)) ?? null;
}

type Readable = Pick<Storage, "getItem">;
type Writable = Pick<Storage, "setItem">;

function storageGet(storage?: Readable | null): Readable | null {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function storageSet(storage?: Writable | null): Writable | null {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function parsePersistedTideHarbor(raw: string | null): PersistedTideHarbor | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  if (t.startsWith("{")) {
    try {
      const o = JSON.parse(t) as { id?: unknown; name?: unknown };
      const name = typeof o.name === "string" ? o.name.trim() : "";
      const id = typeof o.id === "string" ? o.id.trim() : "";
      if (name || id) return { id: id || undefined, name: name || id };
    } catch {
      return null;
    }
    return null;
  }
  return { name: t };
}

function readZustandTideHarbor(raw: string | null): PersistedTideHarbor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { state?: { tideHarbor?: unknown } };
    const h = parsed?.state?.tideHarbor;
    if (typeof h === "string" && h.trim()) return parsePersistedTideHarbor(h.trim());
    if (h && typeof h === "object") {
      const o = h as { id?: unknown; name?: unknown };
      const name = typeof o.name === "string" ? o.name.trim() : "";
      const id = typeof o.id === "string" ? o.id.trim() : "";
      if (name || id) return { id: id || undefined, name: name || id };
    }
  } catch {
    return null;
  }
  return null;
}

/** Dedicated key first, then the zustand persist blob, else Newport. */
export function readPersistedTideHarbor(storage?: Readable | null): string {
  return readPersistedTideHarborRecord(storage)?.name || DEFAULT_TIDE_HARBOR;
}

export function readPersistedTideHarborRecord(storage?: Readable | null): PersistedTideHarbor | null {
  const store = storageGet(storage);
  if (!store) return null;
  try {
    return parsePersistedTideHarbor(store.getItem(TIDE_HARBOR_KEY)) ?? readZustandTideHarbor(store.getItem(STORE_PERSIST_KEY));
  } catch {
    return null;
  }
}

export function writePersistedTideHarbor(
  harbor: string | PersistedTideHarbor,
  storage?: Writable | null,
): void {
  const name = (typeof harbor === "string" ? harbor : harbor.name ?? harbor.id ?? "").trim();
  const givenId = typeof harbor === "string" ? "" : (harbor.id ?? "").trim();
  if (!name && !givenId) return;
  const st = findPackedTideStation(givenId || name);
  const rec: PersistedTideHarbor =
    st && (stationMatches(st, givenId || name) || (givenId && st.id === givenId))
      ? { id: st.id, name: st.name }
      : { id: givenId || undefined, name: name || givenId || DEFAULT_TIDE_HARBOR };
  try {
    storageSet(storage)?.setItem(TIDE_HARBOR_KEY, JSON.stringify(rec));
  } catch {
    /* private mode / SSR */
  }
}

/**
 * Last skipper pick if that station is still packed; otherwise Newport.
 * Missing pack cannot validate — return Newport and do not invent a station.
 */
export function resolveTideHarbor(want?: string | null, storage?: Readable | null): string {
  const rec = readPersistedTideHarborRecord(storage);
  const pick = (want ?? "").trim() || rec?.name || rec?.id || DEFAULT_TIDE_HARBOR;
  const stations = getPackedOcean()?.tides?.stations ?? [];
  if (!stations.length) return DEFAULT_TIDE_HARBOR;
  const sameRecord = !want?.trim() || pick === rec?.name || pick === rec?.id;
  const found =
    findPackedTideStation(pick) ??
    (sameRecord && rec?.id ? findPackedTideStation(rec.id) : null) ??
    (sameRecord && rec?.name ? findPackedTideStation(rec.name) : null);
  if (found) return found.name;
  return findPackedTideStation(DEFAULT_TIDE_HARBOR)?.name ?? DEFAULT_TIDE_HARBOR;
}

function kindFromNeighbors(
  cur: PackedTidePoint,
  prev: PackedTidePoint | undefined,
  next: PackedTidePoint | undefined,
): "high" | "low" | null {
  if (!prev && !next) return null;
  if (!prev) {
    if (cur.heightFt > next!.heightFt) return "high";
    if (cur.heightFt < next!.heightFt) return "low";
    return null;
  }
  if (!next) {
    if (cur.heightFt > prev.heightFt) return "high";
    if (cur.heightFt < prev.heightFt) return "low";
    return null;
  }
  if (cur.heightFt > prev.heightFt && cur.heightFt > next.heightFt) return "high";
  if (cur.heightFt < prev.heightFt && cur.heightFt < next.heightFt) return "low";
  return null;
}

export function classifyPackedHilo(
  hilo: { at: string; heightFt: number; type?: string }[] | undefined,
): PackedTideExtreme[] {
  if (!hilo?.length) return [];
  const pts: Array<PackedTidePoint & { type?: "H" | "L" }> = [];
  for (const h of hilo) {
    const p = validPoint(h);
    if (!p) continue;
    const type = h.type === "H" || h.type === "L" ? h.type : undefined;
    pts.push(type ? { ...p, type } : p);
  }
  pts.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const out: PackedTideExtreme[] = [];
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i]!;
    if (cur.type === "H") {
      out.push({ at: cur.at, heightFt: cur.heightFt, kind: "high" });
      continue;
    }
    if (cur.type === "L") {
      out.push({ at: cur.at, heightFt: cur.heightFt, kind: "low" });
      continue;
    }
    const kind = kindFromNeighbors(cur, pts[i - 1], pts[i + 1]);
    if (kind) out.push({ at: cur.at, heightFt: cur.heightFt, kind });
  }
  return out;
}

export function packedTideCurve(now: Date, harbor = DEFAULT_TIDE_HARBOR): PackedTideCurve | null {
  const ocean = getPackedOcean();
  const tides = ocean?.tides;
  if (!tides?.stations?.length) return null;
  const st = selectPackedTideStation(harbor);
  if (!st) return null;
  const points = (st.series ?? []).map((p) => validPoint(p)).filter((p): p is PackedTidePoint => p != null);
  const extremes = classifyPackedHilo(st.hilo);
  if (!points.length && !extremes.length) return null;
  const t = now.getTime();
  const upcoming = (kind: "high" | "low"): PackedTideExtreme | null =>
    extremes.find((e) => e.kind === kind && Date.parse(e.at) >= t - 60_000) ?? null;
  return {
    harbor: st.name,
    stationId: st.id,
    datum: st.datum || "MLLW",
    live: Boolean(tides.live) || tides.source === "coops" || ocean?.tideSource === "noaa",
    source: tides.source,
    points,
    nextHigh: upcoming("high"),
    nextLow: upcoming("low"),
  };
}
