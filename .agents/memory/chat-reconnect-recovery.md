---
name: Chat reconnect recovery
description: Socket.io chat room membership and client state recovery after reconnecting.
---

When a chat screen reconnects, it must rejoin its conversation room and reload its visible message history and hidden-message list; Socket.io does not restore server room membership automatically.

**Why:** Events emitted during a disconnect are not replayed, so a connected client can otherwise remain silently out of sync.

**How to apply:** Any new chat realtime view should bind room subscription and authoritative state refresh to the socket's `connect` event, while deduplicating refreshed rows by message ID.
