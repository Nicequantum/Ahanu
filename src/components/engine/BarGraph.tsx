import type { EngineReading } from "@/lib/ahanu/types";
import { fraction, shown } from "./gauge-util";
import { hold } from "./TachArc";

export function BarGraph({
  reading,
  label,
  min,
  max,
  digits = 0,
  onHold,
}: {
  reading?: EngineReading;
  label: string;
  min: number;
  max: number;
  digits?: number;
  onHold?: () => void;
}) {
  const t = fraction(reading, min, max);
  return (
    <button type="button" onPointerDown={() => hold(onHold)} className="w-full text-left">
      <p className="text-[10px] tracking-[0.16em] uppercase" style={{ color: "var(--er-muted)" }}>{label}</p>
      <div className="mt-1 h-1.5 w-full rounded-full" style={{ background: "var(--er-tick)" }}>
        <div className="h-full rounded-full" style={{ width: `${t * 100}%`, background: "var(--er-accent)" }} />
      </div>
      <p className="mt-1 text-sm tabular-nums" style={{ color: "var(--er-ink)" }}>{shown(reading, digits)}</p>
    </button>
  );
}
