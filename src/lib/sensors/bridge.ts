/** Helm-side sensor bus. Browser-safe: no node:net, no transmit. */

import { aisTargets } from "@/lib/data/ais";
import { useAhanu } from "@/lib/ahanu/store";
import type { AisTarget } from "@/lib/data/ais";
import type { RadarReturn } from "@/lib/ahanu/types";
import { annotateAis, fusePicture } from "./fuse";
import { AisLineSource, RadarStubSource, SonarStubSource } from "./sources";

export function startHelmSensors(): () => void {
  let stopped = false;
  let generation = 0;
  let ais: AisLineSource | null = null;
  let radar: RadarStubSource | null = null;
  let sonar: SonarStubSource | null = null;
  let lastAis: AisTarget[] = [];
  let lastRadar: RadarReturn[] = [];

  const publish = () => {
    const own = useAhanu.getState().vessel;
    const picture = fusePicture(annotateAis(lastAis, own), lastRadar, Date.now());
    useAhanu.getState().setPicture(picture.ais, picture.radarOnly);
  };

  const shutdown = async () => {
    const prev = [ais, radar, sonar];
    ais = null;
    radar = null;
    sonar = null;
    await Promise.all(prev.map((s) => s?.disconnect() ?? Promise.resolve()));
  };

  const boot = async () => {
    const gen = ++generation;
    await shutdown();
    if (stopped || gen !== generation) return;
    const snap = useAhanu.getState();
    lastAis = [];
    lastRadar = [];
    if (snap.radioMode !== "sim" && !snap.radioSimFallback) {
      snap.setPicture([], []);
    }
    ais = new AisLineSource({
      mode: snap.radioMode,
      simFallback: snap.radioSimFallback,
      wsUrl: snap.radioWsUrl,
      simTargets: () => {
        const s = useAhanu.getState();
        return aisTargets(s.clockMs, s.forecastHour);
      },
      onStatus: (line) => useAhanu.getState().setSensorNote(line),
      onOwn: (fix) => {
        const mode = useAhanu.getState().radioMode;
        if (mode === "sim") return;
        useAhanu.getState().setVessel({
          lat: fix.lat,
          lon: fix.lon,
          ...(fix.sog != null ? { sog: fix.sog } : {}),
          ...(fix.cog != null ? { cog: fix.cog, heading: fix.cog } : {}),
          simulating: false,
        });
      },
    });
    const own = () => useAhanu.getState().vessel;
    radar = new RadarStubSource(own);
    sonar = new SonarStubSource(own);
    try {
      await ais.connect();
      await radar.connect();
      await sonar.connect();
    } catch (err) {
      useAhanu.getState().setSensorNote(err instanceof Error ? err.message : "sensor bus failed");
      return;
    }
    if (stopped || gen !== generation) {
      await shutdown();
      return;
    }
    const localAis = ais;
    const localRadar = radar;
    const localSonar = sonar;
    void (async () => {
      try {
        for await (const frame of localAis.stream()) {
          if (stopped || gen !== generation) break;
          lastAis = frame.payload;
          publish();
        }
      } catch (err) {
        if (!stopped && gen === generation) {
          useAhanu.getState().setSensorNote(err instanceof Error ? err.message : "AIS failed closed");
          if (!useAhanu.getState().radioSimFallback) useAhanu.getState().setPicture([], lastRadar);
        }
      }
    })();
    void (async () => {
      try {
        for await (const frame of localRadar.stream()) {
          if (stopped || gen !== generation) break;
          lastRadar = frame.payload;
          publish();
        }
      } catch {
        /* stub failures stay off the chart */
      }
    })();
    void (async () => {
      try {
        for await (const frame of localSonar.stream()) {
          if (stopped || gen !== generation) break;
          useAhanu.getState().pushSonar(frame.payload);
        }
      } catch {
        /* sounder stub is local */
      }
    })();
  };

  void boot();
  const unsub = useAhanu.subscribe((s, prev) => {
    if (
      s.radioMode !== prev.radioMode ||
      s.radioSimFallback !== prev.radioSimFallback ||
      s.radioWsUrl !== prev.radioWsUrl ||
      s.radioHost !== prev.radioHost
    ) {
      void boot();
    }
  });

  return () => {
    stopped = true;
    unsub();
    void shutdown();
  };
}
