---
name: API contract changes need codegen
description: How to change a response/request shape in this monorepo (openapi → orval → zod + react client).
---

The API contract is the single source of truth in `lib/api-spec/openapi.yaml`. Both
the zod schemas (`lib/api-zod`) and the react-query client (`lib/api-client-react`)
are generated from it.

**Rule:** To add/change a request or response field, edit `openapi.yaml`, then run
`pnpm --filter @workspace/api-spec run codegen` (orval + `typecheck:libs`). Never
hand-edit files under any `generated/` directory — they are overwritten.

**Why:** The route handler returns plain objects (not parsed through a generated
response schema for every endpoint), so the server compiles even if the spec is
stale; the mismatch only surfaces in the web client's generated types. Regenerating
keeps server, zod, and client in lockstep.

**How to apply:** When a code review asks to "surface X in the response" (e.g.
`emailPending`/`notifiedCount` on company-alert create), add a wrapper schema in
openapi (mirror `InvitationCreated`'s shape: `{ entity, ...metadata }`), point the
endpoint's 201 response at it, run codegen, then update the route to return the new
shape and the frontend to read it.
