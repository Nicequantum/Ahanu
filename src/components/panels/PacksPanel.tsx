import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Pane } from "@/components/panels/pane";
import { POINT_JUDITH_CANYON_BBOX } from "@/lib/ahanu/constants";
import { useAhanu } from "@/lib/ahanu/store";
import type { TripPackLayer } from "@/lib/ahanu/types";
import { canRetryLiveOverlays, readyOffshoreBadge } from "@/lib/ahanu/pack";
import { ENC_AID_DISCLAIMER, packedEncCells } from "@/lib/ahanu/packed-chart";

/** Helm-only 2026-08-20: honest Live NOAA copy + NOAA/fixture count + live ingest errors and Retry. ENC catalog boxes paint on ChartMap from cell west/south/east/north — aid overlay, not official S-57. 72 h GFS series stays off. */

function packTone(status: TripPackLayer["status"]): "go" | "caution" | "nogo" | "muted" {
  if (status === "ready") return "go";
  if (status === "stale" || status === "downloading") return "caution";
  return "nogo";
}

function sourceTone(source: TripPackLayer["source"]): "muted" | "sunrise" | "go" {
  if (source === "noaa" || source === "r2") return "go";
  if (source === "fixture") return "sunrise";
  return "muted";
}

export function PacksPanel() {
  const packs = useAhanu((s) => s.packLayers);
  const bbox = useAhanu((s) => s.packBbox);
  const hours = useAhanu((s) => s.packHours);
  const start = useAhanu((s) => s.packStart);
  const setBbox = useAhanu((s) => s.setPackBbox);
  const setWindow = useAhanu((s) => s.setPackWindow);
  const download = useAhanu((s) => s.downloadTripPack);
  const ready = useAhanu((s) => s.packReady);
  const downloading = useAhanu((s) => s.packDownloading);
  const error = useAhanu((s) => s.packError);
  const live = useAhanu((s) => s.packLive);
  const liveErrors = useAhanu((s) => s.packLiveErrors) ?? [];
  const setLive = useAhanu((s) => s.setPackLive);
  const sstStaleOverride = useAhanu((s) => s.sstStaleOverride);
  const setSstStaleOverride = useAhanu((s) => s.setSstStaleOverride);
  const workerHint = useAhanu((s) => s.packManifest?.readyForOffshore);
  useAhanu((s) => s.packEpoch);
  const total = packs.length;
  const ok = packs.filter((p) => p.status === "ready").length;
  const noaaCount = packs.filter((p) => p.source === "noaa").length;
  const fixtureCount = packs.filter((p) => p.source === "fixture").length;
  const pct = total ? (ok / total) * 100 : 0;
  const offshore = Boolean(ready?.ready);
  const badge = readyOffshoreBadge(ready);
  const retryLive = canRetryLiveOverlays({
    live: Boolean(live),
    downloading,
    layers: packs,
    liveErrors,
  });

  return (
    <Pane title="Trip packs" kicker="Pre-departure">
      <div className="mb-3 flex items-center justify-between">
        <Badge tone={badge.caution ? "caution" : "go"}>{badge.long}</Badge>
        <Button
          size="sm"
          disabled={downloading}
          onClick={() => {
            void download();
          }}
        >
          {downloading ? "Downloading…" : "Download 72h"}
        </Button>
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm">Live NOAA</p>
          <p className="text-[11px] text-muted">
            SST (CoralTemp 5 km), chlorophyll, SSH, HMS reminder, ETOPO bathy, hour-0 GFS, plus buoys, tides, and ENC catalog when those fetches parse. 72 h GFS series stays off. Failed fetches stay fixture.
          </p>
        </div>
        <Switch checked={Boolean(live)} onCheckedChange={setLive} disabled={downloading} />
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm">Accept stale SST</p>
          <p className="text-[11px] text-muted">
            Present, hash-ok composite older than 24 h can pass Ready. Aid only — not permission.
          </p>
        </div>
        <Switch
          checked={Boolean(sstStaleOverride)}
          onCheckedChange={setSstStaleOverride}
          disabled={downloading}
        />
      </div>

      <p className="mb-3 text-xs text-muted">
        Point Judith canyon box. Default download is hashed fixtures. Live NOAA can land SST, chlorophyll, SSH, HMS, bathymetry, hour-0 wind/wave, buoys, tides, and the ENC cell list when those bytes parse. It does not fetch a 72 h
        series and does not claim official ENC. Client re-checks hashes after download.
        Worker ready flag is a hint only
        {workerHint == null ? "" : workerHint ? " (hint: yes)" : " (hint: no)"}.
      </p>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <label className="text-[11px] text-muted">
          West
          <Input
            type="number"
            step="0.1"
            value={bbox.west}
            onChange={(e) => setBbox({ west: Number(e.target.value) })}
          />
        </label>
        <label className="text-[11px] text-muted">
          East
          <Input
            type="number"
            step="0.1"
            value={bbox.east}
            onChange={(e) => setBbox({ east: Number(e.target.value) })}
          />
        </label>
        <label className="text-[11px] text-muted">
          South
          <Input
            type="number"
            step="0.1"
            value={bbox.south}
            onChange={(e) => setBbox({ south: Number(e.target.value) })}
          />
        </label>
        <label className="text-[11px] text-muted">
          North
          <Input
            type="number"
            step="0.1"
            value={bbox.north}
            onChange={(e) => setBbox({ north: Number(e.target.value) })}
          />
        </label>
        <label className="text-[11px] text-muted">
          Start (UTC)
          <Input
            type="text"
            value={start.slice(0, 16)}
            onChange={(e) => {
              const v = e.target.value;
              const iso = v.length === 16 ? `${v}:00.000Z` : v;
              setWindow(Number.isNaN(Date.parse(iso)) ? start : new Date(iso).toISOString(), hours);
            }}
          />
        </label>
        <label className="text-[11px] text-muted">
          Hours
          <Input
            type="number"
            min={1}
            max={168}
            value={hours}
            onChange={(e) => setWindow(start, Number(e.target.value) || 72)}
          />
        </label>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="mb-3"
        onClick={() => {
          setBbox({ ...POINT_JUDITH_CANYON_BBOX });
          setWindow(new Date().toISOString(), 72);
        }}
      >
        Reset PJ 72h
      </Button>

      {error && !offshore ? <p className="mb-3 text-xs text-nogo">{error}</p> : null}

      {ready ? (
        <ul className="mb-3 space-y-1 text-[11px] text-muted">
          {ready.failures.map((f) => (
            <li key={f} className="text-nogo">
              {f}
            </li>
          ))}
          {ready.warnings.slice(0, 4).map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      <div className="mb-1 flex items-baseline justify-between text-[11px] text-muted">
        <span>
          {ok}/{total || "—"} hashed
          {total ? ` · ${noaaCount} NOAA / ${fixtureCount} fixture` : ""}
        </span>
        <span className="tabular">{pct.toFixed(0)}%</span>
      </div>
      {liveErrors.length ? (
        <ul className="mb-2 space-y-0.5 text-[11px] text-muted">
          {liveErrors.map((line, i) => (
            <li key={`${i}:${line}`}>{line}</li>
          ))}
        </ul>
      ) : null}
      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-elevated">
        <div className="h-full bg-sunrise" style={{ width: `${pct}%` }} />
      </div>
      <Button
        variant="outline"
        size="sm"
        className="mb-4"
        disabled={!retryLive}
        onClick={() => {
          void download({ skipCache: true });
        }}
      >
        Retry live overlays
      </Button>

      <ul className="space-y-2">
        {packs.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-elevated px-3 py-2">
            <div>
              <p className="text-sm">{p.label}</p>
              <p className="text-[11px] text-muted">
                {p.sizeBytes
                  ? `${p.sizeBytes} B`
                  : `${p.sizeMb} MB`}
                {p.hash ? ` · ${p.hash.slice(0, 12)}` : ""}
                {p.verified ? " · verified" : ""}
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-1.5">
              {p.source ? (
                <Badge tone={sourceTone(p.source)} className="text-[10px] uppercase tracking-wider">
                  {p.source}
                </Badge>
              ) : null}
              <Badge tone={packTone(p.status)}>{p.status}</Badge>
            </span>
          </li>
        ))}
      </ul>
      {packs.length === 0 ? (
        <p className="text-xs text-muted">No objects stored. Download on marina Wi-Fi before you leave Galilee.</p>
      ) : null}
      {packedEncCells().length ? (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-medium">
            {packs.find((layer) => layer.id === "enc")?.source === "noaa"
              ? "ENC catalog (aid · NOAA)"
              : "ENC catalog (aid)"}
          </h3>
          <ul className="mb-2 space-y-0.5 text-[11px] text-muted">
            {packedEncCells().map((c) => (
              <li key={c.id}>
                {c.id} · {c.name}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">{ENC_AID_DISCLAIMER}</p>
        </div>
      ) : null}
      <p className="mt-4 text-xs text-muted">
        AIS is a gateway, not a file. Chlorophyll and altimetry improve the pack; they do not block Ready.
        ENC is a cell list, not a legal chart.
      </p>
    </Pane>
  );
}
