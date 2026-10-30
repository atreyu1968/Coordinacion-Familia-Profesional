---
name: api-server testing harness
description: How automated tests run for the api-server artifact (Vitest + supertest + real Postgres).
---

# api-server test harness

Tests live in `artifacts/api-server/test/`, run with `pnpm --filter @workspace/api-server test` (Vitest).

**Real DB, not mocks.** Routes import a module-level `db` (drizzle) that is not injectable, so tests run against the live `DATABASE_URL`. Seed helpers (`test/helpers.ts`) tag every row with a per-run `vitest-<ts>-<rand>` marker and a `cleanup()` deletes them all in `afterAll`. Always route new fixtures through these helpers so cleanup stays complete.

**Why sequential.** `realtime.ts` holds a module-level Socket.io `io` singleton and all suites share one database, so the config forces single-worker, no file parallelism. Don't reintroduce parallelism without isolating these.

**Global-action tests need isolation.** The shared development database contains active application accounts. Never run a successful test of an endpoint that invalidates every active user's session against it. Test authorization and per-user response codes there; run global success-path integration tests only against a separately verified isolated database.

**Why:** a superadmin session-invalidation test changed every active user's token version before its overly narrow assertion failed; the development rows were restored. **How to apply:** do not exercise global mutation endpoints in the shared test database, even when fixtures are created and cleaned up.

**Workspace deps must be inlined.** `@workspace/db` / `@workspace/api-zod` export raw `.ts`; Vitest config sets `server.deps.inline: [/@workspace\//]` and `resolve.conditions` includes `workspace`. Without these, imports fail as untransformed node_modules.

**Socket e2e.** Wrap `app` in an `http.Server`, call `initRealtime(server)`, listen on port 0, connect `socket.io-client` to `/api/socket.io` with `auth.token`. emitToGroup/emitToUser use the same singleton, so a supertest POST in-process triggers real socket emits.

**Logging.** Config sets `env.LOG_LEVEL=silent` to mute pino during runs.

**The shared test DB can lag the committed schema.** Routes may reference tables that drizzle-kit never pushed (the academic-year feature shipped in code with `academic_years`/`teacher_year_confirmations` absent from the DB). Before testing a new-feature table, run `pnpm --filter @workspace/db push`. Symptom otherwise: `relation "X" does not exist`, often surfacing inside `cleanup()` for every suite (cleanup is shared). Tables not used by routes still need pushing for tests to exercise them.

**Cleanup must cover any new fixture table.** `cleanup()` deletes academic years, teacher confirmations, teaching assignments, groups and training offer by tracked user/center ids and `schoolYears`. Route fixtures that fan out (e.g. open-confirmation inserts a row per active teacher) are cleaned by school year, so always use a unique per-run year for them.

**Migration probes sharing the test DB must run before the API suite or use unique fixture values.** The API suite can delete rows from migration probes when both use the same `schoolYear`, even when the probe's user is unrelated. **Why:** fixture cleanup sometimes scopes by year across all users. **How to apply:** run migration-preservation/idempotency assertions before Vitest, or give the probe a unique marker that no API fixture tracks.

**Don't run cleanup `npx vitest run` in a backgrounded shell here** — the process gets SIGTERM'd between tool polls and the log stays empty. Run a single file (≈12-20s cold start) synchronously instead; multiple files can exceed the 120s tool timeout.

## Isolated suite configuration

Never use Vite/Vitest `mergeConfig` to narrow a general test configuration to a security suite: it concatenates `include`/`exclude` arrays rather than replacing them.

**Why:** concatenation can silently broaden a specialized run to unrelated suites or exclude its intended tests.

**How to apply:** explicitly replace test selection arrays in specialized configurations. Destructive fixtures must also verify the temporary server's identity before their first write; an environment flag alone is not proof of isolation.

## Playwright browser in this workspace

When Playwright's expected downloaded Chromium revision is absent, check the existing system browser before installing another one.

**Why:** the workspace provides Chromium at `/repl/tools/bin/chromium`, while a newer Playwright package may expect a different browser in its cache; this stops the run before any app test executes.

**How to apply:** verify that executable still exists, then supply it through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to the isolated UI runner. A browser-launch failure is not an application-test failure.
