import type { EngineReading } from "@/lib/ahanu/types";
import { arcPoint, fraction, shown } from "./gauge-util";

export function TachArc({
  reading,
  label,
  max = 4800,
  onHold,
}: {
  reading?: EngineReading;
  label: string;
  max?: number;
  onHold?: () => void;
}) {
  const t = fraction(reading, 0, max);
  const start = arcPoint(60, 58, 46, 0);
  const end = arcPoint(60, 58, 46, 1);
  const tip = arcPoint(60, 58, 40, t);
  const large = 0;
  return (
    <button type="button" onContextMenu={(e) => e.preventDefault()} onPointerDown={() => hold(onHold)} className="w-full text-left">
      <svg viewBox="0 0 120 72" className="w-full">
        <path d={`M ${start.x} ${start.y} A 46 46 0 ${large} 1 ${end.x} ${end.y}`} fill="none" stroke="var(--er-tick)" strokeWidth="6" strokeLinecap="round" />
        <path d={`M ${start.x} ${start.y} A 46 46 0 ${large} 1 ${tip.x} ${tip.y}`} fill="none" stroke="var(--er-accent)" strokeWidth="3" strokeLinecap="round" />
        <line x1="60" y1="58" x2={tip.x} y2={tip.y} stroke="var(--er-ink)" strokeWidth="1.4" />
      </svg>
      <p className="text-[10px] tracking-[0.18em] uppercase" style={{ color: "var(--er-muted)" }}>{label}</p>
      <p className="font-display text-xl tabular-nums" style={{ color: "var(--er-ink)" }}>{shown(reading, 0)}</p>
    </button>
  );
}

export function hold(fn?: () => void): void {
  if (!fn) return;
  const timer = window.setTimeout(fn, 480);
  const up = () => {
    window.clearTimeout(timer);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
  };
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}
