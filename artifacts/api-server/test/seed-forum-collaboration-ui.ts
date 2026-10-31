// Development-only browser fixture. Run again with --cleanup after the browser.
import { writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { db, pool, centersTable, usersTable, modulesTable, provincesTable, trainingOfferTable, moduleLearningOutcomesTable, moduleEvaluationCriteriaTable,
  forumThreadsTable, forumPostsTable, forumThreadReadsTable, forumThreadContextsTable,
  forumCollaborationRevisionsTable, forumCollaborationsTable } from "@workspace/db";
import { resourcesTable, resourceCurriculumTable, wikiPagesTable, wikiAttachmentsTable, forumAgreementsTable, forumAgreementRevisionsTable, teachingAssignmentsTable } from "@workspace/db";
import { eq, ilike, inArray } from "drizzle-orm";
import { createUser, createProvince, createCenter, createModule, cleanup, snapshotTestFixtures, restoreTestFixtures } from "./helpers";
import request from "supertest";
import app from "../src/app";
import { getActiveAcademicYear } from "../src/lib/settings";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Development fixtures only");
const file = "/tmp/coordina-forum-ui.json";
let moduleId: number | undefined;
let createdWikiPage: number | undefined;
let agreementThreadId: number | undefined;
let consultationThreadId: number | undefined;
let teacherCredentials: { email: string; password: string } | undefined;
if (process.argv.includes("--cleanup")) {
  const saved = JSON.parse(readFileSync(file, "utf8"));
  let snapshot = saved.cleanupState;
  // Compatibility with the first fixture file, which did not persist its IDs.
  if (!snapshot) {
    const marker = String(saved.email).replace(/-u\d+@example\.test$/, "");
    if (!/^vitest-\d+-\d+$/.test(marker)) throw new Error("Invalid temporary fixture marker");
    const users = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, saved.email));
    const modules = await db.select({ id: modulesTable.id }).from(modulesTable).where(ilike(modulesTable.name, `%${marker}%`));
    const centers = await db.select({ id: centersTable.id }).from(centersTable).where(ilike(centersTable.name, `%${marker}%`));
    const provinces = await db.select({ id: provincesTable.id }).from(provincesTable).where(ilike(provincesTable.name, `%${marker}%`));
    snapshot = { ...snapshotTestFixtures(), userIds: users.map(r => r.id), moduleIds: [...new Set([saved.moduleId, ...modules.map(r => r.id)])],
      centerIds: centers.map(r => r.id), provinceIds: provinces.map(r => r.id) };
  }
  // No global academic-year actions are exercised by this browser fixture.
  // Restrict cleanup to its own users/centers, not all confirmations that year.
  restoreTestFixtures({ ...snapshot, schoolYears: [] });
  for (const id of snapshot.moduleIds) await db.delete(forumAgreementsTable).where(eq(forumAgreementsTable.moduleId, id));
  const pages = await db.select({ id: wikiPagesTable.id }).from(wikiPagesTable).where(inArray(wikiPagesTable.createdBy, snapshot.userIds));
  if (pages.length) {
    await db.delete(wikiAttachmentsTable).where(inArray(wikiAttachmentsTable.pageId, pages.map(p => p.id)));
    await db.delete(wikiPagesTable).where(inArray(wikiPagesTable.id, pages.map(p => p.id)));
  }
  for (const id of snapshot.moduleIds) {
    const resources = await db.select({ id: resourcesTable.id }).from(resourcesTable).where(eq(resourcesTable.moduleId, id));
    if (resources.length) {
      await db.delete(resourceCurriculumTable).where(inArray(resourceCurriculumTable.resourceId, resources.map(r => r.id)));
      await db.delete(resourcesTable).where(inArray(resourcesTable.id, resources.map(r => r.id)));
    }
    const rows = await db.select({ id: forumThreadsTable.id }).from(forumThreadsTable).where(eq(forumThreadsTable.moduleId, id));
    const ids = rows.map(r => r.id);
    if (ids.length) {
      await db.delete(forumThreadContextsTable).where(inArray(forumThreadContextsTable.threadId, ids));
      await db.delete(forumThreadReadsTable).where(inArray(forumThreadReadsTable.threadId, ids));
      await db.delete(forumPostsTable).where(inArray(forumPostsTable.threadId, ids));
      await db.delete(forumThreadsTable).where(inArray(forumThreadsTable.id, ids));
    }
    await db.delete(forumCollaborationRevisionsTable).where(eq(forumCollaborationRevisionsTable.moduleId, id));
    await db.delete(forumCollaborationsTable).where(eq(forumCollaborationsTable.moduleId, id));
  }
  await cleanup();
  unlinkSync(file);
  await pool.end();
  console.log("Fixtures temporales eliminados.");
} else if (existsSync(file)) {
  console.log("Ya existen fixtures temporales; límpialos antes de crear otros.");
  await pool.end();
} else {
try {
  const admin = await createUser({ role: "superadmin", name: "Ensayo temporal de colaboración" });
  const centerId = await createCenter(await createProvince("Ensayo intercentros"));
  await db.update(centersTable).set({ families: ["Administración y Gestión"] }).where(eq(centersTable.id, centerId));
  const cycleName = `Ensayo intercentros ${Date.now()}`;
  moduleId = await createModule({ code: `TEST-${Date.now()}`, name: "ENSAYO · Colaboración ADG (datos ficticios)", cycleName });
  await db.insert(trainingOfferTable).values({ centerId, cycleName });
  const [ra] = await db.insert(moduleLearningOutcomesTable).values({ moduleId, code: "RA1", description: "Resultado ficticio para comprobar la interfaz, no curricular." }).returning();
  await db.insert(moduleEvaluationCriteriaTable).values({ outcomeId: ra.id, code: "a", description: "Criterio ficticio de ensayo, no oficial." });
  const [legacy] = await db.insert(forumThreadsTable).values({ moduleId, authorId: admin.user.id, title: "Debate anterior · prueba de conservación" }).returning();
  await db.insert(forumPostsTable).values({ threadId: legacy.id, authorId: admin.user.id, content: "Este mensaje temporal debe conservarse en Debates generales." });
  if (process.argv.includes("--curriculum") || process.argv.includes("--agreements")) {
    const path = `/api/forum/modules/${moduleId}/collaboration`;
    const state = (await request(app).get(path).set("Authorization", `Bearer ${admin.token}`)).body;
    const reviewed = await request(app).put(path).set("Authorization", `Bearer ${admin.token}`).send({
      revision: 0, fingerprint: state.fingerprint, enabled: true, officialCode: state.moduleCode,
      sourceTitle: "ENSAYO NO OFICIAL", sourceUrl: "https://www.boe.es/buscar/act.php?id=TEST-NO-OFICIAL",
      curriculumVersion: "ENSAYO-RECURSOS-1", territory: "Canarias (ensayo)", confirmReviewed: true, sections: state.sections,
    });
    if (reviewed.status !== 200) throw new Error("No se pudo preparar el piloto ficticio");
    const initialized = await request(app).post(`${path}/initialize`).set("Authorization", `Bearer ${admin.token}`).send({
      revision: reviewed.body.configuration.revision, fingerprint: reviewed.body.fingerprint,
    });
    if (initialized.status !== 200) throw new Error("No se pudieron preparar los hilos ficticios");
    if (process.argv.includes("--agreements")) {
      agreementThreadId = initialized.body.threads.find((thread: { kind: string }) => thread.kind === "programming_section")?.threadId;
      const teacher = await createUser({ role: "teacher", centerId, name: "Docente temporal de acuerdos" });
      await db.insert(teachingAssignmentsTable).values({ teacherId: teacher.user.id, moduleId, centerId, schoolYear: await getActiveAcademicYear() });
      teacherCredentials = { email: teacher.email, password: teacher.password };
      consultationThreadId = initialized.body.threads.find((thread: { kind: string }) => thread.kind === "material_ra")?.threadId;
      if (!consultationThreadId) throw new Error("Falta el hilo ficticio de consulta");
      // Metadata-only fixture: models a previously opened consultation whose
      // provider is now unavailable. Never reads or creates a remote document.
      const [consultation] = await db.insert(forumAgreementsTable).values({
        threadId: consultationThreadId, moduleId, status: "consulta", summary: "ENSAYO · Consulta ficticia de referencia",
        proposedText: "Documento ficticio para probar posturas. No es una programación ni un acuerdo real.",
        fingerprint: reviewed.body.fingerprint, curriculumVersion: "ENSAYO-RECURSOS-1",
        documentUrl: "https://nextcloud.example.invalid/index.php/f/1",
        sources: [{ title: "ENSAYO NO OFICIAL", url: "https://www.boe.es/buscar/act.php?id=TEST-NO-OFICIAL" }],
        electorateIds: [teacher.user.id, admin.user.id], createdBy: admin.user.id, updatedBy: admin.user.id,
      }).returning();
      const { electorateIds: _census, createdBy: _author, updatedBy: _editor, ...snapshot } = consultation;
      await db.insert(forumAgreementRevisionsTable).values({
        agreementId: consultation.id, revision: 1, version: 1, actorId: admin.user.id,
        snapshot: { agreement: { ...snapshot, responsibleId: admin.user.id, reviewerId: admin.user.id,
          updatedAt: consultation.updatedAt.toISOString() },
        participation: { teachers: 0, centers: 0, eligible: 2, limited: true, warning: "ENSAYO ficticio sin aprobación institucional." } },
      });
    }
    await db.insert(resourcesTable).values({ moduleId, title: "ENSAYO · Recurso anterior sin copiar", type: "Enlace",
      fileUrl: `https://example.test/${moduleId}/legacy`, authorId: admin.user.id, originalAuthorName: admin.user.name });
    const [page] = await db.insert(wikiPagesTable).values({ moduleId, title: "ENSAYO · Fuente del selector (sin archivos reales)",
      content: "Solo metadatos ficticios para comprobar selección de la fuente; no hay un PDF real.", createdBy: admin.user.id, updatedBy: admin.user.id }).returning();
    createdWikiPage = page.id;
    await db.insert(wikiAttachmentsTable).values({ pageId: page.id, fileName: "ENSAYO-sin-archivo-real.pdf", contentType: "application/pdf",
      size: 20, objectPath: `/objects/uploads/ensayo-inexistente-${moduleId}.pdf`, uploadedBy: admin.user.id });
  }
  writeFileSync(file, JSON.stringify({ email: admin.email, password: admin.password, moduleId, threadId: agreementThreadId, consultationThreadId,
    teacher: teacherCredentials, cleanupState: snapshotTestFixtures() }), { mode: 0o600 });
  console.log("Fixtures de interfaz listos; ejecutar este script con --cleanup al terminar.");
  await pool.end();
} catch (error) {
  if (moduleId) await db.delete(forumAgreementsTable).where(eq(forumAgreementsTable.moduleId, moduleId));
  if (createdWikiPage) {
    await db.delete(wikiAttachmentsTable).where(eq(wikiAttachmentsTable.pageId, createdWikiPage));
    await db.delete(wikiPagesTable).where(eq(wikiPagesTable.id, createdWikiPage));
  }
  if (moduleId) {
    const rows = await db.select({ id: forumThreadsTable.id }).from(forumThreadsTable).where(eq(forumThreadsTable.moduleId, moduleId));
    const ids = rows.map(r => r.id);
    if (ids.length) {
      await db.delete(forumThreadContextsTable).where(inArray(forumThreadContextsTable.threadId, ids));
      await db.delete(forumThreadReadsTable).where(inArray(forumThreadReadsTable.threadId, ids));
      await db.delete(forumPostsTable).where(inArray(forumPostsTable.threadId, ids));
      await db.delete(forumThreadsTable).where(inArray(forumThreadsTable.id, ids));
    }
    await db.delete(forumCollaborationRevisionsTable).where(eq(forumCollaborationRevisionsTable.moduleId, moduleId));
    await db.delete(forumCollaborationsTable).where(eq(forumCollaborationsTable.moduleId, moduleId));
  }
  await cleanup();
  try { unlinkSync(file); } catch { /* no fixture file if setup failed */ }
  await pool.end();
  throw error;
}
}
