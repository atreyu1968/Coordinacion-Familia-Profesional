export interface ChatRoomSocket {
  connected: boolean;
  emit(event: string, ...args: unknown[]): unknown;
  on(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
}

export function mergeChatMessageSnapshot<T extends { id: number }>(
  current: T[],
  refreshed: T[],
  previouslyLoadedIds: ReadonlySet<number>,
  compare: (a: T, b: T) => number,
): T[] {
  const byId = new Map<number, T>();
  for (const message of refreshed) byId.set(message.id, message);
  // A message received after the request began may not be in its snapshot.
  for (const message of current) {
    if (!previouslyLoadedIds.has(message.id)) byId.set(message.id, message);
  }
  return [...byId.values()].sort(compare);
}

/**
 * Join a chat room whenever the socket connects and rehydrate its client state.
 * Socket.io does not restore server-side room membership after reconnecting.
 */
export function subscribeToChatRoom(
  socket: ChatRoomSocket,
  groupId: number,
  rehydrate: () => void,
): () => void {
  let active = true;
  const synchronize = () => {
    if (!active) return;
    socket.emit("join", groupId);
    rehydrate();
  };

  socket.on("connect", synchronize);
  if (socket.connected) synchronize();

  return () => {
    active = false;
    socket.off("connect", synchronize);
    if (socket.connected) socket.emit("leave", groupId);
  };
}
