/** Read-only comparison shared by the importer and its user-facing report. */
type Row = { code: string; description: string; order: number };
export type CurriculumImportCandidate = {
  code: string;
  outcomes: (Row & { criteria: Row[] })[];
};
export type CurriculumImportReason = { code: string; message: string };

export function planCurriculumCode(actual: string | null, expected: string, legacy: boolean) {
  return {
    conflict: !!actual && !!expected && actual !== expected && !legacy,
    updateCode: !!expected && actual !== expected,
  };
}

/** Same preflight as the seed: missing rows can be added, changed/deleted rows cannot. */
export function planCurriculumRows<T extends Row & { criteria: Row[] }>(
  expected: T[],
  outcomes: (Row & { id: number; deletedAt?: Date | null })[],
  criteria: (Row & { outcomeId: number; deletedAt?: Date | null })[],
) {
  const plan = {
    conflict: null as string | null,
    outcomeIdsByCode: new Map<string, number>(),
    newOutcomes: [] as T[],
    newCriteriaByOutcomeCode: new Map<string, Row[]>(),
  };
  for (const outcome of expected) {
    const matches = outcomes.filter(o => o.code === outcome.code);
    if (matches.length > 1) { plan.conflict = `código RA duplicado ${outcome.code}`; break; }
    if (!matches.length) {
      plan.newOutcomes.push(outcome);
      plan.newCriteriaByOutcomeCode.set(outcome.code, outcome.criteria);
      continue;
    }
    const actual = matches[0];
    if (actual.deletedAt || actual.description !== outcome.description) {
      plan.conflict = `el RA ${outcome.code} ya existe con otra versión o está eliminado`; break;
    }
    plan.outcomeIdsByCode.set(outcome.code, actual.id);
    const missing: Row[] = [];
    for (const criterion of outcome.criteria) {
      const children = criteria.filter(c => c.outcomeId === actual.id && c.code === criterion.code);
      if (children.length > 1) {
        plan.conflict = `criterio CE duplicado ${criterion.code} en ${outcome.code}`; break;
      }
      if (!children.length) missing.push(criterion);
      else if (children[0].deletedAt || children[0].description !== criterion.description) {
        plan.conflict = `el CE ${criterion.code} de ${outcome.code} ya existe con otra versión o está eliminado`; break;
      }
    }
    if (plan.conflict) break;
    if (missing.length) plan.newCriteriaByOutcomeCode.set(outcome.code, missing);
  }
  return plan;
}

export function curriculumImportReasons(
  module: { code: string | null; centerId: number | null },
  expected: CurriculumImportCandidate | undefined,
  outcomes: (Row & { id: number })[],
  criteria: (Row & { outcomeId: number })[],
  hasPreviousReview: boolean,
): CurriculumImportReason[] {
  const reasons: CurriculumImportReason[] = [];
  if (hasPreviousReview) reasons.push({
    code: "previous_review",
    message: "Se conserva la revisión curricular registrada. La importación no sustituye su fuente ni su verificación.",
  });
  if (!module.code?.trim() || (expected && !expected.code.trim())) reasons.push({
    code: "missing_code",
    message: "Falta el código oficial del módulo en el catálogo local o en la hoja revisada. No se hereda una fuente por coincidencia de nombre.",
  });
  else if (expected && module.code !== expected.code) reasons.push({
    code: "different_code",
    message: "El código local no coincide con el código de la hoja revisada. Se conserva la identidad local.",
  });
  if (module.centerId != null) reasons.push({
    code: "center_specific",
    message: "Este módulo pertenece a un centro. La fuente del catálogo global no se asigna automáticamente.",
  });
  if (expected) {
    const exact = outcomes.length === expected.outcomes.length
      && expected.outcomes.every(e => {
        const matches = outcomes.filter(o => o.code === e.code);
        if (matches.length !== 1) return false;
        const actual = matches[0];
        const children = criteria.filter(c => c.outcomeId === actual.id);
        return actual.description === e.description && actual.order === e.order
          && children.length === e.criteria.length
          && e.criteria.every(c => children.filter(a => a.code === c.code
            && a.description === c.description && a.order === c.order).length === 1);
      });
    if (!exact) reasons.push({
      code: "local_curriculum",
      message: "Los RA/CE locales no coinciden exactamente con la hoja revisada (códigos, textos, orden o número de elementos). No se verifican ni se sobrescriben automáticamente.",
    });
  }
  return reasons;
}
