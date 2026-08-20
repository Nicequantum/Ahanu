import { Pane, Stat } from "@/components/panels/pane";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { compass, formatCoord } from "@/lib/ahanu/geo";
import { formatClock } from "@/lib/ahanu/solunar";
import { useAhanu } from "@/lib/ahanu/store";
import { currentAt, tideAt } from "@/lib/ahanu/tides";
import type { EmergencyContact, FloatPlan } from "@/lib/ahanu/types";
import { useMemo, useState, type ReactNode } from "react";

const KIT = [
  {
    id: "epirb",
    label: "EPIRB 406",
    note: "Register the HEX, keep the hydrostatic in date, test on the schedule. Reminder only — Ahanu does not know this hull's beacon.",
  },
  {
    id: "vhf16",
    label: "VHF 16",
    note: "Distress, urgency, safety, and hailing. Keep a watch on 16 while underway.",
  },
  {
    id: "dsc",
    label: "DSC",
    note: "MMSI programmed in the radio. Distress alert is a last resort, not a radio check.",
  },
] as const;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-muted">{label}</span>
      {children}
    </label>
  );
}

function planPlaintext(
  plan: FloatPlan,
  contacts: EmergencyContact[],
  pos: string,
  when: string,
): string {
  const lines = [
    "AHANU FLOAT PLAN",
    `Filed: ${when}`,
    `Position: ${pos}`,
    "",
    `Skipper: ${plan.skipper || "—"}`,
    `Vessel: ${plan.vessel || "—"}`,
    `Souls on board: ${plan.souls}`,
    `Departure: ${plan.departure || "—"}`,
    `Return ETA: ${plan.returnEta || "—"}`,
    `Route: ${plan.route || "—"}`,
    `Radio: ${plan.radio || "—"}`,
  ];
  if (plan.notes) lines.push(`Notes: ${plan.notes}`);
  lines.push("", "DISTRESS CONTACTS");
  for (const c of contacts) {
    lines.push(`${c.name} (${c.role}): ${c.phone || "add a number"}`);
  }
  lines.push("", "CHECKLIST (reminder — not a hull log)", "EPIRB 406", "VHF 16", "DSC");
  return lines.join("\n");
}

export function SafetyPanel() {
  const plan = useAhanu((s) => s.floatPlan);
  const update = useAhanu((s) => s.updateFloatPlan);
  const contacts = useAhanu((s) => s.contacts);
  const v = useAhanu((s) => s.vessel);
  const clock = useAhanu((s) => s.clockMs);
  const tide = useMemo(() => tideAt(v.lat, v.lon, new Date(clock)), [v.lat, v.lon, clock]);
  const cur = useMemo(() => currentAt(v.lat, v.lon, new Date(clock)), [v.lat, v.lon, clock]);
  const [copied, setCopied] = useState(false);

  const summary = useMemo(
    () =>
      planPlaintext(plan, contacts, formatCoord(v), new Date(clock).toISOString().slice(0, 16)),
    [plan, contacts, v, clock],
  );

  return (
    <Pane title="Safety" kicker="Float plan">
      <div className="space-y-2">
        <Field label="Skipper">
          <Input placeholder="Skipper" value={plan.skipper} onChange={(e) => update({ skipper: e.target.value })} />
        </Field>
        <Field label="Vessel">
          <Input placeholder="Vessel" value={plan.vessel} onChange={(e) => update({ vessel: e.target.value })} />
        </Field>
        <Field label="Departure">
          <Input value={plan.departure} onChange={(e) => update({ departure: e.target.value })} />
        </Field>
        <Field label="Return ETA">
          <Input value={plan.returnEta} onChange={(e) => update({ returnEta: e.target.value })} />
        </Field>
        <Field label="Souls on board">
          <Input
            type="number"
            min={0}
            value={plan.souls}
            onChange={(e) => update({ souls: Number(e.target.value) })}
          />
        </Field>
        <Field label="Route">
          <Textarea value={plan.route} onChange={(e) => update({ route: e.target.value })} />
        </Field>
        <Field label="Radio">
          <Input value={plan.radio} onChange={(e) => update({ radio: e.target.value })} />
        </Field>
        <Field label="Notes">
          <Textarea value={plan.notes} onChange={(e) => update({ notes: e.target.value })} />
        </Field>
      </div>
      <Button
        variant="outline"
        className="mt-3 w-full"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(summary);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied" : "Copy float plan"}
      </Button>
      <p className="mt-3 text-xs text-muted">
        File this with someone on the beach before you lose cell. Ahanu keeps the copy onboard.
      </p>
      <Separator className="my-4" />
      <h3 className="mb-2 text-sm font-medium">Distress</h3>
      <ul className="space-y-1 text-xs">
        {contacts.map((c) => (
          <li key={c.id}>
            <span className="text-foam">{c.name}</span>
            <span className="block text-muted">
              {c.role} · {c.phone || "add a number"}
            </span>
          </li>
        ))}
      </ul>
      <Separator className="my-4" />
      <h3 className="mb-2 text-sm font-medium">EPIRB / VHF 16 / DSC</h3>
      <p className="mb-2 text-[11px] text-muted">
        Static reminder. Not a completed log of this boat.
      </p>
      <ul className="space-y-2">
        {KIT.map((item) => (
          <li key={item.id} className="rounded-lg bg-elevated px-3 py-2">
            <p className="text-sm text-foam">{item.label}</p>
            <p className="text-[11px] text-muted">{item.note}</p>
          </li>
        ))}
      </ul>
      <Separator className="my-4" />
      <h3 className="mb-2 text-sm font-medium">Tide & current</h3>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <Stat label="Height" value={`${tide.heightFt.toFixed(1)} ft`} />
        <Stat label="Tide" value={tide.rising ? "Rising" : "Falling"} />
        <Stat label="Current" value={`${cur.speedKt.toFixed(1)} kt ${compass(cur.dir)}`} />
        <Stat label="Next slack" value={formatClock(tide.nextSlack)} />
      </div>
      <p className="text-sm tabular">
        {tide.heightFt.toFixed(1)} ft {tide.rising ? "rising" : "falling"} · current {cur.speedKt.toFixed(1)} kt{" "}
        {compass(cur.dir)}
      </p>
      <p className="mt-2 text-[11px] text-muted">Flood sets {compass(tide.floodDir)}.</p>
      <Badge tone="muted" className="mt-3">
        Harmonic tide · not a CO-OPS gauge
      </Badge>
    </Pane>
  );
}
