import { ChartIsland } from "@/components/ahanu/ChartIsland";
import { PanelBody } from "@/components/ahanu/Panels";
import { CompassTape } from "@/components/ahanu/CompassTape";
import { MarkBurst } from "@/components/ahanu/MarkBurst";
import { NmeaRail } from "@/components/ahanu/NmeaRail";
import { Onboarding } from "@/components/ahanu/Onboarding";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { SignedIn, SignedOut, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { compass, formatCoord, measureSummary, metersToFathoms, metersToFeet } from "@/lib/ahanu/geo";
import { gribAt, scoreGoNoGo } from "@/lib/ahanu/grib";
import { sstC } from "@/lib/ahanu/ocean";
import { habitatScore, zoneLabel } from "@/lib/ahanu/scoring";
import { nearestCanyon } from "@/lib/data/canyons";
import { SPECIES_LABELS } from "@/lib/data/species";
import { applyDisplayMode, applyPersistedDisplayMode } from "@/lib/ahanu/display-mode";
import { markFishHere, useAhanu } from "@/lib/ahanu/store";
import { readyOffshoreBadge } from "@/lib/ahanu/pack";
import { restorePackedSession } from "@/lib/ahanu/pack-client";
import { packedEpoch } from "@/lib/ahanu/packed-fields";
import type { PanelId } from "@/lib/ahanu/types";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import {
  Anchor,
  BookOpen,
  CloudSun,
  Compass,
  Crosshair,
  Fish,
  Layers,
  LifeBuoy,
  MapPinned,
  Moon,
  Package,
  Pause,
  Play,
  Settings,
  Sparkles,
  RotateCcw,
  Ruler,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { toast } from "sonner";

applyPersistedDisplayMode();

const NAV: { id: Exclude<PanelId, null>; icon: typeof Layers; label: string }[] = [
  { id: "layers", icon: Layers, label: "Layers" },
  { id: "weather", icon: CloudSun, label: "Weather" },
  { id: "intel", icon: Sparkles, label: "Intel" },
  { id: "log", icon: Fish, label: "Log" },
  { id: "knowledge", icon: BookOpen, label: "Tricks" },
  { id: "plan", icon: Compass, label: "Plan" },
  { id: "packs", icon: Package, label: "Packs" },
  { id: "safety", icon: LifeBuoy, label: "Safety" },
  { id: "species", icon: MapPinned, label: "Species" },
  { id: "solunar", icon: Moon, label: "Solunar" },
  { id: "settings", icon: Settings, label: "Bridge" },
];

export function AppShell() {
  const panel = useAhanu((s) => s.panel);
  const setPanel = useAhanu((s) => s.setPanel);
  const mode = useAhanu((s) => s.displayMode);
  const { isPending } = useCurrentUserState();

  useEffect(() => {
    void useAhanu.persist.rehydrate();
    useAhanu.getState().setHydrated();
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw-ahanu.js", { type: "module" }).catch(() => undefined);
    }
    void restorePackedSession().then((manifest) => {
      if (manifest) {
        useAhanu.setState({ packManifest: manifest, packEpoch: packedEpoch() });
      }
    });
  }, []);

  useLayoutEffect(() => {
    applyDisplayMode(mode);
  }, [mode]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = now - last;
      if (dt >= 90) {
        useAhanu.getState().tickSim(dt);
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="relative h-svh w-full overflow-hidden bg-abyss text-foam" data-mode={mode}>
      <ChartIsland />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-abyss/20 via-transparent to-abyss/25" />
      <TopBar />
      <MarkBurst />
      <Onboarding />
      <nav className="absolute top-16 left-2 z-20 hidden w-14 flex-col items-center gap-1 rounded-2xl bg-surface/90 py-2 shadow-[0_0_0_1px_var(--color-line)] backdrop-blur-md md:flex">
        {NAV.map((n) => (
          <button
            key={n.id}
            type="button"
            title={n.label}
            aria-label={n.label}
            onClick={() => setPanel(panel === n.id ? null : n.id)}
            className={cn(
              "grid size-11 place-items-center rounded-xl text-muted transition-colors",
              panel === n.id ? "bg-sunrise text-sunrise-fg" : "hover:bg-elevated hover:text-foam",
            )}
          >
            <n.icon className="size-4" />
          </button>
        ))}
      </nav>
      <aside
        className={cn(
          "absolute top-16 right-2 bottom-28 z-20 w-[min(100%-1rem,380px)] overflow-hidden rounded-2xl bg-surface/94 shadow-[0_0_0_1px_var(--color-line)] backdrop-blur-md transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] md:bottom-24",
          panel ? "translate-x-0" : "pointer-events-none translate-x-[120%]",
        )}
      >
        {panel && <PanelBody id={panel} />}
      </aside>
      <InstrumentBar />
      <MobileNav />
      {isPending ? null : null}
    </div>
  );
}

function TopBar() {
  const v = useAhanu((s) => s.vessel);
  const packs = useAhanu((s) => s.packLayers);
  const packReady = useAhanu((s) => s.packReady);
  const hour = useAhanu((s) => s.forecastHour);
  const boat = useAhanu((s) => s.boat);
  const clock = useAhanu((s) => s.clockMs);
  const ready = packs.filter((p) => p.status === "ready").length;
  const grib = gribAt(v.lat, v.lon, hour);
  const go = scoreGoNoGo(grib.windKt, grib.waveFt, boat);
  const canyon = nearestCanyon(v);
  return (
    <header className="absolute top-2 right-2 left-2 z-30 flex items-center gap-2 rounded-2xl bg-surface/90 px-3 py-2 shadow-[0_0_0_1px_var(--color-line)] backdrop-blur-md md:left-[4.25rem]">
      <div className="min-w-0">
        <p className="font-display text-lg leading-none">Ahanu</p>
        <p className="truncate text-[10px] tracking-[0.18em] text-muted uppercase">ah-HAH-noo · {canyon.name}</p>
      </div>
      <div className="ml-auto hidden items-center gap-3 md:flex">
        <HudChip label="SOG" value={`${v.sog.toFixed(1)} kt`} />
        <HudChip label="COG" value={`${v.cog.toFixed(0)}° ${compass(v.cog)}`} />
        <HudChip label="Depth" value={`${metersToFathoms(v.depthM).toFixed(0)} fm`} />
        <HudChip label="SST" value={`${sstC(v.lat, v.lon, hour).toFixed(1)}°`} />
      </div>
      <Badge tone={go === "go" ? "go" : go === "caution" ? "caution" : "nogo"}>{go}</Badge>
      <Badge
        tone={
          packReady?.ready
            ? readyOffshoreBadge(packReady).caution
              ? "caution"
              : "lagoon"
            : "caution"
        }
      >
        {packReady
          ? readyOffshoreBadge(packReady).short
          : packs.length
            ? `${ready}/${packs.length}`
            : "No pack"}
      </Badge>
      <span className="hidden text-xs text-muted tabular md:inline">
        {new Date(clock).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </span>
      <SignedOut>
        <Link to="/login" className="text-xs text-sunrise underline-offset-4 hover:underline">
          Sign in
        </Link>
      </SignedOut>
      <SignedIn>
        <div className="scale-90">
          <UserButton />
        </div>
      </SignedIn>
    </header>
  );
}

function HudChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[4.5rem]">
      <p className="text-[9px] tracking-[0.2em] text-faint uppercase">{label}</p>
      <p className="text-sm tabular leading-tight">{value}</p>
    </div>
  );
}

function InstrumentBar() {
  const v = useAhanu((s) => s.vessel);
  const hour = useAhanu((s) => s.forecastHour);
  const setHour = useAhanu((s) => s.setHour);
  const species = useAhanu((s) => s.species);
  const measure = useAhanu((s) => s.measure);
  const toggleMeasure = useAhanu((s) => s.toggleMeasure);
  const follow = useAhanu((s) => s.followShip);
  const setFollow = useAhanu((s) => s.setFollow);
  const drop = useAhanu((s) => s.dropAnchor);
  const weigh = useAhanu((s) => s.weighAnchor);
  const score = habitatScore(v.lat, v.lon, species, hour, new Date(useAhanu.getState().clockMs));
  const summary = useMemo(() => measureSummary(measure.points), [measure.points]);
  const [live, setLive] = useState(false);
  const playing = useAhanu((s) => s.forecastPlaying);
  const setPlaying = useAhanu((s) => s.setPlaying);
  const replayT = useAhanu((s) => s.replayT);
  const setReplayT = useAhanu((s) => s.setReplayT);
  const nmea = useAhanu((s) => s.nmeaGateway);
  useEffect(() => setLive(true), []);

  return (
    <div className="absolute right-2 bottom-16 left-2 z-30 flex flex-col gap-2 md:bottom-3 md:left-[4.25rem]">
      <div className="flex items-center gap-3 rounded-2xl bg-surface/90 px-3 py-2 shadow-[0_0_0_1px_var(--color-line)] backdrop-blur-md">
        <span className="text-[10px] tracking-widest text-faint uppercase">+{hour}h</span>
        <IconBtn title={playing ? "Pause forecast" : "Play 72h"} onClick={() => setPlaying(!playing)} active={playing}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </IconBtn>
        {live ? (
          <Slider className="flex-1" min={0} max={72} step={3} value={[hour]} onValueChange={([h]) => setHour(h ?? 0)} />
        ) : (
          <div className="h-1.5 flex-1 rounded-full bg-elevated" />
        )}
        <span className="text-[10px] text-muted">72h</span>
      </div>
      <div className="flex items-center gap-2 rounded-2xl bg-surface/90 px-2 py-2 shadow-[0_0_0_1px_var(--color-line)] backdrop-blur-md">
        <p className="hidden px-2 text-[11px] text-muted md:block">
          {formatCoord(v)} · {metersToFeet(v.depthM).toFixed(0)} ft · {SPECIES_LABELS[species]} {zoneLabel(score)} {score}
        </p>
        <div className="ml-auto flex items-center gap-1">
          <IconBtn title="Measure" onClick={toggleMeasure} active={measure.active}>
            <Ruler className="size-4" />
          </IconBtn>
          <IconBtn title="Follow" onClick={() => setFollow(!follow)} active={follow}>
            <Crosshair className="size-4" />
          </IconBtn>
          <IconBtn title="Anchor" onClick={v.anchored ? weigh : drop} active={v.anchored}>
            <Anchor className="size-4" />
          </IconBtn>
          <IconBtn
            title="Replay track"
            onClick={() => setReplayT(replayT == null ? 0 : null)}
            active={replayT != null}
          >
            <RotateCcw className="size-4" />
          </IconBtn>
          <Button
            className="ml-1"
            onClick={() => {
              markFishHere();
              toast("Catch logged", { description: "SST, depth, and time stored locally." });
            }}
          >
            Mark fish
          </Button>
        </div>
      </div>
      {nmea && (
        <div className="hidden md:block">
          <NmeaRail />
        </div>
      )}
      <CompassTape heading={v.heading} cog={v.cog} className="hidden md:block" />
      {measure.active && (
        <p className="rounded-xl bg-elevated px-3 py-1.5 text-xs text-muted">
          Tap the chart to measure. {summary.legs} legs
          {summary.nm ? ` · ${summary.nm.toFixed(2)} nm · ${summary.bearing.toFixed(0)}° ${compass(summary.bearing)}` : ""}.
          Right-click drops a waypoint.
        </p>
      )}
      {live && replayT != null && (
        <div className="hidden items-center gap-3 rounded-xl bg-surface/90 px-3 py-1.5 shadow-[0_0_0_1px_var(--color-line)] md:flex">
          <span className="text-[10px] tracking-widest text-faint uppercase">Replay</span>
          <Slider
            className="flex-1"
            min={0}
            max={100}
            step={1}
            value={[Math.round((replayT ?? 1) * 100)]}
            onValueChange={([n]) => setReplayT((n ?? 100) >= 99 ? null : (n ?? 0) / 100)}
          />
          <span className="text-[10px] text-muted">{replayT == null ? "live" : `${Math.round(replayT * 100)}%`}</span>
        </div>
      )}
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "grid size-11 place-items-center rounded-xl",
        active ? "bg-sunrise text-sunrise-fg" : "text-foam hover:bg-elevated",
      )}
    >
      {children}
    </button>
  );
}

function MobileNav() {
  const panel = useAhanu((s) => s.panel);
  const setPanel = useAhanu((s) => s.setPanel);
  const items = NAV.filter((n) => ["layers", "intel", "log", "knowledge", "packs"].includes(n.id));
  return (
    <nav className="absolute right-2 bottom-2 left-2 z-30 flex items-center justify-around rounded-2xl bg-surface/95 px-1 py-1 shadow-[0_0_0_1px_var(--color-line)] backdrop-blur-md md:hidden">
      {items.map((n) => (
        <button
          key={n.id}
          type="button"
          aria-label={n.label}
          onClick={() => setPanel(panel === n.id ? null : n.id)}
          className={cn(
            "flex h-12 flex-1 flex-col items-center justify-center gap-0.5 text-[10px]",
            panel === n.id ? "text-sunrise" : "text-muted",
          )}
        >
          <n.icon className="size-4" />
          {n.label}
        </button>
      ))}
    </nav>
  );
}
