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
Self-generated VAPID keypair stored in the **database** (the `integration_settings`
singleton row, columns `vapid_public_key`/`vapid_private_key`/`vapid_subject`), NOT in env
vars. It is generated on first use via `webpush.generateVAPIDKeys()` and cached in memory.
**Why:** the VAPID *private* key is sensitive — storing it as a shared env var writes it
into `.replit` in plaintext (committed to source control), which got the work REJECTED in
review. The DB matches the existing deepseek/resend key pattern, survives restarts, works in
prod, and never touches committed files. Settings route only ever exposes `*Configured`
booleans, never raw keys.
Backend `lib/push.ts` sends **both** Expo push and Web Push from the single
`sendPushToUsers()` (called by notify.ts + messaging.ts → one change covers all paths). Web
subs are pruned on 404/410. `getVapidPublicKey()`/`isWebPushConfigured()` are async (DB
load) and degrade gracefully if the DB is unreachable.

**Why (gotcha):** any best-effort branch fired with `void` must have its own `.catch` AND
each DB cleanup (`db.delete`) must be wrapped — otherwise a delete failure becomes an
unhandled rejection that breaks the "push never blocks the request" guarantee.

**How to apply:** `GET /push/vapid-public-key` (auth-protected) returns `{key?}`. Mobile
`registerWebPush()` fetches the key authed, subscribes, POSTs the subscription JSON to
`/push-tokens` with `platform:"web"` (token column stores the JSON string). Stored web subs
are filtered by `platform==="web"` and excluded from the Expo token list.
