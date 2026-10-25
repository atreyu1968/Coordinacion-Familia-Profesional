---
name: Nextcloud PDF previews
description: Preserve Nextcloud's per-user access control when embedding PDF previews in Coordina ADG.
---

Render Nextcloud PDFs inside the authenticated Nextcloud session established by a fresh one-use OIDC/SSO ticket. Do not proxy PDF bytes with the Nextcloud administrator account, create public links, or persist a local preview copy. Restrict embedded navigation to the app and configured Nextcloud origins. On the server, recheck a module or independent-space user's current authorization when consuming the ticket, not only when minting it.

**Why:** a service-account proxy can bypass the caller's Nextcloud permissions, and a copy or public link can remain usable after access is revoked.

**How to apply:** open the user-authorized Nextcloud file browser in the embedded view and let Nextcloud serve previews under its current ACLs. Disable local viewer caching where supported and clear the view on an authorization failure.

For the mobile PWA, use a browser iframe, never React Native WebView (unsupported on web). Keep native WebView isolated from the web bundle. Any external-window fallback must obtain a fresh SSO ticket instead of reusing the iframe URL.

**Why:** the first embedded navigation can consume the single-use ticket; browser privacy settings can also block cross-site iframe sessions.

Reserve a blank browser tab synchronously during the click, before awaiting an API-created access URL (also for SCORM, lesson files and meeting links). Otherwise browsers may block the new window as an unsolicited popup; close the reserved tab if authorization fails.

If an installed PWA still reports unsupported WebView after the web viewer has been corrected, check a refreshed session on the correct origin before proposing a Nextcloud reinstall.

**Why:** the user confirmed that refreshing resolved this error; an already-open PWA can continue running old JavaScript despite the published bundle being corrected.

**How to apply:** distinguish a stale running client from a server failure. Do not assume the service worker caches application files or clear user data without evidence.
