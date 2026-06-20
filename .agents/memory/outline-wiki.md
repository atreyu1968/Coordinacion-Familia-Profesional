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
- **Stale-editor gotcha:** GET editors must intersect current editor ids with the manager's
  candidate set before returning. Otherwise an editor later removed from the module seeds the
  dialog with a checkbox the manager can't uncheck → every PUT fails the subset check. The
  PUT reconciliation still soft-deletes those stale grants once a sanitized save runs.

## Navigation (UI entry points)
- Reachable from Recursos (a "Documentación" card in recursos.tsx → /documentacion) AND from
  each module page (`/academica/modulo/:id` tool → `/documentacion?module=:id`).
- documentacion.tsx auto-opens the matching module's collection via `useModuleParam()` when the
  `?module=` query param is present. Keep that param contract when adding new deep links.

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

## Storage needs S3 (MinIO) on its OWN subdomain too
Outline file uploads use S3-compatible storage (MinIO in the compose), NOT local disk.
**Why:** the task required an S3 stack, and Outline mints pre-signed download URLs against
the configured bucket origin — so that origin must be browser-reachable. Local disk also
works but diverges from the required infra.
**How to apply:** MinIO is exposed on a SECOND dedicated subdomain (files.<domain> by
default) with its own nginx block + cert, parallel to the docs subdomain. Set
`AWS_S3_UPLOAD_BUCKET_URL`/`MINIO_SERVER_URL` to that public origin and forward the Host
header unchanged in nginx (signature is validated against the public host). The storage
subdomain must use the SAME scheme as Outline (https when FORCE_HTTPS) or the browser blocks
mixed content. So an HTTPS install needs DNS + cert for BOTH docs.<domain> and files.<domain>.

## Outline API token is manual
The Outline API token (used by the api-server to provision collections/groups) cannot be
generated headlessly. The installer wires URL + OIDC client id/secret into the main .env
automatically, but the admin must create the token in Outline (Settings → API Tokens) and
paste it into the control panel → Documentación.
