---
name: Expo Router typed routes & movil typecheck
description: Why a newly added movil screen fails typecheck until the expo dev server regenerates its route manifest.
---

# Expo Router typed routes (movil)

`artifacts/movil` has `experiments.typedRoutes: true`, so `router.push("/x")`
is type-checked against a generated union in `.expo/types/router.d.ts`.

**Rule:** After adding a new screen file under `artifacts/movil/app/` (and
registering it in `app/_layout.tsx`), `pnpm --filter ./artifacts/movil typecheck`
will fail with `Argument of type '"/new-route"' is not assignable...` until the
route manifest is regenerated.

**Why:** The typed-routes `.d.ts` is produced by the Expo/Metro dev server, not
by `tsc`. It only includes routes that existed last time the dev server scanned
the app dir.

**How to apply:** Restart the `artifacts/movil: expo` workflow (it rescans and
rewrites `.expo/types/router.d.ts`), then re-run typecheck. Do NOT hand-edit the
generated manifest.
