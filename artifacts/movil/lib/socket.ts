import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;
let activeToken: string | null = null;

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;

/**
 * Lazily create (or reuse) the singleton Socket.io connection authenticated
 * with the caller's JWT. The backend mounts Socket.io at /api/socket.io and
 * validates the token during the handshake.
 *
 * If a socket already exists for a *different* token (e.g. after logout +
 * login as another user), it is torn down and recreated so the realtime
 * session can never stay bound to a previous user's identity/rooms.
 */
export function connectSocket(token: string): Socket {
  if (socket && activeToken === token) {
    if (!socket.connected) socket.connect();
    return socket;
  }
  // Token changed (or first connect) — drop any stale session first.
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  activeToken = token;
  socket = io(`https://${DOMAIN}`, {
    path: "/api/socket.io",
    transports: ["websocket"],
    auth: { token },
    autoConnect: true,
  });
  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  activeToken = null;
}
