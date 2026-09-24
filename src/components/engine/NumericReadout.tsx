import type { EngineReading } from "@/lib/ahanu/types";
import { shown } from "./gauge-util";
import { hold } from "./TachArc";

export function NumericReadout({
  reading,
  label,
  digits = 0,
  onHold,
}: {
  reading?: EngineReading;
  label: string;
  digits?: number;
  onHold?: () => void;
}) {
  return (
    <button type="button" onPointerDown={() => hold(onHold)} className="w-full text-left">
      <p className="text-[10px] tracking-[0.16em] uppercase" style={{ color: "var(--er-muted)" }}>{label}</p>
      <p className="text-lg tabular-nums" style={{ color: "var(--er-ink)", fontFamily: "var(--er-figure)" }}>{shown(reading, digits)}</p>
    </button>
  );
}
