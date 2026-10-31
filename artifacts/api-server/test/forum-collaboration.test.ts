import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db, centersTable, trainingOfferTable, modulesTable, moduleLearningOutcomesTable,
  moduleEvaluationCriteriaTable, forumThreadsTable, forumPostsTable, forumThreadReadsTable,
  forumThreadContextsTable, forumCollaborationsTable, forumCollaborationRevisionsTable,
  moduleMembershipsTable,
} from "@workspace/db";
import app from "../src/app";
import { getActiveAcademicYear } from "../src/lib/settings";
import { createUser, createProvince, createCenter, createModule, createTeachingAssignment, cleanup, authHeader } from "./helpers";

const moduleIds: number[] = [];
const run = `collab-${Date.now()}`;
let owner: Awaited<ReturnType<typeof createUser>>, coordinator: typeof owner, teacher: typeof owner, outsider: typeof owner;
let moduleId: number, centerId: number, ceId: number, legacyId: number;
const url = (id = moduleId) => `/api/forum/modules/${id}/collaboration`;
const get = (id = moduleId, user = owner) => request(app).get(url(id)).set(authHeader(user.token));
const initialize = (state: any, user = owner, id = moduleId) => request(app).post(`${url(id)}/initialize`)
  .set(authHeader(user.token)).send({ revision: state.configuration?.revision ?? 1, fingerprint: state.fingerprint });
const config = (state: any, patch = {}) => ({
  revision: state.configuration?.revision ?? 0, fingerprint: state.fingerprint, enabled: true,
  officialCode: state.moduleCode, sourceTitle: "Fuente ficticia SOLO de ensayo, no currículo oficial",
  sourceUrl: "https://www.boe.es/buscar/act.php?id=TEST-NO-OFICIAL",
  curriculumVersion: "ENSAYO-1", territory: "Canarias (ensayo)",
  confirmReviewed: true, sections: state.sections, ...patch,
});

async function fixture(code: string, family = "Administración y Gestión", withCurriculum = true) {
  const center = await createCenter(await createProvince("Ensayo"));
  await db.update(centersTable).set({ families: [family] }).where(eq(centersTable.id, center));
  const cycleName = `${run}-${moduleIds.length}`;
  const id = await createModule({ code, cycleName, centerId: null, name: `Módulo ${run}` });
  moduleIds.push(id);
  await db.insert(trainingOfferTable).values({ centerId: center, cycleName });
  const outcomes = [];
  const criteria = [];
  if (withCurriculum) {
    for (let n = 1; n <= 2; n++) {
      const [ra] = await db.insert(moduleLearningOutcomesTable).values({
        moduleId: id, code: `RA${n}`, description: `RA de ensayo ${n}`, order: n,
      }).returning();
      outcomes.push(ra);
      for (let k = 0; k < (n === 1 ? 2 : 1); k++) {
        const [ce] = await db.insert(moduleEvaluationCriteriaTable).values({
          outcomeId: ra.id, code: String.fromCharCode(97 + k), description: "CE ficticio de ensayo", order: k,
        }).returning();
        criteria.push(ce);
      }
    }
  }
  return { id, center, outcomes, criteria };
}

beforeAll(async () => {
  owner = await createUser({ role: "superadmin" });
  coordinator = await createUser({ role: "coordinator" });
  const f = await fixture(run);
  moduleId = f.id; centerId = f.center; ceId = f.criteria[0].id;
  teacher = await createUser({ role: "teacher", centerId });
  outsider = await createUser({ role: "teacher" });
  const year = await getActiveAcademicYear();
  if (!year) throw new Error("These scoped forum tests require an active academic year.");
  await createTeachingAssignment({ teacherId: teacher.user.id, moduleId, centerId, schoolYear: year });
  const [legacy] = await db.insert(forumThreadsTable).values({
    moduleId, centerId: null, title: "Debate anterior que debe conservarse", authorId: teacher.user.id,
  }).returning();
  legacyId = legacy.id;
  await db.insert(forumPostsTable).values({ threadId: legacyId, authorId: teacher.user.id, content: "Contenido anterior sin reclasificar" });
  await db.insert(forumThreadReadsTable).values({ threadId: legacyId, userId: teacher.user.id });
});

afterAll(async () => {
  if (moduleIds.length) {
    const threads = await db.select({ id: forumThreadsTable.id }).from(forumThreadsTable).where(inArray(forumThreadsTable.moduleId, moduleIds));
    if (threads.length) {
      const ids = threads.map(t => t.id);
      await db.delete(forumThreadContextsTable).where(inArray(forumThreadContextsTable.threadId, ids));
      await db.delete(forumThreadReadsTable).where(inArray(forumThreadReadsTable.threadId, ids));
      await db.delete(forumPostsTable).where(inArray(forumPostsTable.threadId, ids));
      await db.delete(forumThreadsTable).where(inArray(forumThreadsTable.id, ids));
    }
    await db.delete(forumCollaborationRevisionsTable).where(inArray(forumCollaborationRevisionsTable.moduleId, moduleIds));
    await db.delete(forumCollaborationsTable).where(inArray(forumCollaborationsTable.moduleId, moduleIds));
  }
  await cleanup();
});

describe("Structured forums for Administración y Gestión", () => {
  it("lets coordinators list global modules and open their collaboration screen", async () => {
    const modules = await request(app)
      .get("/api/forum/modules")
      .set(authHeader(coordinator.token));
    expect(modules.status).toBe(200);
    expect(modules.body.some((module: { id: number }) => module.id === moduleId)).toBe(true);

    const state = await get(moduleId, coordinator);
    expect(state.status).toBe(200);
    expect(state.body.canConfigure).toBe(true);
    expect(state.body.importReport.reasons.length).toBeGreaterThan(0);
  });

  it("previews without writing and keeps legacy posts and reads untouched", async () => {
    const state = await get();
    expect(state.status).toBe(200);
    expect(state.body.enabled).toBe(false);
    expect(state.body.importReport.reasons.length).toBeGreaterThan(0);
    expect(state.body.threads).toHaveLength(21); // 16 + 2 RA + 3 CE, not RA × CE.
    expect(state.body.threads.every((t: any) => t.threadId === null)).toBe(true);
    expect((await db.select().from(forumThreadContextsTable).where(eq(forumThreadContextsTable.moduleId, moduleId)))).toHaveLength(0);
    expect((await get(moduleId, teacher)).body.canConfigure).toBe(false);
    expect((await get(moduleId, teacher)).body.importReport).toBeNull();
    expect((await get(moduleId, outsider)).status).toBe(403);
  });

  it("requires human review and forbids ordinary teachers or moderators from attesting a curriculum", async () => {
    const state = (await get()).body;
    expect((await request(app).put(url()).set(authHeader(owner.token)).send(config(state, { confirmReviewed: false }))).status).toBe(400);
    expect((await request(app).put(url()).set(authHeader(teacher.token)).send(config(state))).status).toBe(403);
    await db.insert(moduleMembershipsTable).values({ moduleId, userId: outsider.user.id, role: "member", forumModerator: true });
    expect((await get(moduleId, outsider)).status).toBe(200);
    expect((await get(moduleId, outsider)).body.canConfigure).toBe(false);
    expect((await request(app).put(url()).set(authHeader(outsider.token)).send(config(state))).status).toBe(403);
    expect((await request(app).put(url()).set(authHeader(owner.token)).send(config(state, {
      sections: state.sections.map((s: any) => ({ ...s, key: "PD-01" })),
    }))).status).toBe(400);
  });

  it("does not attribute a spreadsheet review to a user without explicit confirmation", async () => {
    const f = await fixture(`${run}-imported-review`);
    const preview = (await get(f.id)).body;
    const imported = await request(app).put(url(f.id)).set(authHeader(owner.token))
      .send(config(preview, { enabled: false }));
    expect(imported.status).toBe(200);
    // Model the seed's provenance: valid fingerprint, no local human verifier.
    await db.update(forumCollaborationsTable).set({ verifiedBy: null })
      .where(eq(forumCollaborationsTable.moduleId, f.id));
    const current = (await get(f.id)).body;
    expect(current.verificationCurrent).toBe(true);
    const denied = await request(app).put(url(f.id)).set(authHeader(owner.token))
      .send(config(current, { confirmReviewed: false, enabled: true }));
    expect(denied.status).toBe(400);
    const [unchanged] = await db.select().from(forumCollaborationsTable)
      .where(eq(forumCollaborationsTable.moduleId, f.id));
    expect(unchanged.verifiedBy).toBeNull();
    expect(unchanged.enabled).toBe(false);
    const confirmed = await request(app).put(url(f.id)).set(authHeader(owner.token))
      .send(config(current, { confirmReviewed: true, enabled: true }));
    expect(confirmed.status).toBe(200);
    const [reviewed] = await db.select().from(forumCollaborationsTable)
      .where(eq(forumCollaborationsTable.moduleId, f.id));
    expect(reviewed.verifiedBy).toBe(owner.user.id);
  });

  it("ignores other-family duplicate codes and rejects access to their structure even for superadmin", async () => {
    const other = await fixture(run, "Informática y Comunicaciones");
    expect((await get(other.id)).status).toBe(403);
    const state = (await get()).body;
    expect(state.diagnostics.some((d: string) => d.includes("otros registros"))).toBe(false);
    const saved = await request(app).put(url()).set(authHeader(owner.token)).send(config(state));
    expect(saved.status).toBe(200);
    expect(saved.body.verificationCurrent).toBe(true);
  });

  it("initializes ten times and concurrently without duplicating a single structural post", async () => {
    const state = (await get()).body;
    const first = await Promise.all([initialize(state), initialize(state)]);
    expect(first.map(r => r.status)).toEqual([200, 200]);
    for (let i = 0; i < 8; i++) expect((await initialize(state)).status).toBe(200);
    const result = (await get()).body;
    expect(result.threads.filter((t: any) => t.threadId != null)).toHaveLength(21);
    expect(new Set(result.threads.map((t: any) => t.threadId)).size).toBe(21);
    const legacy = await db.select().from(forumThreadsTable).where(eq(forumThreadsTable.id, legacyId));
    expect(legacy[0].title).toBe("Debate anterior que debe conservarse");
    expect((await db.select().from(forumThreadReadsTable).where(eq(forumThreadReadsTable.threadId, legacyId)))).toHaveLength(1);
    expect((await db.select().from(forumPostsTable).where(eq(forumPostsTable.threadId, legacyId)))[0].content).toBe("Contenido anterior sin reclasificar");
    expect((await request(app).get(`/api/forum/threads/${legacyId}`).set(authHeader(teacher.token))).status).toBe(200);
    const createdId = result.threads.find((t: any) => t.key === `MAT-CE:${ceId}`).threadId;
    expect((await request(app).get(`/api/forum/threads/${createdId}`).set(authHeader(teacher.token))).status).toBe(200);
  });

  it("detects concurrent edits and retains template versions and existing thread identity", async () => {
    const old = (await get()).body;
    const payload = config(old, { sections: old.sections.map((s: any, i: number) => ({ ...s, order: 16 - i, title: `${s.title} revisado` })) });
    const edited = await request(app).put(url()).set(authHeader(owner.token)).send(payload);
    expect(edited.status).toBe(200);
    expect(edited.body.configuration.revision).toBe(2);
    expect((await request(app).put(url()).set(authHeader(owner.token)).send(payload)).status).toBe(409);
    expect((await initialize(old)).status).toBe(409);
    const revisions = await db.select().from(forumCollaborationRevisionsTable).where(eq(forumCollaborationRevisionsTable.moduleId, moduleId));
    expect(revisions).toHaveLength(2);
    await db.update(moduleEvaluationCriteriaTable).set({ code: "a revisado" }).where(eq(moduleEvaluationCriteriaTable.id, ceId));
    const changed = (await get()).body;
    expect(changed.verificationCurrent).toBe(false);
    expect((await initialize(changed)).status).toBe(409);
    expect(changed.threads.find((t: any) => t.key === `MAT-CE:${ceId}`).threadId)
      .toBe(old.threads.find((t: any) => t.key === `MAT-CE:${ceId}`).threadId);
    const reviewed = await request(app).put(url()).set(authHeader(owner.token)).send(config(changed, { curriculumVersion: "ENSAYO-2" }));
    expect(reviewed.status).toBe(200);
    expect((await initialize(reviewed.body)).status).toBe(200);
    expect(reviewed.body.threads.find((t: any) => t.key === `MAT-CE:${ceId}`).curriculumVersion).toBe("ENSAYO-1");
  });

  it("disables the pilot without erasing history or allowing regeneration", async () => {
    const state = (await get()).body;
    const disabled = await request(app).put(url()).set(authHeader(owner.token)).send(config(state, { enabled: false }));
    expect(disabled.status).toBe(200);
    expect(disabled.body.enabled).toBe(false);
    expect((await initialize(disabled.body)).status).toBe(409);
    expect(disabled.body.threads.filter((t: any) => t.threadId != null)).toHaveLength(21);
  });

  it("blocks absent curriculum, ambiguous codes, center-specific modules and mismatched identity", async () => {
    const missing = await fixture(`${run}-empty`, "Administración y Gestión", false);
    let state = (await get(missing.id)).body;
    expect(state.diagnostics.some((d: string) => d.includes("no tiene resultados de aprendizaje cargados"))).toBe(true);
    expect((await request(app).put(url(missing.id)).set(authHeader(owner.token)).send(config(state))).status).toBe(409);
    const duplicate = await fixture(run);
    state = (await get(duplicate.id)).body;
    // Official codes shared across different cycles are valid.
    expect((await request(app).put(url(duplicate.id)).set(authHeader(owner.token)).send(config(state))).status).toBe(200);
    const [original] = await db.select().from(modulesTable).where(eq(modulesTable.id, moduleId));
    await db.update(modulesTable).set({ cycleName: original.cycleName }).where(eq(modulesTable.id, duplicate.id));
    state = (await get(duplicate.id)).body;
    expect((await request(app).put(url(duplicate.id)).set(authHeader(owner.token)).send(config(state))).status).toBe(409);
    const centerBound = await fixture(`${run}-center`);
    await db.update(modulesTable).set({ centerId: centerBound.center }).where(eq(modulesTable.id, centerBound.id));
    state = (await get(centerBound.id)).body;
    expect((await request(app).put(url(centerBound.id)).set(authHeader(owner.token)).send(config(state))).status).toBe(409);
    const wrong = await fixture(`${run}-wrong`);
    state = (await get(wrong.id)).body;
    expect((await request(app).put(url(wrong.id)).set(authHeader(owner.token)).send(config(state, { officialCode: "OTRO" }))).status).toBe(409);
  });
});
