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

## Dynamic branding override (superadmin)
The static `public/` assets are now only the FALLBACK. `lib/pwa.ts` `applyBranding()` fetches the
public `/settings/branding` (appName, hasFavicon, version) and, on web, overlays: document.title,
`apple-mobile-web-app-title`, `apple-touch-icon`, the foreground notification icon, AND a Web App
Manifest built on the client and injected as a **Blob URL** (so `start_url`/`scope` are absolute
`origin+BASE_PATH/` and resolve to the app's own origin regardless of the API origin). In-app
logos (login/recuperar) use `lib/branding.ts` `useBrandingAssets()` → custom logo URL or bundled
asset. **Gotcha:** browsers cache the installed name/icon at install time, so already-installed
home-screen PWAs only pick up new branding after a REINSTALL; new installs are correct.
