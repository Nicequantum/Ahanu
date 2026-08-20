import { useEffect, useState, type ComponentType } from "react";

/**
 * MapLibre is a WebGL browser client. Load the plotter only after mount so
 * Cloudflare / Node SSR never pull `maplibre-gl` into a Worker bundle.
 */
export function ChartIsland() {
  const [Map, setMap] = useState<ComponentType | null>(null);

  useEffect(() => {
    let live = true;
    void import("@/components/chartplotter/ChartMap").then((m) => {
      if (live) setMap(() => m.ChartMap);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!Map) {
    return <div className="absolute inset-0 h-full w-full bg-abyss" data-map="ahanu" />;
  }
  return <Map />;
}
