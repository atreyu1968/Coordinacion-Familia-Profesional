---
name: Integration settings (control panel)
description: How external credentials (DeepSeek, Resend, JaaS, Nextcloud) are configured in-app and the rules for adding more.
---

# Integration settings configurable from the Panel de Control

External-service credentials can be set by a superadmin in the in-app **Panel de Control**
(web page `panel-control.tsx`) instead of only via env vars. They are stored in the
`integration_settings` DB table and served through `/settings/integrations` (GET status,
PUT update; superadmin-only). The source of truth for the request/response shapes is
`lib/api-spec/openapi.yaml` → run the api-spec `codegen` script to regenerate
`@workspace/api-zod` and `@workspace/api-client-react` after editing it.

**Rule — never return secret values.** GET/PUT responses expose only `*Configured`
booleans (and non-secret identifiers like the JaaS AppID). Secret fields (API keys,
private keys, the JaaS `kid`) are write-only: accepted on PUT, never echoed back.
**Why:** the panel is visible to superadmins in the browser; leaking a stored key in a
JSON response would expose it. **How to apply:** when adding a new integration, add an
`xConfigured: boolean` to the response and keep the secret out of it.

## Mobile web URL (App Móvil page) — DB > env > Replit Expo domain
The "App Móvil" page only shows its install QR when the API resolves a public web
URL. It is **not** a secret, so it is returned in the settings GET and prefilled in
the panel. Resolution order in the `/mobile-app` route: panel value (DB
`mobile_web_url`) → `MOBILE_WEB_URL` env → `REPLIT_EXPO_DEV_DOMAIN` (Replit only).
**Why:** on a self-hosted VPS there is no Expo domain, so without the env/DB value the
page shows "El acceso a la app móvil no está disponible". The installer auto-derives
`https://DOMAIN` for a real HTTPS domain and prompts for it. **How to apply:** PWA
install + web push need HTTPS, so don't auto-fill it for a bare IP or the `_`
catch-all host.

## JaaS (8x8) video credentials — resolve as a complete triplet, never mixed
JaaS needs all three of `appId`, `kid`, `privateKey`. Resolution prefers the DB triplet
and otherwise falls back to the env triplet (`JAAS_APP_ID` / `JAAS_KID` /
`JAAS_PRIVATE_KEY`), but the two sources are **never mixed field-by-field**.
**Why:** a JWT signed with a `kid` from one source and a private key from another (e.g.
a partially-saved DB row + leftover env vars) silently fails to authenticate and the call
falls back to the 5-minute public meet.jit.si server. **How to apply:** keep the
"all-or-nothing per source" logic in `resolveJaasCreds`; don't reintroduce per-field
`db || env` defaulting.

## Nextcloud/Collabora collaborative space — app is its own OIDC provider, SSO needs same registrable domain
The per-module collaborative space self-hosts Nextcloud + Collabora (Docker Compose in
`deploy/nextcloud/`). The api-server itself acts as a **minimal OIDC provider** (discovery,
JWKS, authorize, token, userinfo under `/api/oidc`); Nextcloud's `user_oidc` app is the
client. The id_token signing key (RSA) resolves env `OIDC_SIGNING_KEY` → DB
`oidc_signing_key` → auto-generated-and-persisted, so it stays stable across restarts.
Nextcloud admin config (url+user+password) and the OIDC client (id+secret) each follow the
same all-or-nothing DB-then-env triplet rule as JaaS; `isNextcloudConfigured` requires
**both**. The Nextcloud uid / OIDC `sub` is `coordina-<userId>`; module group is
`coordina-mod-<id>`. **Why:** the SSO start flow sets a cookie scoped to `/api/oidc`, so
Nextcloud must be served from a **subdomain of the same registrable domain** as the app
(e.g. `drive.example.org` next to `adg.example.org`) or the cookie/redirect handoff breaks.
**How to apply:** keep the installer defaulting the NC/Collabora hosts to subdomains of
`APP_DOMAIN`; OIDC stores are in-memory (single systemd process) — don't assume multi-process.
