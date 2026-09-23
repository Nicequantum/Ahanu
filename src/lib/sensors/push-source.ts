import type { SensorKind } from "@/lib/ahanu/types";
import type { SensorFrame, SensorSource } from "./types";

/** Queueing base for sources that push from a socket, a timer, or a test. */
export abstract class PushSource<T> implements SensorSource<T> {
  abstract readonly id: string;
  abstract readonly kind: SensorKind;
  private queue: SensorFrame<T>[] = [];
  private wake: (() => void) | null = null;
  private stopped = false;
  private opened = false;
  protected closedError: Error | null = null;

  protected emit(payload: T, provenance: SensorFrame<T>["provenance"], at = Date.now()): void {
    if (this.stopped) return;
    this.queue.push({ sourceId: this.id, kind: this.kind, at, provenance, payload });
    this.wake?.();
    this.wake = null;
  }

  /** Stop the stream and surface `err` to the consumer. Nothing after this is trusted. */
  protected failClosed(err: Error): void {
    this.closedError = err;
    this.stopped = true;
    this.wake?.();
    this.wake = null;
  }

  async connect(): Promise<void> {
    if (this.closedError) throw this.closedError;
    this.opened = true;
    await this.onConnect();
  }

  protected async onConnect(): Promise<void> {}

  async *stream(): AsyncGenerator<SensorFrame<T>> {
    if (!this.opened) throw new Error(`${this.id}: stream before connect`);
    while (!this.stopped || this.queue.length > 0) {
      if (this.queue.length === 0) {
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
        continue;
      }
      const frame = this.queue.shift();
      if (frame) yield frame;
    }
    if (this.closedError) throw this.closedError;
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    await this.onDisconnect();
    this.wake?.();
    this.wake = null;
    this.opened = false;
  }

  protected async onDisconnect(): Promise<void> {}
}
