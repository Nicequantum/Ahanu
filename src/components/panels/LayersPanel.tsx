import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { LAYER_META } from "@/lib/ahanu/constants";
import { aisHelmLabel, encHelmLabel } from "@/lib/ahanu/packed-chart";
import { layerPaintSource, layerPaintTone } from "@/lib/ahanu/layer-status";
import { useAhanu } from "@/lib/ahanu/store";
import type { LayerId } from "@/lib/ahanu/types";
import { Pane } from "@/components/panels/pane";

const GROUPS = ["chart", "ocean", "weather", "intel", "ops"] as const;

export function LayersPanel() {
  const layers = useAhanu((s) => s.layers);
  const toggle = useAhanu((s) => s.toggleLayer);
  const setOp = useAhanu((s) => s.setOpacity);
  useAhanu((s) => s.packEpoch);

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
            {ids.map((id) => {
              const origin = layerPaintSource(id);
              return (
                <div key={id} className="mb-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      <span className="truncate">{id === "enc" ? encHelmLabel() : id === "ais" ? aisHelmLabel() : LAYER_META[id].label}</span>
                      <Badge
                        tone={layerPaintTone(origin)}
                        className="shrink-0 text-[10px] uppercase tracking-wider"
                      >
                        {origin}
                      </Badge>
                    </span>
                    <Switch
                      checked={layers[id].visible}
                      onCheckedChange={() => toggle(id)}
                      disabled={origin === "missing"}
                    />
                  </div>
                  {layers[id].visible && origin !== "missing" && (
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
              );
            })}
          </div>
        );
      })}
      <p className="text-xs text-muted">
        Packed / fixture = trip-pack grid or vector. Synthetic = demo field with no pack. Missing = pack
        loaded without that layer. Derived = on-device from packed SST/chl. Local = seed chart when no
        pack. ENC official S-57 paints an extract from packed NOAA .000 bytes plus ISO 8211 .00n updates when those files are in the zip (coastline, shoreline, depth areas/contours, wrecks/obstructions when present, aids, lights, soundings) — S-57 extract, not an ECDIS. A zip with no .001 is base .000 only. Catalog-only packs stay aid boxes.
        HMS closed areas are a reminder overlay, not a legal determination — verify with NOAA HMS
        before you leave the dock. AIS paints a packed AISStream snapshot when that layer is live;
        otherwise the overlay is empty (miss) — never the invented demo fleet.
      </p>
      <p className="mt-2 text-xs text-muted">Right-click the chart to drop a mark. Measure lives on the instruments bar.</p>
    </Pane>
  );
}
