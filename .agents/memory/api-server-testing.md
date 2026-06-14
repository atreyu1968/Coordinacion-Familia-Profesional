---
name: api-server testing harness
description: How automated tests run for the api-server artifact (Vitest + supertest + real Postgres).
---

# api-server test harness

Tests live in `artifacts/api-server/test/`, run with `pnpm --filter @workspace/api-server test` (Vitest).

**Real DB, not mocks.** Routes import a module-level `db` (drizzle) that is not injectable, so tests run against the live `DATABASE_URL`. Seed helpers (`test/helpers.ts`) tag every row with a per-run `vitest-<ts>-<rand>` marker and a `cleanup()` deletes them all in `afterAll`. Always route new fixtures through these helpers so cleanup stays complete.

**Why sequential.** `realtime.ts` holds a module-level Socket.io `io` singleton and all suites share one database, so the config forces single-worker, no file parallelism. Don't reintroduce parallelism without isolating these.

**Workspace deps must be inlined.** `@workspace/db` / `@workspace/api-zod` export raw `.ts`; Vitest config sets `server.deps.inline: [/@workspace\//]` and `resolve.conditions` includes `workspace`. Without these, imports fail as untransformed node_modules.

**Socket e2e.** Wrap `app` in an `http.Server`, call `initRealtime(server)`, listen on port 0, connect `socket.io-client` to `/api/socket.io` with `auth.token`. emitToGroup/emitToUser use the same singleton, so a supertest POST in-process triggers real socket emits.

**Logging.** Config sets `env.LOG_LEVEL=silent` to mute pino during runs.

**The shared test DB can lag the committed schema.** Routes may reference tables that drizzle-kit never pushed (the academic-year feature shipped in code with `academic_years`/`teacher_year_confirmations` absent from the DB). Before testing a new-feature table, run `pnpm --filter @workspace/db push`. Symptom otherwise: `relation "X" does not exist`, often surfacing inside `cleanup()` for every suite (cleanup is shared). Tables not used by routes still need pushing for tests to exercise them.

**Cleanup must cover any new fixture table.** `cleanup()` deletes academic years, teacher confirmations, teaching assignments, groups and training offer by tracked user/center ids and `schoolYears`. Route fixtures that fan out (e.g. open-confirmation inserts a row per active teacher) are cleaned by school year, so always use a unique per-run year for them.

**Don't run cleanup `npx vitest run` in a backgrounded shell here** — the process gets SIGTERM'd between tool polls and the log stays empty. Run a single file (≈12-20s cold start) synchronously instead; multiple files can exceed the 120s tool timeout.
