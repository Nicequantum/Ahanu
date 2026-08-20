import { Pane } from "@/components/panels/pane";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { SPECIES_ORDER } from "@/lib/ahanu/constants";
import { formatLat, formatLon, metersToFathoms } from "@/lib/ahanu/geo";
import { sstC } from "@/lib/ahanu/ocean";
import { markFishHere, useAhanu } from "@/lib/ahanu/store";
import type { SpeciesId } from "@/lib/ahanu/types";
import { COMMUNITY_REPORTS } from "@/lib/data/community";
import { SPECIES_LABELS, speciesColor } from "@/lib/data/species";
import { useState, type ChangeEvent, type FormEvent } from "react";

const PHOTO_MAX_EDGE = 480;

function readPhotoDataUrl(file: File, onDone: (url: string) => void) {
  const reader = new FileReader();
  reader.onload = () => {
    const raw = reader.result;
    if (typeof raw !== "string") return;
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(img.width, img.height));
      if (scale >= 1) {
        onDone(raw);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        onDone(raw);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      onDone(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => onDone(raw);
    img.src = raw;
  };
  reader.readAsDataURL(file);
}

function catchMeta(c: {
  lat: number;
  lon: number;
  sstC?: number;
  depthM?: number;
  lengthIn?: number;
  weightLb?: number;
}): string {
  const bits = [
    `${formatLat(c.lat)} ${formatLon(c.lon)}`,
    c.sstC != null ? `${c.sstC.toFixed(1)}°C` : null,
    c.depthM != null ? `${metersToFathoms(c.depthM).toFixed(0)} fm` : null,
    c.lengthIn != null ? `${c.lengthIn} in` : null,
    c.weightLb != null ? `${c.weightLb} lb` : null,
  ];
  return bits.filter(Boolean).join(" · ");
}

export function LogPanel() {
  const catches = useAhanu((s) => s.catches);
  const waypoints = useAhanu((s) => s.waypoints);
  const removeWaypoint = useAhanu((s) => s.removeWaypoint);
  const v = useAhanu((s) => s.vessel);
  const hour = useAhanu((s) => s.forecastHour);
  const clockMs = useAhanu((s) => s.clockMs);
  const storeSpecies = useAhanu((s) => s.species);

  const [species, setSpecies] = useState<SpeciesId>(storeSpecies);
  const [lengthIn, setLengthIn] = useState("");
  const [weightLb, setWeightLb] = useState("");
  const [notes, setNotes] = useState("");
  const [released, setReleased] = useState(false);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);

  const hereSst = sstC(v.lat, v.lon, hour);
  const hereDepthFm = metersToFathoms(v.depthM).toFixed(0);
  const hereTime = new Date(clockMs).toISOString().slice(11, 16);

  function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setPhotoDataUrl(null);
      return;
    }
    readPhotoDataUrl(file, setPhotoDataUrl);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const s = useAhanu.getState();
    s.addCatch({
      species,
      lat: s.vessel.lat,
      lon: s.vessel.lon,
      at: new Date(s.clockMs).toISOString(),
      lengthIn: lengthIn ? Number(lengthIn) : undefined,
      weightLb: weightLb ? Number(weightLb) : undefined,
      released,
      photoDataUrl: photoDataUrl ?? undefined,
      notes: notes.trim() || undefined,
      sstC: sstC(s.vessel.lat, s.vessel.lon, s.forecastHour),
      depthM: s.vessel.depthM,
      conditions: `SOG ${s.vessel.sog.toFixed(1)} kt  COG ${s.vessel.cog.toFixed(0)}°`,
      synced: false,
    });
    setLengthIn("");
    setWeightLb("");
    setNotes("");
    setReleased(false);
    setPhotoDataUrl(null);
  }

  return (
    <Pane title="Catch log" kicker="Personal history">
      <Button className="mb-4 w-full" onClick={() => markFishHere()}>
        Mark fish here
      </Button>

      {catches.length === 0 ? (
        <p className="text-sm text-muted">
          No fish marked this trip. Hit the gold mark on the rail when the rod goes off — Ahanu
          will fill SST, depth, and time.
        </p>
      ) : (
        <ul className="space-y-3">
          {catches.map((c) => (
            <li key={c.id} className="rounded-xl bg-elevated p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium" style={{ color: speciesColor(c.species) }}>
                  {SPECIES_LABELS[c.species]}
                </span>
                <span className="text-[11px] text-muted tabular">{c.at.slice(11, 16)}</span>
              </div>
              <p className="mt-1 text-xs text-muted">{catchMeta(c)}</p>
              {c.notes && <p className="mt-1 text-xs">{c.notes}</p>}
              {c.released && (
                <Badge tone="lagoon" className="mt-2">
                  Released
                </Badge>
              )}
              {c.photoDataUrl && (
                <img
                  src={c.photoDataUrl}
                  alt=""
                  className="mt-2 max-h-24 rounded-lg object-cover"
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <Separator className="my-4" />
      <h3 className="mb-2 text-sm font-medium">Log a catch</h3>
      <p className="mb-3 text-[11px] text-muted tabular">
        {formatLat(v.lat)} {formatLon(v.lon)} · {hereSst.toFixed(1)}°C · {hereDepthFm} fm · {hereTime}
      </p>
      <form className="space-y-2" onSubmit={onSubmit}>
        <label className="text-[11px] text-muted">Species</label>
        <select
          value={species}
          onChange={(e) => setSpecies(e.target.value as SpeciesId)}
          className="flex h-10 w-full rounded-md bg-elevated px-3 text-sm text-foam shadow-[0_0_0_1px_var(--color-line)] focus-visible:shadow-[0_0_0_1px_var(--color-sunrise)] focus-visible:outline-none"
        >
          {SPECIES_ORDER.map((id) => (
            <option key={id} value={id}>
              {SPECIES_LABELS[id]}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.1"
            placeholder="Length in"
            value={lengthIn}
            onChange={(e) => setLengthIn(e.target.value)}
          />
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.1"
            placeholder="Weight lb"
            value={weightLb}
            onChange={(e) => setWeightLb(e.target.value)}
          />
        </div>
        <Textarea
          placeholder="Notes — bait, dump, what they ate"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="flex items-center justify-between py-1">
          <span className="text-sm">Released</span>
          <Switch checked={released} onCheckedChange={setReleased} />
        </div>
        <input
          type="file"
          accept="image/*"
          onChange={onPhoto}
          className="block w-full text-xs text-muted file:mr-2 file:rounded-md file:border-0 file:bg-elevated file:px-3 file:py-1.5 file:text-xs file:text-foam"
        />
        {photoDataUrl && (
          <img src={photoDataUrl} alt="" className="max-h-24 rounded-lg object-cover" />
        )}
        <Button type="submit" variant="outline" className="w-full">
          Log this catch
        </Button>
      </form>

      <Separator className="my-4" />
      <h3 className="mb-2 text-sm font-medium">Marks ({waypoints.length})</h3>
      {waypoints.length === 0 ? (
        <p className="text-xs text-muted">No marks on the plotter yet.</p>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {waypoints.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-2">
              <span className="truncate text-foam">{w.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-muted">
                  {w.depthM ? `${metersToFathoms(w.depthM).toFixed(0)} fm` : ""}
                </span>
                <button
                  type="button"
                  className="text-[11px] tracking-wide uppercase text-muted hover:text-nogo"
                  onClick={() => removeWaypoint(w.id)}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <Separator className="my-4" />
      <h3 className="mb-2 text-sm font-medium">Community snapshot</h3>
      <p className="mb-2 text-[11px] text-muted">Frozen reports packed with the trip. Not live radio.</p>
      <div className="space-y-2">
        {COMMUNITY_REPORTS.slice(0, 5).map((r) => (
          <article key={r.id} className="rounded-lg bg-elevated px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium" style={{ color: speciesColor(r.species) }}>
                {SPECIES_LABELS[r.species]}
              </span>
              <span className="text-[11px] text-muted tabular">{r.at.slice(5, 16)}</span>
            </div>
            <p className="text-[11px] text-muted">
              <span className="text-lagoon">{r.who}</span>
              {r.size ? ` · ${r.size}` : ""}
            </p>
            <p className="mt-1 text-xs text-foam/90">{r.note}</p>
          </article>
        ))}
      </div>
    </Pane>
  );
}
