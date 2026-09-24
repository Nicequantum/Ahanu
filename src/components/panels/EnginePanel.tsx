import { useMemo, useState, type CSSProperties } from "react";
import { BarGraph } from "@/components/engine/BarGraph";
import { DeltaChip } from "@/components/engine/DeltaChip";
import { FaultPill } from "@/components/engine/FaultPill";
import { NeedleGauge } from "@/components/engine/NeedleGauge";
import { NumericReadout } from "@/components/engine/NumericReadout";
import { TachArc } from "@/components/engine/TachArc";
import { CARB_PARAMS, EFI_PARAMS, ENGINE_THRESHOLDS, PARAM_UNIT } from "@/lib/ahanu/engine/config";
import { bankDelta } from "@/lib/ahanu/engine/delta";
import { assignInstance } from "@/lib/ahanu/engine/map";
import { displayValue } from "@/lib/ahanu/engine/quality";
import { DEFAULT_THEME_ID, STEALTH_NIGHT, themesFromBundles, type EngineTheme } from "@/lib/ahanu/engine/theme";
import { useAhanu } from "@/lib/ahanu/store";
import type { EngineAlarm, EngineId, EngineReading } from "@/lib/ahanu/types";

const WIDGET: Record<string, { kind: "tach" | "needle" | "bar" | "num"; min: number; max: number; digits: number }> = {
  rpm: { kind: "tach", min: 0, max: 4800, digits: 0 },
  coolantTemp: { kind: "needle", min: 100, max: 220, digits: 0 },
  oilPressure: { kind: "needle", min: 0, max: 80, digits: 0 },
  voltage: { kind: "needle", min: 10, max: 16, digits: 1 },
  hours: { kind: "num", min: 0, max: 1, digits: 0 },
  trim: { kind: "bar", min: 0, max: 100, digits: 0 },
  boost: { kind: "bar", min: 0, max: 15, digits: 1 },
  fuelRate: { kind: "num", min: 0, max: 40, digits: 1 },
  afrCommanded: { kind: "num", min: 10, max: 18, digits: 1 },
  afrActual: { kind: "num", min: 10, max: 18, digits: 1 },
  knock: { kind: "num", min: 0, max: 20, digits: 0 },
  injectorPw: { kind: "num", min: 0, max: 20, digits: 1 },
  fuelPressure: { kind: "needle", min: 0, max: 80, digits: 0 },
  egt: { kind: "needle", min: 200, max: 1400, digits: 0 },
  transTemp: { kind: "needle", min: 100, max: 240, digits: 0 },
  transPressure: { kind: "needle", min: 0, max: 400, digits: 0 },
  gear: { kind: "num", min: 0, max: 2, digits: 0 },
};

function byBank(readings: EngineReading[], id: EngineId, param: string): EngineReading | undefined {
  return readings.find((row) => row.engineId === id && row.param === param);
}

function missingAlarm(): EngineAlarm {
  return {
    tier: 2,
    engineId: "unmapped",
    code: "dtc-unavailable",
    description: "unavailable",
    state: "unavailable",
    ts: new Date(0).toISOString(),
    source: "sim",
  };
}

function Gauge({
  param,
  reading,
  onHold,
}: {
  param: string;
  reading?: EngineReading;
  onHold: () => void;
}) {
  const spec = WIDGET[param] ?? { kind: "num" as const, min: 0, max: 1, digits: 0 };
  const label = param.replace(/([A-Z])/g, " $1");
  if (spec.kind === "tach") return <TachArc reading={reading} label={label} max={spec.max} onHold={onHold} />;
  if (spec.kind === "needle") return <NeedleGauge reading={reading} label={label} min={spec.min} max={spec.max} digits={spec.digits} onHold={onHold} />;
  if (spec.kind === "bar") return <BarGraph reading={reading} label={label} min={spec.min} max={spec.max} digits={spec.digits} onHold={onHold} />;
  return <NumericReadout reading={reading} label={label} digits={spec.digits} onHold={onHold} />;
}

export function EnginePanel() {
  const readings = useAhanu((s) => s.engineReadings);
  const alarms = useAhanu((s) => s.engineAlarms);
  const dtcs = useAhanu((s) => s.engineDtcs);
  const mode = useAhanu((s) => s.engineMode);
  const setMode = useAhanu((s) => s.setEngineMode);
  const themeId = useAhanu((s) => s.engineThemeId);
  const setTheme = useAhanu((s) => s.setEngineTheme);
  const map = useAhanu((s) => s.engineInstanceMap);
  const assign = useAhanu((s) => s.setEngineMap);
  const setFeed = useAhanu((s) => s.setEngineFeed);
  const setHost = useAhanu((s) => s.setEngineHost);
  const feed = useAhanu((s) => s.engineFeed);
  const host = useAhanu((s) => s.engineHost);
  const note = useAhanu((s) => s.engineNote);
  const focus = useAhanu((s) => s.engineFocus);
  const setFocus = useAhanu((s) => s.setEngineFocus);
  const [gear, setGear] = useState(false);
  const themes = useMemo(() => themesFromBundles(), []);
  const theme = themes.find((row) => row.id === themeId) ?? themes.find((row) => row.id === DEFAULT_THEME_ID) ?? STEALTH_NIGHT;
  const params = mode === "efi" ? [...CARB_PARAMS, ...EFI_PARAMS.filter((p) => !p.startsWith("cylTrim"))] : [...CARB_PARAMS];
  const cyl = mode === "efi" ? EFI_PARAMS.filter((p) => p.startsWith("cylTrim")) : [];
  const instances = [...new Set(readings.map((row) => row.instance).filter((id): id is number => id != null))];
  const unmapped = instances.filter((id) => map[String(id)] == null);

  return (
    <div className="h-full overflow-y-auto px-3 py-3" style={shell(theme)}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] tracking-[0.22em] uppercase" style={{ color: "var(--er-accent)" }}>Trojan 32 · twin 350</p>
          <h2 className="font-display text-2xl" style={{ fontFamily: "var(--er-display)" }}>Engine room</h2>
        </div>
        <button type="button" aria-label="Themes" className="rounded-md px-2 py-1 text-xs" style={{ color: "var(--er-muted)" }} onClick={() => setGear((v) => !v)}>
          Themes
        </button>
      </div>
      <div className="mb-3 flex gap-2">
        {(["carb", "efi"] as const).map((id) => (
          <button key={id} type="button" onClick={() => setMode(id)} className="rounded-full px-3 py-1 text-xs" style={pill(theme, mode === id)}>
            {id === "carb" ? "Carbureted" : "EFI"}
          </button>
        ))}
      </div>
      {gear && (
        <div className="mb-3 grid grid-cols-2 gap-1">
          {themes.map((row) => (
            <button key={row.id} type="button" className="rounded-md px-2 py-1 text-left text-xs" style={pill(theme, row.id === theme.id)} onClick={() => { setTheme(row.id); setGear(false); }}>
              {row.label}
            </button>
          ))}
        </div>
      )}
      {unmapped.length > 0 && (
        <div className="mb-3 rounded-lg p-2" style={{ background: "var(--er-face)" }}>
          <p className="mb-2 text-[10px] tracking-[0.16em] uppercase" style={{ color: "var(--er-warn)" }}>Calibrate instances · not guessed</p>
          {unmapped.map((id) => {
            const rpm = readings.find((row) => row.instance === id && row.param === "rpm");
            return (
              <div key={id} className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs">Instance {id} · {displayValue(rpm, 0)} rpm</span>
                <span className="flex gap-1">
                  <button type="button" className="rounded px-2 py-1 text-[10px]" style={pill(theme, false)} onClick={() => assign(assignInstance(map, id, "port"))}>Port</button>
                  <button type="button" className="rounded px-2 py-1 text-[10px]" style={pill(theme, false)} onClick={() => assign(assignInstance(map, id, "starboard"))}>Stbd</button>
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="mb-3 grid grid-cols-4 gap-1">
        {["rpm", "coolantTemp", "oilPressure", "voltage"].map((param) => {
          const rule = ENGINE_THRESHOLDS.delta[param];
          const delta = rule ? bankDelta(byBank(readings, "port", param), byBank(readings, "starboard", param), rule) : { text: "—", worse: null };
          return <DeltaChip key={param} label={param === "coolantTemp" ? "coolant" : param === "oilPressure" ? "oil" : param} text={delta.text} hot={delta.worse != null} />;
        })}
      </div>
      {focus ? (
        <DeepDive param={focus.param} engineId={focus.engineId} onClose={() => setFocus(null)} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {(["port", "starboard"] as const).map((id) => (
            <section key={id}>
              <p className="mb-1 text-[10px] tracking-[0.2em] uppercase" style={{ color: "var(--er-accent)" }}>{id}</p>
              <div className="space-y-2">
                {params.map((param) => (
                  <Gauge key={param} param={param} reading={byBank(readings, id, param)} onHold={() => setFocus({ param, engineId: id })} />
                ))}
                {cyl.map((param) => (
                  <Gauge key={param} param={param} reading={byBank(readings, id, param)} onHold={() => setFocus({ param, engineId: id })} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-1">
        {alarms.filter((row) => row.tier === 1 && row.state === "active").map((row) => (
          <FaultPill key={`${row.code}-${row.instance ?? row.engineId}`} alarm={row} />
        ))}
        {dtcs.length === 0 ? <FaultPill alarm={missingAlarm()} /> : dtcs.map((row) => (
          <FaultPill key={row.code} alarm={{ ...missingAlarm(), code: row.code, description: row.description, state: row.state, tier: 2 }} />
        ))}
      </div>
      <p className="mt-2 text-[10px]" style={{ color: "var(--er-muted)" }}>{note || "Sim · no gateway · receive only"}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {(["sim", "analog", "digital"] as const).map((id) => (
          <button key={id} type="button" className="rounded-full px-2 py-1 text-[10px]" style={pill(theme, feed === id)} onClick={() => setFeed(id)}>
            {id}
          </button>
        ))}
      </div>
      <label className="mt-2 block text-[10px]" style={{ color: "var(--er-muted)" }}>
        Gateway host · stored, not dialed
        <input value={host} placeholder="empty" onChange={(e) => setHost(e.target.value)} className="mt-1 w-full rounded-md bg-transparent px-2 py-1 text-xs" style={{ boxShadow: "inset 0 0 0 1px var(--er-tick)", color: "var(--er-ink)" }} />
      </label>
    </div>
  );
}

function DeepDive({ param, engineId, onClose }: { param: string; engineId: EngineId; onClose: () => void }) {
  const readings = useAhanu((s) => s.engineReadings);
  const alarms = useAhanu((s) => s.engineAlarms);
  const dtcs = useAhanu((s) => s.engineDtcs);
  const row = byBank(readings, engineId, param);
  const age = row ? Math.max(0, Date.now() - Date.parse(row.ts)) : null;
  return (
    <div className="rounded-lg p-3" style={{ background: "var(--er-face)" }}>
      <button type="button" className="mb-2 text-[10px] tracking-[0.16em] uppercase" style={{ color: "var(--er-accent)" }} onClick={onClose}>Back</button>
      <p className="text-lg" style={{ color: "var(--er-ink)" }}>{param}</p>
      <p className="text-sm tabular-nums">{displayValue(row, 1)} {row?.unit ?? PARAM_UNIT[param] ?? ""}</p>
      <dl className="mt-2 space-y-1 text-xs" style={{ color: "var(--er-muted)" }}>
        <div>Source {row?.source ?? "—"}</div>
        <div>Quality {row?.quality ?? "missing"}</div>
        <div>Age {age == null ? "—" : `${age} ms`}</div>
        <div>Instance {row?.instance ?? "—"}</div>
        <div>PGN {row?.pgn ?? "—"}</div>
        <div>Bank {engineId}</div>
      </dl>
      <p className="mt-3 text-[10px] tracking-[0.16em] uppercase">Tier 1</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {alarms.filter((item) => item.tier === 1).length === 0 ? <span className="text-xs">clear</span> : alarms.filter((item) => item.tier === 1).map((item) => <FaultPill key={item.code} alarm={item} />)}
      </div>
      <p className="mt-3 text-[10px] tracking-[0.16em] uppercase">Tier 2 DTC</p>
      <div className="mt-1">{dtcs.length === 0 ? <FaultPill alarm={missingAlarm()} /> : null}</div>
    </div>
  );
}

function shell(theme: EngineTheme): CSSProperties {
  return {
    background: theme.palette.bg,
    color: theme.palette.ink,
    fontFamily: theme.typography.ui,
    ["--er-face" as string]: theme.palette.face,
    ["--er-ink" as string]: theme.palette.ink,
    ["--er-muted" as string]: theme.palette.muted,
    ["--er-accent" as string]: theme.palette.accent,
    ["--er-hot" as string]: theme.palette.hot,
    ["--er-ok" as string]: theme.palette.ok,
    ["--er-warn" as string]: theme.palette.warn,
    ["--er-tick" as string]: theme.palette.tick,
    ["--er-display" as string]: theme.typography.display,
    ["--er-figure" as string]: theme.typography.figure,
    boxShadow: theme.background === "vignette" ? "inset 0 0 80px rgb(0 0 0 / 0.45)" : undefined,
    animation: theme.animation === "phosphor" ? "ahanu-phosphor 4.5s steps(2) infinite" : undefined,
  };
}

function pill(theme: EngineTheme, on: boolean): CSSProperties {
  return {
    background: on ? theme.palette.accent : theme.palette.face,
    color: on ? theme.palette.bg : theme.palette.ink,
  };
}
