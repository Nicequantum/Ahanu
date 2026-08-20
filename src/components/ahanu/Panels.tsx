import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { LAYER_META, DISPLAY_MODES, SPECIES_ORDER } from "@/lib/ahanu/constants";
import { formatCoord, formatLat, formatLon, compass, haversineNm, hoursToHm, metersToFathoms, pathLengthNm } from "@/lib/ahanu/geo";
import { forecastSeries, gribAt, routeWeather, scoreGoNoGo } from "@/lib/ahanu/grib";
import { sstC, chlorophyll, sstGradient } from "@/lib/ahanu/ocean";
import { briefing, habitatScore, rankCells, zoneLabel } from "@/lib/ahanu/scoring";
import { formatClock, moonPhase, solunarPeriods, sunTimes } from "@/lib/ahanu/solunar";
import { tideAt, currentAt } from "@/lib/ahanu/tides";
import { fuelPlan, rangeRingNm } from "@/lib/ahanu/fuel";
import { useAhanu } from "@/lib/ahanu/store";
import { CANYONS, nearestCanyon } from "@/lib/data/canyons";
import { buoyAtHour, BUOYS } from "@/lib/data/buoys";
import { ARTICLES } from "@/lib/data/knowledge";
import { REGS } from "@/lib/data/regs";
import { SPECIES, SPECIES_LABELS, speciesColor } from "@/lib/data/species";
import { COMMUNITY_REPORTS } from "@/lib/data/community";
import { PORTS } from "@/lib/data/ports";
import { POINT_JUDITH, VEATCH_HEAD } from "@/lib/ahanu/constants";
import { askSkipper } from "@/lib/server/ask-skipper";
import type { LayerId, PanelId } from "@/lib/ahanu/types";
import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

function Pane({ title, kicker, children }: { title: string; kicker?: string; children: ReactNode }) {
  return (
    <ScrollArea className="h-full px-4 py-4">
      <p className="text-[10px] tracking-[0.22em] text-sunrise uppercase">{kicker ?? "Ahanu"}</p>
      <h2 className="font-display mb-4 text-2xl text-foam">{title}</h2>
      {children}
    </ScrollArea>
  );
}

function LayersPanel() {
  const layers = useAhanu((s) => s.layers);
  const toggle = useAhanu((s) => s.toggleLayer);
  const setOp = useAhanu((s) => s.setOpacity);
  const groups = ["chart", "ocean", "weather", "intel", "ops"] as const;
  return (
    <Pane title="Layers" kicker="Chartplotter">
      {groups.map((g) => (
        <div key={g} className="mb-5">
          <p className="mb-2 text-[10px] tracking-[0.2em] text-faint uppercase">{g}</p>
          {(Object.keys(LAYER_META) as LayerId[])
            .filter((id) => LAYER_META[id].group === g)
            .map((id) => (
              <div key={id} className="mb-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">{LAYER_META[id].label}</span>
                  <Switch checked={layers[id].visible} onCheckedChange={() => toggle(id)} />
                </div>
                {layers[id].visible && (
                  <Slider
                    className="mt-2"
                    min={0.15}
                    max={1}
                    step={0.05}
                    value={[layers[id].opacity]}
                    onValueChange={([v]) => setOp(id, v ?? 0.5)}
                  />
                )}
              </div>
            ))}
        </div>
      ))}
      <p className="text-xs text-muted">Right-click the chart to drop a mark. Measure lives on the instruments bar.</p>
    </Pane>
  );
}

function WeatherPanel() {
  const v = useAhanu((s) => s.vessel);
  const boat = useAhanu((s) => s.boat);
  const hour = useAhanu((s) => s.forecastHour);
  const setHour = useAhanu((s) => s.setHour);
  const series = useMemo(() => forecastSeries(v.lat, v.lon), [v.lat, v.lon]);
  const now = gribAt(v.lat, v.lon, hour);
  const route = useMemo(
    () => routeWeather([POINT_JUDITH, { lat: 40.55, lon: -70.85 }, VEATCH_HEAD], boat.cruiseKt, 0, boat),
    [boat],
  );
  const goTone = now.waveFt / boat.maxWaveFt > 1 || now.windKt / boat.maxWindKt > 1 ? "nogo" : now.waveFt / boat.maxWaveFt > 0.8 ? "caution" : "go";
  return (
    <Pane title="Weather & sea" kicker="GRIB pack">
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Stat label="Wind" value={`${now.windKt.toFixed(0)} kt ${compass(now.windDir)}`} />
        <Stat label="Gust" value={`${now.gustKt.toFixed(0)} kt`} />
        <Stat label="Waves" value={`${now.waveFt.toFixed(1)} ft`} />
        <Stat label="Period" value={`${now.periodS.toFixed(0)} s`} />
        <Stat label="Swell" value={`${now.swellFt.toFixed(1)} ft ${compass(now.swellDir)}`} />
        <Stat label="Pressure" value={`${now.pressureMb.toFixed(0)} mb`} />
      </div>
      <Badge tone={goTone}>{scoreGoNoGo(now.windKt, now.waveFt, boat).toUpperCase()}</Badge>
      <p className="mt-3 mb-1 text-[10px] tracking-widest text-faint uppercase">Forecast hour {hour}</p>
      <Slider min={0} max={72} step={3} value={[hour]} onValueChange={([h]) => setHour(h ?? 0)} />
      <div className="mt-3 flex gap-1 overflow-x-auto pb-2">
        {series.map((f) => (
          <button
            key={f.hour}
            type="button"
            onClick={() => setHour(f.hour)}
            className={cn(
              "flex min-w-10 flex-col items-center rounded-md px-1.5 py-1 text-[10px]",
              f.hour === hour ? "bg-sunrise text-sunrise-fg" : "bg-elevated text-muted",
            )}
          >
            <span>+{f.hour}</span>
            <span className="tabular">{f.waveFt.toFixed(0)}'</span>
            <span
              className={cn(
                "mt-0.5 size-1.5 rounded-full",
                f.go === "go" ? "bg-go" : f.go === "caution" ? "bg-caution" : "bg-nogo",
              )}
            />
          </button>
        ))}
      </div>
      <Separator className="my-4" />
      <h3 className="mb-2 text-sm font-medium">Steam PJ → Veatch</h3>
      <p className="text-xs text-muted">
        {route.nm.toFixed(0)} nm · {hoursToHm(route.hours)} · overall{" "}
        <span className="text-foam">{route.overall}</span>
      </p>
      <Separator className="my-4" />
      <h3 className="mb-2 text-sm font-medium">NDBC snapshot</h3>
      <div className="space-y-2">
        {BUOYS.slice(0, 8).map((b) => {
          const live = buoyAtHour(b.id, hour);
          return (
            <div key={b.id} className="flex items-baseline justify-between text-xs">
              <span className="text-muted">
                {live.id} {live.name}
              </span>
              <span className="tabular text-foam">
                {live.windKt.toFixed(0)} kt · {live.waveFt.toFixed(1)} ft · {live.sstC.toFixed(1)}°
              </span>
            </div>
          );
        })}
      </div>
    </Pane>
  );
}

function IntelPanel() {
  const v = useAhanu((s) => s.vessel);
  const species = useAhanu((s) => s.species);
  const setSpecies = useAhanu((s) => s.setSpecies);
  const hour = useAhanu((s) => s.forecastHour);
  const clock = useAhanu((s) => s.clockMs);
  const date = new Date(clock);
  const here = habitatScore(v.lat, v.lon, species, hour, date);
  const text = useMemo(() => briefing(species, hour, date, v), [species, hour, date, v]);
  const top = useMemo(() => rankCells(species, hour, date, 0.16).slice(0, 8), [species, hour, date]);
  const [ai, setAi] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Pane title="Fishing intel" kicker="On-device score">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {SPECIES_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setSpecies(id)}
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px]",
              species === id ? "bg-sunrise text-sunrise-fg" : "bg-elevated text-muted",
            )}
          >
            {SPECIES_LABELS[id]}
          </button>
        ))}
      </div>
      <div className="mb-3 flex items-end justify-between">
        <div>
          <p className="text-[10px] tracking-widest text-faint uppercase">Under the keel</p>
          <p className="font-display text-4xl text-sunrise tabular">{here}</p>
        </div>
        <Badge tone={here >= 70 ? "sunrise" : here >= 50 ? "lagoon" : "muted"}>{zoneLabel(here)}</Badge>
      </div>
      <p className="mb-4 text-sm leading-relaxed text-muted">{text}</p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        <Stat label="SST" value={`${sstC(v.lat, v.lon, hour).toFixed(1)} °C`} />
        <Stat label="Gradient" value={`${sstGradient(v.lat, v.lon, hour).toFixed(2)} °/nm`} />
        <Stat label="Color" value={`${chlorophyll(v.lat, v.lon, hour).toFixed(2)} chl`} />
        <Stat label="Canyon" value={nearestCanyon(v).name} />
      </div>
      <h3 className="mb-2 text-sm font-medium">Ranked cells</h3>
      <ol className="mb-4 space-y-1 text-xs">
        {top.map((c, i) => (
          <li key={`${c.lat}-${c.lon}`} className="flex justify-between tabular">
            <span className="text-muted">
              {i + 1}. {c.lat.toFixed(2)}N {Math.abs(c.lon).toFixed(2)}W
            </span>
            <span className="text-sunrise">{c.score}</span>
          </li>
        ))}
      </ol>
      <Button
        variant="outline"
        className="w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await askSkipper({ data: { prompt: text } });
          setAi(res.ok ? res.text : res.error);
          setBusy(false);
        }}
      >
        {busy ? "Asking the skipper…" : "Ask Grok to read this scene"}
      </Button>
      {ai && <p className="mt-3 text-sm leading-relaxed text-foam/90">{ai}</p>}
    </Pane>
  );
}

function LogPanel() {
  const catches = useAhanu((s) => s.catches);
  const waypoints = useAhanu((s) => s.waypoints);
  return (
    <Pane title="Catch log" kicker="Personal history">
      {catches.length === 0 ? (
        <p className="text-sm text-muted">
          No fish marked this trip. Hit the gold mark on the rail when the rod goes off — Ahanu will fill SST, depth, and time.
        </p>
      ) : (
        <ul className="space-y-3">
          {catches.map((c) => (
            <li key={c.id} className="rounded-xl bg-elevated p-3">
              <div className="flex justify-between">
                <span className="text-sm font-medium" style={{ color: speciesColor(c.species) }}>
                  {SPECIES_LABELS[c.species]}
                </span>
                <span className="text-[11px] text-muted tabular">{c.at.slice(11, 16)}</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {formatLat(c.lat)} {formatLon(c.lon)} · {c.sstC?.toFixed(1)}°C · {c.depthM?.toFixed(0)} m
              </p>
              {c.notes && <p className="mt-1 text-xs">{c.notes}</p>}
            </li>
          ))}
        </ul>
      )}
      <Separator className="my-4" />
      <h3 className="mb-2 text-sm font-medium">Marks ({waypoints.length})</h3>
      <ul className="space-y-1.5 text-xs">
        {waypoints.slice(0, 16).map((w) => (
          <li key={w.id} className="flex justify-between gap-2">
            <span className="truncate text-foam">{w.name}</span>
            <span className="shrink-0 text-muted">{w.depthM ? `${metersToFathoms(w.depthM).toFixed(0)} fm` : ""}</span>
          </li>
        ))}
      </ul>
    </Pane>
  );
}

function KnowledgePanel() {
  const articleId = useAhanu((s) => s.articleId);
  const setArticle = useAhanu((s) => s.setArticle);
  const [q, setQ] = useState("");
  const list = ARTICLES.filter(
    (a) =>
      !q ||
      a.title.toLowerCase().includes(q.toLowerCase()) ||
      a.body.toLowerCase().includes(q.toLowerCase()) ||
      a.tags.some((t) => t.includes(q.toLowerCase())),
  );
  const open = ARTICLES.find((a) => a.id === articleId);
  if (open) {
    return (
      <Pane title={open.title} kicker={`${open.minutes} min · ${open.category}`}>
        <Button variant="ghost" size="sm" className="mb-3 -ml-2" onClick={() => setArticle(null)}>
          All tricks
        </Button>
        {open.body.split("\n\n").map((p) => (
          <p key={p.slice(0, 24)} className="mb-3 text-sm leading-relaxed text-foam/90">
            {p}
          </p>
        ))}
      </Pane>
    );
  }
  return (
    <Pane title="Tricks of the Trade" kicker="Offline library">
      <Input placeholder="Search tactics, canyons, safety…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="mt-4 space-y-2">
        {list.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => setArticle(a.id)}
              className="w-full rounded-xl bg-elevated px-3 py-3 text-left hover:bg-elevated/70"
            >
              <span className="block text-sm text-foam">{a.title}</span>
              <span className="text-[11px] text-muted">
                {a.minutes} min · {a.category}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Pane>
  );
}

function PlanPanel() {
  const boat = useAhanu((s) => s.boat);
  const update = useAhanu((s) => s.updateBoat);
  const v = useAhanu((s) => s.vessel);
  const fuel = fuelPlan({
    nm: haversineNm(POINT_JUDITH, VEATCH_HEAD) * 2,
    cruiseKt: boat.cruiseKt,
    trollHours: 10,
    boat,
  });
  const range = rangeRingNm(boat, v.sog || boat.cruiseKt);
  return (
    <Pane title="Trip plan" kicker="Fuel · route · ports">
      <p className="mb-3 text-sm text-muted">
        Round trip Point Judith → Veatch at {boat.cruiseKt} kt plus 10 hours of trolling on {boat.name}.
      </p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        <Stat label="Steam" value={hoursToHm(fuel.steamHours)} />
        <Stat label="Burn" value={`${fuel.fuelUsed.toFixed(0)} gal`} />
        <Stat label="Left" value={`${fuel.fuelLeft.toFixed(0)} gal`} />
        <Stat label="Range now" value={`${range.toFixed(0)} nm`} />
      </div>
      <Badge tone={fuel.ok ? "go" : "nogo"}>{fuel.ok ? "Fuel plan holds" : "Into reserve"}</Badge>
      <p className="mt-2 text-xs text-muted">{fuel.note}</p>
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
      <h3 className="mb-2 text-sm font-medium">Home ports</h3>
      <ul className="space-y-1 text-xs">
        {PORTS.map((p) => (
          <li key={p.id} className="flex justify-between">
            <span>
              {p.name}
              {"state" in p ? ` · ${(p as { state?: string }).state}` : ""}
            </span>
            <span className="text-muted tabular">
              {haversineNm(p, VEATCH_HEAD).toFixed(0)} nm to Veatch
            </span>
          </li>
        ))}
      </ul>
    </Pane>
  );
}

function SafetyPanel() {
  const plan = useAhanu((s) => s.floatPlan);
  const update = useAhanu((s) => s.updateFloatPlan);
  const contacts = useAhanu((s) => s.contacts);
  const v = useAhanu((s) => s.vessel);
  const tide = tideAt(v.lat, v.lon, new Date());
  const cur = currentAt(v.lat, v.lon, new Date());
  return (
    <Pane title="Safety" kicker="Float plan">
      <div className="space-y-2">
        <Input placeholder="Skipper" value={plan.skipper} onChange={(e) => update({ skipper: e.target.value })} />
        <Input placeholder="Vessel" value={plan.vessel} onChange={(e) => update({ vessel: e.target.value })} />
        <Input value={plan.departure} onChange={(e) => update({ departure: e.target.value })} />
        <Input value={plan.returnEta} onChange={(e) => update({ returnEta: e.target.value })} />
        <Input
          type="number"
          value={plan.souls}
          onChange={(e) => update({ souls: Number(e.target.value) })}
        />
        <Textarea value={plan.route} onChange={(e) => update({ route: e.target.value })} />
        <Input value={plan.radio} onChange={(e) => update({ radio: e.target.value })} />
      </div>
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
        <li>VHF 16 · DSC · EPIRB · 406</li>
      </ul>
      <Separator className="my-4" />
      <h3 className="mb-2 text-sm font-medium">Tide</h3>
      <p className="text-sm tabular">
        {tide.heightFt.toFixed(1)} ft {tide.rising ? "rising" : "falling"} · current {cur.speedKt.toFixed(1)} kt{" "}
        {compass(cur.dir)}
      </p>
    </Pane>
  );
}

function PacksPanel() {
  const packs = useAhanu((s) => s.packLayers);
  const mark = useAhanu((s) => s.markPack);
  const all = useAhanu((s) => s.downloadAllPacks);
  const ready = packs.filter((p) => p.status === "ready").length;
  const offline = packs.every((p) => p.status === "ready" || p.id === "ais");
  return (
    <Pane title="Trip packs" kicker="Pre-departure">
      <div className="mb-4 flex items-center justify-between">
        <Badge tone={offline ? "go" : "caution"}>
          {offline ? "Ready for offshore" : `${ready}/${packs.length} ready`}
        </Badge>
        <Button size="sm" onClick={all}>
          Sync remaining
        </Button>
      </div>
      <ul className="space-y-2">
        {packs.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-elevated px-3 py-2">
            <div>
              <p className="text-sm">{p.label}</p>
              <p className="text-[11px] text-muted">
                {p.sizeMb} MB · {p.updatedAt === "—" ? "not packed" : p.updatedAt.slice(0, 16)}
              </p>
            </div>
            <button
              type="button"
              className="text-[11px] tracking-wide uppercase"
              onClick={() => mark(p.id, p.status === "ready" ? "stale" : "ready")}
            >
              <Badge tone={p.status === "ready" ? "go" : p.status === "stale" ? "caution" : "nogo"}>
                {p.status}
              </Badge>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted">
        Download while you still have Wi-Fi at Galilee. After that the pack is the ocean.
      </p>
    </Pane>
  );
}

function SpeciesPanel() {
  const species = useAhanu((s) => s.species);
  const setSpecies = useAhanu((s) => s.setSpecies);
  const s = SPECIES[species];
  return (
    <Pane title="Species & HMS" kicker="Identify · retain · release">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {SPECIES_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setSpecies(id)}
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px]",
              species === id ? "bg-sunrise text-sunrise-fg" : "bg-elevated text-muted",
            )}
          >
            {SPECIES_LABELS[id]}
          </button>
        ))}
      </div>
      <p className="font-display text-xl">{s.common}</p>
      <p className="mb-3 text-xs text-muted italic">{s.scientific}</p>
      <p className="mb-3 text-sm leading-relaxed">{s.tactics}</p>
      <p className="mb-4 text-sm text-muted">{s.idNotes}</p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        <Stat label="SST window" value={`${s.sstMinC}–${s.sstMaxC}°C`} />
        <Stat label="Depth" value={`${s.depthMinM}–${s.depthMaxM} m`} />
      </div>
      <Separator className="my-3" />
      {REGS.map((r) => (
        <article key={r.id} className="mb-3">
          <h3 className="text-sm font-medium">{r.title}</h3>
          <p className="text-xs leading-relaxed text-muted">{r.body}</p>
        </article>
      ))}
    </Pane>
  );
}

function SolunarPanel() {
  const v = useAhanu((s) => s.vessel);
  const clock = useAhanu((s) => s.clockMs);
  const date = new Date(clock);
  const sol = solunarPeriods(v.lat, v.lon, date);
  const sun = sunTimes(v.lat, v.lon, date);
  const moon = moonPhase(date);
  return (
    <Pane title="Solunar" kicker={moon.name}>
      <p className="font-display text-5xl text-sunrise tabular">{sol.score}</p>
      <p className="mb-4 text-sm text-muted">{sol.rating} feeding window · {Math.round(Math.abs(Math.sin(moon.phase * Math.PI)) * 100)}% illuminated</p>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Sunrise" value={formatClock(sun.sunrise)} />
        <Stat label="Sunset" value={formatClock(sun.sunset)} />
      </div>
      <h3 className="mt-4 mb-2 text-sm font-medium">Major</h3>
      {sol.major.map((w) => (
        <p key={w[0].toISOString()} className="text-sm tabular">
          {formatClock(w[0])} – {formatClock(w[1])}
        </p>
      ))}
      <h3 className="mt-4 mb-2 text-sm font-medium">Minor</h3>
      {sol.minor.map((w) => (
        <p key={w[0].toISOString()} className="text-sm tabular">
          {formatClock(w[0])} – {formatClock(w[1])}
        </p>
      ))}
    </Pane>
  );
}

function SettingsPanel() {
  const mode = useAhanu((s) => s.displayMode);
  const setMode = useAhanu((s) => s.setDisplayMode);
  const boat = useAhanu((s) => s.boat);
  const nav = useAhanu((s) => s.vessel.mode);
  const setNav = useAhanu((s) => s.setMode);
  const follow = useAhanu((s) => s.followShip);
  const setFollow = useAhanu((s) => s.setFollow);
  const drop = useAhanu((s) => s.dropAnchor);
  const weigh = useAhanu((s) => s.weighAnchor);
  const anchored = useAhanu((s) => s.vessel.anchored);
  return (
    <Pane title="Bridge" kicker="Display · nav">
      <p className="mb-2 text-[11px] tracking-widest text-faint uppercase">Night modes</p>
      <div className="mb-4 grid grid-cols-2 gap-2">
        {DISPLAY_MODES.map((m) => (
          <Button key={m.id} variant={mode === m.id ? "default" : "outline"} onClick={() => setMode(m.id)}>
            {m.label}
          </Button>
        ))}
      </div>
      <p className="mb-2 text-[11px] tracking-widest text-faint uppercase">Own-ship</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {(["trolling", "steaming", "gps", "anchor"] as const).map((m) => (
          <Button key={m} size="sm" variant={nav === m ? "default" : "outline"} onClick={() => setNav(m)}>
            {m}
          </Button>
        ))}
      </div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm">Follow vessel</span>
        <Switch checked={follow} onCheckedChange={setFollow} />
      </div>
      <Button variant="outline" className="w-full" onClick={anchored ? weigh : drop}>
        {anchored ? "Weigh anchor" : "Drop anchor alarm"}
      </Button>
      <p className="mt-4 text-xs text-muted">
        {boat.name} · cruise {boat.cruiseKt} kt · troll {boat.trollKt} kt. Charts are an aid, not a substitute for
        lookout and official ENC.
      </p>
    </Pane>
  );
}

function CommunityStrip() {
  return (
    <div className="mt-2 space-y-2">
      {COMMUNITY_REPORTS.slice(0, 4).map((r) => (
        <p key={r.id} className="text-xs text-muted">
          <span className="text-lagoon">{r.who}</span> · {SPECIES_LABELS[r.species]} · {r.note}
        </p>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-elevated px-3 py-2">
      <p className="text-[10px] tracking-widest text-faint uppercase">{label}</p>
      <p className="text-sm tabular text-foam">{value}</p>
    </div>
  );
}

export function PanelBody({ id }: { id: Exclude<PanelId, null> }) {
  switch (id) {
    case "layers":
      return <LayersPanel />;
    case "weather":
      return <WeatherPanel />;
    case "intel":
      return (
        <>
          <IntelPanel />
        </>
      );
    case "log":
      return <LogPanel />;
    case "knowledge":
      return <KnowledgePanel />;
    case "plan":
      return <PlanPanel />;
    case "safety":
      return <SafetyPanel />;
    case "packs":
      return <PacksPanel />;
    case "species":
      return <SpeciesPanel />;
    case "solunar":
      return <SolunarPanel />;
    case "settings":
      return <SettingsPanel />;
    default:
      return null;
  }
}

export { CommunityStrip, pathLengthNm };
