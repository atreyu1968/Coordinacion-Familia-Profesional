import { Router, type Request, type Response, type NextFunction } from "express";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db, forumThreadsTable, forumThreadContextsTable, forumPostsTable, usersTable, wikiPagesTable,
  forumAgreementsTable as agreements, forumAgreementRevisionsTable as revisions,
  forumAgreementPositionsTable as positions, forumAgreementPositionHistoryTable as history, type User,
} from "@workspace/db";
import { SaveForumAgreementBody, RecordAgreementPositionBody, PublishForumAgreementBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { canReadCurriculumModule } from "../lib/resourceCurriculumAccess";
import { structure } from "./forumCollaboration";
import { getSettings } from "../lib/settings";
import { resolveNextcloudUrl } from "../lib/nextcloud";
import {
  AgreementError, agreementParticipants, nextcloudDocumentUrl, confirmNextcloudAvailability, REFERENCE_LEGEND,
} from "../lib/forumAgreementSupport";
import { canonicalResourceUrl } from "./curriculumResources";
import { enqueueForumDigest } from "../lib/forumDigestQueue";

const router = Router();
type Agreement = typeof agreements.$inferSelect;
type Store = Pick<typeof db, "select" | "insert" | "update" | "execute">;
const root = "/forum/threads/:threadId/agreement";
const CLOSED = ["consensuado", "sin_consenso"];
const safe = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const record = (a: Agreement) => {
  const { electorateIds: _census, createdBy: _creator, updatedBy: _editor, ...rest } = a;
  return { ...rest, responsibleId: a.createdBy, reviewerId: a.updatedBy, updatedAt: a.updatedAt.toISOString() };
};
function participation(a: Agreement | undefined, rows: { userId: number; centerId: number | null; centerName: string }[]) {
  const teachers = new Set(rows.map(r => r.userId)).size;
  const centers = new Set(rows.map(r => r.centerId ?? `retirado:${r.centerName}`)).size;
  const eligible = a?.electorateIds.length ?? 0;
  const limited = teachers === 0 || teachers < eligible || centers < 2;
  return { teachers, centers, eligible, limited,
    warning: limited ? "Participación limitada: se muestran las personas y centros que realmente han intervenido. No implica unanimidad ni aprobación institucional."
      : "La participación registrada no constituye aprobación institucional ni permite presumir unanimidad." };
}
async function current(store: Store, threadId: number) {
  return (await store.select().from(agreements).where(eq(agreements.threadId, threadId)))[0];
}
async function currentPositions(store: Store, a: Agreement) {
  return store.select().from(positions).where(and(eq(positions.agreementId, a.id), eq(positions.version, a.version)));
}
async function audit(store: Store, a: Agreement, actorId: number) {
  const counts = participation(a, await currentPositions(store, a));
  await store.insert(revisions).values({ agreementId: a.id, revision: a.revision, version: a.version,
    snapshot: { agreement: record(a), participation: counts }, actorId, publishedPageId: a.publishedPageId });
}
async function workspace(threadId: number, moduleId: number, user: User) {
  const [a, state, participants] = await Promise.all([
    current(db, threadId), structure(db, moduleId, user), agreementParticipants(moduleId),
  ]);
  const canDelegate = state.canConfigure;
  const canEdit = canDelegate || !!a?.editorIds.includes(user.id) && participants.some(p => p.id === user.id && p.isModerator);
  const canPublish = canDelegate && ["superadmin", "coordinator"].includes(user.role);
  const currentRows = a ? await db.select({ position: positions, userName: usersTable.name }).from(positions)
    .leftJoin(usersTable, eq(usersTable.id, positions.userId)).where(and(eq(positions.agreementId, a.id), eq(positions.version, a.version)))
    .orderBy(asc(positions.updatedAt)) : [];
  const historical = a ? await db.select({ position: history, userName: usersTable.name }).from(history)
    .leftJoin(usersTable, eq(usersTable.id, history.userId)).where(eq(history.agreementId, a.id)).orderBy(desc(history.updatedAt)) : [];
  const changes = a ? await db.select({ revision: revisions, actorName: usersTable.name }).from(revisions)
    .leftJoin(usersTable, eq(usersTable.id, revisions.actorId)).where(eq(revisions.agreementId, a.id)).orderBy(desc(revisions.revision)) : [];
  return {
    moduleId, threadId, canEdit, canDelegate, canPublish,
    canPosition: !!a && a.status === "consulta" && state.verificationCurrent && state.configuration?.enabled === true &&
      state.diagnostics.length === 0 && a.fingerprint === state.fingerprint &&
      a.electorateIds.includes(user.id) && participants.some(p => p.id === user.id && p.centers.length > 0),
    fingerprint: state.fingerprint,
    curriculumCurrent: !!state.configuration?.enabled && state.verificationCurrent && state.diagnostics.length === 0 &&
      (!a || a.fingerprint === state.fingerprint),
    nextcloudConfigured: !!resolveNextcloudUrl(await getSettings()),
    agreement: a ? record(a) : null,
    revisions: changes.map(({ revision: r, actorName }) => ({ revision: r.revision, version: r.version,
      actorName, createdAt: r.createdAt.toISOString(), snapshot: r.snapshot.agreement, participation: r.snapshot.participation })),
    positions: currentRows.map(({ position: p, userName }) => ({ ...p, userName, updatedAt: p.updatedAt.toISOString() })),
    positionHistory: historical.map(({ position: p, userName }) => ({ ...p, userName, updatedAt: p.updatedAt.toISOString() })),
    participants, participation: participation(a, currentRows.map(r => r.position)),
  };
}
const handle = (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { await fn(req, res); if (!res.headersSent) next(); } catch (e) {
      if (e instanceof AgreementError) { res.status(e.status).json({ message: e.message }); return; }
      if ((e as { code?: string; cause?: { code?: string } }).code === "23505" ||
        (e as { cause?: { code?: string } }).cause?.code === "23505") {
        res.status(409).json({ message: "El acuerdo ha cambiado; recarga antes de guardar." }); return;
      }
      next(e);
    }
  };
router.use(root, requireAuth, handle(async (req, res) => {
  const id = Number(req.params.threadId);
  if (!Number.isSafeInteger(id) || id < 1) throw new AgreementError(400, "Hilo inválido.");
  const [thread] = await db.select({ id: forumThreadsTable.id, moduleId: forumThreadsTable.moduleId, title: forumThreadsTable.title })
    .from(forumThreadsTable).innerJoin(forumThreadContextsTable, eq(forumThreadContextsTable.threadId, forumThreadsTable.id))
    .where(and(eq(forumThreadsTable.id, id), isNull(forumThreadsTable.deletedAt)));
  if (!thread) throw new AgreementError(404, "La ficha requiere un hilo estructurado activo.");
  if (!await canReadCurriculumModule(req.user!, thread.moduleId)) throw new AgreementError(403, "Módulo fuera de tu ámbito actual.");
  res.locals.agreementThread = thread;
}));
// The guard above calls next only after its asynchronous checks have completed.
// An explicit middleware wrapper is used below instead of router-wide auth.
router.get(root, handle(async (req, res) => {
  const t = res.locals.agreementThread;
  res.json(await workspace(t.id, t.moduleId, req.user!));
}));

router.put(root, handle(async (req, res) => {
  const parsed = SaveForumAgreementBody.safeParse(req.body);
  if (!parsed.success) throw new AgreementError(400, "Revisa los campos de la ficha de acuerdo.");
  const input = parsed.data, user = req.user!, t = res.locals.agreementThread;
  const rights = await workspace(t.id, t.moduleId, user);
  if (!rights.canEdit) throw new AgreementError(403, "Solo coordinación o un moderador delegado puede preparar la síntesis.");
  let opened = false;
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(1950, ${t.id})`);
    const before = await current(tx, t.id);
    if ((before?.revision ?? 0) !== input.revision) throw new AgreementError(409, "La ficha ha cambiado. Conserva tu texto y recarga la versión actual.");
    if (before && input.status === "archivado" && !input.newVersion) {
      const [a] = await tx.update(agreements).set({ status: "archivado", revision: before.revision + 1,
        updatedBy: user.id, updatedAt: new Date() }).where(eq(agreements.id, before.id)).returning();
      await audit(tx, a, user.id);
      await enqueueForumDigest(tx, { moduleId: t.moduleId, threadId: t.id, actorId: user.id,
        eventKey: `agreement:${a.id}:${a.revision}`, kind: "synthesis" });
      return;
    }
    const state = await structure(tx, t.moduleId, user);
    if (!state.configuration?.enabled || !state.verificationCurrent || state.diagnostics.length ||
      input.fingerprint !== state.fingerprint || before && !input.newVersion && before.fingerprint !== state.fingerprint) {
      throw new AgreementError(409, "El currículo debe estar revisado y activo; una revisión normativa requiere una nueva versión del acuerdo.");
    }
    if (input.newVersion && (!before || ![...CLOSED, "archivado", "revision_normativa"].includes(before.status) && !before.publishedPageId)) {
      throw new AgreementError(409, "Cierra o archiva la consulta antes de abrir una nueva versión.");
    }
    if (input.newVersion && input.status !== "abierto") throw new AgreementError(400, "La nueva versión comienza abierta y sin posturas trasladadas.");
    if (before?.publishedPageId && !input.newVersion) throw new AgreementError(409, "La versión publicada es inmutable. Abre una nueva versión.");
    if (before && CLOSED.includes(before.status) && !input.newVersion) throw new AgreementError(409, "El cierre está documentado. Abre una nueva versión para modificarlo.");
    const editorIds = [...new Set(input.editorIds)];
    if (!rights.canDelegate && JSON.stringify(editorIds.slice().sort()) !== JSON.stringify((before?.editorIds ?? []).slice().sort())) {
      throw new AgreementError(403, "No puedes cambiar las delegaciones de síntesis.");
    }
    if (editorIds.some(id => !rights.participants.some(p => p.id === id && p.isModerator))) {
      throw new AgreementError(400, "Solo puedes delegar la síntesis en moderadores designados de este módulo.");
    }
    const sources = input.sources.map(s => {
      const title = s.title.trim(); let url: string;
      try {
        if (/^\/(?:foros|documentacion)(?:\?|$)/.test(s.url)) {
          const internal = new URL(s.url, "https://internal.invalid");
          if (internal.hash || [...internal.searchParams].some(([key, value]) =>
            !["module", "thread", "tema", "page"].includes(key) || !/^[1-9]\d*$/.test(value))) throw new Error("unsafe internal reference");
          url = `${internal.pathname}${internal.search}`;
        } else url = canonicalResourceUrl(s.url);
        if (url.startsWith("/api/")) throw new Error("private download");
      } catch { throw new AgreementError(400, "Las fuentes deben ser referencias seguras, sin credenciales ni enlaces de compartición."); }
      if (!title) throw new AgreementError(400, "Cada fuente necesita un título.");
      return { title, url };
    });
    let officialUrl: string;
    try { officialUrl = canonicalResourceUrl(state.configuration.sourceUrl); }
    catch { throw new AgreementError(400, "Revisa la fuente curricular: no se publican credenciales ni enlaces portadores de acceso."); }
    const official = { title: state.configuration.sourceTitle, url: officialUrl };
    if (!sources.some(s => s.url === official.url)) sources.unshift(official);
    const sourcePostIds = [...new Set(input.sourcePostIds)];
    if (sourcePostIds.length) {
      const posts = await tx.select({ id: forumPostsTable.id }).from(forumPostsTable).where(and(
        inArray(forumPostsTable.id, sourcePostIds), eq(forumPostsTable.threadId, t.id), isNull(forumPostsTable.deletedAt)));
      if (posts.length !== sourcePostIds.length) throw new AgreementError(400, "Las aportaciones citadas deben estar disponibles en este hilo.");
    }
    const documentUrl = input.documentUrl?.trim() ? await nextcloudDocumentUrl(input.documentUrl) : null;
    const summary = input.summary.trim(), proposedText = input.proposedText.trim();
    if (["consulta", ...CLOSED].includes(input.status) && (!summary || !proposedText || !documentUrl)) {
      throw new AgreementError(400, "La consulta y el cierre requieren síntesis, texto consolidado y un borrador vinculado.");
    }
    if (before?.status === "consulta" && !input.newVersion) {
      const changed = before.summary !== summary || before.proposedText !== proposedText || before.documentUrl !== documentUrl ||
        JSON.stringify(before.sources.map(s => [s.title, s.url])) !== JSON.stringify(sources.map(s => [s.title, s.url])) ||
        JSON.stringify(before.sourcePostIds) !== JSON.stringify(sourcePostIds);
      if (changed || !["consulta", ...CLOSED, "revision_normativa"].includes(input.status)) {
        throw new AgreementError(409, "No se puede cambiar el texto sometido a consulta. Cierra la versión y abre otra para incorporar enmiendas.");
      }
    }
    if (CLOSED.includes(input.status)) {
      if (before?.status !== "consulta") throw new AgreementError(409, "Abre una consulta antes de documentar su cierre.");
      if (input.closureReason.trim().length < 10) throw new AgreementError(400, "Explica el cierre, la participación y el tratamiento de las discrepancias.");
      if (input.status === "consensuado" && !(await currentPositions(tx, before)).length) throw new AgreementError(400, "No puede declararse consenso sin ninguna postura registrada.");
    }
    opened = input.status === "consulta" && before?.status !== "consulta";
    const electorateIds = opened ? rights.participants.filter(p => p.centers.length).map(p => p.id) :
      input.newVersion ? [] : before?.electorateIds ?? [];
    if (opened && !electorateIds.length) throw new AgreementError(400, "No hay participantes con centro válido para abrir la consulta.");
    const values = { status: input.status, revision: (before?.revision ?? 0) + 1,
      version: (before?.version ?? 1) + (input.newVersion ? 1 : 0),
      summary, proposedText, observations: input.observations.trim(), closureReason: input.closureReason.trim(),
      sources, sourcePostIds, editorIds, electorateIds, documentUrl, fingerprint: state.fingerprint,
      curriculumVersion: state.configuration.curriculumVersion, publishedPageId: null, updatedBy: user.id, updatedAt: new Date() };
    const [a] = before ? await tx.update(agreements).set(values).where(eq(agreements.id, before.id)).returning() :
      await tx.insert(agreements).values({ ...values, threadId: t.id, moduleId: t.moduleId, createdBy: user.id }).returning();
    await audit(tx, a, user.id);
    await enqueueForumDigest(tx, { moduleId: t.moduleId, threadId: t.id, actorId: user.id,
      eventKey: `agreement:${a.id}:${a.revision}`, kind: opened ? "consultation" : "synthesis" });
  });
  res.json({ ...await workspace(t.id, t.moduleId, user), notificationWarning: null });
}));

router.post(`${root}/positions`, handle(async (req, res) => {
  const parsed = RecordAgreementPositionBody.safeParse(req.body);
  if (!parsed.success) throw new AgreementError(400, "Revisa la postura y el centro de participación.");
  const input = parsed.data, user = req.user!, t = res.locals.agreementThread;
  const participant = (await agreementParticipants(t.moduleId)).find(p => p.id === user.id);
  const center = participant?.centers.find(c => c.id === input.centerId);
  if (!center) throw new AgreementError(403, "El centro debe proceder de tu perfil o de una asignación vigente del módulo.");
  if (input.position !== "a_favor" && !input.reason.trim()) throw new AgreementError(400, "Motiva las reservas o la discrepancia para poder tratarlas en la síntesis.");
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(1950, ${t.id})`);
    const a = await current(tx, t.id);
    if (!a || a.revision !== input.revision || a.version !== input.version || a.status !== "consulta") throw new AgreementError(409, "La consulta ha cambiado o está cerrada. Recarga antes de registrar tu postura.");
    const state = await structure(tx, t.moduleId, user);
    if (!state.configuration?.enabled || !state.verificationCurrent || state.diagnostics.length || state.fingerprint !== a.fingerprint) {
      throw new AgreementError(409, "El currículo ha cambiado. Se requiere revisión antes de registrar nuevas posturas.");
    }
    if (!a.electorateIds.includes(user.id)) throw new AgreementError(403, "No formabas parte del censo al abrir esta versión. Puedes aportar en el debate y participar en una nueva consulta.");
    const [previous] = await tx.select().from(positions).where(and(eq(positions.agreementId, a.id),
      eq(positions.version, a.version), eq(positions.userId, user.id)));
    const reason = input.reason.trim();
    if (previous?.position === input.position && previous.reason === reason && previous.centerId === center.id) return;
    const value = { agreementId: a.id, version: a.version, userId: user.id, centerId: center.id, centerName: center.name,
      position: input.position, reason, updatedAt: new Date() };
    await tx.insert(positions).values(value).onConflictDoUpdate({ target: [positions.agreementId, positions.version, positions.userId], set: value });
    await tx.insert(history).values(value);
  });
  res.json(await workspace(t.id, t.moduleId, user));
}));

router.post(`${root}/publish`, handle(async (req, res) => {
  const parsed = PublishForumAgreementBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.documentConfirmed || !parsed.data.referenceOnlyConfirmed) throw new AgreementError(400, "Confirma el documento del módulo y su carácter de referencia, no institucional.");
  const input = parsed.data, user = req.user!, t = res.locals.agreementThread;
  const rights = await workspace(t.id, t.moduleId, user);
  if (!rights.canPublish) throw new AgreementError(403, "Solo la coordinación competente o superadministración puede validar la publicación.");
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(1950, ${t.id})`);
    const a = await current(tx, t.id);
    if (!a || a.version !== input.version) throw new AgreementError(409, "La versión ha cambiado.");
    if (a.publishedPageId) return;
    if (a.revision !== input.revision || !CLOSED.includes(a.status) || !a.documentUrl || !a.closureReason.trim()) throw new AgreementError(409, "Requiere una versión cerrada, revisada y con documento vinculado.");
    const state = await structure(tx, t.moduleId, user);
    if (!state.configuration?.enabled || !state.verificationCurrent || state.diagnostics.length || state.fingerprint !== a.fingerprint) throw new AgreementError(409, "La normativa o el currículo ha cambiado. Revisa una nueva versión antes de publicar.");
    await nextcloudDocumentUrl(a.documentUrl);
    await confirmNextcloudAvailability();
    const votes = await currentPositions(tx, a), counts = participation(a, votes);
    const authors = await tx.select({ id: usersTable.id, name: usersTable.name }).from(usersTable)
      .where(inArray(usersTable.id, [...new Set([a.createdBy ?? user.id, user.id, ...votes.map(p => p.userId)])]));
    const names = new Map(authors.map(p => [p.id, p.name]));
    const reserve = votes.filter(p => p.position !== "a_favor").map(p =>
      `<li>${safe(names.get(p.userId) ?? "Cuenta no disponible")} · ${safe(p.centerName)} · ${safe(p.position)}: ${safe(p.reason)}</li>`).join("");
    const paragraph = (s: string) => `<p style="white-space:pre-wrap">${safe(s)}</p>`;
    const content = `<h1>${safe(t.title)}</h1><p><strong>${REFERENCE_LEGEND}</strong></p>
<p>Versión ${a.version} · ${safe(a.curriculumVersion)} · ${safe(a.status)} · ${new Date().toISOString()}</p>
<p>Responsable de la síntesis: ${safe(a.createdBy ? names.get(a.createdBy) ?? "Cuenta no disponible" : "Cuenta no disponible")}.
Validación de publicación: ${safe(user.name)}.</p>
<p>${counts.teachers} docentes participantes / ${counts.centers} centros / ${counts.eligible} docentes en el censo de consulta.</p>
${paragraph(counts.warning)}<h2>Síntesis</h2>${paragraph(a.summary)}<h2>Texto de referencia</h2>${paragraph(a.proposedText)}
<h2>Cierre documentado</h2>${paragraph(a.closureReason)}<h2>Observaciones y concreciones locales</h2>${paragraph(a.observations)}
<h2>Reservas y discrepancias</h2><ul>${reserve || "<li>No constan reservas registradas; no equivale a unanimidad de toda la comunidad.</li>"}</ul>
<h2>Posturas identificadas de esta versión</h2><table><thead><tr><th>Docente</th><th>Centro</th><th>Postura</th><th>Motivación</th></tr></thead><tbody>
${votes.map(p => `<tr><td>${safe(names.get(p.userId) ?? "Cuenta no disponible")}</td><td>${safe(p.centerName)}</td><td>${safe(p.position)}</td><td>${safe(p.reason)}</td></tr>`).join("")}
</tbody></table>
<h2>Fuentes</h2><ul>${a.sources.map(s => `<li><a href="${safe(s.url)}">${safe(s.title)}</a></li>`).join("")}</ul>
<p><a href="/foros?module=${t.moduleId}&amp;thread=${t.id}">Debate y registro de posturas</a></p>
${a.sourcePostIds.length ? `<p>Aportaciones citadas de este hilo: ${a.sourcePostIds.join(", ")}.</p>` : ""}
<p><a href="${safe(a.documentUrl)}">Borrador canónico en Nextcloud</a></p>
<p>La coordinación ha confirmado manualmente el documento del módulo y sus permisos. El sistema ha comprobado la disponibilidad pública del proveedor, no sus archivos mediante credenciales administrativas.</p>`;
    const [page] = await tx.insert(wikiPagesTable).values({ moduleId: t.moduleId,
      title: `${state.moduleCode} · ${t.title} · Referencia v${a.version} (${a.id})`, content,
      tags: ["intercentros", "referencia", `acuerdo-${a.id}`, `version-${a.version}`], createdBy: user.id, updatedBy: user.id }).returning();
    const [saved] = await tx.update(agreements).set({ publishedPageId: page.id, revision: a.revision + 1,
      updatedBy: user.id, updatedAt: new Date() }).where(eq(agreements.id, a.id)).returning();
    await audit(tx, saved, user.id);
    await enqueueForumDigest(tx, { moduleId: t.moduleId, threadId: t.id, actorId: user.id,
      eventKey: `publication:${saved.id}:${saved.version}`, kind: "publication" });
  });
  res.json({ ...await workspace(t.id, t.moduleId, user), notificationWarning: null });
}));
export default router;
