/** Helm engine room. Sim is the default. A host is stored, never dialed from the browser. */

import { applyStale } from "@/lib/ahanu/engine/quality";
import { ENGINE_THRESHOLDS } from "@/lib/ahanu/engine/config";
import { useAhanu } from "@/lib/ahanu/store";
import { EngineSimSource } from "./engine-source";

export function startEngineRoom(): () => void {
  let stopped = false;
  let generation = 0;
  let source: EngineSimSource | null = null;

  const shutdown = async () => {
    const prev = source;
    source = null;
    await prev?.disconnect();
  };

  const boot = async () => {
    const gen = ++generation;
    await shutdown();
    if (stopped || gen !== generation) return;
    const snap = useAhanu.getState();
    if (snap.engineFeed !== "sim") {
      const why = snap.engineHost.trim()
        ? "Host is stored on the boat. This page does not open N2K and does not transmit. Sim stays on."
        : "Live engine path is opt-in and has no host. Sim stays on.";
      snap.setEngineNote(why);
    }
    source = new EngineSimSource({
      getMap: () => useAhanu.getState().engineInstanceMap,
      warn: (line) => {
        console.warn(line);
        useAhanu.getState().setEngineNote(line);
      },
    });
    try {
      await source.connect();
    } catch (err) {
      useAhanu.getState().setEngineNote(err instanceof Error ? err.message : "engine bus failed");
      return;
    }
    const local = source;
    void (async () => {
      try {
        for await (const frame of local.stream()) {
          if (stopped || gen !== generation) break;
          const readings = applyStale(frame.payload.readings, Date.now(), ENGINE_THRESHOLDS.staleMs);
          useAhanu.getState().setEnginePicture(readings, frame.payload.alarms, frame.payload.dtcs);
        }
      } catch (err) {
        if (!stopped && gen === generation) {
          useAhanu.getState().setEngineNote(err instanceof Error ? err.message : "engine failed closed");
        }
      }
    })();
  };

  void boot();
  const unsub = useAhanu.subscribe((state, prev) => {
    if (state.engineFeed !== prev.engineFeed || state.engineHost !== prev.engineHost) void boot();
  });
  return () => {
    stopped = true;
    unsub();
    void shutdown();
  };
}
