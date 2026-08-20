import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SPECIES_ORDER } from "@/lib/ahanu/constants";
import { useAhanu } from "@/lib/ahanu/store";
import { REGS } from "@/lib/data/regs";
import { SPECIES, SPECIES_LABELS, speciesColor } from "@/lib/data/species";
import { cn } from "@/lib/utils";
import { Pane, Stat } from "@/components/panels/pane";

export function SpeciesPanel() {
  const species = useAhanu((s) => s.species);
  const setSpecies = useAhanu((s) => s.setSpecies);
  const s = SPECIES[species];
  const mine = REGS.filter((r) => r.species === species);
  const general = REGS.filter((r) => !r.species);
  const rest = REGS.filter((r) => r.species && r.species !== species);
  const ordered = [...mine, ...general, ...rest];

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
      <p className="font-display text-xl" style={{ color: speciesColor(species) }}>
        {s.common}
      </p>
      <p className="mb-3 text-xs text-muted italic">{s.scientific}</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {s.likesBreaks ? <Badge tone="sunrise">Breaks</Badge> : null}
        {s.likesChlEdge ? <Badge tone="lagoon">Color edge</Badge> : null}
        {s.likesWeed ? <Badge tone="lagoon">Weed</Badge> : null}
        {s.nightBonus > 0 ? <Badge tone="muted">Night +{Math.round(s.nightBonus * 100)}</Badge> : null}
      </div>
      <p className="mb-3 text-sm leading-relaxed">{s.tactics}</p>
      <p className="mb-4 text-sm text-muted">{s.idNotes}</p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        <Stat label="SST window" value={`${s.sstMinC}–${s.sstMaxC}°C`} />
        <Stat label="Depth" value={`${s.depthMinM}–${s.depthMaxM} m`} />
        <Stat label="Pref SST" value={`${s.sstPrefC[0]}–${s.sstPrefC[1]}°C`} />
        <Stat label="Night bonus" value={s.nightBonus > 0 ? `+${s.nightBonus.toFixed(2)}` : "none"} />
      </div>
      <Separator className="my-3" />
      <h3 className="mb-2 text-sm font-medium">REGS</h3>
      <p className="mb-3 text-[11px] text-muted">
        Educational snapshot. Not legal advice — verify with NOAA HMS before you leave the dock.
      </p>
      {ordered.map((r) => (
        <article key={r.id} className="mb-3">
          <h3 className="text-sm font-medium">
            {r.title}
            {r.species === species ? (
              <Badge tone="sunrise" className="ml-2">
                This species
              </Badge>
            ) : null}
          </h3>
          <p className="text-xs leading-relaxed text-muted">{r.body}</p>
        </article>
      ))}
    </Pane>
  );
}
