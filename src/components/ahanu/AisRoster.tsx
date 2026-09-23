import { useAhanu } from "@/lib/ahanu/store";
import { cn } from "@/lib/utils";

function fmt(n: number | null | undefined, digits: number, suffix: string): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}${suffix}`;
}

/** Night-bridge readout for the AIS layer: name, MMSI, COG, SOG, CPA/TCPA. */
export function AisRoster() {
  const visible = useAhanu((s) => s.layers.ais?.visible ?? false);
  const traffic = useAhanu((s) => s.traffic);
  const note = useAhanu((s) => s.sensorNote);
  const focus = useAhanu((s) => s.focusMmsi);
  const setFocus = useAhanu((s) => s.setFocusMmsi);
  if (!visible) return null;
  const rows = [...traffic].sort((a, b) => (a.cpaNm ?? 99) - (b.cpaNm ?? 99)).slice(0, 6);
  const picked = traffic.find((t) => t.mmsi === focus) ?? rows[0];

  return (
    <div className="pointer-events-auto absolute bottom-36 left-2 z-20 w-[min(100%-1rem,280px)] rounded-2xl bg-surface/92 p-3 shadow-[0_0_0_1px_var(--color-line)] backdrop-blur-md md:bottom-40 md:left-20">
      <p className="text-[10px] tracking-[0.18em] text-sunrise uppercase">AIS · {note}</p>
      {picked ? (
        <div className="mt-2">
          <p className="font-display text-lg text-foam">{picked.name}</p>
          <p className="text-xs text-muted">MMSI {picked.mmsi}</p>
          <p className="mt-1 text-xs text-foam tabular">
            COG {Math.round(picked.cog)}° · SOG {picked.sog.toFixed(1)} kt
          </p>
          <p className="text-xs text-lagoon tabular">
            CPA {fmt(picked.cpaNm, 1, " nm")} · TCPA {fmt(picked.tcpaMin, 0, " min")}
            {picked.corroborated ? " · radar" : ""}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">No contacts. The radio is quiet.</p>
      )}
      <ul className="mt-2 max-h-28 space-y-1 overflow-auto">
        {rows.map((t) => (
          <li key={t.mmsi}>
            <button
              type="button"
              onClick={() => setFocus(t.mmsi)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-xs",
                t.mmsi === picked?.mmsi ? "bg-elevated text-foam" : "text-muted hover:bg-elevated",
              )}
            >
              <span className="truncate">{t.name}</span>
              <span className="tabular">{fmt(t.cpaNm, 1, "")}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
