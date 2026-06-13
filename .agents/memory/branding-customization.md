---
name: App branding customization (web)
description: Superadmin-configurable app name/logo/favicon stored in DB, served publicly; security rule for the public asset routes.
---

# App branding customization (web only)

Superadmin can change app NAME, LOGO and FAVICON from Configuración → "Apariencia".
Values live on the `integration_settings` row (`appName`, `logoPath`, `faviconPath`,
all nullable). When unset, the web app falls back to built-in default assets.
Móvil branding (manifest.json/app.json) is build-time and intentionally out of scope.

Public image routes (`GET /settings/branding/logo|favicon`) stream PRIVATE uploaded
objects publicly, because the login screen renders the logo before authentication.

**Rule:** any public route that streams a client-supplied object-storage path must
validate that path with a strict canonical regex (single segment, no `..`, slashes,
or encoded escapes) at BOTH write time (PUT) AND serve time — not just `startsWith`.

**Why:** a loose `startsWith("/objects/uploads/")` check let `/objects/uploads/../secret`
pass; in local-storage mode `getObjectEntityFile` uses `path.resolve`, so `..` escapes
the uploads prefix and would publicly expose unrelated private objects. Serve-time
validation is required so a bad/legacy DB value can never be exposed either.

**How to apply:** guard with `^/objects/uploads/[A-Za-z0-9._-]+$`. Upload ids are
`randomUUID()` so they always match. Cache-bust public branding images with
`?v=<version>` where version derives from `integration_settings.updatedAt`.
