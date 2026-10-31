import { and, eq, isNull } from "drizzle-orm";
import {
  db, modulesTable, moduleLearningOutcomesTable, moduleEvaluationCriteriaTable,
  forumCollaborationsTable, forumCollaborationRevisionsTable,
  forumCurriculumFingerprint, defaultProgrammingSections,
  curriculumImportReasons, type CurriculumImportReason,
} from "@workspace/db";
import { sql } from "drizzle-orm";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type VerifiedForumSource = {
  cycle: string; name: string; code: string;
  sourceTitle: string; sourceUrl: string; curriculumVersion: string;
  territory: string; verifiedAt: string;
};
type Candidate = {
  moduleId: number;
  source: {
    cycle: string; name: string; code: string;
    outcomes: { code: string; description: string; order: number;
      criteria: { code: string; description: string; order: number }[] }[];
  };
};

// The spreadsheet has already been reviewed by the user. Record its provenance
// without impersonating a local user, enabling pilots, or overwriting reviews.
export async function seedVerifiedForumSources(
  tx: Transaction, candidates: Candidate[], sources: VerifiedForumSource[],
  report: { moduleId: number; reasons: CurriculumImportReason[] }[] = [],
): Promise<number> {
  let imported = 0;
  for (const candidate of candidates) {
    const source = sources.find(s => s.cycle === candidate.source.cycle
      && s.name === candidate.source.name && s.code === candidate.source.code);
    if (!source?.code) {
      report.push({ moduleId: candidate.moduleId, reasons: [{
        code: !candidate.source.code?.trim() ? "missing_code" : "missing_source",
        message: !candidate.source.code?.trim()
          ? "Falta el código oficial en la hoja revisada. No se hereda la fuente por nombre; se mantiene pendiente."
          : "No hay una fuente con código oficial para esta identidad en la hoja revisada; se mantiene pendiente.",
      }] });
      continue;
    }
    if (!source.sourceTitle || !source.curriculumVersion || !source.territory
      || !/^https:\/\/(www\.)?(boe\.es|gobiernodecanarias\.org)\//.test(source.sourceUrl)
      || !Number.isFinite(Date.parse(source.verifiedAt))) {
      throw new Error(`Fuente curricular verificada incompleta: ${candidate.source.name}`);
    }
    await tx.execute(sql`select pg_advisory_xact_lock(1947, ${candidate.moduleId})`);
    const [existing] = await tx.select({ id: forumCollaborationsTable.moduleId })
      .from(forumCollaborationsTable).where(eq(forumCollaborationsTable.moduleId, candidate.moduleId));
    const [module] = await tx.select().from(modulesTable).where(eq(modulesTable.id, candidate.moduleId));
    if (!module || module.deletedAt) continue;
    const outcomes = await tx.select().from(moduleLearningOutcomesTable)
      .where(and(eq(moduleLearningOutcomesTable.moduleId, module.id), isNull(moduleLearningOutcomesTable.deletedAt)));
    const criteria = await tx.select({
      id: moduleEvaluationCriteriaTable.id, outcomeId: moduleEvaluationCriteriaTable.outcomeId,
      code: moduleEvaluationCriteriaTable.code, description: moduleEvaluationCriteriaTable.description,
      order: moduleEvaluationCriteriaTable.order,
    }).from(moduleEvaluationCriteriaTable)
      .innerJoin(moduleLearningOutcomesTable, eq(moduleLearningOutcomesTable.id, moduleEvaluationCriteriaTable.outcomeId))
      .where(and(eq(moduleLearningOutcomesTable.moduleId, module.id),
        isNull(moduleLearningOutcomesTable.deletedAt), isNull(moduleEvaluationCriteriaTable.deletedAt)));
    const reasons = curriculumImportReasons(module, candidate.source, outcomes, criteria, !!existing);
    if (reasons.length) {
      report.push({ moduleId: module.id, reasons });
      continue;
    }
    const values = {
      moduleId: module.id, enabled: false, officialCode: source.code,
      sourceTitle: source.sourceTitle, sourceUrl: source.sourceUrl,
      curriculumVersion: source.curriculumVersion, territory: source.territory,
      fingerprint: forumCurriculumFingerprint(module, outcomes, criteria),
      revision: 1, sections: defaultProgrammingSections,
      verifiedBy: null, verifiedAt: new Date(source.verifiedAt),
    };
    const created = await tx.insert(forumCollaborationsTable).values(values)
      .onConflictDoNothing().returning({ id: forumCollaborationsTable.moduleId });
    if (!created.length) continue;
    await tx.insert(forumCollaborationRevisionsTable).values({
      moduleId: module.id, revision: 1, actorId: null,
      configuration: { ...values, verifiedAt: source.verifiedAt,
        curriculum: { module, outcomes, criteria },
        provenance: { kind: "user_verified_spreadsheet", workbook: "modulos-administracion-gestion-ra-ce-revisados.xlsx",
          note: "Fuente curricular confirmada por el usuario; importación sin activar el piloto." } },
    });
    imported++;
  }
  return imported;
}
