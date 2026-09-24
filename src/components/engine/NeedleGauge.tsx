import type { EngineReading } from "@/lib/ahanu/types";
import { arcPoint, fraction, shown } from "./gauge-util";
import { hold } from "./TachArc";

export function NeedleGauge({
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
  const tip = arcPoint(40, 40, 26, t);
  const a = arcPoint(40, 40, 28, 0);
  const b = arcPoint(40, 40, 28, 1);
  return (
    <button type="button" onPointerDown={() => hold(onHold)} className="w-full text-left">
      <svg viewBox="0 0 80 52" className="w-full">
        <path d={`M ${a.x} ${a.y} A 28 28 0 0 1 ${b.x} ${b.y}`} fill="none" stroke="var(--er-tick)" strokeWidth="4" />
        <line x1="40" y1="40" x2={tip.x} y2={tip.y} stroke="var(--er-accent)" strokeWidth="1.6" />
      </svg>
      <p className="text-[10px] tracking-[0.16em] uppercase" style={{ color: "var(--er-muted)" }}>{label}</p>
      <p className="text-sm tabular-nums" style={{ color: "var(--er-ink)" }}>{shown(reading, digits)}</p>
    </button>
  );
}
