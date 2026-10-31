import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db, modulesTable, moduleLearningOutcomesTable as ra, moduleEvaluationCriteriaTable as ce,
  forumCollaborationsTable as configs, forumCurriculumFingerprint,
  type Module, type ModuleLearningOutcome, type ModuleEvaluationCriterion,
} from "@workspace/db";
import type { ForumCurriculumInput, ForumCurriculumChange } from "@workspace/api-zod";

export type ReviewStore = Pick<typeof db, "select">;
export class CurriculumReviewError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type CurriculumSnapshot = {
  module: Module;
  configuration: typeof configs.$inferSelect | null;
  outcomes: ModuleLearningOutcome[];
  criteria: ModuleEvaluationCriterion[];
};
const aliases: Record<string, string> = {
  "Administración y Finanzas": "Técnico Superior en Administración y Finanzas",
  "Asistencia a la Dirección": "Técnico Superior en Asistencia a la Dirección",
  "Gestión Administrativa": "Técnico en Gestión Administrativa",
};
export const curriculumKey = (...parts: string[]) => JSON.stringify(parts);

export async function loadCurriculumSnapshot(store: ReviewStore, moduleId: number): Promise<CurriculumSnapshot> {
  const [module] = await store.select().from(modulesTable).where(eq(modulesTable.id, moduleId));
  if (!module || module.deletedAt) throw new CurriculumReviewError(404, "Módulo no disponible.");
  const [configuration] = await store.select().from(configs).where(eq(configs.moduleId, moduleId));
  // Include tombstones: resurrecting a deleted code would remap historical references.
  const outcomes = await store.select().from(ra).where(eq(ra.moduleId, moduleId)).orderBy(asc(ra.id));
  const criteria = outcomes.length ? await store.select().from(ce)
    .where(inArray(ce.outcomeId, outcomes.map(o => o.id))).orderBy(asc(ce.id)) : [];
  return { module, configuration: configuration ?? null, outcomes, criteria };
}

export function validateIncoming(input: ForumCurriculumInput, snapshot: CurriculumSnapshot) {
  const { module } = snapshot;
  if (module.centerId != null || input.moduleName !== module.name
    || (aliases[input.cycleName] ?? input.cycleName) !== (aliases[module.cycleName ?? ""] ?? module.cycleName)) {
    throw new CurriculumReviewError(400, "La hoja debe corresponder exactamente al módulo global y su ciclo. No se agrupan módulos por nombre.");
  }
  let url: URL;
  try { url = new URL(input.sourceUrl); }
  catch { throw new CurriculumReviewError(400, "Fuente normativa no válida."); }
  const boe = ["boe.es", "www.boe.es"].includes(url.hostname);
  const canarias = ["gobiernodecanarias.org", "www.gobiernodecanarias.org"].includes(url.hostname);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || !(boe || canarias)
    || [...url.searchParams.keys()].some(k => !(boe ? ["id", "p", "tn"] : []).includes(k))) {
    throw new CurriculumReviewError(400, "Utiliza una fuente oficial HTTPS de BOE o Gobierno de Canarias, sin credenciales ni enlaces de acceso privado.");
  }
  const text = [input.officialCode, input.sourceTitle, input.curriculumVersion, input.territory];
  const unique = (codes: string[]) => new Set(codes).size === codes.length;
  if (text.some(s => !s.trim()) || !unique(input.outcomes.map(o => o.code))
    || input.outcomes.some(o => !o.code.trim() || !o.description.trim()
      || !unique(o.criteria.map(c => c.code)) || o.criteria.some(c => !c.code.trim() || !c.description.trim()))) {
    throw new CurriculumReviewError(400, "Hay campos vacíos o códigos RA/CE duplicados en la hoja.");
  }
  for (const outcome of input.outcomes) {
    const matches = snapshot.outcomes.filter(o => o.code === outcome.code);
    if (matches.length > 1 || matches.some(o => o.deletedAt)) {
      throw new CurriculumReviewError(409, `El código ${outcome.code} está duplicado o archivado. Resuelve su identidad antes de importarlo.`);
    }
    for (const criterion of outcome.criteria) {
      const matchesCE = snapshot.criteria.filter(c => c.outcomeId === matches[0]?.id && c.code === criterion.code);
      if (matchesCE.length > 1 || matchesCE.some(c => c.deletedAt)) {
        throw new CurriculumReviewError(409, `El CE ${outcome.code}/${criterion.code} está duplicado o archivado.`);
      }
    }
  }
  if (!unique(snapshot.outcomes.filter(o => !o.deletedAt).map(o => o.code))
    || snapshot.outcomes.some(o => !unique(snapshot.criteria.filter(c => c.outcomeId === o.id && !c.deletedAt).map(c => c.code)))) {
    throw new CurriculumReviewError(409, "El currículo registrado contiene códigos duplicados. Resuélvelos antes de comparar.");
  }
}

const rowValue = (r: { code: string; description: string; order: number }) =>
  ({ code: r.code, description: r.description, order: r.order });
const printable = (v: unknown) => v == null ? "" : typeof v === "string" ? v : JSON.stringify(v, null, 2);

export function compareCurriculum(snapshot: CurriculumSnapshot, input: ForumCurriculumInput) {
  validateIncoming(input, snapshot);
  const changes: ForumCurriculumChange[] = [];
  const add = (key: string, label: string, before: unknown, after: unknown) => {
    if (printable(before) !== printable(after)) changes.push({ key, label, before: printable(before), after: printable(after) });
  };
  add(curriculumKey("moduleCode"), "Código del catálogo", snapshot.module.code ?? "", input.officialCode);
  for (const key of ["officialCode", "sourceTitle", "sourceUrl", "curriculumVersion", "territory"] as const) {
    add(curriculumKey(key), ({ officialCode: "Código verificado", sourceTitle: "Referencia normativa",
      sourceUrl: "Enlace normativo", curriculumVersion: "Versión curricular", territory: "Territorio" })[key],
    snapshot.configuration?.[key] ?? "", input[key]);
  }
  const active = snapshot.outcomes.filter(o => !o.deletedAt);
  for (const code of new Set([...active.map(o => o.code), ...input.outcomes.map(o => o.code)])) {
    const before = active.find(o => o.code === code), after = input.outcomes.find(o => o.code === code);
    if (!before || !after) {
      const old = before ? { ...rowValue(before), criteria: snapshot.criteria
        .filter(c => c.outcomeId === before.id && !c.deletedAt).map(rowValue) } : null;
      add(curriculumKey("ra", code), `RA ${code} · ${before ? "archivar con sus CE" : "añadir con sus CE"}`,
        old, after ? { ...rowValue(after), criteria: after.criteria.map(rowValue) } : null);
      continue;
    }
    add(curriculumKey("ra", code), `RA ${code}`, rowValue(before), rowValue(after));
    const oldCriteria = snapshot.criteria.filter(c => c.outcomeId === before.id && !c.deletedAt);
    for (const c of new Set([...oldCriteria.map(c => c.code), ...after.criteria.map(c => c.code)])) {
      const b = oldCriteria.find(x => x.code === c), a = after.criteria.find(x => x.code === c);
      add(curriculumKey("ce", code, c), `CE ${code}/${c}`, b ? rowValue(b) : null, a ? rowValue(a) : null);
    }
  }
  const token = createHash("sha256").update(JSON.stringify({ snapshot, input })).digest("hex");
  return {
    token, revision: snapshot.configuration?.revision ?? 0, changes,
    warnings: [
      "No se activan pilotos ni se crean temas. Los apartados, debates, acuerdos y recursos existentes se conservan.",
      "Los cambios no seleccionados conservan el texto registrado. Si la aplicación es parcial, la verificación queda pendiente.",
      "Las bajas se archivan; los cambios de código RA/CE se tratan como baja y alta, sin reasignar referencias históricas.",
    ],
  };
}

export async function applyCurriculumRows(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0], snapshot: CurriculumSnapshot,
  input: ForumCurriculumInput, selected: Set<string>,
) {
  const moduleId = snapshot.module.id;
  if (selected.has(curriculumKey("moduleCode"))) {
    const collision = await tx.select({ id: modulesTable.id }).from(modulesTable).where(and(
      snapshot.module.cycleId != null ? eq(modulesTable.cycleId, snapshot.module.cycleId)
        : and(isNull(modulesTable.cycleId), eq(modulesTable.cycleName, snapshot.module.cycleName!)),
      isNull(modulesTable.centerId), isNull(modulesTable.deletedAt),
      sql`upper(trim(${modulesTable.code})) = upper(trim(${input.officialCode}))`,
    ));
    if (collision.some(m => m.id !== moduleId)) throw new CurriculumReviewError(409, "El código propuesto pertenece a otro módulo del mismo ciclo.");
    await tx.update(modulesTable).set({ code: input.officialCode }).where(eq(modulesTable.id, moduleId));
  }
  for (const code of new Set([...snapshot.outcomes.filter(o => !o.deletedAt).map(o => o.code), ...input.outcomes.map(o => o.code)])) {
    const before = snapshot.outcomes.find(o => o.code === code && !o.deletedAt);
    const after = input.outcomes.find(o => o.code === code);
    if (selected.has(curriculumKey("ra", code))) {
      if (before && !after) {
        await tx.update(ra).set({ deletedAt: new Date() }).where(eq(ra.id, before.id));
        await tx.update(ce).set({ deletedAt: new Date() }).where(eq(ce.outcomeId, before.id));
        continue;
      }
      if (!before && after) {
        const [created] = await tx.insert(ra).values({ moduleId, ...rowValue(after) }).returning();
        await tx.insert(ce).values(after.criteria.map(c => ({ outcomeId: created.id, ...rowValue(c) })));
        continue;
      }
      if (before && after) await tx.update(ra).set(rowValue(after)).where(eq(ra.id, before.id));
    }
    if (!before || !after) continue;
    const oldCriteria = snapshot.criteria.filter(c => c.outcomeId === before.id && !c.deletedAt);
    for (const codeCE of new Set([...oldCriteria.map(c => c.code), ...after.criteria.map(c => c.code)])) {
      if (!selected.has(curriculumKey("ce", code, codeCE))) continue;
      const old = oldCriteria.find(c => c.code === codeCE), incoming = after.criteria.find(c => c.code === codeCE);
      if (old) await tx.update(ce).set(incoming ? rowValue(incoming) : { deletedAt: new Date() }).where(eq(ce.id, old.id));
      else if (incoming) await tx.insert(ce).values({ outcomeId: before.id, ...rowValue(incoming) });
    }
  }
}

export function snapshotFingerprint(snapshot: CurriculumSnapshot) {
  const outcomes = snapshot.outcomes.filter(o => !o.deletedAt);
  return forumCurriculumFingerprint(snapshot.module, outcomes, snapshot.criteria
    .filter(c => !c.deletedAt && outcomes.some(o => o.id === c.outcomeId)));
}
