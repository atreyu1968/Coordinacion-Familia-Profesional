---
name: Contract-driven workflow
description: The OpenAPI-first edit/codegen/db-push loop for the Coordina ADG monorepo.
---

# Contract-driven workflow

This project is contract-driven. Never hand-write client API types or routes
out of band with the spec.

**Loop:**
1. Edit `lib/api-spec/openapi.yaml` (schemas, paths, responses).
2. Run `pnpm --filter @workspace/api-spec run codegen` (regenerates the typed
   client + zod and runs `tsc --build` on libs).
3. Run `pnpm --filter @workspace/db run push` if the schema changed.
4. Typecheck all three artifacts: api-server, web, movil.

**Declare every status the backend can return.** Visibility/permission checks
(e.g. `loadVisibleThread`) can return 403 even on GET endpoints — the spec must
list it or the contract drifts from reality and the architect flags it.

**Validation lives in the spec too:** e.g. `minLength: 1` on create-input
string fields enforces non-empty titles/content via generated zod, rather than
ad-hoc server checks.
