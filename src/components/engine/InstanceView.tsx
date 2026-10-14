import { instanceRows } from "@/lib/ahanu/engine/instances";
import { assignInstance, clearInstance, type InstanceMap } from "@/lib/ahanu/engine/map";
import type { EngineFeed, EngineReading, EngineRoomMode } from "@/lib/ahanu/types";

function age(ts: string | null): string {
  if (!ts) return "no data";
  const ms = Math.max(0, Date.now() - Date.parse(ts));
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** NMEA 2000 instance → bank table with source kind, feed, mode and freshness. */
export function InstanceView({
  readings,
  map,
  feed,
  mode,
  onMap,
}: {
  readings: EngineReading[];
  map: InstanceMap;
  feed: EngineFeed;
  mode: EngineRoomMode;
  onMap: (next: InstanceMap) => void;
}) {
  const rows = instanceRows(readings, map, feed, mode);
  if (rows.length === 0) return <p className="text-xs" style={{ color: "var(--er-muted)" }}>No engine instances seen.</p>;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-[10px] tracking-[0.14em] uppercase" style={{ color: "var(--er-muted)" }}>
          <th className="text-left font-normal">inst</th>
          <th className="text-left font-normal">bank</th>
          <th className="text-left font-normal">source</th>
          <th className="text-left font-normal">feed · mode</th>
          <th className="text-right font-normal">params</th>
          <th className="text-right font-normal">age</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.instance} style={{ color: "var(--er-ink)" }}>
            <td className="py-1 tabular-nums">{row.instance}</td>
            <td style={{ color: row.engineId === "unmapped" ? "var(--er-warn)" : "var(--er-accent)" }}>{row.engineId}</td>
            <td>{row.sources.length ? row.sources.join(", ") : "—"}</td>
            <td>
              {row.feed} · {row.mode}
            </td>
            <td className="text-right tabular-nums">
              {row.params}
              {row.stale ? <span style={{ color: "var(--er-warn)" }}> ({row.stale} stale)</span> : null}
            </td>
            <td className="text-right tabular-nums">{age(row.lastTs)}</td>
            <td className="text-right">
              <span className="flex justify-end gap-1">
                <button type="button" className="rounded px-1 text-[10px]" style={{ background: "var(--er-face)" }} onClick={() => onMap(assignInstance(map, row.instance, "port"))}>P</button>
                <button type="button" className="rounded px-1 text-[10px]" style={{ background: "var(--er-face)" }} onClick={() => onMap(assignInstance(map, row.instance, "starboard"))}>S</button>
                <button type="button" className="rounded px-1 text-[10px]" style={{ background: "var(--er-face)" }} onClick={() => onMap(clearInstance(map, row.instance))}>×</button>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
