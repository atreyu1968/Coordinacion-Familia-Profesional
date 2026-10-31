import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, resourceCurriculumTable, resourceLearningTargetsTable, centersTable, modulesTable, type User } from "@workspace/db";
import { resolveReadScope, hasScopeOver, isModuleCoordinator } from "../middlewares/auth";
import { moduleFamilyFilter } from "./familyCatalog";
import { getActiveFamily } from "./settings";

export async function canReadCurriculumModule(user: User, moduleId: number): Promise<boolean> {
  if (await getActiveFamily() !== "Administración y Gestión") return false;
  const [module] = await db.select({ id: modulesTable.id }).from(modulesTable).where(and(
    eq(modulesTable.id, moduleId), isNull(modulesTable.deletedAt), moduleFamilyFilter("Administración y Gestión")));
  if (!module) return false;
  const { moduleVisibleById } = await import("../routes/forums");
  return !!await moduleVisibleById(user, moduleId);
}

type ResourceIdentity = { id: number; authorId: number | null; centerId: number | null };
export async function canReadResourceCenter(resource: ResourceIdentity, user: User) {
  if (resource.centerId == null) return true;
  const scope = resolveReadScope(user);
  if (scope.kind === "global") return true;
  if (scope.kind === "center") return scope.centerId === resource.centerId;
  if (scope.kind !== "province") return false;
  const [center] = await db.select().from(centersTable).where(and(eq(centersTable.id, resource.centerId), isNull(centersTable.deletedAt)));
  return !!center && center.provinceId === scope.provinceId && center.families.includes(await getActiveFamily());
}

export async function canEditCurriculumResource(resource: ResourceIdentity, moduleId: number, user: User) {
  if (resource.authorId === user.id || user.role === "superadmin") return true;
  if (resource.centerId != null) {
    const [center] = await db.select().from(centersTable).where(eq(centersTable.id, resource.centerId));
    return !!center && hasScopeOver(user, { centerId: center.id, provinceId: center.provinceId });
  }
  return user.role === "coordinator" || await isModuleCoordinator(user.id, moduleId);
}

// Shared by the old library and AI discovery: tagging never bypasses their
// existing center/provider permissions, and hidden metadata cannot leak a URL.
export async function authorizedCurriculumResources<T extends ResourceIdentity>(rows: T[], user: User, includeArchived = false) {
  if (!rows.length) return [];
  const metadata = await db.select().from(resourceCurriculumTable).where(inArray(resourceCurriculumTable.resourceId, rows.map(r => r.id)));
  const targets = metadata.length ? await db.select().from(resourceLearningTargetsTable).where(inArray(
    resourceLearningTargetsTable.resourceId, metadata.map(m => m.resourceId))) : [];
  const byId = new Map(metadata.map(m => [m.resourceId, m]));
  const moduleAccess = new Map<number, boolean>();
  const result = [];
  for (const row of rows) {
    const meta = byId.get(row.id);
    if (!meta) { result.push({ ...row, curriculum: undefined }); continue; }
    if (!moduleAccess.has(meta.moduleId)) moduleAccess.set(meta.moduleId, await canReadCurriculumModule(user, meta.moduleId));
    if (!moduleAccess.get(meta.moduleId) || !await canReadResourceCenter(row, user)) continue;
    const canEdit = await canEditCurriculumResource(row, meta.moduleId, user);
    if (meta.archived && (!includeArchived || !canEdit)) continue;
    const [originCenter] = meta.originCenterId == null ? [] : await db.select({ name: centersTable.name }).from(centersTable).where(eq(centersTable.id, meta.originCenterId));
    result.push({ ...row, curriculum: {
      moduleId: meta.moduleId, revision: meta.revision, license: meta.license, version: meta.version,
      originCenterId: meta.originCenterId, originCenterName: originCenter?.name ?? null,
      audience: meta.audience as "teachers" | "students", restricted: meta.restricted, archived: meta.archived,
      curriculumVersion: meta.curriculumVersion, fingerprint: meta.fingerprint, canEdit,
      targets: targets.filter(t => t.resourceId === row.id).map(t => ({ outcomeId: t.outcomeId, criterionId: t.criterionId })),
    } });
  }
  return result;
}
