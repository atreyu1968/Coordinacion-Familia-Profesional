---
name: Móvil PWA install assets
description: Where the Expo web/PWA install icons and manifest live, and how they differ from app.json native icons.
---

# Móvil (Expo) PWA install assets

The installable web PWA icon is NOT controlled by `app.json` `expo.icon` / `web.favicon`
(those drive native + the browser tab favicon). The install icon comes from the web app
manifest and its referenced PNGs, which live in `artifacts/movil/public/`:
`manifest.json`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `sw.js`.

`lib/pwa.ts` injects `<link rel="manifest">` and `apple-touch-icon` at runtime (base-path
aware via `EXPO_PUBLIC_BASE_PATH`, e.g. `/app`). Expo copies everything in `public/` to the
web export root.

**How to apply:** to change the installed-app icon, regenerate the PNGs in `public/` from the
brand logo (`assets/images/icon.png`) — editing `app.json` alone will NOT change it. Icons are
`purpose: "any maskable"`, so keep the logo centered with padding to survive maskable cropping.
