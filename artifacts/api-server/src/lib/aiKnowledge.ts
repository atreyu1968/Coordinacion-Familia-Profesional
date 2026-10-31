import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, notInArray, or, sql, lt } from "drizzle-orm";
import {
  db, usersTable, centersTable, modulesTable, moduleMembershipsTable, teachingAssignmentsTable,
  collaborativeSpacesTable, collaborativeSpaceMembersTable, wikiPagesTable, wikiAttachmentsTable,
  resourcesTable, gdcanResourcesTable, announcementsTable, announcementAttachmentsTable,
  documentFormsTable, documentSubmissionsTable, documentSubmissionValuesTable, documentFormFieldsTable,
  messagesTable, chatGroupsTable, chatGroupMembersTable, coordinatorMailAccountsTable,
  coordinatorMailCasesTable, coordinatorMailMessagesTable, coordinatorMailAttachmentsTable,
  meetingMinutesTable, meetingMinutesSourcesTable, eventsTable, aiKnowledgeAccountsTable,
  aiKnowledgeEntriesTable, lmsCoursesTable, lmsLessonsTable, lmsCourseManagersTable, cyclesTable,
} from "@workspace/db";
import type { User } from "@workspace/db";
import { getSettings, getActiveFamily, getActiveAcademicYear, professionalFamilyOf } from "./settings";
import { resolveReadScope } from "../middlewares/auth";
import { getViewerContext, isInAudience, canManageAudience } from "./audience";
import { canManageMinutes } from "./meetingMinutes";
import { loadAccessibleEvent } from "../routes/events";
import { listManagedGroupFolders, listGroupFolderFiles, readGroupFolderFile, type GroupFolderFile } from "./aiKnowledgeNextcloud";
import { ObjectStorageService } from "./objectStorage";
import { processMaterialBytes } from "./meetingMinutesMedia";
import { sha256 } from "./coordinatorMailSecurity";
import { moduleFolderName, moduleGroupId, independentSpaceFolderName, independentSpaceGroupId, resolveNextcloudConfig, resolveNextcloudUrl } from "./nextcloud";
import { addCoverageOmission, knowledgeSource, newCoverageObservations, summarizeKnowledgeCoverage, summarizePublicLinkCoverage, type CoverageObservations } from "./aiKnowledgeCoverage";
import { PublicPageOmittedError, readPublicPage } from "./aiPublicPage";

type Candidate = {
  key: string; title: string; url: string; version: string; text?: string; fileName?: string;
  read?: () => Promise<Buffer>;
  readText?: () => Promise<string>;
  publicLink?: boolean;
  omission?: string;
};
const storage = new ObjectStorageService();
const MAX_TEXT = 150_000;
const MAX_FILES = 10_000;
const SUPPORTED = /\.(pdf|txt|md|markdown|csv|tsv|json|xml|html?|yml|yaml|log|rst|ini|conf|docx|pptx|xlsx|odt|zip|png|jpe?g|webp|mp3|wav|m4a|ogg|webm|mp4|mov|mkv)$/i;
const mediaTypes = new Set(["pdf", "png", "jpg", "jpeg", "webp", "mp3", "wav", "m4a", "ogg", "webm", "mp4", "mov", "mkv"]);
const candidateSnapshots = new Map<number, { expiresAt: number; items: Candidate[] }>();
const stop = new Set("para con del las los una unos unas por como desde sobre este esta estos estas que quien donde cual cuando cuanto hacer puedes puede favor correo mensaje asunto documentación documentos material plataforma coordinación coordinador coordinadora".split(" "));
const terms = (text: string) => text.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]{3,}/g)?.filter(x => !stop.has(x)) ?? [];

async function objectBytes(objectPath: string): Promise<Buffer> {
  if (!/^\/objects\/uploads\/[a-z0-9._/-]{1,220}$/i.test(objectPath) || objectPath.split("/").some(p => p === ".." || p === ".")) throw new Error("La ruta del documento no es válida.");
  const file = await storage.getObjectEntityFile(objectPath);
  const response = await storage.downloadObject(file, 0);
  if (!response.ok || !response.body) throw new Error("No se pudo leer el archivo autorizado.");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 100 * 1024 * 1024) throw new Error("El archivo supera el máximo de 100 MB."); chunks.push(part.value); }
  } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(chunks);
}
const key = (type: string, id: string | number) => `${type}:${id}`;
const appUrl = (path: string) => path.startsWith("/") && !path.startsWith("//") ? path : "/";

async function userModules(user: User): Promise<Set<number>> {
  const ids = new Set<number>();
  const [center] = user.centerId == null ? [] : await db.select({ provinceId: centersTable.provinceId, families: centersTable.families })
    .from(centersTable).where(and(eq(centersTable.id, user.centerId), isNull(centersTable.deletedAt)));
  const activeFamily = await getActiveFamily();
  const assigned = await db.select({ moduleId: moduleMembershipsTable.moduleId }).from(moduleMembershipsTable)
    .where(and(eq(moduleMembershipsTable.userId, user.id), isNull(moduleMembershipsTable.deletedAt)));
  const year = await getActiveAcademicYear();
  const teaching = await db.select({ moduleId: teachingAssignmentsTable.moduleId }).from(teachingAssignmentsTable)
    .where(and(eq(teachingAssignmentsTable.teacherId, user.id), isNull(teachingAssignmentsTable.deletedAt), year ? eq(teachingAssignmentsTable.schoolYear, year) : undefined));
  const assignedIds = new Set([...assigned, ...teaching].map(x => x.moduleId));
  const modules = await db.select({
    id: modulesTable.id, centerId: modulesTable.centerId, centerProvince: centersTable.provinceId,
    centerFamilies: centersTable.families,
  }).from(modulesTable).leftJoin(centersTable, and(eq(centersTable.id, modulesTable.centerId), isNull(centersTable.deletedAt)))
    .where(and(isNull(modulesTable.deletedAt), or(isNull(modulesTable.centerId), sql`${centersTable.families} @> ${JSON.stringify([activeFamily])}::jsonb`)));
  for (const module of modules) {
    const isAssigned = assignedIds.has(module.id);
    const province = user.provinceId ?? center?.provinceId ?? null;
    const allowed = user.role === "superadmin" ||
      (user.role === "coordinator" && (module.centerId == null || province != null && province === module.centerProvince)) ||
      (user.role === "department_head" && user.centerId != null && user.centerId === module.centerId) ||
      (user.role === "teacher" && isAssigned && (user.centerId == null || user.centerId === module.centerId || module.centerId == null));
    if (allowed) ids.add(module.id);
  }
  return ids;
}

async function filesFromGroupFolders(user: User, moduleIds: Set<number>, out: Candidate[], warnings: string[], coverage: CoverageObservations) {
  try {
    const settings = await getSettings();
    if (!resolveNextcloudConfig(settings) || !resolveNextcloudUrl(settings)) {
      coverage.nextcloud.status = "disconnected";
      coverage.nextcloud.notes.push("Nextcloud no está configurado. La superadministración debe configurar la conexión de solo lectura; no se requiere autorización individual.");
      warnings.push("Nextcloud no está configurado; sus archivos no se han consultado.");
      return;
    }
    const { publicUrl, folders } = await listManagedGroupFolders();
    const byName = new Map(folders.map(folder => [folder.mountPoint, folder]));
    const modules = await db.select({
      id: modulesTable.id, name: modulesTable.name, code: modulesTable.code, centerId: modulesTable.centerId,
    }).from(modulesTable).where(and(isNull(modulesTable.deletedAt), inArray(modulesTable.id, [...moduleIds])));
    const allowedFolders = new Map<number, { title: string; mount: string }>();
    for (const module of modules) {
      const mount = moduleFolderName({ moduleId: module.id, name: module.name, code: module.code });
      const folder = byName.get(mount);
      if (folder?.advancedPermissions) {
        coverage.nextcloud.notes.push("Se omite una carpeta con permisos avanzados para no eludir restricciones de archivo. No se conoce el número de archivos omitidos en ella.");
        warnings.push(`Nextcloud: «${mount}» usa permisos avanzados; no se indexará para evitar que la cuenta técnica eluda una restricción de archivo.`);
      } else if (folder && folder.groups[moduleGroupId(module.id)] != null) {
        allowedFolders.set(folder.id, { title: `Módulo ${module.name}`, mount });
      }
    }
    const spaces = await db.select({ id: collaborativeSpacesTable.id, name: collaborativeSpacesTable.name }).from(collaborativeSpacesTable);
    const memberships = user.role === "superadmin" ? spaces : await db.select({ id: collaborativeSpacesTable.id, name: collaborativeSpacesTable.name })
      .from(collaborativeSpacesTable).innerJoin(collaborativeSpaceMembersTable, eq(collaborativeSpaceMembersTable.spaceId, collaborativeSpacesTable.id))
      .where(eq(collaborativeSpaceMembersTable.userId, user.id));
    for (const space of memberships) {
      const mount = independentSpaceFolderName(space.id);
      const folder = byName.get(mount);
      if (folder?.advancedPermissions) {
        coverage.nextcloud.notes.push("Se omite una carpeta con permisos avanzados para no eludir restricciones de archivo. No se conoce el número de archivos omitidos en ella.");
        warnings.push(`Nextcloud: «${mount}» usa permisos avanzados; no se indexará para evitar que la cuenta técnica eluda una restricción de archivo.`);
      } else if (folder && folder.groups[independentSpaceGroupId(space.id)] != null) {
        allowedFolders.set(folder.id, { title: `Espacio ${space.name}`, mount });
      }
    }
    for (const [folderId, meta] of allowedFolders) {
      const files = await listGroupFolderFiles(folderId);
      for (const file of files) {
        const omission = !SUPPORTED.test(file.fileName) ? "Formato de archivo no compatible. Convierte el original a un formato admitido y vuelve a actualizar." : undefined;
        if (omission) warnings.push(`No se pudo indexar «${file.fileName}» (${meta.title}): formato no compatible.`);
        const pathLabel = file.path.join("/");
        const href = `${publicUrl}/index.php/apps/files/?dir=${encodeURIComponent(`/${meta.mount}/${file.path.slice(0, -1).join("/")}`)}&scrollto=${encodeURIComponent(file.fileName)}`;
        out.push({
          key: `nextcloud:${folderId}:${sha256(JSON.stringify(file.path))}`,
          title: `${meta.title} / ${pathLabel}`, url: href, version: file.etag || `${file.size}`,
          fileName: file.fileName, read: () => readGroupFolderFile(file, file.etag),
          omission,
        });
        if (out.length >= MAX_FILES) throw new Error("Se alcanzó el límite de archivos de conocimiento. La cobertura no es completa.");
      }
    }
  } catch (error) {
    coverage.nextcloud.status = "error";
    coverage.nextcloud.notes.push("No se pudo completar la consulta de Nextcloud. La cobertura puede ser parcial; revisa la conexión administrativa en el panel de control y actualiza el índice. No se requiere autorización individual.");
    warnings.push(error instanceof Error ? `Nextcloud: ${error.message}` : "Nextcloud no pudo consultarse; sus archivos no se usarán.");
  }
}

async function collect(user: User) {
  const { agreementWikiVisibility } = await import("./forumAgreementSupport");
  const items: Candidate[] = []; const warnings: string[] = [];
  const coverage = newCoverageObservations();
  const moduleIds = await userModules(user);
  const add = (item: Candidate) => {
    if (items.length < MAX_FILES) {
      const candidate = item.read && item.fileName
        ? { ...item, version: sha256(`${item.version}|attachment-text-v2`) }
        : item;
      if (!candidate.text && candidate.fileName && !SUPPORTED.test(candidate.fileName)) {
        candidate.omission = "Formato de archivo no compatible. Convierte el original a un formato admitido y vuelve a actualizar.";
      }
      items.push(candidate);
    } else {
      addCoverageOmission(coverage, knowledgeSource(item.key), "Límite de 10.000 materiales alcanzado; este material no se ha incorporado al índice.");
      warnings.push("Se alcanzó el límite de 10.000 fuentes; la cobertura no es completa.");
    }
  };
  const pages = await db.select({
    id: wikiPagesTable.id, title: wikiPagesTable.title, content: wikiPagesTable.content,
    moduleId: wikiPagesTable.moduleId, updatedAt: wikiPagesTable.updatedAt,
  }).from(wikiPagesTable).leftJoin(modulesTable, eq(modulesTable.id, wikiPagesTable.moduleId))
    .where(and(await agreementWikiVisibility(user), isNull(wikiPagesTable.deletedAt), or(isNull(wikiPagesTable.moduleId), and(isNull(modulesTable.deletedAt), inArray(wikiPagesTable.moduleId, [...moduleIds])))));
  const pageIds = pages.map(x => x.id);
  for (const page of pages) add({
    key: key("wiki", page.id), title: `Wiki: ${page.title}`, url: `/wiki/${page.id}`,
    version: sha256(`${page.updatedAt.toISOString()}${page.content}`),
    text: page.content,
  });
  if (pageIds.length) {
    const attachments = await db.select().from(wikiAttachmentsTable).where(and(inArray(wikiAttachmentsTable.pageId, pageIds), isNull(wikiAttachmentsTable.deletedAt)));
    for (const a of attachments) add({
      key: key("wiki-file", a.id), title: `Adjunto de wiki: ${a.fileName}`, url: `/wiki/${a.pageId}`,
      version: `${a.objectPath}:${a.size}:${a.createdAt.toISOString()}`,
      ...(a.indexedText ? { text: a.indexedText } : {}), fileName: a.fileName,
      ...(!a.indexedText ? { read: () => objectBytes(a.objectPath) } : {}),
    });
  }
  const scope = resolveReadScope(user);
  const { authorizedCurriculumResources } = await import("./resourceCurriculumAccess");
  const resourceRows = await authorizedCurriculumResources(
    await db.select().from(resourcesTable).where(isNull(resourcesTable.deletedAt)), user);
  for (const r of resourceRows) {
    const visible = !r.centerId || scope.kind === "global" ||
      scope.kind === "center" && scope.centerId === r.centerId ||
      scope.kind === "province" && (await db.select({ id: centersTable.id }).from(centersTable).where(and(eq(centersTable.id, r.centerId), eq(centersTable.provinceId, scope.provinceId), sql`${centersTable.families} @> ${JSON.stringify([await getActiveFamily()])}::jsonb`))).length > 0;
    if (!visible) continue;
    const objectFileName = r.fileUrl?.startsWith("/objects/uploads/")
      ? r.fileUrl.split(/[?#]/, 1)[0].split("/").pop()
      : undefined;
    add({ key: key("resource", r.id), title: `Material: ${r.title}`, url: `/recursos?resourceId=${r.id}`,
      version: sha256(`${r.title}|${r.description}|${r.fileUrl}`), text: [r.title, r.description].filter(Boolean).join("\n"),
      ...(objectFileName ? {
        fileName: /\.[a-z0-9]{2,8}$/i.test(objectFileName) ? objectFileName : r.title,
        read: () => objectBytes(r.fileUrl!),
      } : {}) });
    if (r.type.trim().toLocaleLowerCase("es") === "enlace") {
      const remoteUrl = r.fileUrl?.trim();
      const validPublicUrl = (() => {
        if (!remoteUrl) return false;
        try {
          const url = new URL(remoteUrl);
          return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
        } catch { return false; }
      })();
      add({
        key: key("resource-url", r.id),
        title: `Página enlazada: ${r.title}`,
        url: `/recursos?resourceId=${r.id}`,
        version: sha256(`public-page-v1|${remoteUrl ?? ""}|${r.title}|${r.description ?? ""}`),
        publicLink: true,
        ...(validPublicUrl
          ? { readText: () => readPublicPage(remoteUrl!) }
          : { omission: "El enlace no contiene una dirección pública HTTP o HTTPS válida." }),
      });
    }
  }
  // GDCAN manuals and references are published platform material, not private
  // administrator data; include them for every user who can use the assistant.
  const gdcanDocs = await db.select().from(gdcanResourcesTable)
    .where(and(isNull(gdcanResourcesTable.deletedAt), inArray(gdcanResourcesTable.type, ["manual", "faq"])));
  for (const doc of gdcanDocs) if (doc.content) add({
    key: key("gdcan", doc.id), title: `GDCAN: ${doc.title}`, url: doc.url ?? "/panel-control",
    version: sha256(`${doc.createdAt.toISOString()}|${doc.content}`), text: doc.content,
  });
  const viewer = await getViewerContext(user);
  const announcements = await db.select().from(announcementsTable).where(isNull(announcementsTable.deletedAt));
  const visibleAnnouncementIds = new Set<number>();
  for (const a of announcements) if (isInAudience(a.audienceType, a.audienceIds, viewer)) {
    visibleAnnouncementIds.add(a.id);
    add({ key: key("announcement", a.id), title: `Tablón: ${a.title}`, url: `/tablon?announcementId=${a.id}`,
      version: sha256(`${a.createdAt.toISOString()}|${a.body}`), text: `${a.title}\n${a.body}` });
  }
  if (visibleAnnouncementIds.size) {
    const rows = await db.select().from(announcementAttachmentsTable).where(inArray(announcementAttachmentsTable.announcementId, [...visibleAnnouncementIds]));
    for (const f of rows) add({ key: key("announcement-file", f.id), title: `Adjunto de tablón: ${f.fileName}`,
      url: `/tablon?announcementId=${f.announcementId}`, version: `${f.objectPath}:${f.size}`, fileName: f.fileName, read: () => objectBytes(f.objectPath) });
  }
  // Submissions are private to their author, or visible to a manager who can
  // manage the form's audience. The audience check is re-evaluated each scan.
  const submissions = await db.select({
    submissionId: documentSubmissionsTable.id, formId: documentFormsTable.id, formTitle: documentFormsTable.title,
    userId: documentSubmissionsTable.userId, audienceType: documentFormsTable.audienceType,
    audienceIds: documentFormsTable.audienceIds,
  }).from(documentSubmissionsTable).innerJoin(documentFormsTable, eq(documentFormsTable.id, documentSubmissionsTable.formId))
    .where(isNull(documentFormsTable.deletedAt));
  const allowedSubmissionIds = new Set<number>();
  for (const s of submissions) if (s.userId === user.id || await canManageAudience(user, s.audienceType, s.audienceIds)) {
    allowedSubmissionIds.add(s.submissionId);
    add({ key: key("submission", s.submissionId), title: `Formulario: ${s.formTitle}`, url: `/documentos?formId=${s.formId}`,
      version: `${s.submissionId}:${s.formId}` });
  }
  if (allowedSubmissionIds.size) {
    const values = await db.select({
      id: documentSubmissionValuesTable.id, fieldId: documentSubmissionValuesTable.fieldId,
      value: documentSubmissionValuesTable.value, objectPath: documentSubmissionValuesTable.objectPath,
      fileName: documentSubmissionValuesTable.fileName, submissionId: documentSubmissionValuesTable.submissionId,
      label: documentFormFieldsTable.label,
    }).from(documentSubmissionValuesTable).leftJoin(documentFormFieldsTable, eq(documentFormFieldsTable.id, documentSubmissionValuesTable.fieldId))
      .where(inArray(documentSubmissionValuesTable.submissionId, [...allowedSubmissionIds]));
    for (const v of values) if (v.value || v.objectPath) add({
      key: key("submission-value", v.id), title: `Documento entregado: ${v.fileName ?? v.label ?? "campo"}`, url: `/documentos`,
      version: `${v.id}:${v.value ?? ""}:${v.objectPath ?? ""}`,
      ...(v.value ? { text: `${v.label ?? "Campo"}: ${v.value}` } : {}),
      ...(v.objectPath ? { fileName: v.fileName ?? v.label ?? "documento", read: () => objectBytes(v.objectPath!) } : {}),
    });
  }
  const mail = await db.select().from(coordinatorMailAccountsTable).where(eq(coordinatorMailAccountsTable.userId, user.id));
  if (mail.length && ["coordinator", "superadmin"].includes(user.role)) {
    if (mail.some(account => !account.refreshTokenEncrypted)) {
      coverage.gmail.status = "disconnected";
      coverage.gmail.notes.push("Gmail está desconectado. Los recuentos solo incluyen correos conservados de importaciones anteriores.");
    } else if (mail.some(account => account.syncStatus === "queued" || account.syncStatus === "syncing" || account.lastSyncAt == null)) {
      coverage.gmail.status = "importing";
      coverage.gmail.notes.push("La importación completa de Gmail sigue en curso. El total de correos aún no importados es desconocido y no está incluido en los pendientes del índice.");
      warnings.push("La importación del historial completo de Gmail sigue en curso; los correos aún no importados no se han consultado.");
    }
    for (const account of mail) {
      if (account.syncStatus === "error" || account.syncStatus === "needs_reauthorization") {
        coverage.gmail.status = "error";
        coverage.gmail.notes.push("La sincronización de Gmail está detenida. Solo se incluyen correos ya importados; revisa la conexión de Gmail para continuar.");
        warnings.push(`Gmail (${account.email}): la sincronización está detenida; el índice solo incluye los mensajes importados anteriormente.`);
      }
    }
    const cases = await db.select().from(coordinatorMailCasesTable).where(eq(coordinatorMailCasesTable.ownerId, user.id));
    for (const c of cases) {
      const msgs = await db.select().from(coordinatorMailMessagesTable).where(and(
        eq(coordinatorMailMessagesTable.caseId, c.id), eq(coordinatorMailMessagesTable.ownerId, user.id),
      )).orderBy(desc(coordinatorMailMessagesTable.receivedAt));
      for (const m of msgs) add({
        key: key("mail", m.id), title: `Correo: ${m.subject}`, url: `/asuntos-correo/${c.id}`,
        version: sha256(`${m.receivedAt.toISOString()}|${m.bodyText}`), text: `De: ${m.senderName} <${m.senderEmail}>\nAsunto: ${m.subject}\n${m.bodyText}`,
      });
      const attachments = await db.select().from(coordinatorMailAttachmentsTable)
        .innerJoin(coordinatorMailMessagesTable, eq(coordinatorMailMessagesTable.id, coordinatorMailAttachmentsTable.messageId))
        .where(and(eq(coordinatorMailMessagesTable.caseId, c.id), eq(coordinatorMailMessagesTable.ownerId, user.id)));
      for (const joined of attachments) {
        const attachment = joined.coordinator_mail_attachments;
        if (attachment.status !== "ready") {
          if (attachment.status === "error") {
            coverage.gmail.errors = (coverage.gmail.errors ?? 0) + 1;
            const note = "Hay adjuntos de Gmail cuya descarga falló; el índice aún no puede leerlos. Reintenta la sincronización de Gmail antes de actualizar el índice.";
            if (!coverage.gmail.notes.includes(note)) coverage.gmail.notes.push(note);
          } else {
            coverage.gmail.pending = (coverage.gmail.pending ?? 0) + 1;
            const note = "Hay adjuntos de Gmail pendientes de descarga; todavía no pueden indexarse.";
            if (!coverage.gmail.notes.includes(note)) coverage.gmail.notes.push(note);
          }
          continue;
        }
        add({
        key: key("mail-attachment", attachment.id), title: `Adjunto de correo: ${attachment.fileName}`, url: `/asuntos-correo/${c.id}`,
        version: `${attachment.objectPath}:${attachment.size}`, fileName: attachment.fileName,
        read: () => attachment.objectPath ? objectBytes(attachment.objectPath) : Promise.reject(new Error("El adjunto no está disponible.")),
        });
      }
    }
  } else if (["coordinator", "superadmin"].includes(user.role)) {
    warnings.push("Gmail no está conectado; consulta los ajustes de Asuntos de correo.");
    coverage.gmail.status = "disconnected";
    coverage.gmail.notes.push("Gmail no está conectado. Conecta el buzón desde Asuntos de correo para importar sus mensajes.");
  }
  // Messages are included only while the user still participates in a chat.
  const memberships = await db.select({ id: chatGroupMembersTable.groupId }).from(chatGroupMembersTable)
    .innerJoin(chatGroupsTable, eq(chatGroupsTable.id, chatGroupMembersTable.groupId))
    .where(eq(chatGroupMembersTable.userId, user.id));
  const groups = [...new Set(memberships.map(m => m.id))];
  const chats = await db.select().from(messagesTable).where(and(isNull(messagesTable.deletedAt), or(
    and(isNull(messagesTable.groupId), or(eq(messagesTable.senderId, user.id), eq(messagesTable.recipientId, user.id))),
    groups.length ? inArray(messagesTable.groupId, groups) : undefined,
  )));
  for (const m of chats) {
    add({ key: key("chat", m.id), title: `Chat: ${m.attachmentName || "mensaje"}`, url: "/chat",
      version: sha256(`${m.createdAt.toISOString()}|${m.content}|${m.attachmentPath}`),
      text: m.content, ...(m.attachmentPath ? { fileName: m.attachmentName ?? "adjunto", read: () => objectBytes(m.attachmentPath!) } : {}) });
  }
  const events = await db.select().from(eventsTable).where(isNull(eventsTable.deletedAt));
  for (const event of events) {
    const permission = await loadAccessibleEvent(event.id, user);
    if (!permission.ok) continue;
    const eventRecord = permission.event;
    const [minutes] = await db.select().from(meetingMinutesTable).where(eq(meetingMinutesTable.eventId, event.id));
    if (minutes?.publishedText) add({ key: key("minutes-published", event.id), title: `Acta publicada: ${eventRecord.name}`, url: `/eventos/${event.id}`,
      version: `${minutes.revision}:${minutes.publishedAt?.toISOString() ?? ""}`, text: minutes.publishedText });
    if (!minutes?.enabled || !canManageMinutes(user, eventRecord)) continue;
    const sources = await db.select().from(meetingMinutesSourcesTable).where(and(eq(meetingMinutesSourcesTable.eventId, event.id), eq(meetingMinutesSourcesTable.purpose, "evidence"), eq(meetingMinutesSourcesTable.status, "ready")));
    for (const source of sources) add({ key: key("minutes-source", source.id), title: `Reunión ${eventRecord.name}: ${source.fileName}`,
      url: `/eventos/${event.id}`, version: `${source.objectPath}:${source.createdAt.toISOString()}`,
      ...(source.extractedText ? { text: source.extractedText } : {}), ...(!source.extractedText ? { fileName: source.fileName, read: () => objectBytes(source.objectPath) } : {}) });
  }
  const lms = await db.select({
    course: lmsCoursesTable, lesson: lmsLessonsTable,
  }).from(lmsLessonsTable).innerJoin(lmsCoursesTable, eq(lmsCoursesTable.id, lmsLessonsTable.courseId))
    .where(and(eq(lmsCoursesTable.status, "published"), isNull(lmsCoursesTable.deletedAt), isNull(lmsLessonsTable.deletedAt)));
  for (const row of lms) {
    if (row.course.moduleId != null && !moduleIds.has(row.course.moduleId)) continue;
    if (row.course.moduleId == null && user.role !== "superadmin") continue;
    const content = JSON.stringify(row.lesson.content);
    add({ key: key("lms", row.lesson.id), title: `Curso ${row.course.title}: ${row.lesson.title}`, url: `/cursos/${row.course.id}`,
      version: `${row.lesson.updatedAt.toISOString()}:${content}:${row.lesson.objectPath ?? ""}`,
      text: `${row.course.title}\n${row.lesson.title}\n${content}`,
      ...(row.lesson.objectPath ? { fileName: row.lesson.objectName ?? row.lesson.title, read: () => objectBytes(row.lesson.objectPath!) } : {}) });
  }
  await filesFromGroupFolders(user, moduleIds, items, warnings, coverage);
  return { items, warnings: [...new Set(warnings)], coverage };
}

async function recordCandidate(userId: number, item: Candidate, retryFailures = false) {
  const [existing] = await db.select().from(aiKnowledgeEntriesTable).where(and(eq(aiKnowledgeEntriesTable.userId, userId), eq(aiKnowledgeEntriesTable.sourceKey, item.key))).limit(1);
  const text = item.text?.slice(0, MAX_TEXT) ?? "";
  const warning = item.omission ?? (item.text && item.text.length > MAX_TEXT ? "El texto indexado se ha recortado al límite de seguridad." : null);
  const status = item.omission
    ? "unsupported"
    : item.readText || item.read && item.fileName
      ? "pending"
      : item.text
        ? "ready"
        : "pending";
  if (!existing) {
    await db.insert(aiKnowledgeEntriesTable).values({ userId, sourceKey: item.key, title: item.title, url: appUrl(item.url),
      version: item.version, text, status, warning });
  } else if (existing.version !== item.version || retryFailures && (
    existing.status === "error" || item.publicLink && (existing.status === "unsupported" || existing.status === "ready")
  )) {
    await db.update(aiKnowledgeEntriesTable).set({ title: item.title, url: appUrl(item.url), version: item.version,
      text, status, warning, leaseToken: null, leaseUntil: null, updatedAt: new Date() })
      .where(and(eq(aiKnowledgeEntriesTable.id, existing.id), eq(aiKnowledgeEntriesTable.version, existing.version)));
  } else {
    await db.update(aiKnowledgeEntriesTable).set({ title: item.title, url: appUrl(item.url) })
      .where(eq(aiKnowledgeEntriesTable.id, existing.id));
  }
}
export async function synchronizeAiKnowledge(userId: number, retryFailures = false) {
  const [user] = await db.select().from(usersTable).where(and(eq(usersTable.id, userId), eq(usersTable.status, "active")));
  if (!user) {
    candidateSnapshots.delete(userId);
    await db.delete(aiKnowledgeEntriesTable).where(eq(aiKnowledgeEntriesTable.userId, userId));
    return { status: "consent_required", pending: 0, ready: 0, errors: 0, sources: [], warnings: [] as string[] };
  }
  const accounts = await db.insert(aiKnowledgeAccountsTable).values({ userId, consentAt: new Date() })
    .onConflictDoUpdate({ target: aiKnowledgeAccountsTable.userId, set: { consentAt: new Date(), scanError: null } }).returning();
  let collected: Awaited<ReturnType<typeof collect>>;
  try {
    collected = await collect(user);
  } catch {
    await db.update(aiKnowledgeAccountsTable).set({ scanError: "No se pudo actualizar el índice; no se utilizará contenido desactualizado.", scannedAt: new Date() })
      .where(eq(aiKnowledgeAccountsTable.userId, userId));
    throw new Error("No se pudo comprobar el acceso actual a todos los materiales. Vuelve a intentarlo; no se enviará contenido desactualizado a la IA.");
  }
  candidateSnapshots.set(userId, { expiresAt: Date.now() + 10 * 60_000, items: collected.items });
  const stamp = new Date();
  for (const item of collected.items) await recordCandidate(userId, item, retryFailures);
  const keys = collected.items.map(i => i.key);
  if (keys.length) {
    await db.delete(aiKnowledgeEntriesTable).where(and(eq(aiKnowledgeEntriesTable.userId, userId), notInArray(aiKnowledgeEntriesTable.sourceKey, keys)));
  } else await db.delete(aiKnowledgeEntriesTable).where(eq(aiKnowledgeEntriesTable.userId, userId));
  await db.update(aiKnowledgeAccountsTable).set({ scannedAt: stamp, scanError: null }).where(eq(aiKnowledgeAccountsTable.userId, userId));
  const counts = await db.select({ status: aiKnowledgeEntriesTable.status }).from(aiKnowledgeEntriesTable).where(eq(aiKnowledgeEntriesTable.userId, userId));
  return {
    status: "ready" as const, ready: counts.filter(x => x.status === "ready").length,
    pending: counts.filter(x => x.status === "pending" || x.status === "processing").length,
    errors: counts.filter(x => x.status === "error" || x.status === "unsupported").length,
    sources: counts.length, warnings: collected.warnings,
  };
}

export async function getAiKnowledgeCoverage(userId: number) {
  const [user] = await db.select().from(usersTable).where(and(eq(usersTable.id, userId), eq(usersTable.status, "active")));
  if (!user) throw new Error("Usuario no disponible.");
  // This is a read-only scan: no consent is recorded, files are not extracted,
  // and no material is sent to a model merely by opening the preview.
  const collected = await collect(user);
  const entries = await db.select({
    sourceKey: aiKnowledgeEntriesTable.sourceKey, version: aiKnowledgeEntriesTable.version,
    status: aiKnowledgeEntriesTable.status, warning: aiKnowledgeEntriesTable.warning,
  }).from(aiKnowledgeEntriesTable).where(eq(aiKnowledgeEntriesTable.userId, userId));
  const links = summarizePublicLinkCoverage(collected.items, entries);
  const [account] = await db.select({ scannedAt: aiKnowledgeAccountsTable.scannedAt, scanError: aiKnowledgeAccountsTable.scanError })
    .from(aiKnowledgeAccountsTable).where(eq(aiKnowledgeAccountsTable.userId, userId));
  if (account?.scanError) collected.coverage.platform.notes.push("La última actualización del índice falló. Vuelve a actualizar antes de generar un borrador.");
  return {
    checkedAt: new Date().toISOString(), lastIndexedAt: account?.scannedAt?.toISOString() ?? null,
    sources: summarizeKnowledgeCoverage(collected.items, entries, collected.coverage), links,
  };
}

export async function processOneAiKnowledgeJob() {
  const claimed = await db.transaction(async tx => {
    const [candidate] = await tx.select({ entry: aiKnowledgeEntriesTable }).from(aiKnowledgeEntriesTable)
      .innerJoin(aiKnowledgeAccountsTable, and(eq(aiKnowledgeAccountsTable.userId, aiKnowledgeEntriesTable.userId), sql`${aiKnowledgeAccountsTable.consentAt} IS NOT NULL`))
      .where(or(eq(aiKnowledgeEntriesTable.status, "pending"), and(eq(aiKnowledgeEntriesTable.status, "processing"), lt(aiKnowledgeEntriesTable.leaseUntil, new Date()))))
      .orderBy(aiKnowledgeEntriesTable.id).limit(1).for("update", { skipLocked: true, of: aiKnowledgeEntriesTable });
    if (!candidate) return null;
    const token = randomUUID();
    const [row] = await tx.update(aiKnowledgeEntriesTable).set({ status: "processing", leaseToken: token, leaseUntil: new Date(Date.now() + 180000) })
      .where(eq(aiKnowledgeEntriesTable.id, candidate.entry.id)).returning();
    return row ? { row, token } : null;
  });
  if (!claimed) return false;
  try {
    const [user] = await db.select().from(usersTable).where(and(eq(usersTable.id, claimed.row.userId), eq(usersTable.status, "active")));
    const [account] = await db.select().from(aiKnowledgeAccountsTable).where(eq(aiKnowledgeAccountsTable.userId, claimed.row.userId));
    if (!user || !account?.consentAt) throw new Error("La autorización del usuario ya no está activa.");
    // A user's explicit sync refreshes the source snapshot before any results
    // can be sent to an AI provider. The worker never crawls every remote folder
    // once per file.
    let snapshot = candidateSnapshots.get(claimed.row.userId);
    if (!snapshot || snapshot.expiresAt <= Date.now()) {
      await synchronizeAiKnowledge(claimed.row.userId);
      snapshot = candidateSnapshots.get(claimed.row.userId);
    }
    const item = snapshot && snapshot.expiresAt > Date.now()
      ? snapshot.items.find(x => x.key === claimed.row.sourceKey && x.version === claimed.row.version)
      : undefined;
    if (!snapshot || snapshot.expiresAt <= Date.now()) return false;
    if (!item) throw new Error("El material se eliminó, cambió o ya no es accesible.");
    let text = item.text ?? "";
    if (item.readText) {
      try {
        text = [text, await item.readText()].filter(Boolean).join("\n\n");
      } catch (error) {
        if (error instanceof PublicPageOmittedError) {
          await db.update(aiKnowledgeEntriesTable).set({ status: "unsupported", warning: error.message, leaseToken: null, leaseUntil: null, updatedAt: new Date() })
            .where(and(eq(aiKnowledgeEntriesTable.id, claimed.row.id), eq(aiKnowledgeEntriesTable.leaseToken, claimed.token)));
          return true;
        }
        throw error;
      }
    } else if (item.read && item.fileName) {
      const bytes = await item.read();
      const ext = item.fileName.split(".").pop()?.toLowerCase() ?? "";
      if (!SUPPORTED.test(item.fileName) || !mediaTypes.has(ext) && !/\.(txt|md|markdown|csv|tsv|json|xml|html?|yml|yaml|log|rst|ini|conf|docx|pptx|xlsx|odt|zip)$/i.test(item.fileName)) {
        await db.update(aiKnowledgeEntriesTable).set({ status: "unsupported", warning: "Formato no compatible.", leaseToken: null, leaseUntil: null, updatedAt: new Date() })
          .where(and(eq(aiKnowledgeEntriesTable.id, claimed.row.id), eq(aiKnowledgeEntriesTable.leaseToken, claimed.token)));
        return true;
      }
      const extracted = await processMaterialBytes(item.fileName, bytes);
      text = [text, extracted].filter(Boolean).join("\n\n");
    }
    if (!text.trim()) throw new Error("No se extrajo texto legible; se conserva el original sin enviarlo a la IA.");
    const truncated = text.length > MAX_TEXT;
    await db.update(aiKnowledgeEntriesTable).set({ text: text.slice(0, MAX_TEXT), status: "ready",
      warning: truncated ? "Contenido recortado al límite de 150.000 caracteres." : null,
      leaseToken: null, leaseUntil: null, updatedAt: new Date() })
      .where(and(eq(aiKnowledgeEntriesTable.id, claimed.row.id), eq(aiKnowledgeEntriesTable.leaseToken, claimed.token)));
  } catch (error) {
    await db.update(aiKnowledgeEntriesTable).set({ status: "error", warning: error instanceof Error ? error.message.slice(0, 300) : "No se pudo leer el archivo.",
      leaseToken: null, leaseUntil: null, updatedAt: new Date() }).where(and(eq(aiKnowledgeEntriesTable.id, claimed.row.id), eq(aiKnowledgeEntriesTable.leaseToken, claimed.token)));
  }
  return true;
}
let workerTimer: ReturnType<typeof setInterval> | undefined;
export function startAiKnowledgeWorker() {
  if (workerTimer) return;
  let busy = false;
  workerTimer = setInterval(() => {
    if (busy) return; busy = true;
    void processOneAiKnowledgeJob().catch(() => undefined).finally(() => { busy = false; });
  }, 5000);
  workerTimer.unref();
}

export async function getAiKnowledgeContext(userId: number, prompt: string) {
  const [account] = await db.select().from(aiKnowledgeAccountsTable).where(eq(aiKnowledgeAccountsTable.userId, userId));
  if (!account?.consentAt) return { context: "", sources: [] as string[], warnings: ["Activa la consulta de materiales de la plataforma antes de usar esta función de IA."] };
  // Retrieval is a security boundary, including callers other than the chat
  // route. Never trust a previous scan after a transfer or membership removal.
  await synchronizeAiKnowledge(userId);
  const rows = await db.select().from(aiKnowledgeEntriesTable).where(and(eq(aiKnowledgeEntriesTable.userId, userId), eq(aiKnowledgeEntriesTable.status, "ready")));
  const queryTerms = [...new Set(terms(prompt))];
  const scored: Array<{ score: number; title: string; url: string; excerpt: string; warning: string | null }> = [];
  for (const row of rows) {
    const body = row.text.slice(0, MAX_TEXT);
    const titleWords = terms(row.title);
    const chunks: string[] = [];
    for (let start = 0; start < body.length; start += 1800) chunks.push(body.slice(start, start + 2200));
    if (chunks.length === 0) chunks.push("");
    for (const chunk of chunks) {
      const words = terms(chunk);
      const score = queryTerms.reduce((n, q) =>
        n +
        (titleWords.includes(q) ? 5 : 0) +
        (words.includes(q) ? 1 + Math.min(3, words.filter(w => w === q).length) : 0),
      0);
      if (score) scored.push({ score, title: row.title, url: row.url, excerpt: chunk || row.title, warning: row.warning });
    }
  }
  const selected = scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, 28);
  const sources = [...new Set(selected.map(s => s.title))];
  const context = selected.map((s, i) => `[F${i + 1}] ${s.title}\n${s.excerpt}`).join("\n\n");
  const warnings: string[] = [];
  const pending = await db.select({ id: aiKnowledgeEntriesTable.id, status: aiKnowledgeEntriesTable.status, title: aiKnowledgeEntriesTable.title })
    .from(aiKnowledgeEntriesTable).where(and(eq(aiKnowledgeEntriesTable.userId, userId), inArray(aiKnowledgeEntriesTable.status, ["pending", "processing", "error", "unsupported"])));
  const processing = pending.filter(p => p.status === "pending" || p.status === "processing").length;
  if (processing) warnings.push(`${processing} archivos aún están pendientes de extracción; no se han consultado.`);
  if (pending.some(p => p.status === "error" || p.status === "unsupported")) warnings.push(`${pending.filter(p => p.status === "error" || p.status === "unsupported").length} archivos no pudieron leerse y no se han consultado.`);
  if (!selected.length) warnings.push("No hay documentos indexados que coincidan con la consulta; no se debe afirmar que se revisó todo el material.");
  return { context, sources, warnings };
}
