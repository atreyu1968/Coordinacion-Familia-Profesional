import { and, eq, isNull, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import {
  db, modulesTable, cyclesTable, forumCollaborationsTable,
  forumCollaborationRevisionsTable, forumThreadContextsTable,
  forumThreadsTable, forumPostsTable, moduleLearningOutcomesTable,
  moduleEvaluationCriteriaTable, forumCurriculumFingerprint, planForumThreads,
} from "@workspace/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ForumDeploymentStats = { activated: number; threads: number; skipped: string[] };
const catalog = JSON.parse(readFileSync(new URL("../data/learning-outcomes-adg.json", import.meta.url), "utf8")) as {
  family: string; modules: { cycle: string }[]; pendingManual: { cycle: string; name: string }[];
};
const aliases: Record<string, string> = {
  "Administración y Finanzas": "Técnico Superior en Administración y Finanzas",
  "Asistencia a la Dirección": "Técnico Superior en Asistencia a la Dirección",
  "Gestión Administrativa": "Técnico en Gestión Administrativa",
};
const familyCycles = new Set(catalog.modules.map(m => m.cycle));

// Only the untouched spreadsheet import (or a previous deployment activation)
// grants automatic initialization. A manual revision, even a deactivation, wins.
export async function seedForumThreads(tx: Transaction, moduleIds?: number[]): Promise<ForumDeploymentStats> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('coordina:adg-ra-ce-curriculum'))`);
  if (catalog.family !== "Administración y Gestión") throw new Error("Catálogo curricular de otra familia.");
  const stats: ForumDeploymentStats = { activated: 0, threads: 0, skipped: [] };
  const configs = await tx.select({ module: modulesTable, cycleName: cyclesTable.name })
    .from(forumCollaborationsTable)
    .innerJoin(modulesTable, eq(modulesTable.id, forumCollaborationsTable.moduleId))
    .innerJoin(cyclesTable, eq(cyclesTable.id, modulesTable.cycleId))
    .where(and(isNull(cyclesTable.deletedAt), isNull(modulesTable.deletedAt), isNull(modulesTable.centerId)));
  for (const row of configs) {
    const module = row.module;
    if (moduleIds && !moduleIds.includes(module.id)) continue;
    const cycleName = aliases[row.cycleName] ?? row.cycleName;
    if (!familyCycles.has(cycleName)) continue;
    if (catalog.pendingManual.some(m => m.cycle === cycleName && m.name === module.name)) {
      stats.skipped.push(`${module.code} · ${module.name}: incidencia pendiente de revisión manual`);
      continue;
    }
    await tx.execute(sql`select pg_advisory_xact_lock(1947, ${module.id})`);
    // Reread after acquiring the same lock used by the interactive editor.
    const [config] = await tx.select().from(forumCollaborationsTable)
      .where(eq(forumCollaborationsTable.moduleId, module.id));
    const [revision] = await tx.select().from(forumCollaborationRevisionsTable)
      .where(and(eq(forumCollaborationRevisionsTable.moduleId, module.id),
        eq(forumCollaborationRevisionsTable.revision, config.revision)));
    const provenance = revision?.configuration.provenance as { kind?: string } | undefined;
    const initial = config.revision === 1 && provenance?.kind === "user_verified_spreadsheet";
    const managed = provenance?.kind === "deployment_verified_forum";
    const skip = (reason: string) => stats.skipped.push(`${module.code} · ${module.name}: ${reason}`);
    if ((!initial && !managed) || config.verifiedBy != null || (managed && !config.enabled)) {
      skip("se conserva la configuración manual"); continue;
    }
    const outcomes = await tx.select().from(moduleLearningOutcomesTable)
      .where(and(eq(moduleLearningOutcomesTable.moduleId, module.id), isNull(moduleLearningOutcomesTable.deletedAt)));
    const criteria = await tx.select({
      id: moduleEvaluationCriteriaTable.id, outcomeId: moduleEvaluationCriteriaTable.outcomeId,
      code: moduleEvaluationCriteriaTable.code, description: moduleEvaluationCriteriaTable.description,
      order: moduleEvaluationCriteriaTable.order,
    }).from(moduleEvaluationCriteriaTable)
      .innerJoin(moduleLearningOutcomesTable, eq(moduleLearningOutcomesTable.id, moduleEvaluationCriteriaTable.outcomeId))
      .where(and(eq(moduleLearningOutcomesTable.moduleId, module.id), isNull(moduleLearningOutcomesTable.deletedAt),
        isNull(moduleEvaluationCriteriaTable.deletedAt)));
    const duplicates = await tx.select({ id: modulesTable.id }).from(modulesTable)
      .where(and(eq(modulesTable.cycleId, module.cycleId!), isNull(modulesTable.centerId),
        isNull(modulesTable.deletedAt),
        sql`upper(trim(${modulesTable.code})) = upper(trim(${module.code}))`));
    if (!module.code?.trim() || config.officialCode !== module.code || duplicates.length !== 1
      || !outcomes.length || outcomes.some(o => !criteria.some(c => c.outcomeId === o.id))
      || config.fingerprint !== forumCurriculumFingerprint(module, outcomes, criteria)) {
      skip("identidad ambigua o currículo pendiente/modificado; requiere revisión"); continue;
    }
    if (!config.enabled) {
      const values = { ...config, enabled: true, revision: config.revision + 1 };
      await tx.update(forumCollaborationsTable).set({ enabled: true, revision: values.revision })
        .where(eq(forumCollaborationsTable.moduleId, module.id));
      await tx.insert(forumCollaborationRevisionsTable).values({
        moduleId: module.id, revision: values.revision, actorId: null,
        configuration: { ...values, verifiedAt: values.verifiedAt.toISOString(),
          curriculum: { module, outcomes, criteria },
          provenance: { kind: "deployment_verified_forum",
            note: "Inicialización autorizada del currículo previamente verificado. No implica aprobación institucional." } },
      });
      config.revision = values.revision;
      stats.activated++;
    }
    // Contexts, including archived/deleted threads, reserve their stable keys.
    const contexts = await tx.select().from(forumThreadContextsTable)
      .where(eq(forumThreadContextsTable.moduleId, module.id));
    const existing = new Set(contexts.map(c => c.stableKey));
    for (const thread of planForumThreads(config.sections, outcomes, criteria)) {
      if (existing.has(thread.key)) continue;
      const [created] = await tx.insert(forumThreadsTable).values({
        moduleId: module.id, centerId: null, title: thread.title, authorId: null,
      }).returning();
      await tx.insert(forumPostsTable).values({ threadId: created.id, authorId: null, content: thread.content });
      await tx.insert(forumThreadContextsTable).values({
        threadId: created.id, moduleId: module.id, kind: thread.kind, stableKey: thread.key,
        outcomeId: thread.outcomeId, criterionId: thread.criterionId,
        templateVersion: config.revision, curriculumVersion: config.curriculumVersion,
      });
      existing.add(thread.key);
      stats.threads++;
    }
  }
  return stats;
}

