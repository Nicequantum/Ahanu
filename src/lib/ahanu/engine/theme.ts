export interface EngineTheme {
  id: string;
  label: string;
  nightSafe: boolean;
  palette: {
    bg: string;
    face: string;
    ink: string;
    muted: string;
    accent: string;
    hot: string;
    ok: string;
    warn: string;
    tick: string;
  };
  typography: { display: string; ui: string; figure: string };
  gauge: { bezel: number; needle: "line" | "sword" | "bar"; arc: number; face: "flat" | "dished" | "lcd" };
  background: "solid" | "vignette" | "scan";
  animation: "none" | "glow" | "phosphor";
}

export function validateTheme(value: unknown): EngineTheme | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<EngineTheme>;
  if (typeof row.id !== "string" || typeof row.label !== "string" || typeof row.nightSafe !== "boolean") return null;
  if (!row.palette || !row.typography || !row.gauge) return null;
  return row as EngineTheme;
}

export function loadThemeBundles(records: unknown[]): EngineTheme[] {
  const themes: EngineTheme[] = [];
  for (const record of records) {
    const theme = validateTheme(record);
    if (theme) themes.push(theme);
  }
  return themes.sort((a, b) => a.label.localeCompare(b.label));
}

export function themesFromBundles(): EngineTheme[] {
  const glob = import.meta.glob("../../../../themes/*.json", { eager: true, import: "default" }) as Record<string, unknown>;
  return loadThemeBundles(Object.values(glob));
}

export const DEFAULT_THEME_ID = "stealth-night";

export const STEALTH_NIGHT: EngineTheme = {
  id: "stealth-night",
  label: "Stealth night",
  nightSafe: true,
  palette: {
    bg: "#071016",
    face: "#0d1c26",
    ink: "#d5e2e8",
    muted: "#6d828c",
    accent: "#8aa0ab",
    hot: "#e06b5a",
    ok: "#6bcb8b",
    warn: "#e0b15a",
    tick: "#1c303c",
  },
  typography: { display: "Fraunces, serif", ui: "Outfit, sans-serif", figure: "ui-monospace, monospace" },
  gauge: { bezel: 1, needle: "line", arc: 0.75, face: "flat" },
  background: "solid",
  animation: "none",
};
