import { TideCurveCard, TideHarborChips } from "@/components/ahanu/TideCurve";
import { FloatPlanExport } from "@/components/panels/FloatPlanExport";
import { Pane, Stat } from "@/components/panels/pane";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { compass } from "@/lib/ahanu/geo";
import { formatClock } from "@/lib/ahanu/solunar";
import { useAhanu } from "@/lib/ahanu/store";
import { packedTideCurve, packedTideHarbors, resolveTideHarbor } from "@/lib/ahanu/tide-curve";
import { currentAt, tideAt } from "@/lib/ahanu/tides";
import { useMemo, type ReactNode } from "react";

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

export function SafetyPanel() {
  const plan = useAhanu((s) => s.floatPlan);
  const update = useAhanu((s) => s.updateFloatPlan);
  const contacts = useAhanu((s) => s.contacts);
  const v = useAhanu((s) => s.vessel);
  const clock = useAhanu((s) => s.clockMs);
  const packEpoch = useAhanu((s) => s.packEpoch);
  const harborPick = useAhanu((s) => s.tideHarbor);
  const setTideHarbor = useAhanu((s) => s.setTideHarbor);
  const harbor = useMemo(() => resolveTideHarbor(harborPick), [harborPick, packEpoch]);
  const tide = useMemo(() => tideAt(v.lat, v.lon, new Date(clock)), [v.lat, v.lon, clock]);
  const cur = useMemo(() => currentAt(v.lat, v.lon, new Date(clock)), [v.lat, v.lon, clock]);
  const curve = useMemo(() => packedTideCurve(new Date(clock), harbor), [clock, harbor, packEpoch]);
  const harbors = useMemo(() => packedTideHarbors(), [packEpoch]);

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
      <Separator className="my-4" />
      <FloatPlanExport />
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
      <TideHarborChips
        harbors={harbors}
        selected={curve?.harbor ?? harbor}
        onSelect={setTideHarbor}
        className="mb-2"
      />
      <TideCurveCard curve={curve} now={new Date(clock)} />
      <div className="mt-3 mb-2 grid grid-cols-2 gap-2">
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
        {curve ? (curve.live ? "Packed CO-OPS · not a live gauge" : "Packed fixture tides · not a live gauge") : "Harmonic tide · not a CO-OPS gauge"}
      </Badge>
    </Pane>
  );
}
