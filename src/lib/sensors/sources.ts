/** AIS (sim / NMEA lines / JSON), radar stub, sonar stub. All receive-only. */

import { AisStream } from "@/lib/ahanu/ais/vdm";
import { parseOwnShip } from "@/lib/ahanu/ais/ownship";
import type { AisTarget } from "@/lib/data/ais";
import type { RadarReturn, SonarColumn } from "@/lib/ahanu/types";
import { parseGatewayPayload } from "./gateway-json";
import { projectRadar } from "./fuse";
import { PushSource } from "./push-source";

export interface OwnGetter {
  (): { lat: number; lon: number; sog: number; cog: number; heading: number; depthM: number };
}

const STUB_HITS = [
  { id: "r-1", rangeNm: 1.6, bearingDeg: 18, strength: 0.72 },
  { id: "r-2", rangeNm: 3.4, bearingDeg: 292, strength: 0.4 },
] as const;

export class AisLineSource extends PushSource<AisTarget[]> {
  readonly id = "ais";
  readonly kind = "ais" as const;
  private readonly streamer = new AisStream();
  private readonly byMmsi = new Map<string, AisTarget>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ws: WebSocket | null = null;
  private readonly opts: {
    mode: "sim" | "tcp" | "ws" | "udp";
    simFallback: boolean;
    wsUrl: string;
    simTargets: () => AisTarget[];
    onStatus: (line: string) => void;
    onOwn: (fix: { lat: number; lon: number; sog?: number; cog?: number }) => void;
  };

  constructor(opts: AisLineSource["opts"]) {
    super();
    this.opts = opts;
  }

  protected async onConnect(): Promise<void> {
    if (this.opts.mode === "sim") {
      this.opts.onStatus("sim · no radio");
      this.publishSim();
      this.timer = setInterval(() => this.publishSim(), 2000);
      return;
    }
    if (this.opts.mode === "tcp" || this.opts.mode === "udp") {
      const why =
        this.opts.mode === "tcp"
          ? "Browser cannot open Garmin Signal TCP 39150. Use the WebSocket gateway, or the Node TCP client on the boat."
          : "Browser cannot bind UDP. Use the WebSocket JSON gateway.";
      this.opts.onStatus(why);
      if (this.opts.simFallback) {
        this.publishSim();
        this.timer = setInterval(() => this.publishSim(), 2000);
        return;
      }
      this.failClosed(new Error(why));
      return;
    }
    const url = this.opts.wsUrl.trim();
    if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
      const why = "WebSocket gateway URL missing";
      this.opts.onStatus(why);
      if (this.opts.simFallback) {
        this.publishSim();
        this.timer = setInterval(() => this.publishSim(), 2000);
        return;
      }
      this.failClosed(new Error(why));
      return;
    }
    await new Promise<void>((resolve) => {
      let opened = false;
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onmessage = (ev) => {
        const text = typeof ev.data === "string" ? ev.data : "";
        this.ingestText(text, "ws-json");
      };
      ws.onerror = () => {
        const why = "WebSocket gateway failed";
        this.opts.onStatus(why);
        if (!opened) {
          if (this.opts.simFallback) {
            this.publishSim();
            this.timer = setInterval(() => this.publishSim(), 2000);
            resolve();
          } else {
            this.failClosed(new Error(why));
            resolve();
          }
        }
      };
      ws.onopen = () => {
        opened = true;
        this.opts.onStatus(`ws · ${url}`);
        resolve();
      };
    });
  }

  protected async onDisconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.ws?.close();
    this.ws = null;
  }

  /** Feed one NMEA line or a JSON gateway chunk. Used by the TCP/UDP adapters and tests. */
  ingestText(text: string, provenance: "nmea-vdm" | "ws-json" | "udp-json" | "nmea-tcp"): void {
    const chunks = parseGatewayPayload(text, provenance === "nmea-tcp" || provenance === "nmea-vdm" ? "nmea-vdm" : provenance);
    for (const chunk of chunks) {
      if (chunk.kind === "reject") {
        if (text.startsWith("!") || text.startsWith("$")) this.ingestNmea(text, provenance);
        continue;
      }
      if (chunk.kind === "nmea") {
        for (const line of chunk.sentences) this.ingestNmea(line, provenance);
      } else {
        this.byMmsi.set(chunk.target.mmsi, { ...chunk.target, provenance });
        this.emit([...this.byMmsi.values()], provenance);
      }
    }
  }

  ingestNmea(line: string, provenance: "nmea-vdm" | "ws-json" | "udp-json" | "nmea-tcp"): void {
    const own = parseOwnShip(line);
    if (own) {
      this.opts.onOwn(own);
      return;
    }
    const ev = this.streamer.pushLine(line);
    if (ev.kind === "drop") return;
    if (ev.kind === "static") return;
    const target = {
      ...ev.target,
      provenance: provenance === "nmea-tcp" ? ("nmea-tcp" as const) : ("nmea-vdm" as const),
    };
    this.byMmsi.set(target.mmsi, target);
    this.emit([...this.byMmsi.values()], target.provenance);
  }

  private publishSim(): void {
    const targets = this.opts.simTargets().map((t) => ({ ...t, provenance: "sim" as const, receivedAt: Date.now() }));
    this.emit(targets, "sim");
  }
}

export class RadarStubSource extends PushSource<RadarReturn[]> {
  readonly id = "radar-stub";
  readonly kind = "radar" as const;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly own: OwnGetter;

  constructor(own: OwnGetter) {
    super();
    this.own = own;
  }

  protected async onConnect(): Promise<void> {
    this.tick();
    this.timer = setInterval(() => this.tick(), 2000);
  }

  protected async onDisconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const ship = this.own();
    const at = Date.now();
    this.emit(
      projectRadar(
        ship,
        STUB_HITS.map((h) => ({ ...h, at, provenance: "stub" as const })),
      ),
      "stub",
      at,
    );
  }
}

export class SonarStubSource extends PushSource<SonarColumn> {
  readonly id = "sonar-stub";
  readonly kind = "sonar" as const;
  private timer: ReturnType<typeof setInterval> | null = null;
  private phase = 0;
  private readonly own: OwnGetter;

  constructor(own: OwnGetter) {
    super();
    this.own = own;
  }

  protected async onConnect(): Promise<void> {
    this.tick();
    this.timer = setInterval(() => this.tick(), 700);
  }

  protected async onDisconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const ship = this.own();
    this.phase += 0.7;
    const depthM = Math.max(4, ship.depthM);
    const fish = (Math.sin(this.phase) + 1) / 2 > 0.72;
    const column: SonarColumn = {
      at: Date.now(),
      depthM,
      provenance: "stub",
      marks: fish
        ? [{ depthM: depthM * (0.35 + (this.phase % 0.2)), strength: 0.8 }]
        : [],
    };
    this.emit(column, "stub", column.at);
  }
}
