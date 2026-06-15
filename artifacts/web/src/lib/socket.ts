import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;
let activeToken: string | null = null;

// The Socket.io server is mounted at `<BASE_URL>api/socket.io` on the same
// origin that serves the web app (the reverse proxy routes `/api` to the API
// server). Normalise the base path so we never produce a double slash.
function socketPath(): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/+$/, "")}/api/socket.io`;
}

/**
 * Lazily create (or reuse) the singleton Socket.io connection authenticated
 * with the caller's JWT. The backend validates the token during the handshake.
 *
 * If a socket already exists for a *different* token (e.g. after logout + login
 * as another user) it is torn down and recreated so the realtime session never
 * stays bound to a previous user's identity/rooms.
 */
export function connectSocket(token: string): Socket {
  if (socket && activeToken === token) {
    if (!socket.connected) socket.connect();
    return socket;
  }
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  activeToken = token;
  socket = io(window.location.origin, {
    path: socketPath(),
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
