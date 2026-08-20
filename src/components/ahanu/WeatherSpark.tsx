import { forecastSeries, gribAt } from "@/lib/ahanu/grib";
import { cn } from "@/lib/utils";
import { useMemo, useState, useEffect } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const SUNRISE = "#e4b56a";
const LAGOON = "#4ecdc4";

export function WeatherSpark({
  lat,
  lon,
  hour,
  onHour,
}: {
  lat: number;
  lon: number;
  hour: number;
  onHour?: (h: number) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const series = useMemo(() => forecastSeries(lat, lon), [lat, lon]);
  const now = useMemo(() => gribAt(lat, lon, hour), [lat, lon, hour]);

  const band = Math.max(1.5, (series[1]?.hour ?? 3) / 2);

  return (
    <div className="pointer-events-auto w-full">
      <div className="mb-1 flex items-baseline gap-3 px-0.5">
        <p className="text-[10px] tracking-[0.18em] text-faint uppercase">72h GRIB</p>
        <p className="ml-auto text-[10px] text-sunrise tabular">
          Wind {now.windKt.toFixed(0)} kt
        </p>
        <p className="text-[10px] text-lagoon tabular">Waves {now.waveFt.toFixed(1)} ft</p>
        <p className="text-[10px] text-faint tabular">+{hour}h</p>
      </div>
      <div className={cn("h-24 w-full", onHour && "cursor-crosshair")}>
        {mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={series}
              margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
              onClick={(state) => {
                const n = Number(state?.activeLabel);
                if (Number.isFinite(n)) onHour?.(n);
              }}
            >
              <XAxis
                dataKey="hour"
                type="number"
                domain={[0, 72]}
                ticks={[0, 24, 48, 72]}
                tick={{ fill: "var(--color-faint)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis yAxisId="wind" hide domain={[0, 36]} />
              <YAxis yAxisId="wave" hide domain={[0, 14]} orientation="right" />
              <Tooltip
                cursor={{ stroke: SUNRISE, strokeWidth: 1, strokeOpacity: 0.45 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const wind = payload.find((p) => p.dataKey === "windKt")?.value;
                  const wave = payload.find((p) => p.dataKey === "waveFt")?.value;
                  return (
                    <div className="rounded-md bg-elevated px-2 py-1 text-[10px] text-foam shadow-[0_0_0_1px_var(--color-line)]">
                      <p className="text-faint tabular">+{String(label)}h</p>
                      <p className="text-sunrise tabular">
                        Wind {typeof wind === "number" ? wind.toFixed(0) : "—"} kt
                      </p>
                      <p className="text-lagoon tabular">
                        Waves {typeof wave === "number" ? wave.toFixed(1) : "—"} ft
                      </p>
                    </div>
                  );
                }}
              />
              <ReferenceArea
                yAxisId="wind"
                x1={hour - band}
                x2={hour + band}
                fill={SUNRISE}
                fillOpacity={0.12}
                ifOverflow="hidden"
              />
              <ReferenceLine yAxisId="wind" x={hour} stroke={SUNRISE} strokeWidth={1} />
              <Area
                yAxisId="wave"
                type="monotone"
                dataKey="waveFt"
                name="Waves"
                stroke={LAGOON}
                fill={LAGOON}
                fillOpacity={0.18}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: LAGOON, stroke: "none" }}
                isAnimationActive={false}
              />
              <Line
                yAxisId="wind"
                type="monotone"
                dataKey="windKt"
                name="Wind"
                stroke={SUNRISE}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: SUNRISE, stroke: "none" }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full rounded-md bg-elevated/50" />
        )}
      </div>
    </div>
  );
}
