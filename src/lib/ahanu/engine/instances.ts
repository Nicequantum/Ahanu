import type { EngineFeed, EngineId, EngineReading, EngineRoomMode, EngineSourceKind } from "@/lib/ahanu/types";
import type { InstanceMap } from "./map";

export interface InstanceRow {
  instance: number;
  engineId: EngineId;
  /** Distinct sources seen on this instance. Empty when mapped but silent. */
  sources: EngineSourceKind[];
  feed: EngineFeed;
  mode: EngineRoomMode;
  params: number;
  ok: number;
  stale: number;
  missing: number;
  /** Newest reading timestamp, or null when the instance is mapped but has sent nothing. */
  lastTs: string | null;
}

/**
 * Every instance on the bus or in the map, sorted by instance number.
 * The side comes from the live reading (already resolved) or the map; it is never guessed.
 */
export function instanceRows(readings: EngineReading[], map: InstanceMap, feed: EngineFeed, mode: EngineRoomMode): InstanceRow[] {
  const ids = new Set<number>();
  for (const row of readings) if (row.instance != null) ids.add(row.instance);
  for (const key of Object.keys(map)) {
    const n = Number(key);
    if (Number.isInteger(n) && n >= 0) ids.add(n);
  }
  return [...ids]
    .sort((a, b) => a - b)
    .map((instance) => {
      const rows = readings.filter((row) => row.instance === instance);
      const side = map[String(instance)];
      const engineId: EngineId = side === "port" || side === "starboard" ? side : "unmapped";
      const lastTs = rows.reduce<string | null>((acc, row) => (acc == null || Date.parse(row.ts) > Date.parse(acc) ? row.ts : acc), null);
      return {
        instance,
        engineId,
        sources: [...new Set(rows.map((row) => row.source))],
        feed,
        mode,
        params: new Set(rows.map((row) => row.param)).size,
        ok: rows.filter((row) => row.quality === "ok").length,
        stale: rows.filter((row) => row.quality === "stale").length,
        missing: rows.filter((row) => row.quality === "missing").length,
        lastTs,
      };
    });
}
