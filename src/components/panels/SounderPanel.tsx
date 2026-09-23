import { Pane, Stat } from "@/components/panels/pane";
import { metersToFathoms } from "@/lib/ahanu/geo";
import { useAhanu } from "@/lib/ahanu/store";

/** Dedicated fish-finder. Depth and marks stay off the chart. */
export function SounderPanel() {
  const trace = useAhanu((s) => s.sonarTrace);
  const depth = useAhanu((s) => s.vessel.depthM);
  const on = useAhanu((s) => s.layers.sonar?.visible ?? true);
  const last = trace[trace.length - 1];
  const shown = last?.depthM ?? depth;
  const cols = trace.slice(-48);

  return (
    <Pane title="Sounder" kicker="Fish finder · not on the chart">
      <p className="mb-3 text-xs text-muted">
        Simulated transducer until a real sounder is on the bus. Marks do not paint the plotter.
      </p>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Stat label="Depth" value={`${shown.toFixed(0)} m`} />
        <Stat label="Fathoms" value={metersToFathoms(shown).toFixed(1)} />
      </div>
      {!on ? (
        <p className="text-xs text-faint">Sonar layer is off. Turn it on under Layers if you want the trace.</p>
      ) : (
        <div
          className="flex h-56 items-end gap-px overflow-hidden rounded-xl bg-abyss p-2"
          aria-label="Echogram"
        >
          {cols.length === 0 ? (
            <p className="text-xs text-faint">Waiting for a ping.</p>
          ) : (
            cols.map((col, i) => {
              const scale = Math.max(shown, 8);
              return (
                <div key={`${col.at}-${i}`} className="relative h-full min-w-0 flex-1">
                  <div
                    className="absolute right-0 bottom-0 left-0 bg-lagoon-dim/80"
                    style={{ height: `${Math.min(100, (col.depthM / (scale * 1.15)) * 100)}%` }}
                  />
                  {col.marks.map((m, j) => (
                    <div
                      key={j}
                      className="absolute right-0 left-0 h-1.5 rounded-sm bg-sunrise"
                      style={{ bottom: `${Math.min(96, (m.depthM / (scale * 1.15)) * 100)}%` }}
                    />
                  ))}
                </div>
              );
            })
          )}
        </div>
      )}
      <p className="mt-2 text-[10px] tracking-widest text-faint uppercase">
        {last?.provenance === "stub" ? "Stub · no transducer" : last ? last.provenance : "idle"}
      </p>
    </Pane>
  );
}
