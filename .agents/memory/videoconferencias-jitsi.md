---
name: Videoconferencing (8x8 JaaS, web only)
description: How meeting rooms work — 8x8 JaaS with coordinator-only moderators, public Jitsi fallback; mobile calls were removed.
---

Videoconferencing lives on the **web app only**. The mobile app has **no call feature** (in-app WebView calls, the `videoconferencias`/`llamada` screens, `lib/call.ts`, and the chat call buttons were all removed; `app.json` keeps only CAMERA for QR scanning).

**Provider model — 8x8 JaaS, login-wall-free.** `POST /meetings/token` returns `{ provider, url }` (`provider` enum `jaas | public`). Server builds the *full* join URL so the client just opens `access.url`:
- **Coordinators/admins** (`superadmin`/`coordinator`, the `CAN_CREATE` set) join as **moderators**: the server signs a short-lived RS256 JWT and returns `https://8x8.vc/{appId}/{room}?jwt=...#config...`. No login screen.
- **Everyone else** joins as a **guest**: `https://8x8.vc/{appId}/{room}#config...` with **no jwt**. Guests don't count as billable monthly active users, so usage stays in the free tier.
- **Fallback**: if JaaS env is absent (or signing fails), returns `provider: "public"` with `https://meet.jit.si/{room}#config...`.

**Why coordinator-only moderators:** explicit user decision — only coordinator/admin "log in" (are authenticated moderators) to keep the JaaS free tier's ~25 MAU cap from being exceeded. Requires "allow guests" enabled in the 8x8 JaaS console so non-token participants can join.

**Config hash** always sets `disableDeepLinking=true` + `prejoinPageEnabled=false` (auto-join, stay in-app); audio-only is a per-join mode appending `startAudioOnly=true`.

**Secrets:** `JAAS_APP_ID` (public, plain env var — appears in the room URL), `JAAS_KID` (the Key ID of the uploaded key pair, NOT the App ID), `JAAS_PRIVATE_KEY` (RSA PEM, sensitive → secret). JWT header `kid` must be `${appId}/${keyId}`.

**Gotcha — JAAS_KID format (caused a JaaS "authentication error").** Two real mistakes operators make: (1) pasting the App-ID cookie suffix as the kid (it equals `JAAS_APP_ID` minus the `vpaas-magic-cookie-` prefix) — that is NOT the key id; (2) the 8x8 console shows the key id already in full `vpaas-magic-cookie-.../<keyId>` form, so pasting it whole makes `${appId}/${kid}` **double** the prefix. `signToken` now guards this: if `JAAS_KID` already contains a `/`, use it verbatim as the header kid; otherwise prepend `${appId}/`. **How to verify:** sign a token, decode the header, confirm `kid` is NOT `appId/appId/...`, and self-verify the signature against the public key derived from the private key (`createPublicKey(createPrivateKey(pem))`) — that derived public key is exactly what must be uploaded to the 8x8 console.

**Gotcha — Replit secrets can mangle a PEM.** A multi-line private key pasted into a secret can come back with **newlines collapsed into spaces** (single line, 0 `\n`), which makes Node's PEM decoder throw `DECODER routines::unsupported` / `secretOrPrivateKey must be an asymmetric key`. `lib/jaas.ts` `normalizePem()` handles all three shapes: real newlines (use as-is), escaped `\n`, and space-collapsed single-line (extract the base64 between BEGIN/END, strip whitespace, re-wrap at 64 cols). **How to apply:** never assume an env-stored PEM is well-formed; normalize before `jwt.sign`/`createPrivateKey`.

Backend lib is `artifacts/api-server/src/lib/jaas.ts`; it reads env at call time (not module load) so tests can toggle config without a restart. The meetings module itself: create gated to `superadmin`/`coordinator`; any auth user lists/joins; delete is host-or-superadmin soft delete.
