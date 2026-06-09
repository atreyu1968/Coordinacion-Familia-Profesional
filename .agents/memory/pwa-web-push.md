---
name: PWA + Web Push for the Expo web build
description: How the Coordina ADG mobile app is made installable (PWA) and how browser/web-push notifications work, including SDK54 quirks.
---

# PWA + Web Push (Expo web build)

## PWA shell — runtime injection, NOT +html.tsx
Expo SDK 54's default SPA web output does **not** apply `app/+html.tsx`, so manifest/meta/
service-worker registration must be injected at **runtime** from a web-only module
(`movil/lib/pwa.ts`, `setupPwa()`), called at module top-level in `_layout.tsx`. All PWA
code is guarded by `Platform.OS === "web"` and `typeof document/window`.

**Why:** `+html.tsx` only takes effect with static rendering; the default SPA export ignores
it. Tried it, it had no effect, deleted it.

**How to apply:** static assets live in `movil/public/` (manifest.json, sw.js, icons
192/512 + apple-touch) — `public/` IS served at web root in dev. The SW is best-effort
(skipWaiting/claim, noop fetch, `push` + `notificationclick` handlers).

## Web push pipeline
Self-generated VAPID keypair (crypto ECDH prime256v1) stored as env vars
`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`. Backend `lib/push.ts` now sends
**both** Expo push and Web Push from the single `sendPushToUsers()` (called by notify.ts +
messaging.ts → one change covers all paths). Web subs are pruned on 404/410. Everything
no-ops gracefully when VAPID is absent (`isWebPushConfigured()` gate).

**Why (gotcha):** any best-effort branch fired with `void` must have its own `.catch` AND
each DB cleanup (`db.delete`) must be wrapped — otherwise a delete failure becomes an
unhandled rejection that breaks the "push never blocks the request" guarantee.

**How to apply:** `GET /push/vapid-public-key` (auth-protected) returns `{key?}`. Mobile
`registerWebPush()` fetches the key authed, subscribes, POSTs the subscription JSON to
`/push-tokens` with `platform:"web"` (token column stores the JSON string). Stored web subs
are filtered by `platform==="web"` and excluded from the Expo token list.
