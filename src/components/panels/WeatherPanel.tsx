import { WeatherSpark } from "@/components/ahanu/WeatherSpark";
import { Pane, Stat } from "@/components/panels/pane";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { POINT_JUDITH, VEATCH_HEAD } from "@/lib/ahanu/constants";
import { compass, hoursToHm } from "@/lib/ahanu/geo";
import { forecastSeries, gribAt, routeWeather, scoreGoNoGo } from "@/lib/ahanu/grib";
import { useAhanu } from "@/lib/ahanu/store";
import { buoyAtHour, BUOYS } from "@/lib/data/buoys";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

export function WeatherPanel() {
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
  const goTone =
    now.waveFt / boat.maxWaveFt > 1 || now.windKt / boat.maxWindKt > 1
      ? "nogo"
      : now.waveFt / boat.maxWaveFt > 0.8
        ? "caution"
        : "go";

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
      <div className="mt-3">
        <WeatherSpark lat={v.lat} lon={v.lon} hour={hour} onHour={setHour} />
      </div>
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
