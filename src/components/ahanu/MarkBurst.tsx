import { metersToFathoms } from "@/lib/ahanu/geo";
import { sstC } from "@/lib/ahanu/ocean";
import { useAhanu } from "@/lib/ahanu/store";
import type { SpeciesId } from "@/lib/ahanu/types";
import { SPECIES_LABELS } from "@/lib/data/species";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

interface Burst {
  id: string;
  species: SpeciesId;
  sstC: number;
  depthM: number;
}

export function MarkBurst() {
  const ripple = useAhanu((s) => s.markRipple);
  const [burst, setBurst] = useState<Burst | null>(null);
  const [visible, setVisible] = useState(false);
  const timers = useRef<{ hide: number; gone: number } | null>(null);

  useEffect(() => {
    return () => {
      if (!timers.current) return;
      window.clearTimeout(timers.current.hide);
      window.clearTimeout(timers.current.gone);
    };
  }, []);

  useEffect(() => {
    if (!ripple) return;
    const s = useAhanu.getState();
    const rec = s.catches.find((c) => c.id === ripple.id);
    setBurst({
      id: ripple.id,
      species: rec?.species ?? s.species,
      sstC: rec?.sstC ?? sstC(ripple.lat, ripple.lon, s.forecastHour),
      depthM: rec?.depthM ?? s.vessel.depthM,
    });
    setVisible(true);
    if (timers.current) {
      window.clearTimeout(timers.current.hide);
      window.clearTimeout(timers.current.gone);
    }
    timers.current = {
      hide: window.setTimeout(() => setVisible(false), 2200),
      gone: window.setTimeout(() => {
        setBurst(null);
        timers.current = null;
      }, 2600),
    };
  }, [ripple]);

  if (!burst) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-20 z-40 flex justify-center px-3">
      <div
        className={cn(
          "glass rounded-2xl px-5 py-3 text-center transition duration-300 ease-out motion-reduce:scale-100 motion-reduce:transition-none",
          visible ? "scale-100 opacity-100" : "scale-95 opacity-0",
        )}
        role="status"
      >
        <p className="font-display text-lg leading-tight text-sunrise">He laughs.</p>
        <p className="mt-0.5 text-xs text-foam">{SPECIES_LABELS[burst.species]}</p>
        <p className="mt-1 text-[10px] tracking-wide text-faint tabular">
          {burst.sstC.toFixed(1)}°C · {metersToFathoms(burst.depthM).toFixed(0)} fm
        </p>
      </div>
    </div>
  );
}
