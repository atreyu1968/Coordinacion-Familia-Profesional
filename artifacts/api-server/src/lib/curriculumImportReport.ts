import { curriculumImportReasons, planCurriculumCode, planCurriculumRows, type CurriculumImportReason } from "@workspace/db";
// Static imports are bundled with the API, including in self-hosted builds.
// Keep a single baseline: these are the same files consumed by the seed.
import catalog from "../../../../scripts/src/data/learning-outcomes-adg.json";
import sources from "../../../../scripts/src/data/curriculum-sources-adg.json";

const aliases: Record<string, string> = {
  "Administración y Finanzas": "Técnico Superior en Administración y Finanzas",
  "Asistencia a la Dirección": "Técnico Superior en Asistencia a la Dirección",
  "Gestión Administrativa": "Técnico en Gestión Administrativa",
};

export function currentCurriculumImportReport(
  module: { id?: number; code: string | null; name: string; centerId: number | null },
  cycleName: string | null,
  outcomes: (Parameters<typeof curriculumImportReasons>[2][number] & { deletedAt?: Date | null })[],
  criteria: (Parameters<typeof curriculumImportReasons>[3][number] & { deletedAt?: Date | null })[],
  hasPreviousReview: boolean,
  context?: {
    cycleLevel: string;
    cycleAmbiguous: boolean;
    siblings: { id: number; name: string; code: string | null }[];
  },
) {
  const cycle = aliases[cycleName ?? ""] ?? cycleName;
  const identity = (s: { cycle: string; name: string }) => s.cycle === cycle && s.name === module.name;
  const matches = catalog.modules.filter(s => identity(s) && (!context || s.level === context.cycleLevel));
  const expected = matches.length === 1 ? matches[0] : undefined;
  const activeOutcomes = outcomes.filter(o => !o.deletedAt);
  const activeCriteria = criteria.filter(c => !c.deletedAt && activeOutcomes.some(o => o.id === c.outcomeId));
  let reasons: CurriculumImportReason[] = [];
  // Model the same stages as the seed before comparing the final RA/CE:
  // identity preflight, non-overwrite row plan, optional code repair, exact match.
  if (expected && module.centerId == null) {
    const codePlan = planCurriculumCode(module.code, expected.code, !!aliases[cycleName ?? ""]);
    const rowPlan = planCurriculumRows(expected.outcomes, outcomes, criteria);
    const ambiguous = context && (context.cycleAmbiguous
      || context.siblings.filter(s => s.name === module.name).length !== 1);
    const collision = codePlan.updateCode && context?.siblings.some(s => s.id !== module.id && s.code?.trim() === expected.code);
    if (ambiguous) reasons.push({ code: "ambiguous_identity",
      message: "El ciclo o el nombre del módulo tiene varios registros locales. La importación no elegirá uno ni asignará su fuente." });
    else if (codePlan.conflict) reasons.push({ code: "different_code",
      message: "El código local no coincide con la hoja revisada en este ciclo. La importación conserva el módulo sin cambios." });
    else if (collision) reasons.push({ code: "code_collision",
      message: "Otro módulo del mismo ciclo utiliza el código verificado. La importación conserva la identidad local sin cambios." });
    else if (rowPlan.conflict) reasons.push({ code: "local_curriculum",
      message: `${rowPlan.conflict}. La importación conserva el módulo sin cambios ni nueva verificación.` });
    else {
      const projectedOutcomes = [...activeOutcomes];
      const projectedCriteria = [...activeCriteria];
      let temporaryId = -1;
      for (const outcome of rowPlan.newOutcomes) {
        const id = temporaryId--;
        projectedOutcomes.push({ ...outcome, id });
        rowPlan.outcomeIdsByCode.set(outcome.code, id);
      }
      for (const [code, missing] of rowPlan.newCriteriaByOutcomeCode) {
        const outcomeId = rowPlan.outcomeIdsByCode.get(code)!;
        projectedCriteria.push(...missing.map(c => ({ ...c, outcomeId })));
      }
      reasons = curriculumImportReasons({ ...module, code: codePlan.updateCode ? expected.code : module.code },
        expected, projectedOutcomes, projectedCriteria, hasPreviousReview);
      if (codePlan.updateCode) reasons.push({ code: "will_update_code",
        message: `La próxima importación podrá completar o corregir el código a ${expected.code}, tras superar las comprobaciones de identidad y RA/CE. Consultar este informe no lo cambia.` });
      if (rowPlan.newOutcomes.length || rowPlan.newCriteriaByOutcomeCode.size) reasons.push({ code: "will_complete_curriculum",
        message: "La próxima importación podrá añadir los RA/CE que faltan en la hoja local, sin sustituir filas existentes. La coincidencia para heredar la fuente se comprobará después de esa carga." });
    }
    if (hasPreviousReview && !reasons.some(r => r.code === "previous_review")) reasons.unshift({
      code: "previous_review", message: "Se conserva la revisión curricular registrada. La importación no sustituye su fuente ni su verificación.",
    });
  } else {
    reasons = curriculumImportReasons(module, expected, activeOutcomes, activeCriteria, hasPreviousReview);
  }
  const pending = catalog.pendingManual.find(identity);
  if (pending) reasons.push({
    code: "pending_manual",
    message: `Incidencia pendiente de revisión manual: ${pending.observation}. No se considera verificada.`,
  });
  else if (catalog.emptyModules.some(identity)) reasons.push({
    code: "no_curriculum",
    message: "La hoja revisada no contiene RA/CE propios para este módulo. No se asigna una fuente verificada.",
  });
  else if (!expected) reasons.push({
    code: "unmatched_identity",
    message: "No hay una correspondencia única de ciclo y módulo en la hoja revisada. No se infiere la fuente por similitud.",
  });
  else if (!sources.some(s => identity(s) && s.code === expected.code && !!s.code)) reasons.push({
    code: "missing_source",
    message: "No hay una fuente con código oficial para esta identidad en la hoja revisada; se mantiene pendiente.",
  });
  if (reasons.every(r => ["will_update_code", "will_complete_curriculum"].includes(r.code))) reasons.push({
    code: "eligible",
    message: "Tras completar los datos previstos, el módulo puede heredar la fuente en la próxima importación. Este informe no ejecuta la carga ni verifica nada.",
  });
  return { reasons };
}
