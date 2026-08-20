import { compass } from "@/lib/ahanu/geo";
import { cn } from "@/lib/utils";

function wrap360(deg: number) {
  return ((deg % 360) + 360) % 360;
}

function labelFor(d: number): string {
  if (d === 0) return "N";
  if (d === 90) return "E";
  if (d === 180) return "S";
  if (d === 270) return "W";
  return String(d);
}

export function CompassTape({
  heading,
  cog,
  className,
}: {
  heading: number;
  cog?: number;
  className?: string;
}) {
  const h = wrap360(heading);
  const px = 5.2;
  const ticks: number[] = [];
  for (let d = -90; d <= 90; d += 10) ticks.push(d);
  return (
    <div
      className={cn(
        "pointer-events-none relative h-11 overflow-hidden rounded-xl bg-surface/90 shadow-[0_0_0_1px_var(--color-line)]",
        className,
      )}
      aria-label={`Heading ${h.toFixed(0)} degrees`}
    >
      <div className="absolute inset-x-0 bottom-0 flex h-7 items-end justify-center">
        {ticks.map((off) => {
          const deg = wrap360(h + off);
          const major = deg % 90 === 0;
          const mid = deg % 30 === 0;
          return (
            <div
              key={off}
              className="absolute bottom-0 flex flex-col items-center"
              style={{ left: `calc(50% + ${off * px}px)`, transform: "translateX(-50%)" }}
            >
              {(major || mid) && (
                <span className={cn("text-[10px] tabular", major ? "text-sunrise" : "text-faint")}>
                  {major ? labelFor(deg) : deg}
                </span>
              )}
              <span className={cn("w-px", major ? "h-3 bg-sunrise" : mid ? "h-2 bg-muted" : "h-1.5 bg-faint")} />
            </div>
          );
        })}
      </div>
      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-sunrise" />
      <p className="absolute top-0.5 left-1/2 -translate-x-1/2 font-display text-sm text-sunrise tabular">
        {h.toFixed(0).padStart(3, "0")}° {compass(h)}
        {cog != null && Math.abs(wrap360(cog) - h) > 6 ? (
          <span className="ml-1 font-sans text-[10px] tracking-widest text-muted uppercase">
            COG {wrap360(cog).toFixed(0)}
          </span>
        ) : null}
      </p>
    </div>
  );
}
