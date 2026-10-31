import { Router } from "express";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  db, modulesTable, forumCollaborationsTable, forumThreadsTable, forumPostsTable,
  forumAgreementsTable, forumAgreementPositionsTable, forumAgreementRevisionsTable,
  moduleLearningOutcomesTable, moduleEvaluationCriteriaTable,
  resourceCurriculumTable, resourcesTable, wikiPagesTable,
} from "@workspace/db";
import type { ForumCollaborationTracking, ForumTrackingModule } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { getActiveAcademicYear, getActiveFamily } from "../lib/settings";
import { moduleFamilyFilter } from "../lib/familyCatalog";
import { moduleVisibleById } from "./forums";
import { structure } from "./forumCollaboration";
import { authorizedCurriculumResources } from "../lib/resourceCurriculumAccess";
import { agreementParticipants, REFERENCE_LEGEND } from "../lib/forumAgreementSupport";

const router = Router();
const FAMILY = "Administración y Gestión";

router.get("/forum/collaboration-tracking", requireAuth, async (req, res) => {
  if (await getActiveFamily() !== FAMILY) {
    res.status(403).json({ message: "El seguimiento intercentros se limita a Administración y Gestión." });
    return;
  }
  // Only configured pilots, never implicit activation of the whole catalogue.
  // No shared cache: assignments and restricted resources must be checked live.
  const candidates = await db.select({ id: modulesTable.id }).from(modulesTable)
    .innerJoin(forumCollaborationsTable, eq(forumCollaborationsTable.moduleId, modulesTable.id))
    .where(and(isNull(modulesTable.deletedAt), moduleFamilyFilter(FAMILY)))
    .orderBy(asc(modulesTable.cycleName), asc(modulesTable.name), asc(modulesTable.id));
  const moduleIds: number[] = [];
  for (const module of candidates) {
    if (await moduleVisibleById(req.user!, module.id)) moduleIds.push(module.id);
  }
  const result: ForumCollaborationTracking = {
    generatedAt: new Date(), academicYear: await getActiveAcademicYear(),
    family: FAMILY, legend: REFERENCE_LEGEND, providerCheck: "not_checked", modules: [],
    totals: { modules: moduleIds.length, enabled: 0, reviewNeeded: 0, participants: 0,
      centers: 0, resources: 0, publishedVersions: 0, openConsultations: 0 },
  };
  if (!moduleIds.length) { res.set("Cache-Control", "no-store").json(result); return; }
  const resourceRows = await db.select({ resource: resourcesTable }).from(resourcesTable)
    .innerJoin(resourceCurriculumTable, eq(resourceCurriculumTable.resourceId, resourcesTable.id))
    .where(and(inArray(resourceCurriculumTable.moduleId, moduleIds), isNull(resourcesTable.deletedAt)));
  const visibleResources = await authorizedCurriculumResources(resourceRows.map(r => r.resource), req.user!);
  const allParticipants = new Set<number>(), allCenters = new Set<number>();

  // Sequential, bounded queries avoid saturating the pool for large networks.
  for (const moduleId of moduleIds) {
    const state = await structure(db, moduleId, req.user!);
    const eligible = await agreementParticipants(moduleId);
    const eligibleIds = new Set(eligible.map(p => p.id));
    const eligibleCenters = new Set(eligible.flatMap(p => p.centers.map(c => c.id)));
    const planned = state.threads.filter(t => !t.archived);
    const created = planned.filter(t => t.threadId != null);
    const threadIds = created.map(t => t.threadId!);
    const outcomes = await db.select().from(moduleLearningOutcomesTable).where(and(
      eq(moduleLearningOutcomesTable.moduleId, moduleId), isNull(moduleLearningOutcomesTable.deletedAt)));
    const criteria = outcomes.length ? await db.select().from(moduleEvaluationCriteriaTable).where(and(
      inArray(moduleEvaluationCriteriaTable.outcomeId, outcomes.map(o => o.id)),
      isNull(moduleEvaluationCriteriaTable.deletedAt))) : [];
    const agreements = threadIds.length ? await db.select().from(forumAgreementsTable)
      .where(inArray(forumAgreementsTable.threadId, threadIds)) : [];
    const positions = agreements.length ? await db.select().from(forumAgreementPositionsTable)
      .where(inArray(forumAgreementPositionsTable.agreementId, agreements.map(a => a.id))) : [];
    const synthesisActions = agreements.length ? await db.select({
      actorId: forumAgreementRevisionsTable.actorId, createdAt: forumAgreementRevisionsTable.createdAt,
    }).from(forumAgreementRevisionsTable)
      .where(inArray(forumAgreementRevisionsTable.agreementId, agreements.map(a => a.id))) : [];
    const posts = threadIds.length ? await db.select({ id: forumPostsTable.id, threadId: forumPostsTable.threadId,
      authorId: forumPostsTable.authorId, createdAt: forumPostsTable.createdAt, deletedAt: forumPostsTable.deletedAt }).from(forumPostsTable)
      .where(inArray(forumPostsTable.threadId, threadIds)).orderBy(asc(forumPostsTable.id)) : [];
    const revisions = await db.select({ pageId: forumAgreementRevisionsTable.publishedPageId })
      .from(forumAgreementRevisionsTable)
      .innerJoin(forumAgreementsTable, eq(forumAgreementsTable.id, forumAgreementRevisionsTable.agreementId))
      .innerJoin(wikiPagesTable, eq(wikiPagesTable.id, forumAgreementRevisionsTable.publishedPageId))
      .where(and(eq(forumAgreementsTable.moduleId, moduleId), isNull(wikiPagesTable.deletedAt)));
    const currentPositions = positions.filter(p => agreements.some(a =>
      a.id === p.agreementId && a.version === p.version) && eligibleIds.has(p.userId));
    const participants = new Set<number>(), centers = new Set<number>();
    // The first post is the automatically generated prompt, not participation.
    // Include deleted prompts when identifying it, so deleting one cannot turn
    // the first genuine reply into a prompt.
    const seen = new Set<number>();
    const activity: Date[] = [];
    for (const post of posts) {
      const prompt = !seen.has(post.threadId); seen.add(post.threadId);
      if (!prompt && post.deletedAt == null && post.authorId != null && eligibleIds.has(post.authorId)) {
        participants.add(post.authorId); activity.push(post.createdAt);
      }
    }
    for (const a of agreements) {
      if (a.createdBy != null && eligibleIds.has(a.createdBy)) participants.add(a.createdBy);
      if (a.updatedBy != null && eligibleIds.has(a.updatedBy)) participants.add(a.updatedBy);
      activity.push(a.updatedAt);
    }
    for (const action of synthesisActions) {
      if (action.actorId != null && eligibleIds.has(action.actorId)) participants.add(action.actorId);
    }
    for (const p of currentPositions) {
      participants.add(p.userId); activity.push(p.updatedAt);
      // Count explicitly chosen, still-authorized centers; do not infer a
      // center vote from a teacher's multiple assignments or identical names.
      if (p.centerId != null && eligible.find(u => u.id === p.userId)?.centers.some(c => c.id === p.centerId)) centers.add(p.centerId);
    }
    for (const id of participants) allParticipants.add(id);
    for (const id of centers) allCenters.add(id);
    const materials = visibleResources.filter(r => r.curriculum?.moduleId === moduleId);
    const outcomeIds = new Set(outcomes.map(o => o.id));
    const covered = new Set(materials.flatMap(r => r.curriculum?.targets.map(t => t.outcomeId) ?? [])
      .filter(id => outcomeIds.has(id)));
    const row: ForumTrackingModule = {
      id: moduleId, code: state.moduleCode, name: state.moduleName, cycleName: state.cycleName,
      enabled: state.enabled, verificationCurrent: state.verificationCurrent,
      reviewNeeded: !state.verificationCurrent || state.diagnostics.length > 0,
      diagnostics: state.diagnostics, outcomes: outcomes.length, criteria: criteria.length,
      outcomesWithCriteria: new Set(criteria.map(c => c.outcomeId)).size,
      outcomesWithResources: covered.size, resources: materials.length,
      resourcesNeedingReview: materials.filter(r => r.curriculum?.fingerprint !== state.fingerprint ||
        r.curriculum?.curriculumVersion !== state.configuration?.curriculumVersion).length,
      plannedThreads: planned.length, createdThreads: created.length,
      participants: participants.size, centers: centers.size,
      eligibleParticipants: eligibleIds.size, eligibleCenters: eligibleCenters.size,
      publishedVersions: new Set(revisions.map(r => r.pageId)).size,
      lastActivityAt: activity.length ? new Date(activity.reduce((max, date) => Math.max(max, date.getTime()), 0)) : null,
      threads: created.map(t => {
        const a = agreements.find(a => a.threadId === t.threadId);
        return { id: t.threadId!, title: t.title, kind: t.kind, status: a?.status ?? "sin_sintesis",
          version: a?.version ?? null, publishedPageId: a?.publishedPageId ?? null };
      }),
    };
    result.modules.push(row);
    result.totals.enabled += Number(row.enabled);
    result.totals.reviewNeeded += Number(row.reviewNeeded);
    result.totals.resources += row.resources;
    result.totals.publishedVersions += row.publishedVersions;
    result.totals.openConsultations += row.threads.filter(t => t.status === "consulta").length;
  }
  result.totals.participants = allParticipants.size;
  result.totals.centers = allCenters.size;
  result.generatedAt = new Date();
  res.set("Cache-Control", "no-store").json(result);
});

export default router;
