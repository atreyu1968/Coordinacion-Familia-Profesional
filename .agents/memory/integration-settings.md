---
name: Integration settings (control panel)
description: How external credentials (DeepSeek, Resend, JaaS) are configured in-app and the rules for adding more.
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

## JaaS (8x8) video credentials — resolve as a complete triplet, never mixed
JaaS needs all three of `appId`, `kid`, `privateKey`. Resolution prefers the DB triplet
and otherwise falls back to the env triplet (`JAAS_APP_ID` / `JAAS_KID` /
`JAAS_PRIVATE_KEY`), but the two sources are **never mixed field-by-field**.
**Why:** a JWT signed with a `kid` from one source and a private key from another (e.g.
a partially-saved DB row + leftover env vars) silently fails to authenticate and the call
falls back to the 5-minute public meet.jit.si server. **How to apply:** keep the
"all-or-nothing per source" logic in `resolveJaasCreds`; don't reintroduce per-field
`db || env` defaulting.
