import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@/shared/protocol";

export type RoomSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** In production set NEXT_PUBLIC_SYNC_URL. Locally we assume the sync server runs on port 4000 of the same host
 *  (so a phone opening http://<laptop-ip>:3000 automatically talks to http://<laptop-ip>:4000). */
export function syncUrl() {
  return process.env.NEXT_PUBLIC_SYNC_URL || `${window.location.protocol}//${window.location.hostname}:4000`;
}

export function createSocket(): RoomSocket {
  return io(syncUrl(), {
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  });
}

export function createRoom(name: string, memberId: string): Promise<string> {
  const s = createSocket();
  return new Promise((resolve, reject) => {
    const fail = setTimeout(() => {
      s.close();
      reject(new Error("The sync server did not answer. If it was asleep, wait ~30 s and try again."));
    }, 45_000);
    s.emit("room:create", { name, memberId }, ({ roomCode }) => {
      clearTimeout(fail);
      s.close();
      resolve(roomCode);
    });
  });
}
