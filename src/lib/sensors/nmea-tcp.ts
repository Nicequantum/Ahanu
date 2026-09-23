/**
 * Receive-only NMEA 0183 TCP client.
 * Garmin Signal VHF publishes AIS on port 39150. This socket never writes.
 * Not imported by the browser bundle — the PWA cannot open raw TCP.
 */

import { GARMIN_SIGNAL_VHF_PORT } from "./ports";

export interface NmeaTcpHandle {
  disconnect(): Promise<void>;
  /** Always 0. The radio stays the radio. */
  bytesWritten(): number;
}

export async function connectNmeaTcp(options: {
  host: string;
  port?: number;
  onLine: (line: string) => void;
  onError?: (err: Error) => void;
}): Promise<NmeaTcpHandle> {
  const host = options.host.trim();
  if (!host) throw new Error("NMEA TCP host is empty");
  const port = options.port ?? GARMIN_SIGNAL_VHF_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("NMEA TCP port is invalid");
  const net = await import("node:net");
  const socket = net.createConnection({ host, port });
  socket.setEncoding("utf8");
  let buf = "";
  let written = 0;
  const origWrite = socket.write.bind(socket);
  socket.write = ((...args: unknown[]) => {
    written += 1;
    return origWrite(...(args as Parameters<typeof socket.write>));
  }) as typeof socket.write;

  socket.on("data", (chunk: string) => {
    buf += chunk;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) options.onLine(trimmed);
    }
  });
  socket.on("error", (err) => {
    options.onError?.(err);
  });

  await new Promise<void>((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const bad = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      socket.off("connect", ok);
      socket.off("error", bad);
    };
    socket.once("connect", ok);
    socket.once("error", bad);
  });

  return {
    bytesWritten: () => written,
    disconnect: () =>
      new Promise((resolve) => {
        if (socket.destroyed) {
          resolve();
          return;
        }
        socket.end(() => resolve());
        socket.destroy();
      }),
  };
}
