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

## Cross-host reverse proxy / Cloudflare Tunnel — bind address
By default Outline (3500) and MinIO (3501) bind to `127.0.0.1` only, which assumes the
reverse proxy lives on the SAME host. If the proxy / Cloudflare Tunnel (`cloudflared`)
runs on a DIFFERENT machine (e.g. a central gateway), it cannot reach loopback ports →
the tunnel logs `dial tcp <host>:3500: connect: connection refused` and the edge returns
**502**. (`connection refused` = host reachable but port not listening on that interface;
`i/o timeout` = wrong host/unreachable.)
**Fix:** set `OUTLINE_BIND_ADDR` in `deploy/outline/.env` to the server's LAN IP (preferred,
opens only that interface) or `0.0.0.0`, then `docker compose up -d`. Verify with
`ss -ltnp | grep -E '3500|3501'`.
**Installer must preserve it (durable rule):** `install-outline.sh` rewrites the whole
`.env` via `cat >` on every run, and `update.sh` runs the installer on every update — so any
key not read back via `env_get` is silently lost. `OUTLINE_BIND_ADDR` MUST be in the env_get
preserve list + the heredoc, or an update reverts a manually-set LAN IP to loopback and the
502 returns. Same trap for any future compose var. Also: when bound to a specific LAN IP
(not loopback/0.0.0.0), the loopback `curl 127.0.0.1` readiness probe and nginx
`proxy_pass http://127.0.0.1` both fail — both use a resolved `UPSTREAM_ADDR` (= bind addr,
or 127.0.0.1 when bind is 0.0.0.0); the nginx template takes `__OUTLINE_UPSTREAM_ADDR__`.
**Tunnel notes:** Public Hostname service must be **HTTP** (cloudflared talks http to the
container and injects `X-Forwarded-Proto: https`, so `FORCE_HTTPS=true` works without a
loop). With a tunnel, certbot is unused (edge TLS); OUTLINE_URL/S3_PUBLIC_URL still must be
**https** so links/pre-signed URLs match the public origin.

## Outline API token is manual
The Outline API token (used by the api-server to provision collections/groups) cannot be
generated headlessly. The installer wires URL + OIDC client id/secret into the main .env
automatically, but the admin must create the token in Outline (Settings → API Tokens) and
paste it into the control panel → Documentación.

## Token bootstrap catch-22 — login readiness vs full config
**Rule:** SSO sign-in into Outline only needs URL + OIDC client. The API token is ONLY for
provisioning per-module collections, so the open/login flow must NOT require it.
**Why:** the only way to create the token is to log into Outline; if login itself is gated on
the token, the admin can never reach Outline (open endpoint 503 + page shows "no configurada"
→ dead end). This was a real bootstrap deadlock.
**How to apply:** keep two checks distinct — `isOutlineConfigured` (URL+OIDC+token, "fully
ready, can provision") vs `isOutlineLoginReady` (URL+OIDC, "SSO works"). `/wiki/status` returns
both (`configured`, `loginReady`). The open endpoint gates on `loginReady` and only calls
`ensureModuleWiki` when a token exists; with no token it still mints the SSO ticket and
`/oidc/start` lands the user on Outline `/home` (moduleCollectionPath(null)). Frontend shows a
"needs token" bootstrap banner when `loginReady && !configured` instead of blocking.
