/** Engine room ear. Simulated by default. No socket, no transmit. */

import type { EngineRoomMode, SensorKind } from "@/lib/ahanu/types";
import { simPicture, type EnginePicture } from "@/lib/ahanu/engine/sim";
import type { InstanceMap } from "@/lib/ahanu/engine/map";
import { PushSource } from "./push-source";

export class EngineSimSource extends PushSource<EnginePicture> {
  readonly id = "engine-sim";
  readonly kind: SensorKind = "engine";
  readonly bytesSent = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly getMap: () => InstanceMap;
  private readonly warn: (line: string) => void;
  private readonly getMode: () => EngineRoomMode;

  constructor(opts: { getMap: () => InstanceMap; getMode?: () => EngineRoomMode; warn?: (line: string) => void }) {
    super();
    this.getMap = opts.getMap;
    this.getMode = opts.getMode ?? (() => "carb");
    this.warn = opts.warn ?? (() => {});
  }

  protected async onConnect(): Promise<void> {
    this.emit(simPicture(this.getMap(), Date.now(), this.warn, this.getMode()), "sim");
    this.timer = setInterval(() => {
      this.emit(simPicture(this.getMap(), Date.now(), this.warn, this.getMode()), "sim");
    }, 250);
  }

  protected async onDisconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
