import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { seedVerifiedForumSources, type VerifiedForumSource } from "./seed-forum-curriculum";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  cyclesTable,
  db,
  moduleEvaluationCriteriaTable,
  moduleLearningOutcomesTable,
  modulesTable,
  type CurriculumImportReason,
  planCurriculumCode, planCurriculumRows,
} from "@workspace/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type CurriculumCriterion = {
  code: string;
  description: string;
  order: number;
};

type CurriculumOutcome = {
  code: string;
  description: string;
  order: number;
  sources: string[];
  criteria: CurriculumCriterion[];
};

type CurriculumModule = {
  cycle: string;
  level: string;
  code: string;
  name: string;
  outcomes: CurriculumOutcome[];
};

type CurriculumCatalog = {
  family: string;
  verifiedModuleCount: number;
  resolvedIncidentCount: number;
  includedModuleCount: number;
  modulesWithCurriculum: number;
  emptyModules: Array<{ cycle: string; name: string }>;
  pendingManual: Array<{ cycle: string; name: string; observation: string }>;
  ignoredOutOfFamily: Array<{ cycle: string; name: string; reason: string }>;
  resolvedIncidents: Array<{
    cycle: string;
    name: string;
    resolution: string;
    sourceUrl: string;
  }>;
  modules: CurriculumModule[];
};

type SeedStats = {
  verifiedModules: number;
  resolvedIncidents: number;
  includedModules: number;
  modulesWithCurriculum: number;
  emptyModules: number;
  pendingManual: number;
  ignoredOutOfFamily: number;
  modulesMatched: number;
  modulesSkipped: number;
  outcomesInserted: number;
  criteriaInserted: number;
  moduleCodesUpdated: number;
  curriculumSourcesImported: number;
  curriculumSourceReport: { moduleId: number; reasons: CurriculumImportReason[] }[];
  warnings: string[];
};

// Explicit curricular identities, not fuzzy name matching. Older installations
// use these short cycle titles; preserve their module IDs and relationships.
const legacyCycleNames: Record<string, string> = {
  "Técnico Superior en Administración y Finanzas": "Administración y Finanzas",
  "Técnico Superior en Asistencia a la Dirección": "Asistencia a la Dirección",
  "Técnico en Gestión Administrativa": "Gestión Administrativa",
};

const here = dirname(fileURLToPath(import.meta.url));
const catalogPath = join(here, "../data/learning-outcomes-adg.json");

function loadCatalog(): CurriculumCatalog {
  return JSON.parse(readFileSync(catalogPath, "utf8")) as CurriculumCatalog;
}

function validateCatalog(catalog: CurriculumCatalog): void {
  if (catalog.family !== "Administración y Gestión") {
    throw new Error("El catálogo RA/CE no corresponde a Administración y Gestión.");
  }
  if (catalog.includedModuleCount !== catalog.modules.length + catalog.emptyModules.length) {
    throw new Error("El recuento de módulos validados no coincide con el catálogo.");
  }
  if (catalog.includedModuleCount !== catalog.verifiedModuleCount + catalog.resolvedIncidentCount) {
    throw new Error("El recuento de incidencias resueltas no coincide con el catálogo.");
  }
  if (catalog.modulesWithCurriculum !== catalog.modules.length) {
    throw new Error("El recuento de módulos con RA/CE no coincide con el catálogo.");
  }
  if (
    catalog.resolvedIncidentCount !== 1 ||
    catalog.pendingManual.length !== 9 ||
    catalog.ignoredOutOfFamily.length !== 1 ||
    catalog.resolvedIncidents.length !== 1
  ) {
    throw new Error("No coinciden las incidencias resueltas, pendientes o ajenas a la familia.");
  }

  const moduleKeys = new Set<string>();
  for (const module of catalog.modules) {
    const moduleKey = `${module.cycle}\u001f${module.name}`;
    if (moduleKeys.has(moduleKey)) {
      throw new Error(`Módulo duplicado en el catálogo RA/CE: ${module.name}`);
    }
    moduleKeys.add(moduleKey);

    if (!module.cycle || !module.level || !module.name || module.outcomes.length === 0) {
      throw new Error(`Módulo incompleto en el catálogo RA/CE: ${module.name}`);
    }

    const outcomeCodes = new Set<string>();
    for (const outcome of module.outcomes) {
      if (!outcome.code || !outcome.description || outcome.criteria.length === 0) {
        throw new Error(
          `Resultado de aprendizaje incompleto en ${module.name}: ${outcome.code}`,
        );
      }
      if (outcomeCodes.has(outcome.code)) {
        throw new Error(`Código RA duplicado en ${module.name}: ${outcome.code}`);
      }
      outcomeCodes.add(outcome.code);

      const criterionCodes = new Set<string>();
      for (const criterion of outcome.criteria) {
        if (!criterion.code || !criterion.description) {
          throw new Error(
            `Criterio incompleto en ${module.name}, ${outcome.code}`,
          );
        }
        if (criterionCodes.has(criterion.code)) {
          throw new Error(
            `Código CE duplicado en ${module.name}, ${outcome.code}: ${criterion.code}`,
          );
        }
        criterionCodes.add(criterion.code);
      }
    }
  }
}

export async function seedLearningOutcomesCatalog(
  tx: Transaction,
  catalog = loadCatalog(),
  sources: VerifiedForumSource[] = JSON.parse(readFileSync(join(here, "../data/curriculum-sources-adg.json"), "utf8")),
): Promise<SeedStats> {
  validateCatalog(catalog);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('coordina:adg-ra-ce-curriculum'))`,
  );

  const stats: SeedStats = {
    verifiedModules: catalog.verifiedModuleCount,
    resolvedIncidents: catalog.resolvedIncidentCount,
    includedModules: catalog.includedModuleCount,
    modulesWithCurriculum: catalog.modulesWithCurriculum,
    emptyModules: catalog.emptyModules.length,
    pendingManual: catalog.pendingManual.length,
    ignoredOutOfFamily: catalog.ignoredOutOfFamily.length,
    modulesMatched: 0,
    modulesSkipped: 0,
    outcomesInserted: 0,
    criteriaInserted: 0,
    moduleCodesUpdated: 0,
    curriculumSourcesImported: 0,
    curriculumSourceReport: [],
    warnings: [],
  };

  const cycleIds = new Map<string, Array<{ id: number; legacy: boolean }>>();
  const candidates: Array<{ moduleId: number; source: CurriculumModule; updateCode: boolean }> = [];

  for (const source of catalog.modules) {
    const cycleKey = `${source.cycle}\u001f${source.level}`;
    if (!cycleIds.has(cycleKey)) {
      const names = [source.cycle, legacyCycleNames[source.cycle]].filter(Boolean);
      const cycles = await tx
        .select({ id: cyclesTable.id, name: cyclesTable.name })
        .from(cyclesTable)
        .where(
          and(
            inArray(cyclesTable.name, names),
            eq(cyclesTable.level, source.level),
            isNull(cyclesTable.deletedAt),
          ),
        );
      const safeCycles = cycles.filter(cycle => cycles.filter(c => c.name === cycle.name).length === 1);
      cycleIds.set(cycleKey, safeCycles.map(c => ({ id: c.id, legacy: c.name !== source.cycle })));
      if (!cycles.length || safeCycles.length !== cycles.length) {
        stats.warnings.push(
          `Ciclo «${source.cycle}»: ${cycles.length === 0 ? "no encontrado" : "duplicado"}; no se cargarán sus datos.`,
        );
      }
    }

    const matchedCycles = cycleIds.get(cycleKey) ?? [];
    if (!matchedCycles.length) {
      stats.modulesSkipped++;
      continue;
    }

    for (const { id: cycleId, legacy } of matchedCycles) {
      const modules = await tx
        .select({ id: modulesTable.id, code: modulesTable.code })
        .from(modulesTable)
        .where(
          and(
            eq(modulesTable.cycleId, cycleId),
            eq(modulesTable.name, source.name),
            isNull(modulesTable.centerId),
            isNull(modulesTable.deletedAt),
          ),
        )
        .limit(2)
        .for("update");

      // Short-title cycles may contain only a few historic modules.
      if (legacy && modules.length === 0) continue;
      if (modules.length !== 1) {
        stats.modulesSkipped++;
        stats.warnings.push(
          `Módulo «${source.name}» (${source.cycle}): ${modules.length === 0 ? "no encontrado" : "duplicado"}; sin cambios.`,
        );
        continue;
      }

      const actualCode = modules[0].code;
      const codePlan = planCurriculumCode(actualCode, source.code, legacy);
      if (codePlan.conflict) {
        stats.modulesSkipped++;
        stats.curriculumSourceReport.push({ moduleId: modules[0].id, reasons: [{
          code: "different_code", message: "El código local no coincide con la hoja revisada; se conserva sin cambios.",
        }] });
        stats.warnings.push(
          `Módulo «${source.name}» (${source.cycle}): el código del catálogo no coincide; sin cambios.`,
        );
        continue;
      }

      const updateCode = codePlan.updateCode;
      if (updateCode) {
        const collisions = await tx.select({ id: modulesTable.id }).from(modulesTable)
          .where(and(eq(modulesTable.cycleId, cycleId), isNull(modulesTable.centerId),
            isNull(modulesTable.deletedAt), sql`trim(${modulesTable.code}) = ${source.code}`,
            sql`${modulesTable.id} <> ${modules[0].id}`)).limit(1);
        if (collisions.length) {
          stats.modulesSkipped++;
          stats.curriculumSourceReport.push({ moduleId: modules[0].id, reasons: [{
            code: "code_collision", message: "Otro módulo del mismo ciclo ya utiliza el código verificado; no se sustituye la identidad local.",
          }] });
          stats.warnings.push(`Módulo «${source.name}» (${source.cycle}): el código verificado ya pertenece a otro módulo del mismo ciclo; sin cambios.`);
          continue;
        }
      }
      candidates.push({ moduleId: modules[0].id, source, updateCode });
    }
  }

  if (candidates.length === 0) return stats;

  const moduleIds = candidates.map((candidate) => candidate.moduleId);
  const existingOutcomes = await tx
    .select()
    .from(moduleLearningOutcomesTable)
    .where(inArray(moduleLearningOutcomesTable.moduleId, moduleIds));
  const outcomeIds = existingOutcomes.map((outcome) => outcome.id);
  const existingCriteria =
    outcomeIds.length > 0
      ? await tx
          .select()
          .from(moduleEvaluationCriteriaTable)
          .where(inArray(moduleEvaluationCriteriaTable.outcomeId, outcomeIds))
      : [];

  const outcomesByModule = new Map<number, typeof existingOutcomes>();
  for (const outcome of existingOutcomes) {
    const rows = outcomesByModule.get(outcome.moduleId) ?? [];
    rows.push(outcome);
    outcomesByModule.set(outcome.moduleId, rows);
  }
  const criteriaByOutcome = new Map<number, typeof existingCriteria>();
  for (const criterion of existingCriteria) {
    const rows = criteriaByOutcome.get(criterion.outcomeId) ?? [];
    rows.push(criterion);
    criteriaByOutcome.set(criterion.outcomeId, rows);
  }

  type ModulePlan = {
    moduleId: number;
    source: CurriculumModule;
    outcomeIdsByCode: Map<string, number>;
    newOutcomes: CurriculumOutcome[];
    newCriteriaByOutcomeCode: Map<string, CurriculumCriterion[]>;
    updateCode: boolean;
  };

  const plans: ModulePlan[] = [];
  for (const candidate of candidates) {
    const moduleOutcomes = outcomesByModule.get(candidate.moduleId) ?? [];
    const rowPlan = planCurriculumRows(candidate.source.outcomes, moduleOutcomes,
      moduleOutcomes.flatMap(o => criteriaByOutcome.get(o.id) ?? []));
    const plan: ModulePlan = {
      moduleId: candidate.moduleId,
      source: candidate.source,
      outcomeIdsByCode: rowPlan.outcomeIdsByCode,
      newOutcomes: rowPlan.newOutcomes,
      newCriteriaByOutcomeCode: rowPlan.newCriteriaByOutcomeCode,
      updateCode: candidate.updateCode,
    };
    const conflict = rowPlan.conflict;
    if (conflict) {
      stats.modulesSkipped++;
      stats.curriculumSourceReport.push({ moduleId: candidate.moduleId, reasons: [{
        code: "local_curriculum", message: `${conflict}; se conservan los RA/CE locales sin asignar una fuente verificada.`,
      }] });
      stats.warnings.push(
        `Módulo «${candidate.source.name}» (${candidate.source.cycle}): ${conflict}; sin cambios.`,
      );
      continue;
    }
    plans.push(plan);
  }

  stats.modulesMatched = plans.length;

  // Correct identity only after the whole module's existing RA/CE has passed
  // the non-overwrite checks. Never merge records or replace human edits.
  for (const plan of plans.filter(p => p.updateCode)) {
    await tx.update(modulesTable).set({ code: plan.source.code })
      .where(eq(modulesTable.id, plan.moduleId));
    stats.moduleCodesUpdated++;
  }

  const outcomesToInsert = plans.flatMap((plan) =>
    plan.newOutcomes.map((outcome) => ({
      moduleId: plan.moduleId,
      code: outcome.code,
      description: outcome.description,
      order: outcome.order,
    })),
  );
  if (outcomesToInsert.length > 0) {
    const inserted = await tx
      .insert(moduleLearningOutcomesTable)
      .values(outcomesToInsert)
      .returning({
        id: moduleLearningOutcomesTable.id,
        moduleId: moduleLearningOutcomesTable.moduleId,
        code: moduleLearningOutcomesTable.code,
      });
    for (const row of inserted) {
      const plan = plans.find((item) => item.moduleId === row.moduleId);
      plan?.outcomeIdsByCode.set(row.code, row.id);
    }
    stats.outcomesInserted = inserted.length;
  }

  const criteriaToInsert: Array<{
    outcomeId: number;
    code: string;
    description: string;
    order: number;
  }> = [];
  for (const plan of plans) {
    for (const [outcomeCode, criteria] of plan.newCriteriaByOutcomeCode) {
      const outcomeId = plan.outcomeIdsByCode.get(outcomeCode);
      if (outcomeId === undefined) {
        throw new Error(
          `No se pudo resolver el RA ${outcomeCode} de ${plan.source.name}.`,
        );
      }
      criteriaToInsert.push(
        ...criteria.map((criterion) => ({
          outcomeId,
          code: criterion.code,
          description: criterion.description,
          order: criterion.order,
        })),
      );
    }
  }

  for (let start = 0; start < criteriaToInsert.length; start += 400) {
    const batch = criteriaToInsert.slice(start, start + 400);
    await tx.insert(moduleEvaluationCriteriaTable).values(batch);
    stats.criteriaInserted += batch.length;
  }

  stats.curriculumSourcesImported = await seedVerifiedForumSources(tx, plans, sources, stats.curriculumSourceReport);
  return stats;
}

export function logLearningOutcomesSeedStats(stats: SeedStats): void {
  console.log(
    `Currículo RA/CE — módulos correctos en la hoja: ${stats.verifiedModules}; incidencias resueltas: ${stats.resolvedIncidents}; módulos incluidos: ${stats.includedModules}; con RA/CE: ${stats.modulesWithCurriculum}; sin RA/CE propio: ${stats.emptyModules}; fuera de familia ignorados: ${stats.ignoredOutOfFamily}; incidencias pendientes: ${stats.pendingManual}; módulos seguros: ${stats.modulesMatched}; módulos omitidos: ${stats.modulesSkipped}; códigos actualizados: ${stats.moduleCodesUpdated}; RA añadidos: ${stats.outcomesInserted}; CE añadidos: ${stats.criteriaInserted}.`,
  );
  console.log(`Fuentes curriculares verificadas importadas: ${stats.curriculumSourcesImported}; no se activan pilotos ni se sustituyen revisiones existentes.`);
  for (const item of stats.curriculumSourceReport) {
    console.warn(`Fuente curricular omitida — módulo ${item.moduleId}: ${item.reasons.map(r => r.message).join(" ")}`);
  }
  for (const warning of stats.warnings) {
    console.warn(`Currículo RA/CE omitido: ${warning}`);
  }
}
