import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db, cyclesTable, modulesTable, moduleLearningOutcomesTable, moduleEvaluationCriteriaTable,
  forumCollaborationsTable, forumCollaborationRevisionsTable, forumCurriculumFingerprint,
  defaultProgrammingSections, forumThreadContextsTable, forumThreadsTable, forumPostsTable,
} from "@workspace/db";
import { seedForumThreads } from "../../../scripts/src/lib/seed-forum-threads";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function rolledBack(check: (tx: Tx) => Promise<void>) {
  const rollback = new Error("Rollback deployment fixtures");
  try {
    await db.transaction(async tx => { await check(tx); throw rollback; });
  } catch (error) { if (error !== rollback) throw error; }
}

async function fixture(tx: Tx, family = "Administración y Gestión") {
  const key = `forum-deploy-${Date.now()}-${Math.random()}`;
  const [cycle] = await tx.insert(cyclesTable).values({
    name: family === "Administración y Gestión" ? "Técnico en Gestión Administrativa" : "Otra familia",
    level: key,
  }).returning();
  const [module] = await tx.insert(modulesTable).values({
    code: key, name: key, cycleId: cycle.id, cycleName: cycle.name,
  }).returning();
  const [outcome] = await tx.insert(moduleLearningOutcomesTable).values({
    moduleId: module.id, code: "RA1", description: "Resultado de prueba", order: 1,
  }).returning();
  const [criterion] = await tx.insert(moduleEvaluationCriteriaTable).values({
    outcomeId: outcome.id, code: "a", description: "Criterio de prueba", order: 1,
  }).returning();
  const config = {
    moduleId: module.id, enabled: false, officialCode: module.code!,
    sourceTitle: "Fuente verificada", sourceUrl: "https://www.boe.es/",
    curriculumVersion: "Prueba", territory: "Canarias", revision: 1,
    sections: defaultProgrammingSections, verifiedBy: null,
    fingerprint: forumCurriculumFingerprint(module, [outcome], [criterion]),
  };
  await tx.insert(forumCollaborationsTable).values(config);
  await tx.insert(forumCollaborationRevisionsTable).values({
    moduleId: module.id, revision: 1, actorId: null,
    configuration: { ...config, provenance: { kind: "user_verified_spreadsheet" } },
  });
  return { module, outcome, criterion };
}

describe("deployment initialization of verified module forums", () => {
  it("creates programming, RA and CE threads once and preserves edits and archived threads", async () => {
    await rolledBack(async tx => {
      const { module } = await fixture(tx);
      const first = await seedForumThreads(tx, [module.id]);
      const expected = defaultProgrammingSections.filter(s => s.enabled).length + 2;
      expect(first).toEqual({ activated: 1, threads: expected, skipped: [] });
      const contexts = await tx.select().from(forumThreadContextsTable)
        .where(eq(forumThreadContextsTable.moduleId, module.id));
      expect(contexts.map(c => c.kind)).toEqual(expect.arrayContaining(["programming_section", "material_ra", "material_ce"]));
      const threadId = contexts[0].threadId;
      await tx.update(forumThreadsTable).set({ title: "Edición humana", deletedAt: new Date() })
        .where(eq(forumThreadsTable.id, threadId));
      await tx.update(forumPostsTable).set({ content: "Respuesta conservada" })
        .where(eq(forumPostsTable.threadId, threadId));
      const second = await seedForumThreads(tx, [module.id]);
      expect(second).toEqual({ activated: 0, threads: 0, skipped: [] });
      const [thread] = await tx.select().from(forumThreadsTable).where(eq(forumThreadsTable.id, threadId));
      expect(thread.title).toBe("Edición humana");
      expect(thread.deletedAt).not.toBeNull();
      const [post] = await tx.select().from(forumPostsTable).where(eq(forumPostsTable.threadId, threadId));
      expect(post.content).toBe("Respuesta conservada");
    });
  });

  it("does not enable manual revisions or undo a deliberate deactivation", async () => {
    await rolledBack(async tx => {
      const { module } = await fixture(tx);
      await seedForumThreads(tx, [module.id]);
      await tx.update(forumCollaborationsTable).set({ enabled: false, revision: 3 })
        .where(eq(forumCollaborationsTable.moduleId, module.id));
      await tx.insert(forumCollaborationRevisionsTable).values({
        moduleId: module.id, revision: 3, actorId: null, configuration: { enabled: false },
      });
      const result = await seedForumThreads(tx, [module.id]);
      expect(result.threads).toBe(0);
      expect(result.skipped).toHaveLength(1);
      const [config] = await tx.select().from(forumCollaborationsTable).where(eq(forumCollaborationsTable.moduleId, module.id));
      expect(config.enabled).toBe(false);
      expect(config.revision).toBe(3);
    });
  });

  it("leaves changed curriculum and ambiguous module identities pending", async () => {
    await rolledBack(async tx => {
      const first = await fixture(tx);
      await tx.update(moduleLearningOutcomesTable).set({ description: "Texto local" })
        .where(eq(moduleLearningOutcomesTable.id, first.outcome.id));
      const second = await fixture(tx);
      await tx.insert(modulesTable).values({
        name: "Identidad duplicada", code: second.module.code, cycleId: second.module.cycleId,
      });
      const result = await seedForumThreads(tx, [first.module.id, second.module.id]);
      expect(result.activated).toBe(0);
      expect(result.threads).toBe(0);
      expect(result.skipped).toHaveLength(2);
    });
  });

  it("excludes other families and modules without a verified source", async () => {
    await rolledBack(async tx => {
      const other = await fixture(tx, "Otra familia");
      const pending = await fixture(tx);
      await tx.delete(forumCollaborationRevisionsTable).where(eq(forumCollaborationRevisionsTable.moduleId, pending.module.id));
      await tx.delete(forumCollaborationsTable).where(eq(forumCollaborationsTable.moduleId, pending.module.id));
      const result = await seedForumThreads(tx, [other.module.id, pending.module.id]);
      expect(result).toEqual({ activated: 0, threads: 0, skipped: [] });
      const contexts = await tx.select().from(forumThreadContextsTable)
        .where(and(eq(forumThreadContextsTable.moduleId, other.module.id)));
      expect(contexts).toHaveLength(0);
    });
  });

  it("keeps modules with missing criteria pending", async () => {
    await rolledBack(async tx => {
      const { module, criterion } = await fixture(tx);
      await tx.delete(moduleEvaluationCriteriaTable).where(eq(moduleEvaluationCriteriaTable.id, criterion.id));
      const result = await seedForumThreads(tx, [module.id]);
      expect(result.activated).toBe(0);
      expect(result.threads).toBe(0);
      expect(result.skipped).toHaveLength(1);
    });
  });

  it("fills a partial initialization without replacing existing topics", async () => {
    await rolledBack(async tx => {
      const { module } = await fixture(tx);
      const [thread] = await tx.insert(forumThreadsTable).values({
        moduleId: module.id, title: "Programación existente", authorId: null,
      }).returning();
      const section = defaultProgrammingSections.find(s => s.enabled)!;
      await tx.insert(forumThreadContextsTable).values({
        moduleId: module.id, threadId: thread.id, stableKey: section.key,
        kind: "programming_section", templateVersion: 1, curriculumVersion: "Prueba",
      });
      const result = await seedForumThreads(tx, [module.id]);
      expect(result.threads).toBe(defaultProgrammingSections.filter(s => s.enabled).length + 1);
      const [preserved] = await tx.select().from(forumThreadsTable).where(eq(forumThreadsTable.id, thread.id));
      expect(preserved.title).toBe("Programación existente");
    });
  });
});
