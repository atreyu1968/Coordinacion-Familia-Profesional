---
name: Expo Go dev QR target on Replit
description: What URL a QR code must encode to open the Expo mobile app in Expo Go during Replit development.
---

# Expo Go dev QR target on Replit

To open the Expo mobile app in **Expo Go** during development, a QR code must encode
`exp://${REPLIT_EXPO_DEV_DOMAIN}` (the `exp://` scheme + the bare domain, no port — the
Replit proxy serves it over 443).

**Why:** Replit's editor URL-bar QR points at the HTTPS editor/proxy URL, which is not what
Expo Go consumes. The mobile dev script sets `EXPO_PACKAGER_PROXY_URL=https://$REPLIT_EXPO_DEV_DOMAIN`,
so Expo Go must be pointed at the same host under the `exp://` scheme. `REPLIT_EXPO_DEV_DOMAIN`
is an env var available to the API server.

**How to apply:** When surfacing a phone-install QR inside the app (not Replit's UI), read
`REPLIT_EXPO_DEV_DOMAIN` server-side, strip any accidental `http(s)://` / trailing slashes,
and build `exp://<domain>`. Keep optional published-store URLs (`MOBILE_IOS_URL`,
`MOBILE_ANDROID_URL`) graceful — omit when unset. Android is not supported via Replit Expo Launch;
production iOS goes through Replit Expo Launch (App Store). Never run EAS / `npx expo` CLI.
