import { FloatPlanExport } from "@/components/panels/FloatPlanExport";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { POINT_JUDITH, VEATCH_HEAD } from "@/lib/ahanu/constants";
import { fuelPlan, rangeRingNm } from "@/lib/ahanu/fuel";
import { haversineNm, hoursToHm } from "@/lib/ahanu/geo";
import { useAhanu } from "@/lib/ahanu/store";
import { PORTS } from "@/lib/data/ports";
import type { ReactNode } from "react";
import { Pane, Stat } from "@/components/panels/pane";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-muted">{label}</span>
      {children}
    </label>
  );
}

export function PlanPanel() {
  const boat = useAhanu((s) => s.boat);
  const update = useAhanu((s) => s.updateBoat);
  const v = useAhanu((s) => s.vessel);
  const steamNm = haversineNm(POINT_JUDITH, VEATCH_HEAD) * 2;
  const fuel = fuelPlan({
    nm: steamNm,
    cruiseKt: boat.cruiseKt,
    trollHours: 10,
    boat,
  });
  const range = rangeRingNm(boat, v.sog || boat.cruiseKt);

  return (
    <Pane title="Trip plan" kicker="Fuel · route · ports">
      <p className="mb-3 text-sm text-muted">
        Round trip Point Judith → Veatch at {boat.cruiseKt} kt plus 10 hours of trolling on {boat.name}.{" "}
        {steamNm.toFixed(0)} nm steam.
      </p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        <Stat label="Steam" value={hoursToHm(fuel.steamHours)} />
        <Stat label="Burn" value={`${fuel.fuelUsed.toFixed(0)} gal`} />
        <Stat label="Left" value={`${fuel.fuelLeft.toFixed(0)} gal`} />
        <Stat label="Range ring" value={`${range.toFixed(0)} nm`} />
      </div>
      <Badge tone={fuel.ok ? "go" : "nogo"}>{fuel.ok ? "Fuel plan holds" : "Into reserve"}</Badge>
      <p className="mt-2 text-xs text-muted">{fuel.note}</p>
      <p className="mt-1 text-[11px] text-muted">
        Range ring at {(v.sog || boat.cruiseKt).toFixed(1)} kt SOG, tank minus {boat.reserveGal} gal reserve.
      </p>
      <Separator className="my-4" />
      <div className="space-y-2">
        <Field label="Boat name">
          <Input value={boat.name} onChange={(e) => update({ name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Fuel gal">
            <Input
              type="number"
              min={0}
              value={boat.fuelGal}
              onChange={(e) => update({ fuelGal: Number(e.target.value) })}
            />
          </Field>
          <Field label="Reserve gal">
            <Input
              type="number"
              min={0}
              value={boat.reserveGal}
              onChange={(e) => update({ reserveGal: Number(e.target.value) })}
            />
          </Field>
          <Field label="Cruise gph">
            <Input
              type="number"
              min={0}
              value={boat.gphCruise}
              onChange={(e) => update({ gphCruise: Number(e.target.value) })}
            />
          </Field>
          <Field label="Troll gph">
            <Input
              type="number"
              min={0}
              value={boat.gphTroll}
              onChange={(e) => update({ gphTroll: Number(e.target.value) })}
            />
          </Field>
        </div>
      </div>
      <Separator className="my-4" />
      <label className="text-[11px] text-muted">Cruise knots</label>
      <Slider
        className="my-2"
        min={12}
        max={28}
        step={0.5}
        value={[boat.cruiseKt]}
        onValueChange={([n]) => update({ cruiseKt: n ?? 21 })}
      />
      <p className="mb-3 text-xs tabular text-muted">{boat.cruiseKt.toFixed(1)} kt cruise · {boat.trollKt.toFixed(1)} kt troll</p>
      <label className="text-[11px] text-muted">Max wind / max wave</label>
      <div className="mt-2 flex gap-2">
        <Input
          type="number"
          value={boat.maxWindKt}
          onChange={(e) => update({ maxWindKt: Number(e.target.value) })}
        />
        <Input
          type="number"
          value={boat.maxWaveFt}
          onChange={(e) => update({ maxWaveFt: Number(e.target.value) })}
        />
      </div>
      <Separator className="my-4" />
      <h3 className="mb-2 text-sm font-medium">Ports</h3>
      <ul className="space-y-1 text-xs">
        {PORTS.map((p) => (
          <li key={p.id} className="flex justify-between">
            <span>
              {p.name} · {p.state}
            </span>
            <span className="text-muted tabular">{haversineNm(p, VEATCH_HEAD).toFixed(0)} nm to Veatch</span>
          </li>
        ))}
      </ul>
      <Separator className="my-4" />
      <FloatPlanExport />
    </Pane>
  );
}
