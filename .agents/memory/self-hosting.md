---
name: Self-hosting Coordina ADG
description: Non-obvious constraints for running this app outside Replit (no GCS), and how the local storage driver + installer are wired.
---

# Running Coordina ADG self-hosted (bare Ubuntu / VPS)

**Why:** The default object storage is hard-coupled to the Replit GCS sidecar
(`http://127.0.0.1:1106`), which only exists on Replit. On a VPS it must use the
filesystem instead.

## Storage driver switch
- `STORAGE_DRIVER=local` selects the filesystem backend; unset/anything else
  keeps the Replit GCS path. Default behavior must stay unchanged — keep the
  driver gate, don't refactor the GCS branch away.
- Local mode stores ACL/metadata in a per-file `.meta.json` sidecar (there's no
  bucket metadata service). Files live under `LOCAL_STORAGE_DIR/{private,public}`.
- Local upload URLs are HMAC-signed with a TTL keyed by `JWT_SECRET`
  (`?exp=&sig=`), to mirror cloud presigned-URL expiry. **How to apply:** if you
  change the upload URL shape, keep sign (getObjectEntityUploadURL) and verify
  (PUT /storage/local-upload route) in lockstep, and strip the query in
  normalizeObjectEntityPath before storing the entity path.

## Build-time env gotchas (bite the installer if missed)
- **Web build requires `PORT` and `BASE_PATH`** even though it's a static build
  (vite.config.ts throws otherwise). Self-hosted build uses `PORT=5173 BASE_PATH=/`.
  Output goes to `artifacts/web/dist/public`.
- API server throws at boot if `PORT`, `DATABASE_URL`, or `JWT_SECRET` are absent.
- DB schema is applied via `pnpm --filter @workspace/db run push` (drizzle push,
  no SQL migration files).
- Registration is invitation-only, so a fresh DB has no admin — must run the
  seed (`@workspace/scripts run seed-admin`, reads SEED_ADMIN_*).

## Installer
- `deploy/install.sh` is the one-shot bare-Ubuntu bootstrap; `deploy/update.sh`
  pulls+rebuilds+restarts. Must stay **idempotent**: preserve existing
  DB password, JWT_SECRET, and optional JAAS_*/RESEND_*/PUBLIC_APP_URL on rerun
  (read them back from the existing `.env`), never rotate them silently.
- nginx needs the `map $http_upgrade $connection_upgrade` block (http context,
  in conf.d) for Socket.io websocket upgrades; the app's socket path is
  `/api/socket.io`.
- JaaS video is optional (falls back to public meet.jit.si). The private key can
  be a single-line `\n`-escaped PEM — `normalizePem` in jaas.ts repairs it, which
  is what lets it live in a systemd EnvironmentFile.

## Mobile app served as a PWA under /app (same domain, no subdomain)
**Why:** The web (desktop) and movil (Expo) are two separate artifacts. The
installer must publish BOTH or phones get the desktop web. Chosen topology:
desktop web at `/`, Expo web export at `/app` on the same domain.
- The Expo web export must be path-aware: `app.config.js` sets
  `experiments.baseUrl` from `EXPO_PUBLIC_BASE_PATH` (unset in dev so `expo start`
  stays root-based; `/app` only at export time). Build via
  `EXPO_PUBLIC_DOMAIN=<apihost> EXPO_PUBLIC_BASE_PATH=/app pnpm --filter
  @workspace/movil run build:web`.
- **How to apply (PWA under a subpath):** manifest.json `start_url`/`scope`/icons
  must be RELATIVE (".", "icon-192.png") and pwa.ts must prefix manifest/sw/icon
  URLs with `EXPO_PUBLIC_BASE_PATH`; sw.js icons relative + notificationclick
  resolved against `self.registration.scope`. SW registered at `/app/sw.js` →
  scope `/app/`, which is required for installability/push under the subpath.
- nginx: `location = /app {301 →/app/}` + `location /app/ { try_files $uri $uri/
  /app/index.html; }` MUST come before the catch-all `location / {…/index.html}`
  (longest-prefix wins). update.sh backfills this block path-aware (awk -v on the
  derived MOBILE_PATH), not hardcoded `/app`.
- The app bakes API base = `https://EXPO_PUBLIC_DOMAIN` then appends `/api/…`, so
  EXPO_PUBLIC_DOMAIN must be the SAME host that proxies the API at `/api`.
- Only build mobile when DOMAIN is a real HTTPS hostname (not `_` or a bare IP) —
  PWA install/push need HTTPS. In update.sh the mobile build runs BEFORE the web
  root is wiped, so a failed build aborts (set -e) and leaves the live `/app`
  untouched.

## Collaborative space: served as SUBPATHS of the single main domain
The collab installer (`install-collab.sh`) takes only the MAIN app domain and serves
Nextcloud at `https://<domain>/nextcloud` and Collabora at `https://<domain>/collabora`
— NOT `drive.`/`office.` subdomains. No extra DNS records or certificates: the subpaths
are covered by the main domain's TLS cert.
**Why:** institutional domains (e.g. `coordinacionag.iesmmg.es`) often can't create
subdomains; same-origin subpaths also make the SSO cookie shared naturally.
**How to apply:** `install.sh` passes `APP_DOMAIN=DOMAIN`; a standalone run auto-detects
the domain from the main app `.env` (`PUBLIC_APP_URL` → `MOBILE_WEB_URL` host). nginx:
the location blocks live in a `/etc/nginx/snippets/coordina-adg-collab-locations.conf`
snippet `include`d by the main site server block (the template has a zero-match wildcard
include; `install-collab.sh` self-injects the include line into existing configs before
`location / {`). Nextcloud `/nextcloud/` proxy uses a TRAILING-SLASH `proxy_pass` to STRIP
the prefix (container serves at root; `OVERWRITEWEBROOT=/nextcloud` re-adds it in URLs);
Collabora `/collabora/` proxy KEEPS the prefix (no trailing slash) to match
`--o:net.service_root=/collabora`. `occ` sets `overwrite*`/`trusted_*` explicitly so reruns
and migrations from old subdomain installs are corrected (image only applies OVERWRITE* on
first install). Bare IP / `_` is rejected. The mobile PWA at `/app` is built/published by
`install.sh` whenever DOMAIN is a real HTTPS host — same single-domain input drives all.

## Collab credentials must be SEEDED env→DB or the panel looks empty
**Why:** the collab installer writes the connection details to the api-server `.env`
(`NEXTCLOUD_URL`, `COLLABORA_URL`, `NEXTCLOUD_ADMIN_USER/PASSWORD`,
`NEXTCLOUD_OIDC_CLIENT_ID/SECRET`). The `resolveNextcloud*` helpers fall back to those
env vars so the space WORKS, but `GET /settings/integrations` returns the RAW DB row, so
the in-app control panel shows EMPTY fields and admins think nothing was saved.
**How to apply:** `seedIntegrationSettingsFromEnv()` (lib/settings.ts) runs on api-server
startup (called from index.ts `start()` before `listen`, errors caught so boot never blocks)
and backfills ONLY empty collab DB fields from env. DB always wins (never overwrites a
non-empty field), so panel edits are preserved. Consequence: clearing a field in the panel
while env still has it gets RE-seeded on next restart — to truly disable, clear the env var
too. The installer must write `COLLABORA_URL` (it was previously missing).

## Admin OCS must reach Nextcloud over loopback, NOT the public URL
**Why:** admin provisioning (create group/group-folder/users) calls Nextcloud's OCS API
server-side. If it uses the PUBLIC `NEXTCLOUD_URL` (`https://<domain>/nextcloud`), the
request leaves the host and (behind Cloudflare Tunnel / some reverse proxies) the loopback
`/nextcloud/ocs/...` doesn't route back to Nextcloud → OCS fails with a Go-style
`404 page not found` (that exact body = NOT Nextcloud; it's the proxy/tunnel). Symptom:
"No se pudo abrir el espacio" toast, `groupfolders:list` shows "No folders configured", no
`coordina-mod-*` groups.
**How to apply:** `NEXTCLOUD_ADMIN_URL` (e.g. `http://127.0.0.1:8081`, the loopback-published
container port) is a TRANSPORT OVERRIDE in `resolveNextcloudConfig()` — it replaces the base
url for OCS even when creds come from the DB (because env→DB seeding backfills the PUBLIC url).
The public URL still drives browser/SSO links via `resolveNextcloudUrl()`. The installer must
also add `127.0.0.1:<port>` to Nextcloud `trusted_domains` (else loopback Host → 400 untrusted).
Direct loopback hits Nextcloud at container ROOT (no `/nextcloud` prefix; that prefix is only
nginx + `overwritewebroot`). Collabora↔Nextcloud (WOPI) may need the same loopback treatment
if document editing later fails the same way.

## tsc in this monorepo: use `tsc --build`, NOT `tsc --noEmit` standalone
**Why:** artifacts use TypeScript project references (`references` to `lib/db`, `lib/api-zod`).
Running `tsc --noEmit` directly in an artifact resolves referenced packages to their (often
STALE or absent) `dist/*.d.ts` and emits bogus errors (TS6305, or "property X does not exist"
when the dist predates a schema change). The authoritative gate is root `pnpm run typecheck`
(= `tsc --build` for libs, then per-artifact `tsc -p tsconfig.json --noEmit`). `lib/*/dist` and
`*.tsbuildinfo` are gitignored build artifacts; deleting them is safe (dev runs via tsx/esbuild,
package `exports` point at `./src`), and `tsc -b` regenerates them.

## Optional Cloudflare Tunnel (cloudflared) in the installer
`install.sh` optionally prompts for a `CLOUDFLARE_TUNNEL_TOKEN` (blank = skip; persisted
in `.env` for rerun idempotency, the app never reads it). If set and `cloudflared` isn't on
PATH it installs the official `.deb` for `dpkg --print-architecture`, then runs `cloudflared
service uninstall || true` + `service install <token>` (idempotent — re-applies a changed
token). The tunnel terminates TLS at Cloudflare and forwards to local nginx :80, so subpaths
(/app,/api,/nextcloud,/collabora) need no local certbot. `uninstall.sh` runs `cloudflared
service uninstall` (keeps the binary).
**Why:** lets admins expose the server via Cloudflare without opening ports or local TLS; the
main domain's Cloudflare cert already covers all subpaths.

## Stale clone is the #1 cause of "old behavior" on self-host servers
Self-hosters run `git clone` once; a later re-`clone` prints "destination path already
exists and is not an empty directory" and is a NO-OP, so they keep running the OLD code.
Symptoms of stale code: collab installs as `drive.`/`office.` SUBDOMAINS (pre-subpath
migration), the domain prompt is missing/different, etc. **Always tell them to
`cd <repo> && git pull` (or remove the dir and re-clone) before reinstalling.**
**Why:** merges land in the Replit repo; the server only updates on an explicit pull.

## Installer prompt eaten by pasted trailing newline → DOMAIN silently "_"
When the install command is pasted as a block (or `curl | bash`), a leftover newline in
the terminal buffer can be swallowed by the FIRST `read`, silently accepting its default
(`DOMAIN=_`), which disables HTTPS AND skips the collaborative space (DEFAULT_COLLAB=no for
`_`/IP). `install.sh` now calls `drain_tty` (non-blocking `read -t 0.1` flush) before the
first prompt. Most robust workaround for users: pass values as env vars, e.g.
`sudo DOMAIN=adg.example.org CLOUDFLARE_TUNNEL_TOKEN=... bash deploy/install.sh` (env-set
vars skip prompts entirely via `prompt_default`/`prompt_secret` early-return).

## "/app 404" recovery when the server doesn't know its own domain
**Why:** A very common self-host shape is install with `DOMAIN=_` (or IP) and then
put a real domain in front via Cloudflare/another proxy. Then `server_name` is `_`,
`.env` MOBILE_WEB_URL/PUBLIC_APP_URL are blank, so the mobile app is never built and
`/app` falls through to the desktop SPA (which renders its OWN 404 — nginx returns
200). The domain the admin types into the in-app control panel is saved in the
**DB** (`integration_settings.mobile_web_url`), NOT in `.env`, so deploy scripts that
only read `.env`/nginx can't see it.
**How to apply:** `update.sh` resolves the mobile host in priority order:
env `MOBILE_WEB_URL` → DB `mobile_web_url` (best-effort `psql`, must be non-fatal so a
DB hiccup never aborts before git pull/schema push) → `PUBLIC_APP_URL` → env `DOMAIN`
override → nginx `server_name` (ignoring `_`/localhost/IPv4). The one-shot user fix is
`sudo DOMAIN=their-domain bash deploy/update.sh`. When writing back to `.env`, upsert
with grep-drop-then-append + `cat >` (NOT `mv`) so the file's owner/perms are
preserved — `mv` from /tmp makes it root:root 600 and the service user can't read it.

## DB schema push in deploy scripts MUST be non-interactive (push-force)
**Why:** `update.sh`/`install.sh` run with no TTY. Plain `drizzle-kit push`
(`@workspace/db run push`) prompts for confirmation on any change it deems risky;
with no stdin it hangs or fails, and `set -e` aborts the deploy BEFORE the
`seed-reference-data` step → provinces/islands/municipalities/FP-centers tables
stay EMPTY (symptom: "no centros ni islas" in the dropdowns after an Ubuntu
deploy/update). **How to apply:** deploy scripts must call `run push-force`
(non-interactive variant in lib/db/package.json), never `run push`. Schema
changes in this app are additive, so forcing is safe. Immediate server recovery
without re-deploying: run the seed directly —
`DATABASE_URL=$(grep ^DATABASE_URL= .env | cut -d= -f2-) pnpm --filter @workspace/scripts run seed-reference-data`.
