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
