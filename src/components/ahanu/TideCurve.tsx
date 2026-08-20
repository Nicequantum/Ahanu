import { formatClock } from "@/lib/ahanu/solunar";
import type { PackedTideCurve } from "@/lib/ahanu/tide-curve";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

const LAGOON = "#4ecdc4";
const SUNRISE = "#e4b56a";

export function TideCurvePlot({
  curve,
  now,
  compact,
  className,
}: {
  curve: PackedTideCurve;
  now: Date;
  compact?: boolean;
  className?: string;
}) {
  const w = compact ? 168 : 320;
  const h = compact ? 44 : 72;
  const drawn = useMemo(() => {
    const pts = curve.points;
    if (pts.length === 0) {
      return { d: "", nowX: null as number | null, marks: [] as { x: number; y: number; kind: "high" | "low" }[] };
    }
    const times = pts.map((p) => Date.parse(p.at));
    const t0 = times[0]!;
    const t1 = times[times.length - 1]!;
    const span = Math.max(1, t1 - t0);
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of pts) {
      if (p.heightFt < lo) lo = p.heightFt;
      if (p.heightFt > hi) hi = p.heightFt;
    }
    if (!(Number.isFinite(lo) && Number.isFinite(hi))) return { d: "", nowX: null, marks: [] };
    if (lo === hi) {
      lo -= 0.5;
      hi += 0.5;
    }
    const pad = 4;
    const xAt = (t: number) => pad + ((t - t0) / span) * (w - pad * 2);
    const yAt = (v: number) => h - pad - ((v - lo) / (hi - lo)) * (h - pad * 2);
    const d = pts
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(times[i]!).toFixed(1)} ${yAt(p.heightFt).toFixed(1)}`)
      .join(" ");
    const nt = now.getTime();
    const nowX = nt >= t0 && nt <= t1 ? xAt(nt) : null;
    const marks: { x: number; y: number; kind: "high" | "low" }[] = [];
    for (const ex of [curve.nextHigh, curve.nextLow]) {
      if (!ex) continue;
      const t = Date.parse(ex.at);
      if (t < t0 || t > t1) continue;
      marks.push({ x: xAt(t), y: yAt(ex.heightFt), kind: ex.kind });
    }
    return { d, nowX, marks };
  }, [curve, now, w, h]);

  if (!drawn.d) return null;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn("w-full", compact ? "h-11" : "h-[4.5rem]", className)}
      role="img"
      aria-label={`${curve.harbor} packed tide curve`}
    >
      <path d={drawn.d} fill="none" stroke={LAGOON} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {drawn.nowX != null ? (
        <line x1={drawn.nowX} x2={drawn.nowX} y1={2} y2={h - 2} stroke={SUNRISE} strokeWidth={1} strokeOpacity={0.7} />
      ) : null}
      {drawn.marks.map((m) => (
        <circle key={`${m.kind}-${m.x}`} cx={m.x} cy={m.y} r={2.4} fill={m.kind === "high" ? SUNRISE : LAGOON} />
      ))}
    </svg>
  );
}

export function TideCurveCard({
  curve,
  now,
  compact,
  className,
}: {
  curve: PackedTideCurve | null;
  now: Date;
  compact?: boolean;
  className?: string;
}) {
  if (!curve || (!curve.points.length && !curve.nextHigh && !curve.nextLow)) {
    return (
      <p className={cn("text-xs text-muted", className)} data-tide="empty">
        no packed tides
      </p>
    );
  }
  const fmt = (ex: PackedTideCurve["nextHigh"]) =>
    ex ? `${formatClock(new Date(ex.at))} · ${ex.heightFt.toFixed(1)} ft` : "—";
  return (
    <div className={cn("space-y-1.5", className)} data-tide={curve.live ? "coops" : "fixture"} data-harbor={curve.harbor}>
      <div className="flex items-baseline gap-2">
        <p className="text-[10px] tracking-[0.18em] text-faint uppercase">{curve.harbor}</p>
        <p className="ml-auto text-[10px] text-faint tabular">{curve.datum}</p>
      </div>
      {curve.points.length ? <TideCurvePlot curve={curve} now={now} compact={compact} /> : null}
      <div className={cn("grid gap-1", compact ? "grid-cols-1" : "grid-cols-2")}>
        <p className="text-[11px] tabular text-foam">
          <span className="text-faint">High </span>
          {fmt(curve.nextHigh)}
        </p>
        <p className="text-[11px] tabular text-foam">
          <span className="text-faint">Low </span>
          {fmt(curve.nextLow)}
        </p>
      </div>
    </div>
  );
}

export function TideHarborChips({
  harbors,
  selected,
  onSelect,
  className,
}: {
  harbors: string[];
  selected: string;
  onSelect: (name: string) => void;
  className?: string;
}) {
  if (harbors.length <= 1) return null;
  return (
    <div className={cn("flex flex-wrap gap-1", className)} data-tide-harbors="">
      {harbors.map((name) => (
        <button
          key={name}
          type="button"
          onClick={() => onSelect(name)}
          className={
            name === selected
              ? "rounded-md bg-sunrise px-2 py-1 text-[10px] tracking-wider text-sunrise-fg uppercase"
              : "rounded-md bg-elevated px-2 py-1 text-[10px] tracking-wider text-muted uppercase"
          }
        >
          {name}
        </button>
      ))}
    </div>
  );
}

