---
name: Outline documentation wiki (Recursos → Documentación)
description: How the self-hosted Outline wiki is integrated — SSO, per-module edit authz, and the subdomain deploy constraint.
---

# Outline documentation wiki

Self-hosted Outline integrated as the "Documentación" entry under Recursos, mirroring
the Nextcloud collaborative-space pattern. One Outline collection per module; everyone
reads, selected people edit.

## Authorization model (per-module editors)
- ALL docs are readable by every authenticated user.
- Edit grants are managed via `wiki_module_editors` (soft-delete, unique moduleId+userId).
- **superadmin** can grant edit to any active user.
- **module coordinator** (a `module_memberships` row with role='coordinator') can grant edit
  only to that module's members. PUT validates `desired ⊆ candidates` before persisting,
  then syncs the Outline editor group.
- **Rule:** any new editor-management surface must enforce this candidate-subset check
  server-side; the client affordances are not the authority.

## SSO (OIDC multi-client)
- The api-server OIDC route resolves the client by `client_id` (Nextcloud + Outline both).
- Outline is configured with explicit URIs, NOT discovery:
  `OIDC_AUTH_URI/TOKEN_URI/USERINFO_URI = https://<APP_DOMAIN>/api/oidc/{authorize,token,userinfo}`.
- Each client has its own redirect-uri allow-list; `/start` branches on the ticket target.

## Deploy constraint — Outline needs its OWN subdomain
**Why:** Unlike Nextcloud (served as subpaths /nextcloud, /collabora of the main domain),
Outline cannot run from a subpath. It requires a dedicated subdomain (docs.<domain> by
default) with its own DNS record and its own certbot certificate.
**How to apply:** `deploy/outline/` holds the compose + installer (parallel to
`deploy/nextcloud/`); `deploy/nginx-outline.conf.template` is a standalone server block
(not an include). install.sh/update.sh/uninstall.sh each have an Outline branch mirroring
the collab branch — keep all three in parity when changing one.

## HTTPS / FORCE_HTTPS coupling
Outline `FORCE_HTTPS=true` redirects everything to https, so the URL scheme, FORCE_HTTPS,
and certbot must agree. The installer decides the scheme up front: HTTPS only when
LETSENCRYPT_EMAIL is set (then OUTLINE_URL=https + FORCE_HTTPS=true); otherwise plain HTTP
(OUTLINE_URL=http + FORCE_HTTPS=false) so the site is still reachable. Never hard-code
FORCE_HTTPS=true while allowing an http URL — that yields an unreachable wiki.

## Outline API token is manual
The Outline API token (used by the api-server to provision collections/groups) cannot be
generated headlessly. The installer wires URL + OIDC client id/secret into the main .env
automatically, but the admin must create the token in Outline (Settings → API Tokens) and
paste it into the control panel → Documentación.
