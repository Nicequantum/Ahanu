import { Badge } from "@/components/ui/badge";
import { formatClock, moonPhase, moonTimes, solunarPeriods, sunTimes } from "@/lib/ahanu/solunar";
import { useAhanu } from "@/lib/ahanu/store";
import { Pane, Stat } from "@/components/panels/pane";

function inWindow(now: number, w: [Date, Date]) {
  return now >= w[0].getTime() && now <= w[1].getTime();
}

export function SolunarPanel() {
  const v = useAhanu((s) => s.vessel);
  const clock = useAhanu((s) => s.clockMs);
  const date = new Date(clock);
  const sol = solunarPeriods(v.lat, v.lon, date);
  const sun = sunTimes(v.lat, v.lon, date);
  const moon = moonPhase(date);
  const times = moonTimes(v.lat, v.lon, date);
  const now = date.getTime();
  const majorNow = sol.major.some((w) => inWindow(now, w));
  const minorNow = sol.minor.some((w) => inWindow(now, w));
  const illum = Math.round(Math.abs(Math.sin(moon.phase * Math.PI)) * 100);
  const major = [...sol.major].sort((a, b) => a[0].getTime() - b[0].getTime());
  const minor = [...sol.minor].sort((a, b) => a[0].getTime() - b[0].getTime());

  return (
    <Pane title="Solunar" kicker={moon.name}>
      <p className="font-display text-5xl text-sunrise tabular">{sol.score}</p>
      <p className="mb-2 text-sm text-muted">
        {sol.rating} feeding window · {illum}% illuminated
      </p>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {majorNow ? <Badge tone="sunrise">Major now</Badge> : null}
        {minorNow && !majorNow ? <Badge tone="lagoon">Minor now</Badge> : null}
        {!majorNow && !minorNow ? <Badge tone="muted">{sol.rating}</Badge> : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Sunrise" value={formatClock(sun.sunrise)} />
        <Stat label="Sunset" value={formatClock(sun.sunset)} />
        <Stat label="Moonrise" value={times.moonrise ? formatClock(times.moonrise) : "—"} />
        <Stat label="Moonset" value={times.moonset ? formatClock(times.moonset) : "—"} />
      </div>
      <h3 className="mt-4 mb-2 text-sm font-medium">Major</h3>
      {major.length === 0 ? (
        <p className="text-sm text-muted">No major window this civil day.</p>
      ) : (
        major.map((w) => (
          <p key={w[0].toISOString()} className="text-sm tabular">
            {formatClock(w[0])} – {formatClock(w[1])}
            {inWindow(now, w) ? <span className="ml-2 text-sunrise">now</span> : null}
          </p>
        ))
      )}
      <h3 className="mt-4 mb-2 text-sm font-medium">Minor</h3>
      {minor.length === 0 ? (
        <p className="text-sm text-muted">No minor window this civil day.</p>
      ) : (
        minor.map((w) => (
          <p key={w[0].toISOString()} className="text-sm tabular">
            {formatClock(w[0])} – {formatClock(w[1])}
            {inWindow(now, w) ? <span className="ml-2 text-lagoon">now</span> : null}
          </p>
        ))
      )}
    </Pane>
  );
}
