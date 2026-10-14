import { ENGINE_THRESHOLDS, PARAM_UNIT, WIDEBAND_SPREAD_AFR } from "@/lib/ahanu/engine/config";
import { displayValue } from "@/lib/ahanu/engine/quality";
import { dualSync, widebandCheck, type SyncStatus, type WidebandCheck } from "@/lib/ahanu/engine/sync";
import type { EngineReading } from "@/lib/ahanu/types";

const DIGITS: Record<string, number> = { voltage: 1, afrA: 2, afrB: 2, afrCommanded: 1, sparkAdvance: 1, injectorPw: 2 };

const STATUS_COLOR: Record<SyncStatus, string> = {
  sync: "var(--er-ok)",
  mismatch: "var(--er-hot)",
  stale: "var(--er-warn)",
  missing: "var(--er-muted)",
};

function label(param: string): string {
  return param.replace(/([A-Z])/g, " $1").toLowerCase();
}

function Wideband({ check }: { check: WidebandCheck }) {
  const color = check.status === "agree" ? "var(--er-ok)" : check.status === "disagree" ? "var(--er-hot)" : "var(--er-muted)";
  return (
    <div className="rounded-md px-2 py-1" style={{ background: "var(--er-face)", boxShadow: `inset 0 0 0 1px ${color}` }}>
      <p className="text-[10px] tracking-[0.14em] uppercase" style={{ color: "var(--er-muted)" }}>{check.engineId} wideband A/B</p>
      <p className="text-sm tabular-nums" style={{ color }}>
        {check.status === "missing" ? "—" : `${check.status} · Δ${check.spread?.toFixed(2)}`}
      </p>
    </div>
  );
}

/** Port and starboard side by side with a per-row sync/mismatch dot. */
export function DualView({ readings, params }: { readings: EngineReading[]; params: readonly string[] }) {
  const summary = dualSync(readings, params, ENGINE_THRESHOLDS.delta);
  const hasAfr = readings.some((row) => row.param === "afrA" || row.param === "afrB");
  return (
    <div>
      <p className="mb-2 text-xs" data-testid="dual-summary" style={{ color: summary.allInSync ? "var(--er-ok)" : summary.mismatch ? "var(--er-hot)" : "var(--er-warn)" }}>
        {summary.allInSync ? "Banks in sync" : `${summary.mismatch} mismatch · ${summary.stale} stale · ${summary.missing} missing · ${summary.sync} in sync`}
      </p>
      {hasAfr && (
        <div className="mb-2 grid grid-cols-2 gap-1">
          <Wideband check={widebandCheck(readings, "port", WIDEBAND_SPREAD_AFR)} />
          <Wideband check={widebandCheck(readings, "starboard", WIDEBAND_SPREAD_AFR)} />
        </div>
      )}
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-[10px] tracking-[0.14em] uppercase" style={{ color: "var(--er-muted)" }}>
            <th className="text-left font-normal">param</th>
            <th className="text-right font-normal">port</th>
            <th className="text-right font-normal">stbd</th>
            <th className="text-right font-normal">Δ</th>
            <th className="w-4" />
          </tr>
        </thead>
        <tbody>
          {summary.rows.map((row) => (
            <tr key={row.param} style={{ color: "var(--er-ink)" }}>
              <td className="py-0.5">
                {label(row.param)} <span style={{ color: "var(--er-muted)" }}>{PARAM_UNIT[row.param] ?? ""}</span>
              </td>
              <td className="text-right" style={{ color: row.delta.worse === "port" ? "var(--er-hot)" : undefined }}>{displayValue(row.port, DIGITS[row.param] ?? 0)}</td>
              <td className="text-right" style={{ color: row.delta.worse === "starboard" ? "var(--er-hot)" : undefined }}>{displayValue(row.starboard, DIGITS[row.param] ?? 0)}</td>
              <td className="text-right">{row.delta.text}</td>
              <td className="text-right">
                <span title={row.status} aria-label={row.status} className="inline-block h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[row.status] }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
