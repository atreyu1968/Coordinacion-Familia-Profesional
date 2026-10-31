import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, trainingOfferTable, moduleLearningOutcomesTable, moduleEvaluationCriteriaTable, teachingAssignmentsTable,
  moduleMembershipsTable, forumThreadsTable, forumPostsTable, forumThreadReadsTable, forumThreadContextsTable,
  forumCollaborationsTable, forumCollaborationRevisionsTable, wikiPagesTable,
  forumAgreementsTable, forumAgreementRevisionsTable,
  resourcesTable, resourceCurriculumTable, resourceLearningTargetsTable,
  forumDigestEventsTable,
} from "@workspace/db";
vi.mock("../src/lib/nextcloud", async importOriginal => ({
  ...await importOriginal<object>(), resolveNextcloudUrl: () => "https://nextcloud.example.test",
}));
vi.mock("../src/lib/notify", () => ({ notifyUsers: vi.fn().mockResolvedValue(undefined) }));
import { notifyUsers } from "../src/lib/notify";
import app from "../src/app";
import { getActiveAcademicYear } from "../src/lib/settings";
import { canReadAgreementWiki } from "../src/lib/forumAgreementSupport";
import { createUser, createProvince, createCenter, createModule, authHeader, cleanup, snapshotTestFixtures, restoreTestFixtures } from "./helpers";

const stamp = `agreement-${Date.now()}`;
let admin: Awaited<ReturnType<typeof createUser>>, teacher: typeof admin, teacher2: typeof admin, moderator: typeof admin, outsider: typeof admin;
let moduleId: number, threadId: number, centerId: number, otherCenter: number;
let state: any;
let fetchMock: ReturnType<typeof vi.spyOn>;
const path = () => `/api/forum/threads/${threadId}/agreement`;
async function load(who = admin) {
  const r = await request(app).get(path()).set(authHeader(who.token));
  expect(r.status).toBe(200); return r.body;
}
function body(patch: Record<string, unknown> = {}) {
  const a = state.agreement;
  return { revision: a?.revision ?? 0, fingerprint: state.fingerprint, status: a?.status ?? "abierto",
    summary: a?.summary ?? "Síntesis ficticia", proposedText: a?.proposedText ?? "Texto de ensayo, no curricular.",
    observations: a?.observations ?? "", closureReason: a?.closureReason ?? "",
    sources: a?.sources ?? [], sourcePostIds: a?.sourcePostIds ?? [], editorIds: a?.editorIds ?? [],
    documentUrl: a?.documentUrl ?? "https://nextcloud.example.test/index.php/f/123", ...patch };
}
async function save(patch: Record<string, unknown> = {}, who = admin) {
  const r = await request(app).put(path()).set(authHeader(who.token)).send(body(patch));
  if (r.status === 200) state = r.body;
  return r;
}
beforeAll(async () => {
  fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ installed: true, maintenance: false }), {
    status: 200, headers: { "Content-Type": "application/json" },
  }));
  const province = await createProvince(stamp);
  centerId = await createCenter(province); otherCenter = await createCenter(province);
  moduleId = await createModule({ centerId: null, code: stamp, cycleName: stamp, name: `ENSAYO ${stamp}` });
  await db.insert(trainingOfferTable).values({ centerId, cycleName: stamp });
  const [ra] = await db.insert(moduleLearningOutcomesTable).values({ moduleId, code: "RA1", description: "Resultado ficticio, no oficial." }).returning();
  await db.insert(moduleEvaluationCriteriaTable).values({ outcomeId: ra.id, code: "a", description: "Criterio ficticio." });
  admin = await createUser({ role: "superadmin", centerId, provinceId: province });
  teacher = await createUser({ role: "teacher", centerId, provinceId: province });
  teacher2 = await createUser({ role: "teacher", centerId, provinceId: province });
  moderator = await createUser({ role: "teacher", centerId, provinceId: province });
  outsider = await createUser({ role: "teacher", centerId: otherCenter, provinceId: province });
  const year = await getActiveAcademicYear();
  await db.insert(teachingAssignmentsTable).values([
    { teacherId: teacher.user.id, centerId, moduleId, schoolYear: year },
    { teacherId: teacher.user.id, centerId: otherCenter, moduleId, schoolYear: year },
    { teacherId: teacher2.user.id, centerId, moduleId, schoolYear: year },
  ]);
  await db.insert(moduleMembershipsTable).values({ moduleId, userId: moderator.user.id, forumModerator: true });
  const cfg = `/api/forum/modules/${moduleId}/collaboration`;
  const initial = (await request(app).get(cfg).set(authHeader(admin.token))).body;
  const configured = await request(app).put(cfg).set(authHeader(admin.token)).send({
    revision: 0, fingerprint: initial.fingerprint, enabled: true, officialCode: initial.moduleCode, sourceTitle: "ENSAYO no oficial",
    sourceUrl: "https://www.boe.es/buscar/act.php?id=TEST-NO-OFICIAL", curriculumVersion: stamp, territory: "Canarias (ensayo)",
    confirmReviewed: true, sections: initial.sections,
  });
  expect(configured.status).toBe(200);
  const initialized = await request(app).post(`${cfg}/initialize`).set(authHeader(admin.token)).send({
    revision: configured.body.configuration.revision, fingerprint: configured.body.fingerprint,
  });
  expect(initialized.status).toBe(200);
  threadId = initialized.body.threads.find((t: any) => t.kind === "programming_section").threadId;
  state = await load();
}, 30000);
afterAll(async () => {
  fetchMock?.mockRestore();
  if (moduleId) {
    const pages = await db.select({ id: wikiPagesTable.id }).from(wikiPagesTable).where(eq(wikiPagesTable.moduleId, moduleId));
    await db.delete(forumAgreementsTable).where(eq(forumAgreementsTable.moduleId, moduleId));
    if (pages.length) await db.delete(wikiPagesTable).where(inArray(wikiPagesTable.id, pages.map(p => p.id)));
    const threads = await db.select({ id: forumThreadsTable.id }).from(forumThreadsTable).where(eq(forumThreadsTable.moduleId, moduleId));
    if (threads.length) {
      const ids = threads.map(t => t.id);
      await db.delete(forumThreadContextsTable).where(inArray(forumThreadContextsTable.threadId, ids));
      await db.delete(forumThreadReadsTable).where(inArray(forumThreadReadsTable.threadId, ids));
      await db.delete(forumPostsTable).where(inArray(forumPostsTable.threadId, ids));
      await db.delete(forumThreadsTable).where(inArray(forumThreadsTable.id, ids));
    }
    await db.delete(forumCollaborationRevisionsTable).where(eq(forumCollaborationRevisionsTable.moduleId, moduleId));
    await db.delete(forumCollaborationsTable).where(eq(forumCollaborationsTable.moduleId, moduleId));
  }
  restoreTestFixtures({ ...snapshotTestFixtures(), schoolYears: [] }); await cleanup();
}, 30000);

describe("Ficha de acuerdo y consulta versionada", () => {
  it("scopes live tracking to assigned pilots and does not count generated prompts", async () => {
    expect((await request(app).get("/api/forum/collaboration-tracking")).status).toBe(401);
    const mine = await request(app).get("/api/forum/collaboration-tracking").set(authHeader(teacher.token));
    expect(mine.status).toBe(200);
    expect(mine.headers["cache-control"]).toContain("no-store");
    expect(mine.body.modules.map((m: any) => m.id)).toEqual([moduleId]);
    const row = mine.body.modules[0];
    expect(row.participants).toBe(0);
    expect(row.centers).toBe(0);
    expect(row.lastActivityAt).toBeNull();
    expect(row.createdThreads).toBe(row.plannedThreads);
    expect(row.outcomesWithCriteria).toBe(1);
    expect(row.threads.every((t: any) => t.status === "sin_sintesis")).toBe(true);
    expect(mine.body.providerCheck).toBe("not_checked");
    const denied = await request(app).get("/api/forum/collaboration-tracking").set(authHeader(outsider.token));
    expect(denied.body.modules).toEqual([]);
    expect(denied.body.totals.participants).toBe(0);
  });
  it("counts only visible non-archived resources and distinguishes RA coverage from criteria", async () => {
    const inserted = await db.insert(resourcesTable).values([0, 1, 2].map(i => ({
      title: `ENSAYO ${stamp}-${i}`, type: "link", authorId: admin.user.id, moduleId,
      deletedAt: i === 2 ? new Date() : null,
    }))).returning();
    try {
      const [config] = await db.select().from(forumCollaborationsTable).where(eq(forumCollaborationsTable.moduleId, moduleId));
      await db.insert(resourceCurriculumTable).values(inserted.map((r, i) => ({
        resourceId: r.id, moduleId, canonicalKey: `${stamp}-${i}`, license: "ENSAYO",
        version: "1", audience: "teachers", archived: i === 1,
        curriculumVersion: config.curriculumVersion, fingerprint: config.fingerprint,
      })));
      const [ra] = await db.select().from(moduleLearningOutcomesTable).where(eq(moduleLearningOutcomesTable.moduleId, moduleId));
      await db.insert(resourceLearningTargetsTable).values({
        resourceId: inserted[0].id, outcomeId: ra.id, stableKey: `RA:${ra.id}`,
      });
      const r = await request(app).get("/api/forum/collaboration-tracking").set(authHeader(teacher.token));
      expect(r.status).toBe(200);
      expect(r.body.modules[0].resources).toBe(1);
      expect(r.body.modules[0].outcomesWithResources).toBe(1);
      expect(r.body.modules[0].resourcesNeedingReview).toBe(0);
      await db.update(resourceCurriculumTable).set({ curriculumVersion: "ENSAYO-ANTERIOR" })
        .where(eq(resourceCurriculumTable.resourceId, inserted[0].id));
      const changed = await request(app).get("/api/forum/collaboration-tracking").set(authHeader(teacher.token));
      expect(changed.body.modules[0].resourcesNeedingReview).toBe(1);
    } finally {
      await db.delete(resourceCurriculumTable).where(inArray(resourceCurriculumTable.resourceId, inserted.map(r => r.id)));
      await db.delete(resourcesTable).where(inArray(resourcesTable.id, inserted.map(r => r.id)));
    }
  });
  it("limits module reading, synthesis editing and explicit moderator delegation", async () => {
    expect((await request(app).get(path()).set(authHeader(outsider.token))).status).toBe(403);
    expect((await save({}, teacher)).status).toBe(403);
    expect((await save({}, moderator)).status).toBe(403);
    expect((await save({ editorIds: [moderator.user.id] })).status).toBe(200);
    const old = body();
    expect((await save({ summary: "Síntesis delegada" }, moderator)).status).toBe(200);
    expect((await save({ editorIds: [] }, moderator)).status).toBe(403);
    expect((await request(app).put(path()).set(authHeader(admin.token)).send(old)).status).toBe(409);
    expect(state.agreement.sources[0].title).toBe("ENSAYO no oficial");
  });
  it("rejects unsafe sources, foreign posts, public shares and unconfigured provider hosts", async () => {
    for (const url of ["javascript:alert(1)", "https://example.test/s/token", "https://example.test/?access_token=x"]) {
      expect((await save({ sources: [{ title: "Bad", url }] })).status).toBe(400);
    }
    expect((await save({ sourcePostIds: [2147483000] })).status).toBe(400);
    expect((await save({ documentUrl: "https://other.example.test/f/1" })).status).toBe(400);
    expect((await save({ status: "consensuado" })).status).toBe(409);
  });
  it("freezes consultation text and deduplicates a teacher with multiple centers and changed positions", async () => {
    expect((await save({ status: "consulta" })).status).toBe(200);
    const input = { revision: state.agreement.revision, version: 1, centerId, position: "a_favor", reason: "" };
    expect((await save({ proposedText: "Changed during consultation" })).status).toBe(409);
    expect((await request(app).post(`${path()}/positions`).set(authHeader(outsider.token)).send(input)).status).toBe(403);
    let r = await request(app).post(`${path()}/positions`).set(authHeader(teacher.token)).send(input);
    expect(r.status).toBe(200); expect(r.body.participation.teachers).toBe(1);
    r = await request(app).post(`${path()}/positions`).set(authHeader(teacher.token)).send({ ...input, centerId: otherCenter, position: "con_reservas", reason: "Concreción local por revisar" });
    expect(r.status).toBe(200); state = r.body;
    expect(state.positions).toHaveLength(1); expect(state.positionHistory).toHaveLength(2);
    expect(state.participation.teachers).toBe(1); expect(state.participation.centers).toBe(1);
    r = await request(app).post(`${path()}/positions`).set(authHeader(teacher.token)).send({ ...input, centerId: otherCenter, position: "con_reservas", reason: "Concreción local por revisar" });
    expect(r.body.positionHistory).toHaveLength(2);
    r = await request(app).post(`${path()}/positions`).set(authHeader(teacher2.token)).send(input);
    expect(r.status).toBe(200); state = r.body;
    expect(state.participation.teachers).toBe(2); expect(state.participation.centers).toBe(2);
    const tracking = await request(app).get("/api/forum/collaboration-tracking").set(authHeader(teacher.token));
    expect(tracking.status).toBe(200);
    expect(tracking.body.modules[0].centers).toBe(2);
    expect(tracking.body.modules[0].participants).toBeGreaterThanOrEqual(3);
    expect(tracking.body.totals.participants).toBe(tracking.body.modules[0].participants);
    expect(tracking.body.totals.centers).toBe(2);
    expect(tracking.body.totals.openConsultations).toBe(1);
  });
  it("requires a reason for closure, records reservations, and does not make consensus automatic", async () => {
    expect((await save({ status: "consensuado", closureReason: "" })).status).toBe(400);
    expect((await save({ status: "consensuado", closureReason: "Referencia limitada a los participantes, conservando las reservas locales." })).status).toBe(200);
    expect(state.participation.warning.toLowerCase()).toContain("no");
    const r = await request(app).post(`${path()}/positions`).set(authHeader(teacher.token)).send({
      revision: state.agreement.revision, version: 1, centerId, position: "a_favor", reason: "",
    });
    expect(r.status).toBe(409);
  });
  it("does not publish when Nextcloud is unavailable and rejects publication by teachers or delegated moderators", async () => {
    const input = { revision: state.agreement.revision, version: 1, documentConfirmed: true, referenceOnlyConfirmed: true };
    expect((await request(app).post(`${path()}/publish`).set(authHeader(moderator.token)).send(input)).status).toBe(403);
    fetchMock.mockRejectedValueOnce(new Error("Provider down"));
    const r = await request(app).post(`${path()}/publish`).set(authHeader(admin.token)).send(input);
    expect(r.status).toBe(503); expect((await load()).agreement.publishedPageId).toBeNull();
    expect((await db.select().from(wikiPagesTable).where(eq(wikiPagesTable.moduleId, moduleId)))).toHaveLength(0);
  });
  it("publishes one immutable wiki snapshot with reservations, scoped reads and idempotent retries", async () => {
    const input = { revision: state.agreement.revision, version: 1, documentConfirmed: true, referenceOnlyConfirmed: true };
    const responses = await Promise.all([1, 2].map(() => request(app).post(`${path()}/publish`).set(authHeader(admin.token)).send(input)));
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    state = responses[0].body; const page = state.agreement.publishedPageId;
    expect(page).toBeGreaterThan(0);
    const [row] = await db.select().from(wikiPagesTable).where(eq(wikiPagesTable.id, page));
    expect(row.content).toContain("No sustituye la programación aprobada por cada centro");
    expect(row.content).toContain("Concreción local por revisar");
    expect(await canReadAgreementWiki(page, outsider.user)).toBe(false);
    expect((await request(app).get(`/api/wiki/pages/${page}`).set(authHeader(outsider.token))).status).toBe(404);
    const list = await request(app).get("/api/wiki/pages").set(authHeader(outsider.token));
    expect(list.body.items.some((p: any) => p.id === page)).toBe(false);
    expect((await request(app).put(`/api/wiki/pages/${page}`).set(authHeader(admin.token)).send({ title: "tampered", content: "bad" })).status).toBe(409);
    await expect(db.update(wikiPagesTable).set({ content: "bypass" }).where(eq(wikiPagesTable.id, page))).rejects.toThrow();
    expect((await db.select().from(wikiPagesTable).where(eq(wikiPagesTable.moduleId, moduleId)))).toHaveLength(1);
    const queued = await db.select().from(forumDigestEventsTable).where(and(
      eq(forumDigestEventsTable.moduleId, moduleId), eq(forumDigestEventsTable.kind, "publication")));
    expect(queued).toHaveLength(1);
  });
  it("requires a new version after publication and keeps previous wiki and positions intact", async () => {
    expect((await save({ proposedText: "overwrite published" })).status).toBe(409);
    expect((await save({ newVersion: true, status: "abierto", proposedText: "Nueva propuesta revisada" })).status).toBe(200);
    expect(state.agreement.version).toBe(2); expect(state.agreement.publishedPageId).toBeNull();
    expect(state.positions).toHaveLength(0); expect(state.positionHistory).toHaveLength(3);
    expect(state.revisions.some((r: any) => r.snapshot.publishedPageId != null)).toBe(true);
    const tracking = await request(app).get("/api/forum/collaboration-tracking").set(authHeader(teacher.token));
    expect(tracking.body.modules[0].publishedVersions).toBe(1);
    expect(tracking.body.modules[0].centers).toBe(0);
    expect((await db.select().from(forumAgreementRevisionsTable).where(eq(forumAgreementRevisionsTable.agreementId, state.agreement.id)))).not.toHaveLength(0);
  });
  it("does not grant historical reading after assignment removal and allows retirement after curricular change", async () => {
    const published = state.revisions.find((r: any) => r.snapshot.publishedPageId != null).snapshot.publishedPageId;
    await db.update(teachingAssignmentsTable).set({ deletedAt: new Date() }).where(and(
      eq(teachingAssignmentsTable.teacherId, teacher.user.id), eq(teachingAssignmentsTable.moduleId, moduleId)));
    expect((await request(app).get(path()).set(authHeader(teacher.token))).status).toBe(403);
    expect((await request(app).get(`/api/wiki/pages/${published}`).set(authHeader(teacher.token))).status).toBe(404);
    await db.update(moduleLearningOutcomesTable).set({ description: "Revisión ficticia pendiente de confirmación" })
      .where(eq(moduleLearningOutcomesTable.moduleId, moduleId));
    expect((await save({ summary: "No publicar bajo otra fuente sin revisar" })).status).toBe(409);
    const previous = state.agreement.summary;
    expect((await save({ status: "archivado", summary: "No sobrescribir al retirar" })).status).toBe(200);
    expect(state.agreement.summary).toBe(previous);
    expect(await db.select().from(forumDigestEventsTable).where(and(
      eq(forumDigestEventsTable.moduleId, moduleId),
      eq(forumDigestEventsTable.eventKey, `agreement:${state.agreement.id}:${state.agreement.revision}`)))).toHaveLength(1);
    const hidden = await request(app).get("/api/forum/collaboration-tracking").set(authHeader(teacher.token));
    expect(hidden.body.modules).toEqual([]);
    await db.update(forumCollaborationsTable).set({ enabled: false }).where(eq(forumCollaborationsTable.moduleId, moduleId));
    const tracking = await request(app).get("/api/forum/collaboration-tracking").set(authHeader(admin.token));
    const row = tracking.body.modules.find((m: any) => m.id === moduleId);
    expect(row.reviewNeeded).toBe(true);
    expect(row.enabled).toBe(false);
    expect(row.publishedVersions).toBe(1);
  });
});
