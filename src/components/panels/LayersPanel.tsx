import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { LAYER_META } from "@/lib/ahanu/constants";
import { useAhanu } from "@/lib/ahanu/store";
import type { LayerId } from "@/lib/ahanu/types";
import { Pane } from "@/components/panels/pane";

const GROUPS = ["chart", "ocean", "weather", "intel", "ops"] as const;

export function LayersPanel() {
  const layers = useAhanu((s) => s.layers);
  const toggle = useAhanu((s) => s.toggleLayer);
  const setOp = useAhanu((s) => s.setOpacity);

  return (
    <Pane title="Layers" kicker="Chartplotter">
      {GROUPS.map((g) => {
        const ids = (Object.keys(LAYER_META) as LayerId[]).filter((id) => LAYER_META[id].group === g);
        const on = ids.filter((id) => layers[id].visible).length;
        return (
          <div key={g} className="mb-5">
            <p className="mb-2 text-[10px] tracking-[0.2em] text-faint uppercase">
              {g} · {on}/{ids.length}
            </p>
            {ids.map((id) => (
              <div key={id} className="mb-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">{LAYER_META[id].label}</span>
                  <Switch checked={layers[id].visible} onCheckedChange={() => toggle(id)} />
                </div>
                {layers[id].visible && (
                  <div className="mt-2">
                    <Slider
                      min={0.15}
                      max={1}
                      step={0.05}
                      value={[layers[id].opacity]}
                      onValueChange={([v]) => setOp(id, v ?? 0.5)}
                    />
                    <p className="mt-1 text-[10px] tabular text-faint">{Math.round(layers[id].opacity * 100)}%</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}
      <p className="text-xs text-muted">Right-click the chart to drop a mark. Measure lives on the instruments bar.</p>
    </Pane>
  );
}
