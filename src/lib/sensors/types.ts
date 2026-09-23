import type { SensorKind, SensorProvenance } from "@/lib/ahanu/types";

export interface SensorFrame<T> {
  sourceId: string;
  kind: SensorKind;
  at: number;
  provenance: SensorProvenance | string;
  payload: T;
}

/**
 * One sensor. `connect` opens the ear, `stream` yields samples, `disconnect` closes it.
 * Implementations must not transmit. A hard error fails the stream closed.
 */
export interface SensorSource<T> {
  readonly id: string;
  readonly kind: SensorKind;
  connect(): Promise<void>;
  stream(): AsyncIterable<SensorFrame<T>>;
  disconnect(): Promise<void>;
}
