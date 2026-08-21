/**
 * Honest pack source rows. GET /api/sources stays the ingest catalog.
 * These names are what this pack fetched — not leftover MUR/GFS copy.
 */
import { parseLayerBody } from "./pack-fixtures";

const SST_LANDED_BY_ID: Record<string, string> = {
  noaacwLEOACSPOSSTL3SnrtKDaily: "ACSPO",
  jplMURSST41: "MUR",
  noaacwBLENDEDsstDNDaily: "GeoPolar",
  noaacrwsstDaily: "CoralTemp",
  noaacwGEOHIRRSSTGoes16NRT: "GOES-16",
};

/** Product that actually landed. Catalog / leftover MUR labels do not win. */
export function sstLandedName(dataset?: string | null, note?: string | null): string | undefined {
  const id = (dataset ?? "").trim();
  if (id && SST_LANDED_BY_ID[id]) return SST_LANDED_BY_ID[id];
  const blob = `${id} ${note ?? ""}`;
  if (/ACSPO/i.test(blob)) return "ACSPO";
  if (/GeoPolar/i.test(blob)) return "GeoPolar";
  if (/CoralTemp|Coral Reef Watch/i.test(blob)) return "CoralTemp";
  if (/GOES-16|GEOHIRR/i.test(blob)) return "GOES-16";
  if (/\bMUR\b/i.test(blob)) return "MUR";
  return undefined;
}

export type PackSourceRef = { id: string; name: string };

const CATALOG_SOURCE_IDS = new Set([
  "ghrsst-coastwatch-sst",
  "ncep-gfswave",
  "nws-ndfd",
  "cmems-chl",
  "altimetry-ssh",
  "coops-tides",
  "ndbc",
  "hms-closed-areas",
  "ncei-bathymetry",
]);

const CATALOG_SOURCE_NAMES = new Set([
  "NOAA Electronic Navigational Charts (S-57 / S-101)",
  "NOAA MarineCadastre canyon heads",
  "GHRSST / CoastWatch SST",
  "NCEP GFS-Wave / WAVEWATCH III",
]);

function overlaySstMeta(overlay?: string): { dataset?: string; note?: string } {
  if (!overlay) return {};
  const parsed = parseLayerBody(overlay);
  if (!parsed || parsed.kind !== "grid") return {};
  return {
    dataset: typeof parsed.dataset === "string" && parsed.dataset ? parsed.dataset : undefined,
    note: typeof parsed.note === "string" && parsed.note ? parsed.note : undefined,
  };
}

function overlayNote(overlay?: string): string | undefined {
  if (!overlay) return undefined;
  const parsed = parseLayerBody(overlay);
  if (!parsed) return undefined;
  if ("note" in parsed && typeof parsed.note === "string" && parsed.note.trim()) return parsed.note.trim();
  if ("payload" in parsed && parsed.payload && typeof parsed.payload === "object") {
    const n = (parsed.payload as { note?: unknown }).note;
    if (typeof n === "string" && n.trim()) return n.trim();
  }
  return undefined;
}

/** Official S-57 with cell/update counts when official. Fixture is not a landed ENC. */
export function encSourceName(overlay?: string): string | undefined {
  if (!overlay) return undefined;
  const parsed = parseLayerBody(overlay);
  if (!parsed || !("payload" in parsed) || !parsed.payload || typeof parsed.payload !== "object") {
    return overlayNote(overlay);
  }
  const p = parsed.payload as {
    fixture?: boolean;
    official?: boolean;
    note?: string;
    s57?: { cellIds?: string[]; updateCount?: number };
  };
  if (p.fixture) return undefined;
  const note = typeof p.note === "string" ? p.note.trim() : "";
  if (p.official) {
    const n = Array.isArray(p.s57?.cellIds) ? p.s57.cellIds.length : 0;
    const u = typeof p.s57?.updateCount === "number" ? p.s57.updateCount : 0;
    const counted = `Official NOAA S-57 (${n} cells, ${u} update file${u === 1 ? "" : "s"})`;
    if (note && /\d+\s+cells/i.test(note) && /update/i.test(note)) return note;
    return counted;
  }
  if (note) return note;
  return "NOAA ENC product-catalog excerpt — not official S-57.";
}

function overlayDerivedSources(overlays: Partial<Record<string, string>>): PackSourceRef[] {
  const out: PackSourceRef[] = [];
  const sst = overlays.sst;
  if (sst) {
    const meta = overlaySstMeta(sst);
    const product = sstLandedName(meta.dataset, meta.note);
    const name = meta.note || (product ? `SST ${product}` : undefined);
    if (name) out.push({ id: "noaa-sst", name });
  }
  const enc = overlays.enc;
  if (enc) {
    const name = encSourceName(enc);
    if (name) out.push({ id: "noaa-enc", name });
  }
  const gfsNote = overlayNote(overlays.wind) ?? overlayNote(overlays.waves);
  if (gfsNote && (/GFS-Wave|gfs:/i.test(gfsNote) || /f000|hour-0/i.test(gfsNote))) {
    out.push({ id: "nomads-gfswave", name: gfsNote });
  }
  return out;
}

function isCatalogSource(s: PackSourceRef): boolean {
  return CATALOG_SOURCE_IDS.has(s.id) || CATALOG_SOURCE_NAMES.has(s.name);
}

/**
 * Sources this pack actually fetched. Drops the static ingest catalog
 * (GHRSST/MUR, ncep-gfswave, …). Does not invent products.
 */
export function landedPackSources(manifest: {
  sources?: PackSourceRef[];
  layers?: { id: string; label: string; source?: string }[];
  liveErrors?: readonly string[] | null;
}): PackSourceRef[] {
  const byId = new Map<string, string>();
  for (const s of manifest.sources ?? []) {
    if (!s?.id || !s?.name) continue;
    if (isCatalogSource(s)) continue;
    byId.set(s.id, s.name);
  }
  const sst = manifest.layers?.find((l) => l.id === "sst");
  if (sst && (sst.source === "noaa" || sst.source === "r2") && !byId.has("noaa-sst")) {
    const product = sstLandedName(undefined, sst.label);
    if (product) byId.set("noaa-sst", `SST ${product}`);
  }
  const enc = manifest.layers?.find((l) => l.id === "enc");
  if (enc && (enc.source === "noaa" || enc.source === "r2") && !byId.has("noaa-enc")) {
    if (/official S-57/i.test(enc.label)) byId.set("noaa-enc", enc.label);
  }
  if (!byId.has("nomads-gfswave")) {
    const gfs = (manifest.liveErrors ?? []).find((e) => /^gfs:/i.test(e.trim()));
    if (gfs) byId.set("nomads-gfswave", gfs.trim());
  }
  return [...byId.entries()].map(([id, name]) => ({ id, name }));
}

/** Product rows only (SST / GFS / ENC / other live extras). */
export function landedProductSources(
  manifest: Parameters<typeof landedPackSources>[0],
): PackSourceRef[] {
  return landedPackSources(manifest).filter((s) => s.id !== "fixture" && s.id !== "noaa");
}

export function landedPackNotes(manifest: {
  sources?: PackSourceRef[];
  layers?: { id: string; label: string; source?: string }[];
  liveErrors?: readonly string[] | null;
  notes?: string;
}): string {
  const products = landedProductSources(manifest);
  const sst = products.find((s) => s.id === "noaa-sst");
  const gfs = products.find((s) => s.id === "nomads-gfswave");
  const enc = products.find((s) => s.id === "noaa-enc");
  const bits = [sst?.name, gfs?.name, enc?.name].filter((n): n is string => Boolean(n));
  const base = (manifest.notes ?? "").trim();
  const line = `Landed this pack: ${bits.join(" · ")}.`;
  if (!bits.length) {
    const stripped = base.replace(/^Landed this pack:[^.]*\.\s*/, "").trim();
    return stripped || base;
  }
  if (!base) return line;
  const stripped = base.replace(/^Landed this pack:[^.]*\.\s*/, "").trim();
  return stripped ? `${line} ${stripped}` : line;
}

export function leftoverMurSstLabel(label?: string | null): boolean {
  if (!label) return false;
  if (/ACSPO/i.test(label)) return false;
  return /MUR\s*\/\s*CoastWatch/i.test(label) || sstLandedName(undefined, label) === "MUR";
}

/** Pack row from the landed body. Leftover MUR catalog copy does not win. */
export function sstLabelFromLanded(input: {
  dataset?: string | null;
  note?: string | null;
  source?: string;
  stored?: string;
}): string {
  const product = sstLandedName(input.dataset, input.note);
  if (product) return `SST ${product}`;
  if (input.source === "fixture") return "SST composite (fixture)";
  if (input.stored && !/MUR\s*\/\s*CoastWatch/i.test(input.stored)) return input.stored;
  return "SST composite (public ERDDAP)";
}

function overlayIsOfficialEnc(overlay?: string): boolean {
  if (!overlay) return false;
  const parsed = parseLayerBody(overlay);
  if (!parsed || !("payload" in parsed) || !parsed.payload || typeof parsed.payload !== "object") return false;
  const p = parsed.payload as { official?: boolean; fixture?: boolean };
  return Boolean(p.official) && !p.fixture;
}

/**
 * Persist-time rewrite. layer.label / sources[] follow the landed body so
 * R2 cannot keep a MUR label on an ACSPO object. ENC sources include
 * cell/update counts when official. Does not invent products.
 */
export function rewriteLandedManifest<
  T extends {
    sources?: PackSourceRef[];
    layers: { id: string; label: string; source?: string }[];
    liveErrors?: readonly string[] | null;
    notes?: string;
    landedSources?: PackSourceRef[];
  },
>(manifest: T, overlays: Partial<Record<string, string>>): T {
  const layers = manifest.layers.map((layer) => {
    if (layer.id === "sst" && overlays.sst) {
      const meta = overlaySstMeta(overlays.sst);
      const product = sstLandedName(meta.dataset, meta.note);
      if (product || leftoverMurSstLabel(layer.label)) {
        return {
          ...layer,
          label: sstLabelFromLanded({
            dataset: meta.dataset,
            note: meta.note,
            source: product ? "noaa" : layer.source,
            stored: layer.label,
          }),
        };
      }
    }
    if (layer.id === "enc" && overlayIsOfficialEnc(overlays.enc)) {
      return { ...layer, label: "NOAA ENC (official S-57)" };
    }
    return layer;
  });

  const byId = new Map<string, string>();
  for (const s of manifest.sources ?? []) {
    if (!s?.id || !s?.name) continue;
    if (isCatalogSource(s)) continue;
    byId.set(s.id, s.name);
  }
  if (overlays.sst) {
    const meta = overlaySstMeta(overlays.sst);
    if (!sstLandedName(meta.dataset, meta.note)) byId.delete("noaa-sst");
  }
  if (overlays.enc && !encSourceName(overlays.enc)) byId.delete("noaa-enc");
  for (const s of overlayDerivedSources(overlays)) {
    if (s.id === "noaa-sst" || s.id === "noaa-enc") byId.set(s.id, s.name);
    else if (!byId.has(s.id)) byId.set(s.id, s.name);
  }

  const sources = [...byId.entries()].map(([id, name]) => ({ id, name }));
  const next = { ...manifest, layers, sources };
  return {
    ...next,
    landedSources: landedProductSources(next),
    notes: landedPackNotes({ ...next, notes: manifest.notes }),
  };
}

export function mergePackSources(
  liveIds: string[],
  extra: PackSourceRef[] | undefined,
  overlays: Partial<Record<string, string>>,
): PackSourceRef[] {
  const byId = new Map<string, string>();
  for (const s of extra ?? []) {
    if (s?.id && s?.name) byId.set(s.id, s.name);
  }
  if (overlays.sst) {
    const meta = overlaySstMeta(overlays.sst);
    if (!sstLandedName(meta.dataset, meta.note)) byId.delete("noaa-sst");
  }
  for (const s of overlayDerivedSources(overlays)) {
    if (s.id === "noaa-sst" || s.id === "noaa-enc") byId.set(s.id, s.name);
    else if (!byId.has(s.id)) byId.set(s.id, s.name);
  }
  const base: PackSourceRef[] = liveIds.length
    ? [
        { id: "fixture", name: "Hashed fixture objects (not live GRIB/SST/CMEMS)" },
        { id: "noaa", name: `Public NOAA overlay (${liveIds.join(", ")})` },
      ]
    : [{ id: "fixture", name: "Hashed fixture objects (not live NOAA/CMEMS)" }];
  return [...base, ...[...byId.entries()].map(([id, name]) => ({ id, name }))];
}
