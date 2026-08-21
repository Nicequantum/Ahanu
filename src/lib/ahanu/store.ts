import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_BOAT,
  DEFAULT_LAYERS,
  POINT_JUDITH,
  VEATCH_HEAD,
} from "./constants";
import { destination, haversineNm, initialBearing } from "./geo";
import { depthM } from "./bathymetry";
import { sstC } from "./ocean";
import { SEED_SPOTS } from "@/lib/data/spots";
import { uid } from "@/lib/utils";
import type {
  BoatLimits,
  CatchRecord,
  DisplayMode,
  EmergencyContact,
  FloatPlan,
  LayerId,
  MeasureState,
  NavMode,
  PanelId,
  SpeciesId,
  TripPackLayer,
  VesselState,
  Waypoint,
} from "./types";
import { POINT_JUDITH_CANYON_BBOX } from "./constants";
import { capLiveErrors, evaluateReadyForOffshore, type PackBBox, type ReadyOffshoreResult, type TripPackManifestV1 } from "./pack";
import {
  downloadTripPack as fetchTripPack,
  evidenceFromPackLayers,
  restorePackedSession,
  tripPackLayersFromReady,
} from "./pack-client";
import { packedEpoch } from "./packed-fields";
import { deviceToken, retryUnsyncedCatches as postUnsyncedCatches, syncCatch } from "./catch-sync";
import {
  applyDisplayMode,
  applyPersistedDisplayMode,
  readPersistedDisplayMode,
  writePersistedDisplayMode,
} from "./display-mode";
import {
  DEFAULT_TIDE_HARBOR,
  findPackedTideStation,
  readPersistedTideHarbor,
  writePersistedTideHarbor,
} from "./tide-curve";

const TROLL_PATH = (() => {
  const pts = [];
  const c = { lat: 39.91, lon: -69.7 };
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    pts.push({
      lat: c.lat + Math.sin(a) * 0.08 + Math.sin(a * 2) * 0.015,
      lon: c.lon + Math.cos(a) * 0.14,
    });
  }
  return pts;
})();

const STEAM_PATH = [POINT_JUDITH, { lat: 40.55, lon: -70.85 }, VEATCH_HEAD];

/** Real-time accumulator for GRIB playback (not persisted). */
let playAcc = 0;

export interface AhanuState {
  vessel: VesselState;
  layers: Record<LayerId, { visible: boolean; opacity: number }>;
  forecastHour: number;
  species: SpeciesId;
  panel: PanelId;
  displayMode: DisplayMode;
  tideHarbor: string;
  waypoints: Waypoint[];
  catches: CatchRecord[];
  track: { lat: number; lon: number }[];
  measure: MeasureState;
  boat: BoatLimits;
  floatPlan: FloatPlan;
  contacts: EmergencyContact[];
  packLayers: TripPackLayer[];
  packBbox: PackBBox;
  packHours: number;
  packStart: string;
  packManifest: TripPackManifestV1 | null;
  packReady: ReadyOffshoreResult | null;
  packDownloading: boolean;
  packError: string | null;
  packEpoch: number;
  packLive: boolean;
  packLiveErrors: string[];
  sstStaleOverride: boolean;
  simT: number;
  followShip: boolean;
  markRipple: { lat: number; lon: number; id: string } | null;
  articleId: string | null;
  breakSensitivity: number;
  clockMs: number;
  hydrated: boolean;
  forecastPlaying: boolean;
  nmeaGateway: boolean;
  replayT: number | null;
  safetyDepthM: number;
  setPanel: (p: PanelId) => void;
  toggleLayer: (id: LayerId) => void;
  setOpacity: (id: LayerId, opacity: number) => void;
  setHour: (h: number) => void;
  setSpecies: (s: SpeciesId) => void;
  setDisplayMode: (m: DisplayMode) => void;
  setTideHarbor: (harbor: string) => void;
  setMode: (m: NavMode) => void;
  setFollow: (v: boolean) => void;
  setBreakSensitivity: (n: number) => void;
  addWaypoint: (w: Omit<Waypoint, "id" | "createdAt">) => void;
  removeWaypoint: (id: string) => void;
  addCatch: (c: Omit<CatchRecord, "id">) => CatchRecord;
  setVessel: (v: Partial<VesselState>) => void;
  tickSim: (dtMs: number) => void;
  dropAnchor: () => void;
  weighAnchor: () => void;
  toggleMeasure: () => void;
  addMeasurePoint: (p: { lat: number; lon: number }) => void;
  clearMeasure: () => void;
  updateBoat: (b: Partial<BoatLimits>) => void;
  updateFloatPlan: (f: Partial<FloatPlan>) => void;
  addContact: (c: Omit<EmergencyContact, "id">) => void;
  markPack: (id: string, status: TripPackLayer["status"]) => void;
  downloadAllPacks: () => void;
  setPackBbox: (b: Partial<PackBBox>) => void;
  setPackWindow: (start: string, hours: number) => void;
  setPackLive: (live: boolean) => void;
  setSstStaleOverride: (v: boolean) => void;
  downloadTripPack: (opts?: { skipCache?: boolean }) => Promise<ReadyOffshoreResult | null>;
  updateCatch: (id: string, patch: Partial<CatchRecord>) => void;
  retryUnsyncedCatches: () => Promise<{ attempted: number; synced: number; failed: number }>;
  setArticle: (id: string | null) => void;
  setRipple: (r: AhanuState["markRipple"]) => void;
  setHydrated: () => void;
  setPlaying: (v: boolean) => void;
  setNmeaGateway: (v: boolean) => void;
  setReplayT: (t: number | null) => void;
  setSafetyDepth: (m: number) => void;
}

const defaultVessel = (): VesselState => ({
  lat: 39.905,
  lon: -69.695,
  cog: 145,
  sog: 7.4,
  heading: 145,
  depthM: 188,
  mode: "trolling",
  simulating: true,
  anchored: false,
  anchor: null,
  anchorRadiusM: 80,
});

export const useAhanu = create<AhanuState>()(
  persist(
    (set, get) => ({
      vessel: defaultVessel(),
      layers: DEFAULT_LAYERS,
      forecastHour: 0,
      species: "bigeye",
      panel: null,
      displayMode: readPersistedDisplayMode(),
      tideHarbor: readPersistedTideHarbor(),
      waypoints: SEED_SPOTS,
      catches: [],
      track: [{ lat: 39.905, lon: -69.695 }],
      measure: { active: false, points: [] },
      boat: DEFAULT_BOAT,
      floatPlan: {
        skipper: "",
        vessel: "Laughing One",
        departure: "Point Judith — Galilee",
        returnEta: "Sunday 18:00",
        souls: 4,
        route: "PJ → Veatch west wall → Atlantis slide",
        contacts: "",
        radio: "VHF 16 / 68  ·  MMSI on file",
        notes: "",
      },
      contacts: [
        { id: "c1", name: "USCG Sector Southeastern New England", role: "Rescue", phone: "401-435-2300" },
        { id: "c2", name: "Dock / home", role: "Float plan", phone: "" },
      ],
      packLayers: [],
      packBbox: { ...POINT_JUDITH_CANYON_BBOX },
      packHours: 72,
      packStart: new Date().toISOString(),
      packManifest: null,
      packReady: null,
      packDownloading: false,
      packError: null,
      packEpoch: 0,
      packLive: false,
      packLiveErrors: [],
      sstStaleOverride: false,
      simT: 0.12,
      followShip: true,
      markRipple: null,
      articleId: null,
      breakSensitivity: 1,
      clockMs: Date.parse("2026-08-20T21:40:00Z"),
      hydrated: false,
      forecastPlaying: false,
      nmeaGateway: false,
      replayT: null,
      safetyDepthM: 10,
      setPanel: (panel) => set({ panel }),
      toggleLayer: (id) =>
        set((s) => ({
          layers: {
            ...s.layers,
            [id]: { ...s.layers[id], visible: !s.layers[id]!.visible },
          },
        })),
      setOpacity: (id, opacity) =>
        set((s) => ({
          layers: { ...s.layers, [id]: { ...s.layers[id]!, opacity } },
        })),
      setHour: (forecastHour) => set({ forecastHour }),
      setSpecies: (species) => set({ species }),
      setDisplayMode: (displayMode) => {
        const next = applyDisplayMode(displayMode);
        writePersistedDisplayMode(next);
        set({ displayMode: next });
      },
      setTideHarbor: (harbor) => {
        const raw = harbor.trim() || DEFAULT_TIDE_HARBOR;
        const st = findPackedTideStation(raw);
        const next = st?.name ?? raw;
        writePersistedTideHarbor(st ? { id: st.id, name: st.name } : next);
        set({ tideHarbor: next });
      },
      setMode: (mode) =>
        set((s) => ({
          vessel: {
            ...s.vessel,
            mode,
            sog: mode === "trolling" ? s.boat.trollKt : mode === "steaming" ? s.boat.cruiseKt : 0,
            simulating: mode !== "gps" && mode !== "anchor",
            anchored: mode === "anchor",
          },
          simT: mode === "steaming" ? 0 : s.simT,
        })),
      setFollow: (followShip) => set({ followShip }),
      setBreakSensitivity: (breakSensitivity) => set({ breakSensitivity }),
      addWaypoint: (w) =>
        set((s) => ({
          waypoints: [
            ...s.waypoints,
            { ...w, id: uid("wp"), createdAt: new Date().toISOString() },
          ],
        })),
      removeWaypoint: (id) =>
        set((s) => ({ waypoints: s.waypoints.filter((w) => w.id !== id) })),
      addCatch: (c) => {
        const rec: CatchRecord = { ...c, id: uid("catch"), synced: c.synced ?? false };
        set((s) => ({ catches: [rec, ...s.catches] }));
        void syncCatch(rec, { token: deviceToken() }).then((next) => {
          if (next.synced) {
            useAhanu.getState().updateCatch(next.id, { synced: true });
          }
        });
        return rec;
      },
      updateCatch: (id, patch) =>
        set((s) => ({
          catches: s.catches.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),
      retryUnsyncedCatches: () => retryUnsyncedCatchesOnce(),
      setVessel: (v) => set((s) => ({ vessel: { ...s.vessel, ...v } })),
      tickSim: (dtMs) => {
        const s = get();
        let hour = s.forecastHour;
        let playing = s.forecastPlaying;
        if (playing) {
          playAcc += dtMs;
          if (playAcc >= 1600) {
            playAcc = 0;
            hour = hour + 3;
            if (hour > 72) {
              hour = 0;
              playing = false;
            }
          }
        }
        if (!s.vessel.simulating || s.vessel.anchored) {
          set({ clockMs: s.clockMs + dtMs, forecastHour: hour, forecastPlaying: playing });
          return;
        }
        const hours = (dtMs / 3600000) * 48;
        const kt = s.vessel.sog;
        const nm = kt * hours;
        let lat = s.vessel.lat;
        let lon = s.vessel.lon;
        let cog = s.vessel.cog;
        let t = s.simT;
        if (s.vessel.mode === "trolling") {
          t = (t + nm / 28) % 1;
          const i = Math.floor(t * (TROLL_PATH.length - 1));
          const a = TROLL_PATH[i]!;
          const b = TROLL_PATH[i + 1] ?? TROLL_PATH[0]!;
          const u = t * (TROLL_PATH.length - 1) - i;
          lat = a.lat + (b.lat - a.lat) * u;
          lon = a.lon + (b.lon - a.lon) * u;
          cog = initialBearing(a, b);
        } else if (s.vessel.mode === "steaming") {
          t = Math.min(1, t + nm / 132);
          const i = t < 0.55 ? 0 : 1;
          const local = t < 0.55 ? t / 0.55 : (t - 0.55) / 0.45;
          const a = STEAM_PATH[i]!;
          const b = STEAM_PATH[i + 1]!;
          lat = a.lat + (b.lat - a.lat) * local;
          lon = a.lon + (b.lon - a.lon) * local;
          cog = initialBearing(a, b);
        }
        const track = s.track;
        const last = track[track.length - 1];
        const nextTrack =
          !last || haversineNm(last, { lat, lon }) > 0.12
            ? [...track.slice(-400), { lat, lon }]
            : track;
        set({
          simT: t,
          clockMs: s.clockMs + dtMs * 12,
          forecastHour: hour,
          forecastPlaying: playing,
          track: nextTrack,
          vessel: {
            ...s.vessel,
            lat,
            lon,
            cog,
            heading: cog,
            depthM: Math.max(8, depthM(lat, lon)),
            sog: kt,
          },
        });
      },
      dropAnchor: () =>
        set((s) => ({
          vessel: {
            ...s.vessel,
            anchored: true,
            simulating: false,
            sog: 0,
            mode: "anchor",
            anchor: { lat: s.vessel.lat, lon: s.vessel.lon },
          },
        })),
      weighAnchor: () =>
        set((s) => ({
          vessel: {
            ...s.vessel,
            anchored: false,
            simulating: true,
            mode: "trolling",
            sog: s.boat.trollKt,
            anchor: null,
          },
        })),
      toggleMeasure: () =>
        set((s) => ({
          measure: { active: !s.measure.active, points: s.measure.active ? [] : s.measure.points },
        })),
      addMeasurePoint: (p) =>
        set((s) => ({ measure: { ...s.measure, points: [...s.measure.points, p].slice(-8) } })),
      clearMeasure: () => set({ measure: { active: false, points: [] } }),
      updateBoat: (b) => set((s) => ({ boat: { ...s.boat, ...b } })),
      updateFloatPlan: (f) => set((s) => ({ floatPlan: { ...s.floatPlan, ...f } })),
      addContact: (c) =>
        set((s) => ({ contacts: [...s.contacts, { ...c, id: uid("em") }] })),
      markPack: (id, status) =>
        set((s) => ({
          packLayers: s.packLayers.map((p) =>
            p.id === id ? { ...p, status, updatedAt: new Date().toISOString() } : p,
          ),
        })),
      setPackBbox: (b) => set((s) => ({ packBbox: { ...s.packBbox, ...b } })),
      setPackWindow: (packStart, packHours) => set({ packStart, packHours }),
      setPackLive: (packLive) => set({ packLive }),
      setSstStaleOverride: (sstStaleOverride) => {
        const s = get();
        const next: Partial<AhanuState> = { sstStaleOverride };
        if (s.packManifest && s.packLayers.length) {
          const result = evaluateReadyForOffshore({
            hours: s.packManifest.hours,
            start: s.packManifest.start,
            sstOverride: sstStaleOverride,
            layers: evidenceFromPackLayers(s.packManifest, s.packLayers),
            liveErrors: s.packManifest.liveErrors,
          });
          next.packReady = result;
          next.packError = result.ready ? null : result.failures.join("; ");
        }
        set(next);
      },
      downloadAllPacks: () => {
        void get().downloadTripPack();
      },
      downloadTripPack: async (opts) => {
        const s = get();
        set({
          packDownloading: true,
          packError: null,
          packLiveErrors: [],
          packLayers: s.packLayers.map((p) => ({ ...p, status: "downloading" as const })),
        });
        try {
          const result = await fetchTripPack({
            bbox: s.packBbox,
            start: s.packStart,
            hours: s.packHours,
            live: s.packLive,
            skipCache: Boolean(opts?.skipCache),
            sstOverride: s.sstStaleOverride,
          });
          const packLayers = tripPackLayersFromReady(result.manifest, result.ready);
          set({
            packLayers,
            packManifest: result.manifest,
            packReady: result.ready,
            packDownloading: false,
            packError: result.ready.ready ? null : result.ready.failures.join("; "),
            packLiveErrors: s.packLive ? capLiveErrors(result.manifest.liveErrors) : [],
            packEpoch: packedEpoch(),
          });
          return result.ready;
        } catch (err) {
          const message = err instanceof Error ? err.message : "pack download failed";
          set({ packDownloading: false, packError: message, packReady: null });
          return null;
        }
      },
      setArticle: (articleId) => set({ articleId, panel: "knowledge" }),
      setRipple: (markRipple) => set({ markRipple }),
      setHydrated: () => set({ hydrated: true }),
      setPlaying: (forecastPlaying) => {
        if (forecastPlaying) playAcc = 0;
        set({ forecastPlaying });
      },
      setNmeaGateway: (nmeaGateway) => set({ nmeaGateway }),
      setReplayT: (replayT) => set({ replayT, followShip: replayT == null }),
      setSafetyDepth: (safetyDepthM) => set({ safetyDepthM }),
    }),
    {
      name: "ahanu-bridge-v1",
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.layers = { ...DEFAULT_LAYERS, ...state.layers };
        if (!Array.isArray(state.packLiveErrors)) state.packLiveErrors = [];
        const next = applyDisplayMode(state.displayMode);
        writePersistedDisplayMode(next);
        if (next !== state.displayMode) state.displayMode = next;
        const harbor = (typeof state.tideHarbor === "string" && state.tideHarbor.trim())
          ? state.tideHarbor.trim()
          : readPersistedTideHarbor();
        writePersistedTideHarbor(harbor);
        if (harbor !== state.tideHarbor) state.tideHarbor = harbor;
      },
      partialize: (s) => ({
        waypoints: s.waypoints,
        catches: s.catches,
        boat: s.boat,
        floatPlan: s.floatPlan,
        contacts: s.contacts,
        displayMode: s.displayMode,
        tideHarbor: s.tideHarbor,
        species: s.species,
        layers: s.layers,
        packLayers: s.packLayers,
        packBbox: s.packBbox,
        packHours: s.packHours,
        packStart: s.packStart,
        packManifest: s.packManifest,
        packReady: s.packReady,
        packLive: s.packLive,
        packLiveErrors: s.packLiveErrors,
        sstStaleOverride: s.sstStaleOverride,
        nmeaGateway: s.nmeaGateway,
        safetyDepthM: s.safetyDepthM,
      }),
    },
  ),
);

type RetryCounts = { attempted: number; synced: number; failed: number };

let retryInflight: Promise<RetryCounts> | null = null;
let hydrateInflight: Promise<RetryCounts> | null = null;

/** One leftover-catch pass. Save, hydrate, visibility, and online share this. */
export function retryUnsyncedCatchesOnce(): Promise<RetryCounts> {
  if (retryInflight) return retryInflight;
  const pending = (async () => {
    const token = deviceToken();
    if (!token) return { attempted: 0, synced: 0, failed: 0 };
    const result = await postUnsyncedCatches(useAhanu.getState().catches, { token });
    if (result.synced > 0) {
      const ok = new Set(result.records.filter((r) => r.synced).map((r) => r.id));
      useAhanu.setState((s) => ({
        catches: s.catches.map((c) => (ok.has(c.id) ? { ...c, synced: true } : c)),
      }));
    }
    return { attempted: result.attempted, synced: result.synced, failed: result.failed };
  })();
  retryInflight = pending;
  void pending.finally(() => {
    if (retryInflight === pending) retryInflight = null;
  });
  return pending;
}

/** One persist restore + one leftover-catch retry. Helm boot only — not a loop. */
export async function hydrateAhanuStore() {
  if (hydrateInflight) return hydrateInflight;
  hydrateInflight = (async () => {
    try {
      await useAhanu.persist?.rehydrate?.();
      // IDB is source of truth for a dock pack. Persist can be empty or
      // raced to [] if a parallel setState wrote before rehydrate.
      const restored = await restorePackedSession({
        sstOverride: useAhanu.getState().sstStaleOverride,
      });
      if (restored) {
        useAhanu.setState({
          packManifest: restored.manifest,
          packLayers: restored.layers,
          packReady: restored.ready,
          packError: restored.ready.ready ? null : restored.ready.failures.join("; "),
          packLiveErrors: capLiveErrors(restored.manifest.liveErrors),
          packEpoch: packedEpoch(),
        });
      }
      useAhanu.getState().setHydrated();
      return await retryUnsyncedCatchesOnce();
    } finally {
      hydrateInflight = null;
    }
  })();
  return hydrateInflight;
}

type WakeDoc = Pick<Document, "addEventListener" | "removeEventListener"> & {
  visibilityState?: string;
};
type WakeWin = Pick<Window, "addEventListener" | "removeEventListener">;

/** visibilitychange + online → one leftover-catch retry. Remove on unmount. */
export function bindUnsyncedCatchRetry(opts?: { document?: WakeDoc; window?: WakeWin }): () => void {
  const doc = opts?.document ?? (typeof document !== "undefined" ? document : undefined);
  const win = opts?.window ?? (typeof window !== "undefined" ? window : undefined);
  const onVisible = () => {
    if (doc && doc.visibilityState !== "visible") return;
    void retryUnsyncedCatchesOnce();
  };
  const onOnline = () => {
    void retryUnsyncedCatchesOnce();
  };
  doc?.addEventListener("visibilitychange", onVisible);
  win?.addEventListener("online", onOnline);
  return () => {
    doc?.removeEventListener("visibilitychange", onVisible);
    win?.removeEventListener("online", onOnline);
  };
}

export function markFishHere() {
  const s = useAhanu.getState();
  const rec = s.addCatch({
    species: s.species,
    lat: s.vessel.lat,
    lon: s.vessel.lon,
    at: new Date(s.clockMs).toISOString(),
    released: false,
    sstC: sstC(s.vessel.lat, s.vessel.lon, s.forecastHour),
    depthM: s.vessel.depthM,
    conditions: `SOG ${s.vessel.sog.toFixed(1)} kt  COG ${s.vessel.cog.toFixed(0)}°`,
    synced: false,
  });
  s.setRipple({ lat: s.vessel.lat, lon: s.vessel.lon, id: rec.id });
  s.addWaypoint({
    name: `${s.species.toUpperCase()} ${new Date(s.clockMs).toISOString().slice(11, 16)}`,
    lat: s.vessel.lat,
    lon: s.vessel.lon,
    depthM: s.vessel.depthM,
    tags: [s.species],
    color: "#E4B56A",
  });
  return rec;
}

export { destination };

applyPersistedDisplayMode();
