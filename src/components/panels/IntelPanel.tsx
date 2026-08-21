import { Pane, Stat } from "@/components/panels/pane";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { depthM } from "@/lib/ahanu/bathymetry";
import { SPECIES_ORDER } from "@/lib/ahanu/constants";
import { chlorophyll, sstC, sstGradient } from "@/lib/ahanu/ocean";
import { briefing, habitatScore, rankCells, zoneLabel } from "@/lib/ahanu/scoring";
import { useAhanu } from "@/lib/ahanu/store";
import { nearestCanyon } from "@/lib/data/canyons";
import { SPECIES_LABELS } from "@/lib/data/species";
import { askSkipper } from "@/lib/server/ask-skipper";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";

export function IntelPanel() {
  const v = useAhanu((s) => s.vessel);
  const species = useAhanu((s) => s.species);
  const setSpecies = useAhanu((s) => s.setSpecies);
  const hour = useAhanu((s) => s.forecastHour);
  const clock = useAhanu((s) => s.clockMs);
  const setFollow = useAhanu((s) => s.setFollow);
  const addWaypoint = useAhanu((s) => s.addWaypoint);
  const date = useMemo(() => new Date(clock), [clock]);
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
          <li key={`${c.lat}-${c.lon}`}>
            <button
              type="button"
              onClick={() => {
                setFollow(false);
                addWaypoint({
                  name: `INTEL ${c.score}`,
                  lat: c.lat,
                  lon: c.lon,
                  depthM: depthM(c.lat, c.lon),
                  tags: ["intel"],
                });
              }}
              className="flex w-full items-baseline justify-between rounded-md px-1 py-1 text-left tabular hover:bg-elevated"
            >
              <span className="text-muted">
                {i + 1}. {c.lat.toFixed(2)}N {Math.abs(c.lon).toFixed(2)}W
              </span>
              <span className="text-sunrise">{c.score}</span>
            </button>
          </li>
        ))}
      </ol>
      <Button
        variant="outline"
        className="w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const res = await askSkipper({ data: { prompt: text } });
            setAi(res.ok ? res.text : res.error);
          } catch (err) {
            const msg = err instanceof Error ? err.message : "";
            setAi(msg === "Unauthorized" ? "Sign in to ask the skipper" : "Skipper AI is not available");
          }
          setBusy(false);
        }}
      >
        {busy ? "Asking the skipper…" : "Ask the skipper to read this scene"}
      </Button>
      {ai && <p className="mt-3 text-sm leading-relaxed text-foam/90">{ai}</p>}
    </Pane>
  );
}
