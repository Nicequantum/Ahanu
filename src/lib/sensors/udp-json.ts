/**
 * Receive-only UDP JSON gateway. The socket never sends a datagram.
 * Browser helms use the WebSocket path instead; this is the Node/boat adapter.
 */

import { AIS_JSON_UDP_PORT } from "./ports";

export interface UdpJsonHandle {
  port(): number;
  disconnect(): Promise<void>;
  bytesSent(): number;
}

export async function listenUdpJson(options: {
  port?: number;
  onPayload: (text: string, rinfo: { address: string; port: number }) => void;
  onError?: (err: Error) => void;
}): Promise<UdpJsonHandle> {
  const port = options.port ?? AIS_JSON_UDP_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("UDP port is invalid");
  const dgram = await import("node:dgram");
  const socket = dgram.createSocket("udp4");
  let sent = 0;
  const origSend = socket.send.bind(socket);
  socket.send = ((...args: unknown[]) => {
    sent += 1;
    return origSend(...(args as Parameters<typeof socket.send>));
  }) as typeof socket.send;

  socket.on("message", (msg, rinfo) => {
    options.onPayload(msg.toString("utf8"), { address: rinfo.address, port: rinfo.port });
  });
  socket.on("error", (err) => options.onError?.(err));

  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(port, "0.0.0.0", () => {
      socket.off("error", reject);
      resolve();
    });
  });

  return {
    port: () => {
      const addr = socket.address();
      return typeof addr === "string" ? port : addr.port;
    },
    bytesSent: () => sent,
    disconnect: () =>
      new Promise((resolve) => {
        socket.close(() => resolve());
      }),
  };
}
