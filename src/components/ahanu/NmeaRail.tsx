import { Badge } from "@/components/ui/badge";
import { gribAt } from "@/lib/ahanu/grib";
import { gatewayFeed } from "@/lib/ahanu/nmea";
import { useAhanu } from "@/lib/ahanu/store";
import { cn } from "@/lib/utils";

export function NmeaRail({ className }: { className?: string }) {
  const vessel = useAhanu((s) => s.vessel);
  const hour = useAhanu((s) => s.forecastHour);
  const clockMs = useAhanu((s) => s.clockMs);
  const on = useAhanu((s) => s.nmeaGateway);
  const wind = gribAt(vessel.lat, vessel.lon, hour);
  const sentences = gatewayFeed({
    lat: vessel.lat,
    lon: vessel.lon,
    sog: vessel.sog,
    cog: vessel.cog,
    heading: vessel.heading,
    depthM: vessel.depthM,
    windKt: wind.windKt,
    windDir: wind.windDir,
    date: new Date(clockMs),
  }).slice(0, 4);

  return (
    <div
      className={cn(
        "flex items-center gap-2 overflow-x-auto rounded-xl bg-elevated px-2 py-1.5 pointer-events-auto",
        className,
      )}
      aria-label="NMEA gateway feed"
    >
      <Badge tone={on ? "lagoon" : "muted"} className="shrink-0 tracking-[0.14em] uppercase">
        GATEWAY · Wi-Fi
      </Badge>
      <div className="flex min-w-0 items-center gap-4">
        {sentences.map((s) => (
          <span key={s} className="font-mono text-xs whitespace-nowrap text-lagoon/90">
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}
