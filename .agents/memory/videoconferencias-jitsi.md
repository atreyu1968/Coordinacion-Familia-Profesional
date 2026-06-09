---
name: Keyless Jitsi videoconferencing
description: How meeting rooms and in-chat video calls work without any API keys.
---

Videoconferencing uses the public `https://meet.jit.si/<roomName>` service — no API keys, no SDK, no accounts.

**Rooms must be unguessable.** Room names are random (server-generated UUID for the meetings module; `coordinaadg-chat-<groupId>-<rand>` for chat calls). Privacy depends entirely on the room slug being secret, since meet.jit.si rooms are otherwise open.

**Meetings module** (standalone feature): create is gated to `superadmin`/`coordinator` server-side; any auth user lists/joins; delete is host-or-superadmin soft delete. Web joins via an embedded iframe overlay (`allow="camera; microphone; fullscreen; display-capture; autoplay"`) plus open-in-tab.

**Mobile calls are embedded in-app, not in an external browser.** A shared helper (`movil/lib/call.ts`) builds the room URL and routes the call: on native it pushes a full-screen WebView screen (`react-native-webview`); on web (where the WebView can't be granted camera/mic) it falls back to `expo-web-browser` new tab. The WebView screen requests mic (and camera only for video) via expo-camera permission hooks *before* loading, and sets `mediaCapturePermissionGrantHandler` (iOS). `app.json` carries iOS NSCamera/NSMicrophone usage strings + Android CAMERA/RECORD_AUDIO/MODIFY_AUDIO_SETTINGS.

**Audio-only calls** are a per-join mode, not a separate room: append Jitsi URL hash config `#config.startAudioOnly=true` (also always set `disableDeepLinking=true&prejoinPageEnabled=false` so the room stays in-app and auto-joins). Both web and mobile expose video + audio buttons; chat encodes the mode in the posted message (🔊 = audio) so joiners match the initiator.

**Chat video/audio calls** (mobile chat only — web has no chat UI): no backend/contract change. The header buttons post a plain-text message containing the join URL, then open the room **only on send success** so every member can discover the same room. Messages whose content matches `https://meet\.jit\.si/...` render a join button.

**Why:** keeps the whole feature keyless and contract-light; the join link living in the message history is the shareability mechanism, so launching the room before the message persists would strand the caller in a room nobody can find. WebView (not the system browser) is what keeps the call inside the app.
