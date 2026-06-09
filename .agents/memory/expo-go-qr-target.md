---
name: Mobile install/QR target on Replit
description: What URL the in-app / web-panel QR must encode to let users install the Coordina ADG mobile app.
---

# Mobile install / QR target on Replit

## Current direction: PWA-first (Expo Go retired)
Expo Go was rejected by the user ("da muchos errores"). The mobile app is distributed
as an **installable PWA** of the Expo *web* build, served at the clean origin
`https://${REPLIT_EXPO_DEV_DOMAIN}` (root — ideal PWA scope). The web-panel QR and
install instructions must encode that **HTTPS web URL**, not `exp://`.

**Why:** the web build runs in any mobile browser and installs to the home screen
(iOS: Compartir → Añadir a pantalla de inicio; Android: menu → Instalar app, or the
in-app "Instalar app" button). No store, no Expo Go, no native build needed.

**How to apply:** `/mobile-app` exposes `webUrl` (from `REPLIT_EXPO_DEV_DOMAIN`, override
`MOBILE_WEB_URL`). The panel `app-movil.tsx` renders the QR from `webUrl`. `expoGoUrl` is
still returned by the API but is no longer surfaced in the UI. Keep store URLs
(`MOBILE_IOS_URL`/`MOBILE_ANDROID_URL`) graceful — omit when unset.

## Legacy note (Expo Go, no longer used in UI)
For Expo Go a QR had to encode `exp://${REPLIT_EXPO_DEV_DOMAIN}` (scheme `exp://`, bare
domain, no port — Replit proxy serves 443; `EXPO_PACKAGER_PROXY_URL` points at the same
host). Never run EAS / `npx expo` CLI.
