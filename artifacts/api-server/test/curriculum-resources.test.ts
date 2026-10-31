import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, centersTable, modulesTable, trainingOfferTable, moduleLearningOutcomesTable, moduleEvaluationCriteriaTable,
  teachingAssignmentsTable, resourcesTable, resourceCurriculumTable, forumCollaborationsTable, forumCollaborationRevisionsTable,
  wikiPagesTable, wikiAttachmentsTable } from "@workspace/db";
import app from "../src/app";
import { getActiveAcademicYear } from "../src/lib/settings";
import { canonicalResourceUrl } from "../src/routes/curriculumResources";
import { authorizedCurriculumResources } from "../src/lib/resourceCurriculumAccess";
import { createUser, createProvince, createCenter, createModule, authHeader, cleanup, restoreTestFixtures, snapshotTestFixtures } from "./helpers";

const stamp = `curriculum-resource-${Date.now()}`;
let admin: Awaited<ReturnType<typeof createUser>>, teacher: typeof admin, outsider: typeof admin;
let moduleId: number, otherModule: number, ra: number, ra2: number, ce: number, foreignRA: number, fingerprint: string;
let resourceId: number, legacyId: number, wikiPage: number, wikiAttachment: number, protectedId: number;
const ids: number[] = [];
let createdResources: number[] = [];
const base = () => ({ revision: 0, fingerprint, license: "CC BY-SA 4.0", version: "1.0",
  audience: "teachers", restricted: false, archived: false, rightsConfirmed: true,
  targets: [{ outcomeId: ra, criterionId: null }, { outcomeId: ra2, criterionId: ce }] });
const newBody = (suffix: string) => ({ ...base(), title: `Material ficticio ${stamp}`, type: "Material de aula",
  description: "Solo prueba, sin datos de alumnado.", fileUrl: `https://example.test/${stamp}/${suffix}` });
const url = (id = moduleId) => `/api/forum/modules/${id}/resources`;

beforeAll(async () => {
  admin = await createUser({ role: "superadmin" });
  teacher = await createUser({ role: "teacher" });
  outsider = await createUser({ role: "teacher" });
  const centerId = await createCenter(await createProvince(stamp));
  await db.update(centersTable).set({ families: ["Administración y Gestión"] }).where(eq(centersTable.id, centerId));
  for (let i = 0; i < 2; i++) {
    const cycleName = `${stamp}-${i}`;
    const id = await createModule({ code: `${stamp}-${i}`, name: `ENSAYO ${stamp}`, cycleName });
    ids.push(id);
    await db.insert(trainingOfferTable).values({ centerId, cycleName });
  }
  [moduleId, otherModule] = ids;
  const [first, second, foreign] = await db.insert(moduleLearningOutcomesTable).values([
    { moduleId, code: "RA1", description: "Resultado de ensayo uno" },
    { moduleId, code: "RA2", description: "Resultado de ensayo dos" },
    { moduleId: otherModule, code: "RA1", description: "Otro currículo" },
  ]).returning();
  ra = first.id; ra2 = second.id; foreignRA = foreign.id;
  const criteria = await db.insert(moduleEvaluationCriteriaTable).values([
    { outcomeId: ra, code: "a", description: "Criterio ficticio" },
    { outcomeId: ra2, code: "a", description: "Segundo criterio ficticio" },
  ]).returning();
  ce = criteria[1].id;
  await db.insert(teachingAssignmentsTable).values({ teacherId: teacher.user.id, centerId, moduleId, schoolYear: await getActiveAcademicYear() });
  const state = (await request(app).get(`/api/forum/modules/${moduleId}/collaboration`).set(authHeader(admin.token))).body;
  fingerprint = state.fingerprint;
  const reviewed = await request(app).put(`/api/forum/modules/${moduleId}/collaboration`).set(authHeader(admin.token)).send({
    revision: 0, fingerprint, enabled: true, officialCode: state.moduleCode, sourceTitle: "SOLO ENSAYO",
    sourceUrl: "https://www.boe.es/buscar/act.php?id=TEST", curriculumVersion: "ENSAYO-1",
    territory: "Canarias", confirmReviewed: true, sections: state.sections,
  });
  expect(reviewed.status).toBe(200);
  const [legacy] = await db.insert(resourcesTable).values({ title: `Recurso anterior ${stamp}`, type: "Documento", fileUrl: "https://example.test/legacy",
    authorId: admin.user.id, centerId: null }).returning();
  legacyId = legacy.id; createdResources.push(legacyId);
});

afterAll(async () => {
  // Track every test URL even when an assertion aborts before saving its ID.
  const all = await db.select({ id: resourcesTable.id }).from(resourcesTable);
  const ours = await db.select({ id: resourcesTable.id }).from(resourcesTable).where(inArray(resourcesTable.moduleId, ids));
  createdResources = [...new Set([...createdResources, ...ours.map(r => r.id)])].filter(id => all.some(r => r.id === id));
  if (createdResources.length) {
    await db.delete(resourceCurriculumTable).where(inArray(resourceCurriculumTable.resourceId, createdResources));
    await db.delete(resourcesTable).where(inArray(resourcesTable.id, createdResources));
  }
  if (wikiPage) {
    await db.delete(wikiAttachmentsTable).where(eq(wikiAttachmentsTable.pageId, wikiPage));
    await db.delete(wikiPagesTable).where(eq(wikiPagesTable.id, wikiPage));
  }
  if (ids.length) {
    await db.delete(forumCollaborationRevisionsTable).where(inArray(forumCollaborationRevisionsTable.moduleId, ids));
    await db.delete(forumCollaborationsTable).where(inArray(forumCollaborationsTable.moduleId, ids));
  }
  restoreTestFixtures({ ...snapshotTestFixtures(), schoolYears: [] });
  await cleanup();
});

describe.sequential("ADG resource associations, existing library and protected solutions", () => {
  it("publishes one canonical resource with several real targets, no cartesian copies", async () => {
    const result = await request(app).post(url()).set(authHeader(teacher.token)).send(newBody("canonical"));
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    resourceId = result.body.id; createdResources.push(resourceId);
    expect(result.body.curriculum.targets).toHaveLength(2);
    expect(result.body.curriculum.originCenterId).toBe(teacher.user.centerId);
    expect(result.body.originalAuthorName).toBe(teacher.user.name);
    const list = await request(app).get("/api/resources").query({ moduleId, outcomeId: ra2, criterionId: ce }).set(authHeader(teacher.token));
    expect(list.body.map((r: { id: number }) => r.id)).toEqual([resourceId]);
    const wrong = await request(app).get("/api/resources").query({ criterionId: ce, outcomeId: ra }).set(authHeader(teacher.token));
    expect(wrong.body).toEqual([]);
  });
  it("does not leak tagged resources through legacy list or AI discovery to unassigned teachers", async () => {
    expect((await request(app).get(url()).set(authHeader(outsider.token))).status).toBe(403);
    const legacy = await request(app).get("/api/resources").set(authHeader(outsider.token));
    expect(legacy.body.some((r: { id: number }) => r.id === resourceId)).toBe(false);
    expect(legacy.body.some((r: { id: number }) => r.id === legacyId)).toBe(true);
    const [row] = await db.select().from(resourcesTable).where(eq(resourcesTable.id, resourceId));
    expect(await authorizedCurriculumResources([row], outsider.user)).toEqual([]);
    expect((await request(app).put(`${url()}/${resourceId}`).set(authHeader(outsider.token)).send(base())).status).toBe(403);
  });
  it("rejects mismatched RA/CE, other curricula, duplicate targets and unverified modules", async () => {
    for (const targets of [[{ outcomeId: ra, criterionId: ce }], [{ outcomeId: foreignRA, criterionId: null }],
      [{ outcomeId: ra, criterionId: null }, { outcomeId: ra, criterionId: null }]]) {
      expect((await request(app).post(url()).set(authHeader(admin.token)).send({ ...newBody("invalid"), targets })).status).toBe(400);
    }
    expect((await request(app).post(url(otherModule)).set(authHeader(admin.token)).send(newBody("unreviewed"))).status).toBe(409);
  });
  it("detects duplicate canonical URI and serializes concurrent creation", async () => {
    expect((await request(app).post(url()).set(authHeader(teacher.token)).send({ ...newBody("canonical"), fileUrl: newBody("canonical").fileUrl + "#page=2" })).status).toBe(409);
    const both = await Promise.all([1, 2].map(() => request(app).post(url()).set(authHeader(teacher.token)).send(newBody("concurrent"))));
    expect(both.map(r => r.status).sort()).toEqual([201, 409]);
    for (const r of both) if (r.status === 201) createdResources.push(r.body.id);
    const alias = await request(app).post("/api/resources").set(authHeader(outsider.token)).send({
      title: "No permitir un alias sin las restricciones", type: "Enlace", fileUrl: newBody("canonical").fileUrl + "#otro",
    });
    expect(alias.status).toBe(409);
  });
  it("updates associations without changing canonical bytes, checks revision and retains legacy source", async () => {
    const update = await request(app).put(`${url()}/${resourceId}`).set(authHeader(teacher.token)).send({ ...base(), revision: 1, version: "1.1", targets: [{ outcomeId: ra2, criterionId: ce }] });
    expect(update.status).toBe(200);
    expect(update.body.fileUrl).toBe(newBody("canonical").fileUrl);
    expect(update.body.curriculum.revision).toBe(2);
    expect((await request(app).put(`${url()}/${resourceId}`).set(authHeader(teacher.token)).send({ ...base(), revision: 1 })).status).toBe(409);
    const link = await request(app).put(`${url()}/${legacyId}`).set(authHeader(admin.token)).send(base());
    expect(link.status, JSON.stringify(link.body)).toBe(200);
    expect(link.body.fileUrl).toBe("https://example.test/legacy");
    expect(link.body.id).toBe(legacyId);
  });
  it("only allows protected module-wiki attachments as restricted solution references", async () => {
    expect((await request(app).post(url()).set(authHeader(teacher.token)).send({ ...newBody("solution-public"), restricted: true })).status).toBe(400);
    const [page] = await db.insert(wikiPagesTable).values({ moduleId, title: "ENSAYO solución protegida", createdBy: admin.user.id, updatedBy: admin.user.id }).returning();
    wikiPage = page.id;
    const [attachment] = await db.insert(wikiAttachmentsTable).values({ pageId: wikiPage, fileName: "ensayo.pdf", contentType: "application/pdf",
      size: 20, objectPath: `/objects/uploads/${stamp}.pdf`, uploadedBy: admin.user.id }).returning();
    wikiAttachment = attachment.id;
    const result = await request(app).post(url()).set(authHeader(admin.token)).send({ ...newBody("unused"), restricted: true,
      fileUrl: `/api/wiki/attachments/${wikiAttachment}/download` });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    protectedId = result.body.id; createdResources.push(protectedId);
    expect(result.body.curriculum.restricted).toBe(true);
    expect((await request(app).post(url()).set(authHeader(admin.token)).send({ ...newBody("invalid-students"), restricted: true, audience: "students" })).status).toBe(400);
    expect((await request(app).get("/api/resources").set(authHeader(outsider.token))).body.some((r: { id: number }) => r.id === protectedId)).toBe(false);
  });
  it("rejects bearer/signed links and unsafe sources; Nextcloud outage cannot duplicate bytes", async () => {
    for (const value of ["http://example.test/a", "https://example.test/a?access_token=secret", "https://example.test/s/secret",
      "/objects/uploads/public.pdf", "javascript:alert(1)", "https://u:p@example.test/a"]) expect(() => canonicalResourceUrl(value)).toThrow();
    const result = await request(app).post(url()).set(authHeader(teacher.token)).send({ ...newBody("unused"), fileUrl: `https://unavailable.example.test/index.php/f/${Date.now()}` });
    expect(result.status).toBe(201);
    createdResources.push(result.body.id);
    expect(result.body.fileUrl).toContain("/index.php/f/");
    // Metadata only: no Nextcloud requests, folders, uploads or copied file bytes.
  });
  it("archives even after curricular changes and never revives via generic library or AI", async () => {
    await db.update(moduleLearningOutcomesTable).set({ description: "Currículo cambiado durante el ensayo" }).where(eq(moduleLearningOutcomesTable.id, ra));
    expect((await request(app).post(url()).set(authHeader(teacher.token)).send(newBody("stale"))).status).toBe(409);
    const retired = await request(app).put(`${url()}/${resourceId}`).set(authHeader(teacher.token)).send({ ...base(), revision: 2, archived: true });
    expect(retired.status).toBe(200);
    expect(retired.body.curriculum.archived).toBe(true);
    const listed = (await request(app).get("/api/resources").set(authHeader(teacher.token))).body;
    expect(listed.some((r: { id: number }) => r.id === resourceId)).toBe(false);
    const all = (await request(app).get(url()).set(authHeader(teacher.token))).body;
    expect(all.find((r: { id: number }) => r.id === resourceId).curriculum.archived).toBe(true);
    expect((await request(app).put(`${url()}/${resourceId}`).set(authHeader(teacher.token)).send({ ...base(), revision: 3, archived: false })).status).toBe(409);
  });
});
