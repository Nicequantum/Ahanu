import type { EngineAlarm } from "@/lib/ahanu/types";

/** One pill. Tier 1 is a solid alarm. Tier 2 is a DTC, dashed when unavailable. */
export function FaultPill({ alarm }: { alarm: EngineAlarm }) {
  const tier2 = alarm.tier === 2;
  const dead = alarm.state === "unavailable";
  const historic = alarm.state === "historic";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] tracking-wide"
      style={{
        color: dead ? "var(--er-muted)" : historic ? "var(--er-muted)" : "var(--er-hot)",
        background: tier2 || dead ? "transparent" : "color-mix(in srgb, var(--er-hot) 16%, transparent)",
        boxShadow: tier2 ? "inset 0 0 0 1px var(--er-hot)" : dead ? "inset 0 0 0 1px dashed var(--er-muted)" : undefined,
        borderStyle: dead ? "dashed" : undefined,
      }}
    >
      {tier2 ? "DTC" : "ALM"}
      <span style={{ color: "var(--er-ink)" }}>{alarm.description}</span>
    </span>
  );
}
