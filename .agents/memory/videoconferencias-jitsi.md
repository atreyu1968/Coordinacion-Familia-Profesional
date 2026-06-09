---
name: Keyless Jitsi videoconferencing
description: How meeting rooms and in-chat video calls work without any API keys.
---

Videoconferencing uses the public `https://meet.jit.si/<roomName>` service — no API keys, no SDK, no accounts.

**Rooms must be unguessable.** Room names are random (server-generated UUID for the meetings module; `coordinaadg-chat-<groupId>-<rand>` for chat calls). Privacy depends entirely on the room slug being secret, since meet.jit.si rooms are otherwise open.

**Meetings module** (standalone feature): create is gated to `superadmin`/`coordinator` server-side; any auth user lists/joins; delete is host-or-superadmin soft delete. Web joins via an embedded iframe overlay (`allow="camera; microphone; fullscreen; display-capture; autoplay"`) plus open-in-tab; mobile joins via `expo-web-browser` `openBrowserAsync`.

**Chat video calls** (mobile chat only — web has no chat UI): no backend/contract change. The header button posts a plain-text message containing the join URL, then opens the room **only on send success** so every member can discover the same room. Messages whose content matches `https://meet\.jit\.si/...` render a "Unirse a la videollamada" button.

**Why:** keeps the whole feature keyless and contract-light; the join link living in the message history is the shareability mechanism, so launching the room before the message persists would strand the caller in a room nobody can find.
