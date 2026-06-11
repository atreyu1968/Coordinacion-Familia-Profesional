---
name: Nextcloud collaborative-space iframe goes black (self-host)
description: Debugging order for a black "espacio colaborativo" iframe on self-hosted installs — mixed-content/http + DB-override gotchas.
---

# Black Nextcloud iframe on self-host = almost always an http (Mixed Content) issue, not permissions

When the collaborative-space overlay opens to a BLACK screen (not a white
"refused to connect"), the SSO/membership side is usually fine. Check the
browser console for `Mixed Content: ... requested an insecure frame
'http://.../nextcloud/' ... blocked`. An HTTPS page cannot embed an http iframe,
so the frame is blocked and the black overlay background shows through.

**Why it happens:** behind Cloudflare Tunnel → nginx, requests reach Nextcloud
and the api-server as `http` (nginx forwards `X-Forwarded-Proto $scheme`, and
cloudflared→nginx is http). Both sides must FORCE https in the URLs they emit:

- Nextcloud: `occ config:system:set overwriteprotocol --value=https` (plus
  `overwritehost`, `overwritewebroot=/nextcloud`, `overwrite.cli.url`). Without
  this Nextcloud's own redirects (e.g. to its root `/nextcloud/` after login)
  use http.
- api-server: `PUBLIC_APP_URL=https://<domain>` in `.env`, else `getAppBaseUrl`
  derives http from `x-forwarded-proto` and the OIDC discovery advertises an
  http `authorization_endpoint`.

**The DB-override trap:** the public Nextcloud URL the app uses for SSO links
comes from `integration_settings.nextcloud_url` (DB / control panel), which
**wins over** the `NEXTCLOUD_URL` env var. The env→DB seed only fills a field
when it is EMPTY, so a stale/wrong value (seen in the wild: `.es` instead of
`.org`, or an old `drive.` subdomain, or a root URL missing `/nextcloud`)
persists across re-installs and re-runs of the installer. A wrong domain/prefix
here produces a 404 on `.../apps/user_oidc/login/<id>`. Fix it directly:
`update integration_settings set nextcloud_url='https://<domain>/nextcloud', collabora_url='https://<domain>/collabora';` then restart the app service.

**Verify with curl, not the browser** (browsers cache 301 redirects very
aggressively — after fixing the server the user kept seeing the old http
redirect until testing in incognito / clearing site data):
- `curl .../api/oidc/.well-known/openid-configuration` → endpoints must be https.
- `curl -D - .../nextcloud/index.php/apps/user_oidc/login/1?redirect_url=...`
  → the `location:` chain must be all https.

**Debugging order:** (1) console says Mixed Content? → fix overwriteprotocol +
PUBLIC_APP_URL. (2) console says 404 on login/<id>? → check provider id with
`occ user_oidc:provider` AND the DB `nextcloud_url` domain/prefix. (3) only after
the curl chain is clean https, suspect browser cache → test in incognito.

Side note: the overlay's "Nueva pestaña" link reuses the same one-time SSO
ticket the iframe already consumed, so it shows "Enlace caducado" — expected,
not a regression.
