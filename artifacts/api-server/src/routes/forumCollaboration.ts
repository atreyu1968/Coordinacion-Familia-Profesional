import { Router } from "express";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  db, cyclesTable, modulesTable, moduleLearningOutcomesTable, moduleEvaluationCriteriaTable, forumCurriculumFingerprint,
  forumCollaborationsTable, forumCollaborationRevisionsTable,
  forumThreadContextsTable, forumThreadsTable, forumPostsTable, type User,
} from "@workspace/db";
import {
  ConfigureForumCollaborationBody, InitializeForumCollaborationBody,
  GetForumCollaborationResponse,
  type ForumCollaborationThread,
} from "@workspace/api-zod";
import { requireAuth, isModuleCoordinator, hasScopeOver } from "../middlewares/auth";
import { moduleVisibleById } from "./forums";
import { getActiveAcademicYear } from "../lib/settings";
import { defaultProgrammingSections } from "../lib/forumProgrammingTemplate";
import { moduleFamilyFilter } from "../lib/familyCatalog";
import { getActiveFamily } from "../lib/settings";
import { enqueueForumDigest } from "../lib/forumDigestQueue";
import { currentCurriculumImportReport } from "../lib/curriculumImportReport";

const router = Router();
const COLLABORATION_FAMILY = "Administración y Gestión";
type Database = Pick<typeof db, "select" | "insert" | "update" | "execute">;
class Conflict extends Error {}
const normalize = (s: string | null) => (s ?? "").trim().toUpperCase();

async function canConfigure(user: User, module: { id: number; centerId: number | null }) {
  if (await isModuleCoordinator(user.id, module.id)) return true;
  if (user.role === "superadmin") return true;
  if (!["coordinator", "department_head"].includes(user.role)) return false;
  if (module.centerId == null) return user.role === "coordinator";
  // Use the same forum management scope, without giving ordinary moderators
  // authority to attest a curriculum or create structural topics.
  const { centersTable } = await import("@workspace/db");
  const [center] = await db.select().from(centersTable).where(eq(centersTable.id, module.centerId));
  return !!center && hasScopeOver(user, { centerId: center.id, provinceId: center.provinceId });
}

export async function structure(store: Database, moduleId: number, user: User) {
  const [module] = await store.select().from(modulesTable).where(eq(modulesTable.id, moduleId));
  const [config] = await store.select().from(forumCollaborationsTable)
    .where(eq(forumCollaborationsTable.moduleId, moduleId));
  const outcomes = await store.select().from(moduleLearningOutcomesTable)
    .where(and(eq(moduleLearningOutcomesTable.moduleId, moduleId), isNull(moduleLearningOutcomesTable.deletedAt)))
    .orderBy(asc(moduleLearningOutcomesTable.id));
  const criteria = await store.select({ id: moduleEvaluationCriteriaTable.id, outcomeId: moduleEvaluationCriteriaTable.outcomeId,
    code: moduleEvaluationCriteriaTable.code, description: moduleEvaluationCriteriaTable.description, order: moduleEvaluationCriteriaTable.order })
    .from(moduleEvaluationCriteriaTable)
    .innerJoin(moduleLearningOutcomesTable, eq(moduleLearningOutcomesTable.id, moduleEvaluationCriteriaTable.outcomeId))
    .where(and(eq(moduleLearningOutcomesTable.moduleId, moduleId), isNull(moduleLearningOutcomesTable.deletedAt),
      isNull(moduleEvaluationCriteriaTable.deletedAt))).orderBy(asc(moduleEvaluationCriteriaTable.id));
  const fingerprint = forumCurriculumFingerprint(module, outcomes, criteria);
  const duplicates = module.code?.trim() ? await store.select({ id: modulesTable.id }).from(modulesTable)
    .where(and(sql`upper(trim(${modulesTable.code})) = ${normalize(module.code)}`,
      // A verified official module can be shared by different cycles. Only
      // competing identities within this cycle and center are ambiguous.
      module.cycleId != null ? eq(modulesTable.cycleId, module.cycleId)
        : and(isNull(modulesTable.cycleId), sql`${modulesTable.cycleName} IS NOT DISTINCT FROM ${module.cycleName}`),
      module.centerId != null ? eq(modulesTable.centerId, module.centerId) : isNull(modulesTable.centerId),
      sql`${modulesTable.id} <> ${moduleId}`, isNull(modulesTable.deletedAt), moduleFamilyFilter(COLLABORATION_FAMILY))) : [];
  const diagnostics: string[] = [];
  if (module.centerId != null) diagnostics.push("Este módulo es específico de un centro: requiere una correspondencia curricular validada antes de activar la comunidad intercentros.");
  if (!module.code?.trim()) diagnostics.push("Falta el código oficial en el catálogo. Corrige y verifica la identidad del módulo; no se agrupa por nombre.");
  if (duplicates.length) diagnostics.push("El código aparece en otros registros. Es necesario resolver explícitamente su correspondencia curricular; no se fusionarán automáticamente.");
  if (!outcomes.length) diagnostics.push("Este registro del módulo no tiene resultados de aprendizaje cargados. Comprueba la carga de la hoja curricular verificada y su correspondencia con el módulo.");
  if (outcomes.some(o => !criteria.some(c => c.outcomeId === o.id))) diagnostics.push("Hay resultados de aprendizaje sin criterios de evaluación registrados.");
  if (!config) diagnostics.push("La coordinación debe revisar y configurar la fuente curricular antes de activar este piloto.");
  else if (config.fingerprint !== fingerprint) diagnostics.push("El catálogo o los RA/CE han cambiado desde la revisión. Revisa la fuente y confirma una nueva versión antes de generar hilos.");
  const sections = config?.sections ?? defaultProgrammingSections;
  const contexts = await store.select({
    threadId: forumThreadContextsTable.threadId, key: forumThreadContextsTable.stableKey,
    kind: forumThreadContextsTable.kind, outcomeId: forumThreadContextsTable.outcomeId,
    criterionId: forumThreadContextsTable.criterionId, curriculumVersion: forumThreadContextsTable.curriculumVersion,
    title: forumThreadsTable.title, archived: sql<boolean>`${forumThreadsTable.deletedAt} is not null`,
  }).from(forumThreadContextsTable).innerJoin(forumThreadsTable, eq(forumThreadsTable.id, forumThreadContextsTable.threadId))
    .where(eq(forumThreadContextsTable.moduleId, moduleId));
  const planned = [
    ...sections.filter(s => s.enabled).sort((a, b) => a.order - b.order || a.key.localeCompare(b.key)).map(s => ({
      key: s.key, kind: "programming_section" as const, title: `${s.key} · ${s.title}`, content: s.prompt, outcomeId: null as number | null, criterionId: null as number | null,
    })),
    ...outcomes.flatMap(o => [
      { key: `MAT-RA:${o.id}`, kind: "material_ra" as const, title: `${o.code} · Materiales y actividades`,
        content: `${o.code}: ${o.description}\n\nComparte propuestas integradoras, dudas y referencias a materiales de la biblioteca existente. No adjuntes datos del alumnado ni copies archivos innecesariamente. Las propuestas no modifican el texto oficial.`,
        outcomeId: o.id, criterionId: null as number | null },
      ...criteria.filter(c => c.outcomeId === o.id).map(c => ({
        key: `MAT-CE:${c.id}`, kind: "material_ce" as const, title: `${o.code} · CE ${c.code} · Materiales y actividades`,
        content: `${o.code}: ${o.description}\n\nCE ${c.code}: ${c.description}\n\nPropón actividades, evidencias, instrumentos y enlaces a recursos de la biblioteca. Identifica su autoría y licencia. Las propuestas no modifican el texto oficial.`,
        outcomeId: o.id, criterionId: c.id,
      })),
    ]),
  ];
  const plannedKeys = new Set(planned.map(t => t.key));
  const threads: ForumCollaborationThread[] = planned.map(t => {
    const existing = contexts.find(c => c.key === t.key);
    return { ...t, threadId: existing?.threadId ?? null, archived: existing?.archived ?? false,
      curriculumVersion: existing?.curriculumVersion ?? config?.curriculumVersion ?? null };
  });
  // Keep historical and disabled contexts navigable. Never remap a deleted RA
  // or a disabled section to a new curricular identity.
  for (const old of contexts.filter(c => !plannedKeys.has(c.key))) {
    threads.push({ ...old, kind: old.kind as typeof threads[number]["kind"], content: "", archived: true });
  }
  const configureAllowed = await canConfigure(user, module);
  let importReport = null;
  if (configureAllowed && (user.role === "superadmin" || user.role === "coordinator"
    || await isModuleCoordinator(user.id, moduleId))) {
    const [cycle] = module.cycleId == null ? [] : await store.select()
      .from(cyclesTable).where(eq(cyclesTable.id, module.cycleId));
    const siblings = module.cycleId == null ? [] : await store.select({
      id: modulesTable.id, name: modulesTable.name, code: modulesTable.code,
    }).from(modulesTable).where(and(eq(modulesTable.cycleId, module.cycleId),
      isNull(modulesTable.centerId), isNull(modulesTable.deletedAt)));
    const matchingCycles = !cycle ? [] : await store.select({ id: cyclesTable.id }).from(cyclesTable)
      .where(and(eq(cyclesTable.name, cycle.name),
        cycle.level == null ? isNull(cyclesTable.level) : eq(cyclesTable.level, cycle.level), isNull(cyclesTable.deletedAt)));
    const reportOutcomes = await store.select().from(moduleLearningOutcomesTable)
      .where(eq(moduleLearningOutcomesTable.moduleId, moduleId));
    const reportCriteria = await store.select({
      outcomeId: moduleEvaluationCriteriaTable.outcomeId, code: moduleEvaluationCriteriaTable.code,
      description: moduleEvaluationCriteriaTable.description, order: moduleEvaluationCriteriaTable.order,
      deletedAt: moduleEvaluationCriteriaTable.deletedAt,
    }).from(moduleEvaluationCriteriaTable).innerJoin(moduleLearningOutcomesTable,
      eq(moduleLearningOutcomesTable.id, moduleEvaluationCriteriaTable.outcomeId))
      .where(eq(moduleLearningOutcomesTable.moduleId, moduleId));
    importReport = currentCurriculumImportReport(module, cycle?.name ?? module.cycleName,
      reportOutcomes, reportCriteria, !!config, {
        cycleLevel: cycle?.level ?? "", cycleAmbiguous: !cycle || !!cycle.deletedAt || matchingCycles.length !== 1, siblings,
      });
  }
  return {
    moduleId, moduleCode: module.code, moduleName: module.name, cycleName: module.cycleName,
    academicYear: await getActiveAcademicYear(), enabled: config?.enabled ?? false,
    canConfigure: configureAllowed, verificationCurrent: !!config && config.fingerprint === fingerprint,
    importReport,
    fingerprint, diagnostics, sections, threads,
    configuration: config ? { revision: config.revision, enabled: config.enabled,
      officialCode: config.officialCode, sourceTitle: config.sourceTitle, sourceUrl: config.sourceUrl,
      curriculumVersion: config.curriculumVersion, territory: config.territory, verifiedAt: config.verifiedAt.toISOString() } : null,
  };
}

router.use("/forum/modules/:moduleId/collaboration", requireAuth, async (req, res, next) => {
  const moduleId = Number(req.params.moduleId);
  if (!Number.isSafeInteger(moduleId) || moduleId < 1) { res.status(400).json({ message: "Identificador de módulo no válido" }); return; }
  const [familyModule] = await db.select({ id: modulesTable.id }).from(modulesTable)
    .where(and(eq(modulesTable.id, moduleId), isNull(modulesTable.deletedAt), moduleFamilyFilter(COLLABORATION_FAMILY)));
  if ((await getActiveFamily()) !== COLLABORATION_FAMILY || !familyModule) {
    res.status(403).json({ message: "Esta ampliación se limita a Administración y Gestión." }); return;
  }
  if (!(await moduleVisibleById(req.user!, moduleId))) { res.status(403).json({ message: "Módulo fuera de tu ámbito" }); return; }
  next();
});
router.get("/forum/modules/:moduleId/collaboration", async (req, res) => {
  res.json(GetForumCollaborationResponse.parse(await structure(db, Number(req.params.moduleId), req.user!)));
});
router.put("/forum/modules/:moduleId/collaboration", async (req, res) => {
  const parsed = ConfigureForumCollaborationBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Revisa los campos de configuración y la plantilla de 16 apartados." }); return; }
  const input = parsed.data, moduleId = Number(req.params.moduleId);
  const before = await structure(db, moduleId, req.user!);
  if (!before.canConfigure) { res.status(403).json({ message: "Solo coordinación o gestión autorizada puede configurar la estructura" }); return; }
  let source: URL;
  try { source = new URL(input.sourceUrl); }
  catch { res.status(400).json({ message: "La fuente curricular debe ser una URL HTTPS válida." }); return; }
  if (source.protocol !== "https:" || source.username || source.password || !input.confirmReviewed ||
    ![input.sourceTitle, input.officialCode, input.curriculumVersion, input.territory].every(s => s.trim()) ||
    new Set(input.sections.map(s => s.key)).size !== 16 ||
    input.sections.some(s => !s.title.trim() || !s.prompt.trim())) {
    res.status(400).json({ message: "Confirma la revisión humana, una fuente HTTPS sin credenciales y las 16 claves PD-01 a PD-16 sin duplicados." }); return;
  }
  try {
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(1947, ${moduleId})`);
      const current = await structure(tx, moduleId, req.user!);
      if ((current.configuration?.revision ?? 0) !== input.revision || current.fingerprint !== input.fingerprint) throw new Conflict("La configuración o el currículo han cambiado. Recarga la vista previa.");
      if (input.enabled && normalize(input.officialCode) !== normalize(current.moduleCode)) throw new Conflict("El código oficial debe coincidir con el catálogo verificado. Corrige primero el catálogo.");
      const identityProblems = current.diagnostics.filter(d => !d.startsWith("La coordinación") && !d.startsWith("El catálogo"));
      if (input.enabled && identityProblems.length) throw new Conflict(identityProblems.join(" "));
      const values = { moduleId, enabled: input.enabled, officialCode: input.officialCode.trim(),
        sourceTitle: input.sourceTitle.trim(), sourceUrl: source.href, curriculumVersion: input.curriculumVersion.trim(),
        territory: input.territory.trim(), fingerprint: current.fingerprint, revision: input.revision + 1,
        sections: input.sections.map(s => ({ ...s, title: s.title.trim(), prompt: s.prompt.trim() })),
        verifiedBy: req.user!.id, verifiedAt: new Date() };
      await tx.insert(forumCollaborationsTable).values(values).onConflictDoUpdate({ target: forumCollaborationsTable.moduleId, set: values });
      await tx.insert(forumCollaborationRevisionsTable).values({ moduleId, revision: values.revision,
        actorId: req.user!.id, configuration: { ...values, verifiedAt: values.verifiedAt.toISOString() } });
    });
    res.json(await structure(db, moduleId, req.user!));
  } catch (error) { if (!(error instanceof Conflict)) throw error; res.status(409).json({ message: error.message }); }
});
router.post("/forum/modules/:moduleId/collaboration/initialize", async (req, res) => {
  const parsed = InitializeForumCollaborationBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Debes confirmar la revisión y la vista previa actual." }); return; }
  const moduleId = Number(req.params.moduleId);
  try {
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(1947, ${moduleId})`);
      const state = await structure(tx, moduleId, req.user!);
      if (!state.canConfigure) throw Object.assign(new Error("No puedes generar hilos estructurales"), { status: 403 });
      if (!state.enabled || !state.verificationCurrent || state.diagnostics.length ||
        state.configuration?.revision !== parsed.data.revision || state.fingerprint !== parsed.data.fingerprint)
        throw new Conflict("No se puede generar: revisa los diagnósticos, activa el piloto y confirma la vista previa actual.");
      for (const thread of state.threads.filter(t => t.threadId == null && !t.archived)) {
        const [created] = await tx.insert(forumThreadsTable).values({
          moduleId, centerId: null, title: thread.title, authorId: req.user!.id,
        }).returning();
        await tx.insert(forumPostsTable).values({ threadId: created.id, authorId: req.user!.id, content: thread.content });
        await enqueueForumDigest(tx, { moduleId, threadId: created.id, actorId: req.user!.id,
          eventKey: `debate:${created.id}`, kind: "debate" });
        await tx.insert(forumThreadContextsTable).values({
          threadId: created.id, moduleId, kind: thread.kind, stableKey: thread.key, outcomeId: thread.outcomeId,
          criterionId: thread.criterionId, templateVersion: state.configuration!.revision, curriculumVersion: state.configuration!.curriculumVersion,
        });
      }
    });
    res.json(await structure(db, moduleId, req.user!));
  } catch (error) {
    if (error instanceof Conflict) { res.status(409).json({ message: error.message }); return; }
    if ((error as { status?: number }).status === 403) { res.status(403).json({ message: "No puedes generar hilos estructurales" }); return; }
    throw error;
  }
});
export default router;
