import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db, cyclesTable, modulesTable, moduleLearningOutcomesTable, moduleEvaluationCriteriaTable,
  forumCollaborationsTable, forumCollaborationRevisionsTable, forumCurriculumFingerprint,
} from "@workspace/db";
import { seedLearningOutcomesCatalog } from "../../../scripts/src/lib/seed-learning-outcomes";

const baseline = JSON.parse(readFileSync(new URL("../../../scripts/src/data/learning-outcomes-adg.json", import.meta.url), "utf8"));
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function rolledBack(check: (tx: Tx) => Promise<void>) {
  const rollback = new Error("Rollback test-only curriculum fixtures");
  try {
    await db.transaction(async tx => { await check(tx); throw rollback; });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function fixture(tx: Tx) {
  const level = `TEST-RA-CE-${Date.now()}-${Math.random()}`;
  const canonicalName = "Técnico en Gestión Administrativa";
  const [canonical, legacy] = await tx.insert(cyclesTable).values([
    { name: canonicalName, level }, { name: "Gestión Administrativa", level },
  ]).returning();
  const [current, old] = await tx.insert(modulesTable).values([
    { name: level, cycleId: canonical.id, code: null },
    { name: level, cycleId: legacy.id, code: "OLD-TEST-CODE" },
  ]).returning();
  const source = {
    cycle: canonicalName, level, code: "VERIFIED-TEST-CODE", name: level,
    outcomes: [{ code: "RA1", description: "Resultado SOLO de ensayo", order: 1, sources: [],
      criteria: [{ code: "1.a", description: "Criterio SOLO de ensayo", order: 1 }] }],
  };
  const catalog = { ...baseline, verifiedModuleCount: 1, resolvedIncidentCount: 1,
    includedModuleCount: 2, modulesWithCurriculum: 1,
    emptyModules: [{ cycle: canonicalName, name: "Tutoría" }], modules: [source] };
  const sources = [{ cycle: source.cycle, name: source.name, code: source.code,
    sourceTitle: "Fuente SOLO de ensayo", sourceUrl: "https://www.boe.es/buscar/act.php?id=TEST",
    curriculumVersion: "Versión SOLO de ensayo", territory: "Canarias",
    verifiedAt: "2026-10-31T00:00:00.000Z" }];
  return { current, old, source, catalog, sources };
}

describe("Verified curriculum on legacy cycle records", () => {
  it("fills the existing legacy ID, corrects its code, and is idempotent", async () => {
    await rolledBack(async tx => {
      const f = await fixture(tx);
      const first = await seedLearningOutcomesCatalog(tx, f.catalog, f.sources);
      expect(first.outcomesInserted).toBe(2);
      expect(first.criteriaInserted).toBe(2);
      expect(first.moduleCodesUpdated).toBe(2);
      expect(first.curriculumSourcesImported).toBe(2);
      const [old] = await tx.select().from(modulesTable).where(eq(modulesTable.id, f.old.id));
      expect(old.code).toBe(f.source.code);
      expect(old.cycleId).toBe(f.old.cycleId);
      const outcomes = await tx.select().from(moduleLearningOutcomesTable).where(eq(moduleLearningOutcomesTable.moduleId, f.old.id));
      expect(outcomes).toHaveLength(1);
      const [config] = await tx.select().from(forumCollaborationsTable).where(eq(forumCollaborationsTable.moduleId, f.old.id));
      const criteria = await tx.select().from(moduleEvaluationCriteriaTable)
        .where(eq(moduleEvaluationCriteriaTable.outcomeId, outcomes[0].id));
      expect(config.enabled).toBe(false);
      expect(config.verifiedBy).toBeNull();
      expect(config.sourceUrl).toBe(f.sources[0].sourceUrl);
      expect(config.curriculumVersion).toBe(f.sources[0].curriculumVersion);
      expect(config.fingerprint).toBe(forumCurriculumFingerprint(old, outcomes, criteria));
      const [revision] = await tx.select().from(forumCollaborationRevisionsTable)
        .where(eq(forumCollaborationRevisionsTable.moduleId, f.old.id));
      expect(revision.actorId).toBeNull();
      expect(revision.configuration.provenance).toMatchObject({ kind: "user_verified_spreadsheet" });
      const second = await seedLearningOutcomesCatalog(tx, f.catalog, f.sources);
      expect(second.outcomesInserted).toBe(0);
      expect(second.criteriaInserted).toBe(0);
      expect(second.moduleCodesUpdated).toBe(0);
      expect(second.curriculumSourcesImported).toBe(0);
      expect(second.curriculumSourceReport.find(r => r.moduleId === f.old.id)?.reasons.map(r => r.code))
        .toContain("previous_review");
      await tx.update(forumCollaborationsTable).set({ sourceTitle: "Revisión humana posterior", enabled: true })
        .where(eq(forumCollaborationsTable.moduleId, f.old.id));
      await seedLearningOutcomesCatalog(tx, f.catalog, f.sources);
      const [preserved] = await tx.select().from(forumCollaborationsTable).where(eq(forumCollaborationsTable.moduleId, f.old.id));
      expect(preserved.sourceTitle).toBe("Revisión humana posterior");
      expect(preserved.enabled).toBe(true);
    });
  });

  it("preserves manually edited RA and leaves the module code untouched on conflict", async () => {
    await rolledBack(async tx => {
      const f = await fixture(tx);
      await tx.insert(moduleLearningOutcomesTable).values({
        moduleId: f.old.id, code: "RA1", description: "Edición humana SOLO de ensayo", order: 1,
      });
      const result = await seedLearningOutcomesCatalog(tx, f.catalog, f.sources);
      expect(result.modulesSkipped).toBe(1);
      expect(result.curriculumSourceReport.find(r => r.moduleId === f.old.id)?.reasons.map(r => r.code))
        .toContain("local_curriculum");
      const [old] = await tx.select().from(modulesTable).where(eq(modulesTable.id, f.old.id));
      expect(old.code).toBe("OLD-TEST-CODE");
      const [ra] = await tx.select().from(moduleLearningOutcomesTable).where(eq(moduleLearningOutcomesTable.moduleId, f.old.id));
      expect(ra.description).toBe("Edición humana SOLO de ensayo");
      const criteria = await tx.select().from(moduleEvaluationCriteriaTable).where(eq(moduleEvaluationCriteriaTable.outcomeId, ra.id));
      expect(criteria).toHaveLength(0);
      expect(await tx.select().from(forumCollaborationsTable).where(eq(forumCollaborationsTable.moduleId, f.old.id))).toHaveLength(0);
    });
  });

  it("does not reuse a code already occupied within the same cycle", async () => {
    await rolledBack(async tx => {
      const f = await fixture(tx);
      await tx.insert(modulesTable).values({ name: "Otro módulo SOLO de ensayo",
        cycleId: f.old.cycleId, code: f.source.code });
      const result = await seedLearningOutcomesCatalog(tx, f.catalog);
      expect(result.modulesSkipped).toBe(1);
      expect(result.warnings.join(" ")).toContain("otro módulo del mismo ciclo");
      expect(await tx.select().from(moduleLearningOutcomesTable).where(eq(moduleLearningOutcomesTable.moduleId, f.old.id))).toHaveLength(0);
    });
  });

  it("does not verify extra local outcomes merely because expected rows match", async () => {
    await rolledBack(async tx => {
      const f = await fixture(tx);
      await tx.insert(moduleLearningOutcomesTable).values({
        moduleId: f.old.id, code: "RA-LOCAL", description: "Ampliación local SOLO de ensayo", order: 9,
      });
      const result = await seedLearningOutcomesCatalog(tx, f.catalog, f.sources);
      expect(result.curriculumSourceReport.find(r => r.moduleId === f.old.id)?.reasons.map(r => r.code))
        .toContain("local_curriculum");
      expect(await tx.select().from(forumCollaborationsTable)
        .where(eq(forumCollaborationsTable.moduleId, f.old.id))).toHaveLength(0);
    });
  });

  it("reports absent verified codes without inventing a source or revision", async () => {
    await rolledBack(async tx => {
      const f = await fixture(tx);
      f.source.code = "";
      f.sources[0].code = "";
      const result = await seedLearningOutcomesCatalog(tx, f.catalog, f.sources);
      expect(result.curriculumSourcesImported).toBe(0);
      expect(result.curriculumSourceReport.find(r => r.moduleId === f.current.id)?.reasons.map(r => r.code))
        .toContain("missing_code");
      expect(await tx.select().from(forumCollaborationsTable)
        .where(eq(forumCollaborationsTable.moduleId, f.current.id))).toHaveLength(0);
      expect(await tx.select().from(forumCollaborationRevisionsTable)
        .where(eq(forumCollaborationRevisionsTable.moduleId, f.current.id))).toHaveLength(0);
      const [current] = await tx.select().from(modulesTable).where(eq(modulesTable.id, f.current.id));
      expect(current.code).toBeNull();
    });
  });
});
