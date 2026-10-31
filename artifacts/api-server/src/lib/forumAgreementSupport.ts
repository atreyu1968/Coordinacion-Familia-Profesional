import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  db, usersTable, centersTable, teachingAssignmentsTable, moduleMembershipsTable,
  forumAgreementRevisionsTable, forumAgreementsTable, wikiPagesTable, type User,
} from "@workspace/db";
import { getActiveAcademicYear, getSettings } from "./settings";
import { resolveNextcloudUrl } from "./nextcloud";
import { canReadCurriculumModule } from "./resourceCurriculumAccess";
import { canonicalResourceUrl } from "../routes/curriculumResources";

export class AgreementError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const REFERENCE_LEGEND = "Documento intercentros de referencia. No sustituye la programación aprobada por cada centro";
export async function agreementParticipants(moduleId: number) {
  const year = await getActiveAcademicYear();
  const assignments = await db.select().from(teachingAssignmentsTable).where(and(
    eq(teachingAssignmentsTable.moduleId, moduleId), eq(teachingAssignmentsTable.schoolYear, year ?? ""),
    isNull(teachingAssignmentsTable.deletedAt)));
  const memberships = await db.select().from(moduleMembershipsTable).where(and(
    eq(moduleMembershipsTable.moduleId, moduleId), isNull(moduleMembershipsTable.deletedAt)));
  const candidateIds = [...new Set([...assignments.map(a => a.teacherId),
    ...memberships.filter(m => m.role === "coordinator" || m.forumModerator).map(m => m.userId)])];
  const candidates = await db.select().from(usersTable).where(and(
    eq(usersTable.status, "active"), isNull(usersTable.deletedAt),
    or(inArray(usersTable.id, candidateIds.length ? candidateIds : [-1]),
      inArray(usersTable.role, ["superadmin", "coordinator", "department_head"]))));
  const centers = await db.select({ id: centersTable.id, name: centersTable.name }).from(centersTable)
    .where(and(isNull(centersTable.deletedAt), sql`${centersTable.families} @> '["Administración y Gestión"]'::jsonb`));
  const result = [];
  for (const u of candidates) {
    if (!await canReadCurriculumModule(u, moduleId)) continue;
    const centerIds = new Set(assignments.filter(a => a.teacherId === u.id).map(a => a.centerId));
    // A scoped manager or designated moderator can participate from their own
    // real profile center; ordinary teachers use the module's actual assignments.
    if (u.centerId != null && (["superadmin", "coordinator", "department_head"].includes(u.role) ||
      memberships.some(m => m.userId === u.id && (m.forumModerator || m.role === "coordinator")))) centerIds.add(u.centerId);
    result.push({ id: u.id, name: u.name,
      isModerator: memberships.some(m => m.userId === u.id && m.forumModerator),
      centers: centers.filter(c => centerIds.has(c.id)) });
  }
  return result;
}

export async function nextcloudDocumentUrl(value: string) {
  const base = resolveNextcloudUrl(await getSettings());
  if (!base) throw new AgreementError(409, "Configura Nextcloud antes de vincular el borrador. El foro sigue disponible.");
  let canonical: string;
  try { canonical = canonicalResourceUrl(value.trim()); }
  catch { throw new AgreementError(400, "Usa una referencia estable de Nextcloud, sin credenciales ni enlaces públicos de compartición."); }
  const target = new URL(canonical), provider = new URL(base);
  const prefix = provider.pathname.replace(/\/$/, "");
  if (target.origin !== provider.origin || !target.pathname.startsWith(`${prefix}/`) ||
    !/^\/(?:index\.php\/)?f\/[1-9]\d*$/.test(target.pathname.slice(prefix.length)) || target.search) {
    throw new AgreementError(400, "El documento debe ser /f/ID o /index.php/f/ID del Nextcloud configurado.");
  }
  return canonical;
}

// Only probes the configured provider's public health endpoint. It never reads
// private file bytes with an administrator identity. File/module/rights are
// separately attested by the human publisher, not pretended to be verified here.
export async function confirmNextcloudAvailability() {
  const base = resolveNextcloudUrl(await getSettings());
  if (!base) throw new AgreementError(503, "Nextcloud no está configurado; no se ha publicado ninguna versión.");
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/status.php`, { redirect: "error", signal: AbortSignal.timeout(4000) });
    const status = await response.json() as { installed?: boolean; maintenance?: boolean; needsDbUpgrade?: boolean };
    if (!response.ok || status.installed !== true || status.maintenance || status.needsDbUpgrade) throw new Error("unavailable");
  } catch {
    throw new AgreementError(503, "No se pudo confirmar la disponibilidad de Nextcloud. El borrador y el foro siguen guardados; no se ha publicado ninguna versión.");
  }
}

export async function canReadAgreementWiki(pageId: number, user: { id: number }) {
  const [link] = await db.select({ moduleId: sql<number>`(select module_id from forum_agreements where id=${forumAgreementRevisionsTable.agreementId})` })
    .from(forumAgreementRevisionsTable).where(eq(forumAgreementRevisionsTable.publishedPageId, pageId)).limit(1);
  if (!link) return true;
  const [full] = await db.select().from(usersTable).where(and(eq(usersTable.id, user.id), eq(usersTable.status, "active"), isNull(usersTable.deletedAt)));
  return !!full && await canReadCurriculumModule(full, link.moduleId);
}

export async function isAgreementWikiPage(pageId: number) {
  const [row] = await db.select({ id: forumAgreementRevisionsTable.id }).from(forumAgreementRevisionsTable)
    .where(eq(forumAgreementRevisionsTable.publishedPageId, pageId)).limit(1);
  return !!row;
}

// Add to ordinary wiki/search/AI SQL filters, not just the final page download.
// Existing non-agreement pages retain their original access rules.
export async function agreementWikiVisibility(user: { id: number }) {
  const links = await db.select({ moduleId: forumAgreementsTable.moduleId }).from(forumAgreementRevisionsTable)
    .innerJoin(forumAgreementsTable, eq(forumAgreementsTable.id, forumAgreementRevisionsTable.agreementId))
    .where(sql`${forumAgreementRevisionsTable.publishedPageId} is not null`);
  const [full] = await db.select().from(usersTable).where(and(eq(usersTable.id, user.id), eq(usersTable.status, "active"), isNull(usersTable.deletedAt)));
  const allowed: number[] = [];
  if (full) for (const id of new Set(links.map(l => l.moduleId))) if (await canReadCurriculumModule(full, id)) allowed.push(id);
  return sql`not exists (select 1 from forum_agreement_revisions ar
    inner join forum_agreements ag on ag.id=ar.agreement_id
    where ar.published_page_id=${wikiPagesTable.id} and ag.module_id not in (${sql.join((allowed.length ? allowed : [-1]).map(id => sql`${id}`), sql`, `)}))`;
}
