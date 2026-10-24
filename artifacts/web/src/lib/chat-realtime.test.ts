import { describe, expect, it } from "vitest";
import {
  mergeChatMessageSnapshot,
  subscribeToChatRoom,
  type ChatRoomSocket,
} from "@workspace/api-client-react";

class TestSocket implements ChatRoomSocket {
  connected = true;
  readonly emitted: Array<{ event: string; args: unknown[] }> = [];
  private readonly listeners = new Map<string, Set<(...args: any[]) => void>>();

  emit(event: string, ...args: unknown[]) {
    this.emitted.push({ event, args });
  }

  on(event: string, listener: (...args: any[]) => void) {
    const eventListeners = this.listeners.get(event) ?? new Set();
    eventListeners.add(listener);
    this.listeners.set(event, eventListeners);
  }

  off(event: string, listener: (...args: any[]) => void) {
    this.listeners.get(event)?.delete(listener);
  }

  disconnect() {
    this.connected = false;
  }

  reconnect() {
    this.connected = true;
    for (const listener of this.listeners.get("connect") ?? []) listener();
  }
}

describe("chat room reconnect recovery", () => {
  it("rejoins and reloads messages changed while disconnected", () => {
    const socket = new TestSocket();
    let serverMessages = [{ id: 1, content: "mensaje inicial" }];
    let visibleMessages = [...serverMessages];
    const previouslyLoadedIds = new Set(visibleMessages.map((message) => message.id));
    const rehydrate = () => {
      visibleMessages = mergeChatMessageSnapshot(
        visibleMessages,
        serverMessages,
        previouslyLoadedIds,
        (a, b) => a.id - b.id,
      );
    };

    const unsubscribe = subscribeToChatRoom(socket, 42, rehydrate);
    expect(visibleMessages).toEqual([{ id: 1, content: "mensaje inicial" }]);
    expect(socket.emitted).toEqual([{ event: "join", args: [42] }]);

    socket.disconnect();
    serverMessages = [
      ...serverMessages,
      { id: 2, content: "enviado durante la desconexión" },
    ];
    socket.reconnect();

    expect(socket.emitted).toEqual([
      { event: "join", args: [42] },
      { event: "join", args: [42] },
    ]);
    expect(visibleMessages).toContainEqual({
      id: 2,
      content: "enviado durante la desconexión",
    });
    expect(visibleMessages).toHaveLength(2);

    unsubscribe();
    expect(socket.emitted.at(-1)).toEqual({ event: "leave", args: [42] });
  });

  it("removes hidden messages and uses the latest server copy without duplicates", () => {
    const oldCopy = { id: 1, content: "antes" };
    const current = [oldCopy, { id: 2, content: "oculto durante la caída" }];
    const updatedSnapshot = [{ id: 1, content: "editado" }];
    const result = mergeChatMessageSnapshot(
      current,
      updatedSnapshot,
      new Set(current.map((message) => message.id)),
      (a, b) => a.id - b.id,
    );

    expect(result).toEqual(updatedSnapshot);
  });
});
