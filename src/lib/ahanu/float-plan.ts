/**
 * Shore-side float plan. Built from store state only — no network.
 * Not an official form. Empty skipper fields stay empty or "not set".
 * Contacts are never invented.
 */

import { CANYONS } from "@/lib/data/canyons";
import { readyOffshoreBadge, type PackBBox, type ReadyOffshoreResult } from "./pack";
import type { EmergencyContact, FloatPlan } from "./types";

export const NOT_SET = "not set";

/** Aid one-liner. Keep this dry — it is left ashore. */
export const FLOAT_PLAN_AID_LINE =
  "Ahanu is an aid to navigation and fishing, not a substitute for current official ENC.";

export interface FloatPlanSnapshot {
  vessel: string;
  skipper: string;
  departure: string;
  returnEta: string;
  souls: number | null;
  route: string;
  radio: string;
  notes: string;
  contacts: Array<Pick<EmergencyContact, "name" | "role" | "phone">>;
  bbox: PackBBox | null;
  windowStart: string | null;
  windowHours: number | null;
  /** If omitted, canyons are derived from bbox heads. */
  canyons?: string[];
  ready: ReadyOffshoreResult | null;
  sstStaleOverride: boolean;
  filedAt?: string;
}

export function blank(value: string | null | undefined): string {
  const t = value?.trim() ?? "";
  return t.length ? t : NOT_SET;
}

export function formatSouls(souls: number | null | undefined): string {
  if (souls == null || Number.isNaN(souls)) return NOT_SET;
  return String(souls);
}

export function formatBbox(bbox: PackBBox): string {
  return `${fmtLat(bbox.south)}–${fmtLat(bbox.north)}, ${fmtLon(bbox.west)}–${fmtLon(bbox.east)}`;
}

export function pointInBbox(lat: number, lon: number, bbox: PackBBox): boolean {
  return lat >= bbox.south && lat <= bbox.north && lon >= bbox.west && lon <= bbox.east;
}

/** Canyon names whose heads sit inside the pack bbox. */
export function canyonsInBbox(bbox: PackBBox, canyons = CANYONS): string[] {
  return canyons.filter((c) => pointInBbox(c.head.lat, c.head.lon, bbox)).map((c) => c.name);
}

export function formatWindow(start: string | null | undefined, hours: number | null | undefined): string {
  const startOk = Boolean(start && !Number.isNaN(Date.parse(start)));
  const hoursOk = hours != null && Number.isFinite(hours);
  if (!startOk && !hoursOk) return NOT_SET;
  const startBit = startOk ? new Date(start!).toISOString() : NOT_SET;
  const hoursBit = hoursOk ? `${hours} h` : NOT_SET;
  return `${startBit} · ${hoursBit}`;
}

export function formatContactLine(c: Pick<EmergencyContact, "name" | "role" | "phone">): string | null {
  const name = c.name.trim();
  const role = c.role.trim();
  const phone = c.phone.trim();
  if (!name && !role && !phone) return null;
  const who = name || NOT_SET;
  const job = role ? ` (${role})` : "";
  return `${who}${job}: ${phone || NOT_SET}`;
}

export function formatReadyLine(ready: ReadyOffshoreResult | null, sstStaleOverride: boolean): string {
  if (!ready) {
    return sstStaleOverride ? `${NOT_SET}. Stale-SST override is on.` : NOT_SET;
  }
  const badge = readyOffshoreBadge(ready);
  const parts = [badge.long];
  if (ready.sstOverrideUsed || (sstStaleOverride && ready.ready)) {
    parts.push("Caution: Ready used a stale-SST override. SST composite may be older than 24 h.");
  } else if (sstStaleOverride) {
    parts.push("Stale-SST override is on.");
  }
  if (ready.failures.length) parts.push(ready.failures.join("; "));
  return parts.join(" ");
}

export function floatPlanBasename(vessel: string, filedAt?: string): string {
  const v =
    vessel
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "vessel";
  const d = filedAt && !Number.isNaN(Date.parse(filedAt)) ? new Date(filedAt).toISOString().slice(0, 10) : "draft";
  return `ahanu-float-plan-${v}-${d}`;
}

export function snapshotFromState(input: {
  floatPlan: FloatPlan;
  boatName?: string;
  contacts: Array<Pick<EmergencyContact, "name" | "role" | "phone">>;
  packBbox: PackBBox | null;
  packStart: string | null;
  packHours: number | null;
  packReady: ReadyOffshoreResult | null;
  sstStaleOverride: boolean;
  clockMs?: number;
}): FloatPlanSnapshot {
  const p = input.floatPlan;
  return {
    vessel: p.vessel.trim() || input.boatName?.trim() || "",
    skipper: p.skipper,
    departure: p.departure,
    returnEta: p.returnEta,
    souls: p.souls,
    route: p.route,
    radio: p.radio,
    notes: p.notes,
    contacts: input.contacts,
    bbox: input.packBbox,
    windowStart: input.packStart,
    windowHours: input.packHours,
    ready: input.packReady,
    sstStaleOverride: input.sstStaleOverride,
    filedAt: input.clockMs != null ? new Date(input.clockMs).toISOString() : undefined,
  };
}

export function formatFloatPlanText(s: FloatPlanSnapshot): string {
  const canyonNames = s.canyons ?? (s.bbox ? canyonsInBbox(s.bbox) : []);
  const contactLines = s.contacts.map(formatContactLine).filter((line): line is string => line != null);
  const optional: string[] = [];
  if (s.route.trim()) optional.push(`Route: ${s.route.trim()}`);
  if (s.notes.trim()) optional.push(`Notes: ${s.notes.trim()}`);

  const lines = [
    "AHANU FLOAT PLAN",
    s.filedAt && !Number.isNaN(Date.parse(s.filedAt)) ? `Filed: ${new Date(s.filedAt).toISOString()}` : null,
    "",
    `Vessel: ${blank(s.vessel)}`,
    `Skipper: ${blank(s.skipper)}`,
    `Departure harbor: ${blank(s.departure)}`,
    `Return ETA: ${blank(s.returnEta)}`,
    `Souls on board: ${formatSouls(s.souls)}`,
    `Pack bbox: ${s.bbox ? formatBbox(s.bbox) : NOT_SET}`,
    `Canyons: ${canyonNames.length ? canyonNames.join(", ") : NOT_SET}`,
    `Window: ${formatWindow(s.windowStart, s.windowHours)}`,
    `Radio: ${blank(s.radio)}`,
    ...optional,
    "",
    "EMERGENCY CONTACTS",
    ...(contactLines.length ? contactLines : [NOT_SET]),
    "",
    `Ready: ${formatReadyLine(s.ready, s.sstStaleOverride)}`,
    "",
    FLOAT_PLAN_AID_LINE,
  ];
  return lines.filter((line): line is string => line != null).join("\n");
}

export function formatFloatPlanHtml(s: FloatPlanSnapshot): string {
  const text = formatFloatPlanText(s);
  const title = `Float plan — ${blank(s.vessel)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; color: #111; background: #fff; max-width: 40rem; margin: 1.5rem auto; padding: 0 1rem; }
  h1 { font-size: 1.1rem; font-weight: 600; margin: 0 0 1rem; }
  pre { white-space: pre-wrap; font-family: inherit; font-size: 14px; line-height: 1.45; margin: 0; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<pre>${escapeHtml(text)}</pre>
</body>
</html>
`;
}

function fmtLat(n: number): string {
  return `${Math.abs(n).toFixed(2)}°${n >= 0 ? "N" : "S"}`;
}

function fmtLon(n: number): string {
  return `${Math.abs(n).toFixed(2)}°${n >= 0 ? "E" : "W"}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
