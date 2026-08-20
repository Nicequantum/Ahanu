import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAhanu } from "@/lib/ahanu/store";
import type { TripPackLayer } from "@/lib/ahanu/types";
import { Pane } from "@/components/panels/pane";

function packTone(status: TripPackLayer["status"]): "go" | "caution" | "nogo" | "muted" {
  if (status === "ready") return "go";
  if (status === "stale" || status === "downloading") return "caution";
  return "nogo";
}

export function PacksPanel() {
  const packs = useAhanu((s) => s.packLayers);
  const mark = useAhanu((s) => s.markPack);
  const all = useAhanu((s) => s.downloadAllPacks);
  const total = packs.length;
  const ready = packs.filter((p) => p.status === "ready").length;
  const pct = total ? (ready / total) * 100 : 0;
  const offshore = packs.every((p) => p.status === "ready" || p.id === "ais");

  return (
    <Pane title="Trip packs" kicker="Pre-departure">
      <div className="mb-3 flex items-center justify-between">
        <Badge tone={offshore ? "go" : "caution"}>
          {offshore ? "Ready for offshore" : `${ready}/${total} ready`}
        </Badge>
        <Button size="sm" onClick={all}>
          Sync remaining
        </Button>
      </div>
      <div className="mb-1 flex items-baseline justify-between text-[11px] text-muted">
        <span>
          {ready}/{total} packed
        </span>
        <span className="tabular">{pct.toFixed(0)}%</span>
      </div>
      <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-elevated">
        <div className="h-full bg-sunrise" style={{ width: `${pct}%` }} />
      </div>
      <p className="mb-3 text-xs text-muted">
        AIS is a gateway feed, not a file. That pack may stay missing or labelled gateway — live targets need a
        radio or NMEA path. Ready for offshore does not wait on it.
      </p>
      <ul className="space-y-2">
        {packs.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-elevated px-3 py-2">
            <div>
              <p className="text-sm">{p.label}</p>
              <p className="text-[11px] text-muted">
                {p.id === "ais"
                  ? "gateway · live feed"
                  : `${p.sizeMb} MB · ${!p.updatedAt || p.updatedAt === "—" ? "not packed" : p.updatedAt.slice(0, 16)}`}
              </p>
              {p.id === "ais" ? (
                <p className="mt-1 text-[11px] text-muted">
                  May stay gateway. Toggle only if you actually have a snapshot.
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="text-[11px] tracking-wide uppercase"
              onClick={() => mark(p.id, p.status === "ready" ? "stale" : "ready")}
            >
              <Badge tone={packTone(p.status)}>{p.status === "missing" && p.id === "ais" ? "gateway" : p.status}</Badge>
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
