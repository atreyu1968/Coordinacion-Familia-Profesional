import { Router, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { db, coordinatorMailAccountsTable, coordinatorMailAttachmentsTable, coordinatorMailCaseNotesTable, coordinatorMailCasesTable, coordinatorMailMessagesTable, coordinatorMailOutboxTable, coordinatorMailSettingsTable, usersTable } from "@workspace/db";
import {
  AddCoordinatorMailCaseNoteBody, GenerateCoordinatorMailReplyDraftBody,
  SendCoordinatorMailReplyBody, UpdateCoordinatorMailAdminSettingsBody,
  UpdateCoordinatorMailCaseBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { AttendanceError } from "../lib/eventCertificates";
import { buildAuthorizationUrl, exchangeGoogleCode, getGmailConfiguration } from "../lib/coordinatorMailGmail";
import { decryptMailSecret, encryptMailSecret, newMailNonce, safeEmail, sha256, sanitizeHeader } from "../lib/coordinatorMailSecurity";
import { getAppBaseUrl, readCookie } from "../lib/appUrl";
import { ObjectStorageService } from "../lib/objectStorage";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { connectionDto, getMailAdminSettings, getOwnedCase, mailCaseDetail, mailCaseId, mailWorkspace, requireMailAdmin, requireMailCoordinator, safeStatus } from "../lib/coordinatorMailStore";

const router = Router();
const storage = new ObjectStorageService();
const OAuthCookie = "coordinator_mail_oauth";
type Handler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (handler: Handler) => async (req: Request, res: Response, next: (e?: unknown) => void) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  try { await handler(req, res); }
  catch (e) {
    if (e instanceof AttendanceError) res.status(e.status).json({ message: e.message });
    else next(e);
  }
};
function parsed<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new AttendanceError(400, "Revisa los datos y completa los campos obligatorios.");
  return result.data as T;
}
function oauthCookie(res: Response, request: Request, value: string, clear = false) {
  const secure = request.secure || getAppBaseUrl(request).startsWith("https://");
  res.cookie(OAuthCookie, clear ? "" : value, {
    httpOnly: true, secure, sameSite: "lax", path: "/api/coordinator-mail/gmail",
    maxAge: clear ? 0 : 10 * 60 * 1000,
  });
}
function constantTimeStringEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function gmailRedirectUri(request: Request): string {
  return `${new URL(getAppBaseUrl(request)).origin}/api/coordinator-mail/gmail/callback`;
}
function normalizedGoogleSettings(request: Request, clientId: unknown, redirectUri: unknown) {
  if (typeof clientId !== "string" || !/^[A-Za-z0-9_-]{12,300}\.apps\.googleusercontent\.com$/.test(clientId.trim())) {
    throw new AttendanceError(400, "Introduce el identificador de cliente OAuth de Google.");
  }
  if (typeof redirectUri !== "string") throw new AttendanceError(400, "Introduce la URI de retorno de Google.");
  let supplied: URL;
  try { supplied = new URL(redirectUri.trim()); }
  catch { throw new AttendanceError(400, "La URI de retorno de Google no es válida."); }
  const expected = new URL(gmailRedirectUri(request));
  const isLocalHttp = supplied.protocol === "http:" && ["localhost", "127.0.0.1"].includes(supplied.hostname);
  if ((!isLocalHttp && supplied.protocol !== "https:") || supplied.origin !== expected.origin ||
      supplied.pathname !== expected.pathname || supplied.search || supplied.hash) {
    throw new AttendanceError(400, `Usa exactamente esta URI de retorno: ${expected.toString()}`);
  }
  return { clientId: clientId.trim(), redirectUri: supplied.toString() };
}

async function workspaceResponse(request: Request, response: Response) {
  const user = await requireMailCoordinator(request);
  const page = Math.max(1, Math.min(10_000, Math.floor(Number(request.query.page) || 1)));
  const status = request.query.status ? String(request.query.status) : undefined;
  if (status) safeStatus(status);
  const search = typeof request.query.search === "string" ? request.query.search.trim().slice(0, 100) : undefined;
  response.json(await mailWorkspace(user.id, { page, status, search }));
}

router.get("/coordinator-mail/workspace", requireAuth, wrap(workspaceResponse));
router.get("/coordinator-mail/cases/:id", requireAuth, wrap(async (req, res) => {
  const user = await requireMailCoordinator(req);
  const id = mailCaseId(req.params.id);
  const page = Math.max(1, Math.min(10_000, Math.floor(Number(req.query.messagePage) || 1)));
  res.json(await mailCaseDetail(user.id, id, page));
}));

router.patch("/coordinator-mail/cases/:id", requireAuth, wrap(async (req, res) => {
  const user = await requireMailCoordinator(req);
  const id = mailCaseId(req.params.id);
  const body = parsed(UpdateCoordinatorMailCaseBody, req.body);
  if (body.draftTo !== undefined && body.draftTo && !safeEmail(body.draftTo)) {
    throw new AttendanceError(400, "El destinatario debe ser una dirección de correo única válida.");
  }
  if (body.title !== undefined && (!body.title.trim() || body.title.trim().length > 200)) {
    throw new AttendanceError(400, "El asunto debe tener entre 1 y 200 caracteres.");
  }
  await db.transaction(async tx => {
    const [row] = await tx.select().from(coordinatorMailCasesTable)
      .where(and(eq(coordinatorMailCasesTable.id, id), eq(coordinatorMailCasesTable.ownerId, user.id)))
      .limit(1).for("update");
    if (!row) throw new AttendanceError(404, "No se encontró el asunto.");
    if (row.revision !== body.revision) throw new AttendanceError(409, "El asunto cambió. Recarga la página antes de guardar.");
    const updated = await tx.update(coordinatorMailCasesTable).set({
      ...(body.title !== undefined ? { title: sanitizeHeader(body.title.trim(), 200) } : {}),
      ...(body.status !== undefined ? { status: safeStatus(body.status) } : {}),
      ...(body.dueAt !== undefined ? { dueAt: body.dueAt } : {}),
      ...(body.draftTo !== undefined ? { draftTo: body.draftTo.trim() } : {}),
      ...(body.draftSubject !== undefined ? { draftSubject: sanitizeHeader(body.draftSubject, 998) } : {}),
      ...(body.draftBody !== undefined ? { draftBody: body.draftBody } : {}),
      revision: row.revision + 1, updatedAt: new Date(), lastActivityAt: new Date(),
    }).where(and(eq(coordinatorMailCasesTable.id, id), eq(coordinatorMailCasesTable.ownerId, user.id), eq(coordinatorMailCasesTable.revision, body.revision))).returning();
    if (!updated.length) throw new AttendanceError(409, "El asunto cambió. Recarga la página antes de guardar.");
    if (body.status && body.status !== row.status) {
      await tx.insert(coordinatorMailCaseNotesTable).values({
        caseId: id, createdBy: user.id, kind: "status", content: `Se cambió el estado de ${row.status} a ${body.status}.`,
      });
    }
    if (body.draftTo !== undefined || body.draftSubject !== undefined || body.draftBody !== undefined) {
      await tx.insert(coordinatorMailCaseNotesTable).values({
        caseId: id, createdBy: user.id, kind: "draft", content: "Se guardó el borrador de respuesta. No se envió.",
      });
    }
  });
  res.json(await mailCaseDetail(user.id, id));
}));

router.post("/coordinator-mail/cases/:id/notes", requireAuth, wrap(async (req, res) => {
  const user = await requireMailCoordinator(req);
  const id = mailCaseId(req.params.id);
  const { content } = parsed(AddCoordinatorMailCaseNoteBody, req.body);
  const row = await getOwnedCase(user.id, id);
  await db.transaction(async tx => {
    const [locked] = await tx.select().from(coordinatorMailCasesTable)
      .where(and(eq(coordinatorMailCasesTable.id, id), eq(coordinatorMailCasesTable.ownerId, user.id))).limit(1).for("update");
    if (!locked || locked.revision !== row.revision) throw new AttendanceError(409, "El asunto cambió. Recarga la página antes de guardar la nota.");
    await tx.insert(coordinatorMailCaseNotesTable).values({ caseId: id, createdBy: user.id, kind: "note", content: content.trim() });
    await tx.update(coordinatorMailCasesTable).set({
      revision: locked.revision + 1, updatedAt: new Date(), lastActivityAt: new Date(),
    }).where(eq(coordinatorMailCasesTable.id, id));
  });
  res.json(await mailCaseDetail(user.id, id));
}));

router.post("/coordinator-mail/cases/:id/ai-draft", requireAuth, wrap(async (req, res) => {
  const user = await requireMailCoordinator(req);
  const id = mailCaseId(req.params.id);
  const body = parsed(GenerateCoordinatorMailReplyDraftBody, req.body);
  if (body.consent !== true) throw new AttendanceError(400, "Autoriza expresamente el uso de IA para generar este borrador.");
  const [row] = await db.select().from(coordinatorMailCasesTable)
    .where(and(eq(coordinatorMailCasesTable.id, id), eq(coordinatorMailCasesTable.ownerId, user.id))).limit(1);
  if (!row) throw new AttendanceError(404, "No se encontró el asunto.");
  if (row.revision !== body.revision) throw new AttendanceError(409, "El asunto cambió. Recarga la página antes de solicitar otro borrador.");
  if (!row.aiConsentAt && row.aiStatus === "processing") throw new AttendanceError(409, "Ya se está preparando un borrador de este asunto.");
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(coordinatorMailMessagesTable).where(eq(coordinatorMailMessagesTable.caseId, id));
  if (!total) throw new AttendanceError(400, "Añade un correo al asunto antes de generar una respuesta.");
  const [updated] = await db.update(coordinatorMailCasesTable).set({
    aiStatus: "queued", aiError: null, aiConsentAt: new Date(), aiInstructions: body.instructions ?? "",
    aiRevision: body.revision, aiRequestedBy: user.id, aiLeaseToken: null, aiLeaseUntil: null,
    revision: sql`${coordinatorMailCasesTable.revision} + 1`, updatedAt: new Date(),
  }).where(and(eq(coordinatorMailCasesTable.id, id), eq(coordinatorMailCasesTable.ownerId, user.id), eq(coordinatorMailCasesTable.revision, body.revision))).returning();
  if (!updated) throw new AttendanceError(409, "El asunto cambió. Recarga la página antes de iniciar el borrador.");
  await db.insert(coordinatorMailCaseNotesTable).values({
    caseId: id, createdBy: user.id, kind: "status",
    content: "Se autorizó el uso de IA para preparar un borrador. Se usarán hasta los ocho últimos correos y notas de este asunto; no sus adjuntos. No se enviará automáticamente.",
  });
  res.status(202).json(await mailCaseDetail(user.id, id));
}));

router.post("/coordinator-mail/cases/:id/send", requireAuth, wrap(async (req, res) => {
  const user = await requireMailCoordinator(req);
  const id = mailCaseId(req.params.id);
  const body = parsed(SendCoordinatorMailReplyBody, req.body);
  if (body.confirmed !== true) throw new AttendanceError(400, "Confirma la acción de envío.");
  await db.transaction(async tx => {
    const [mailCase] = await tx.select().from(coordinatorMailCasesTable)
      .where(and(eq(coordinatorMailCasesTable.id, id), eq(coordinatorMailCasesTable.ownerId, user.id))).limit(1).for("update");
    if (!mailCase) throw new AttendanceError(404, "No se encontró el asunto.");
    if (mailCase.revision !== body.revision) throw new AttendanceError(409, "El borrador cambió. Recarga el asunto, comprueba el destinatario y vuelve a confirmar.");
    if (!mailCase.draftTo || !safeEmail(mailCase.draftTo)) throw new AttendanceError(400, "Comprueba y completa un único destinatario válido.");
    if (!mailCase.draftSubject.trim() || !mailCase.draftBody.trim()) throw new AttendanceError(400, "El asunto y el cuerpo del borrador no pueden estar vacíos.");
    const [account] = await tx.select({ id: coordinatorMailAccountsTable.id })
      .from(coordinatorMailAccountsTable).where(eq(coordinatorMailAccountsTable.userId, user.id)).limit(1);
    if (!account) throw new AttendanceError(409, "Conecta primero tu cuenta Gmail.");
    const [old] = await tx.select().from(coordinatorMailOutboxTable)
      .where(and(eq(coordinatorMailOutboxTable.caseId, id), eq(coordinatorMailOutboxTable.revision, mailCase.revision))).limit(1);
    if (old?.status === "unknown" || old?.status === "sending" || old?.status === "sent" || old?.status === "queued") {
      throw new AttendanceError(409, old.status === "unknown"
        ? "Google no confirmó el resultado anterior. Comprueba Gmail Enviados antes de intentarlo otra vez."
        : "Ya existe un envío para este borrador. Revisa su estado antes de repetirlo.");
    }
    if (old) {
      await tx.update(coordinatorMailOutboxTable).set({
        status: "queued", error: null, leaseToken: null, leaseUntil: null, sentAt: null,
      }).where(eq(coordinatorMailOutboxTable.id, old.id));
    } else {
      await tx.insert(coordinatorMailOutboxTable).values({
        caseId: id, revision: mailCase.revision, recipient: mailCase.draftTo.trim(),
        subject: sanitizeHeader(mailCase.draftSubject.trim(), 998), bodyText: mailCase.draftBody,
      });
    }
    await tx.update(coordinatorMailCasesTable).set({
      revision: mailCase.revision + 1, updatedAt: new Date(), lastActivityAt: new Date(),
    }).where(eq(coordinatorMailCasesTable.id, id));
    await tx.insert(coordinatorMailCaseNotesTable).values({
      caseId: id, createdBy: user.id, kind: "status",
      content: `Se puso en cola un envío confirmado a ${mailCase.draftTo.trim()}.`,
    });
  });
  res.status(202).json(await mailCaseDetail(user.id, id));
}));

router.post("/coordinator-mail/gmail/connect", requireAuth, wrap(async (req, res) => {
  const user = await requireMailCoordinator(req);
  const config = await getGmailConfiguration();
  if (!config) throw new AttendanceError(409, "La superadministración debe configurar Google OAuth en el panel de control.");
  if (config.redirectUri !== gmailRedirectUri(req)) {
    throw new AttendanceError(409, "La dirección pública de la aplicación ha cambiado. La superadministración debe volver a guardar la configuración OAuth y actualizar la URI de retorno en Google.");
  }
  const state = newMailNonce();
  const cookie = newMailNonce();
  const verifier = randomBytes(32).toString("base64url");
  await db.insert(coordinatorMailAccountsTable).values({
    userId: user.id, oauthStateHash: sha256(state), oauthCookieHash: sha256(cookie),
    oauthVerifierEncrypted: encryptMailSecret(verifier), oauthExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    syncStatus: "idle",
  }).onConflictDoUpdate({
    target: coordinatorMailAccountsTable.userId,
    set: {
      oauthStateHash: sha256(state), oauthCookieHash: sha256(cookie),
      oauthVerifierEncrypted: encryptMailSecret(verifier),
      oauthExpiresAt: new Date(Date.now() + 10 * 60 * 1000), updatedAt: new Date(),
    },
  });
  oauthCookie(res, req, cookie);
  res.json({ authorizationUrl: buildAuthorizationUrl(config, state, verifier) });
}));

router.get("/coordinator-mail/gmail/callback", wrap(async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const cookie = readCookie(req, OAuthCookie) ?? "";
  // Never retain the short-lived OAuth code or state in request logs.
  req.url = "/coordinator-mail/gmail/callback";
  req.originalUrl = `${req.baseUrl}${req.url}`;
  oauthCookie(res, req, "", true);
  try {
    if (!/^[A-Za-z0-9._~+\/-]{1,2048}$/.test(code) || state.length < 32 || cookie.length < 32) throw new Error("Invalid OAuth callback.");
    const config = await getGmailConfiguration();
    if (!config) throw new Error("Gmail OAuth configuration is unavailable.");
    const stateHash = sha256(state);
    const cookieHash = sha256(cookie);
    const [account] = await db.select().from(coordinatorMailAccountsTable)
      .where(and(
        eq(coordinatorMailAccountsTable.oauthStateHash, stateHash),
        eq(coordinatorMailAccountsTable.oauthCookieHash, cookieHash),
        sql`${coordinatorMailAccountsTable.oauthExpiresAt} > NOW()`,
      )).limit(1);
    if (!account?.oauthVerifierEncrypted || !await (async () => {
      const [owner] = await db.select({ id: usersTable.id, role: usersTable.role, status: usersTable.status }).from(usersTable).where(eq(usersTable.id, account.userId)).limit(1);
      return !!owner && owner.status === "active" && ["coordinator", "superadmin"].includes(owner.role);
    })()) throw new Error("OAuth state or user is invalid.");
    const [consumed] = await db.update(coordinatorMailAccountsTable).set({
      oauthStateHash: null, oauthCookieHash: null, oauthVerifierEncrypted: null, oauthExpiresAt: null,
    }).where(and(
      eq(coordinatorMailAccountsTable.id, account.id),
      eq(coordinatorMailAccountsTable.oauthStateHash, stateHash),
      eq(coordinatorMailAccountsTable.oauthCookieHash, cookieHash),
    )).returning();
    if (!consumed) throw new Error("OAuth state has already been used.");
    const token = await exchangeGoogleCode(code, decryptMailSecret(account.oauthVerifierEncrypted), config);
    const profileResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${token.accessToken}` }, signal: AbortSignal.timeout(25_000), redirect: "error",
    });
    if (!profileResponse.ok) throw new Error("Google did not confirm the Gmail mailbox.");
    const profile = await profileResponse.json() as { emailAddress?: unknown };
    if (typeof profile.emailAddress !== "string" || !safeEmail(profile.emailAddress)) throw new Error("Google returned an invalid mailbox identity.");
    const [saved] = await db.update(coordinatorMailAccountsTable).set({
      email: profile.emailAddress.toLowerCase(), accessTokenEncrypted: encryptMailSecret(token.accessToken),
      refreshTokenEncrypted: encryptMailSecret(token.refreshToken), accessTokenExpiresAt: token.expiresAt,
      syncStatus: "queued", syncError: null, syncPageToken: null,
      syncQuery: null, nextSyncAt: new Date(), lastSyncAt: null, syncMessagesImported: 0,
      updatedAt: new Date(),
    }).where(eq(coordinatorMailAccountsTable.id, account.id)).returning();
    if (!saved) throw new Error("Could not save the Gmail connection.");
    res.redirect(303, "/asuntos-correo?gmail=connected");
  } catch {
    res.redirect(303, "/asuntos-correo?gmail=error");
  }
}));

router.post("/coordinator-mail/gmail/sync", requireAuth, wrap(async (req, res) => {
  const user = await requireMailCoordinator(req);
  const [account] = await db.select().from(coordinatorMailAccountsTable).where(eq(coordinatorMailAccountsTable.userId, user.id)).limit(1);
  if (!account?.refreshTokenEncrypted) throw new AttendanceError(409, "Conecta primero tu cuenta Gmail.");
  if (account.syncStatus !== "syncing") await db.update(coordinatorMailAccountsTable).set({
    syncStatus: "queued", syncError: null, nextSyncAt: new Date(),
  }).where(and(eq(coordinatorMailAccountsTable.id, account.id), eq(coordinatorMailAccountsTable.syncStatus, account.syncStatus)));
  res.json(await mailWorkspace(user.id, {}));
}));

router.delete("/coordinator-mail/gmail", requireAuth, wrap(async (req, res) => {
  const user = await requireMailCoordinator(req);
  await db.update(coordinatorMailAccountsTable).set({
    email: null, accessTokenEncrypted: null, refreshTokenEncrypted: null, accessTokenExpiresAt: null,
    oauthStateHash: null, oauthCookieHash: null, oauthVerifierEncrypted: null, oauthExpiresAt: null,
    syncStatus: "idle", syncError: null, syncPageToken: null, syncQuery: null,
    nextSyncAt: null, syncLeaseUntil: null, updatedAt: new Date(),
  }).where(eq(coordinatorMailAccountsTable.userId, user.id));
  res.json({ disconnected: true, connection: await connectionDto(user.id) });
}));

router.get("/coordinator-mail/admin-settings", requireAuth, wrap(async (req, res) => {
  await requireMailAdmin(req);
  res.json(await getMailAdminSettings(req));
}));

router.put("/coordinator-mail/admin-settings", requireAuth, wrap(async (req, res) => {
  await requireMailAdmin(req);
  const body = parsed(UpdateCoordinatorMailAdminSettingsBody, req.body);
  const { clientId, redirectUri } = normalizedGoogleSettings(req, body.clientId, body.redirectUri);
  let encryptedSecret: string | null;
  const [old] = await db.select().from(coordinatorMailSettingsTable).where(eq(coordinatorMailSettingsTable.id, 1)).limit(1);
  if (body.clearClientSecret === true) encryptedSecret = null;
  else if (typeof body.clientSecret === "string" && body.clientSecret.trim()) {
    if (body.clientSecret.trim().length > 1024) throw new AttendanceError(400, "El secreto de Google es demasiado largo.");
    encryptedSecret = encryptMailSecret(body.clientSecret.trim());
  } else if (old?.googleClientSecretEncrypted) encryptedSecret = old.googleClientSecretEncrypted;
  else throw new AttendanceError(400, "Introduce el secreto de cliente OAuth de Google.");
  if (encryptedSecret && old?.googleClientId !== clientId && !body.clientSecret?.trim()) {
    throw new AttendanceError(409, "Al cambiar el identificador de cliente, introduce el secreto correspondiente.");
  }
  await db.insert(coordinatorMailSettingsTable).values({
    id: 1, googleClientId: clientId, googleClientSecretEncrypted: encryptedSecret, googleRedirectUri: redirectUri, updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: coordinatorMailSettingsTable.id,
    set: { googleClientId: clientId, googleClientSecretEncrypted: encryptedSecret, googleRedirectUri: redirectUri, updatedAt: new Date() },
  });
  res.json(await getMailAdminSettings(req));
}));

router.get("/coordinator-mail/attachments/:id", requireAuth, wrap(async (req, res) => {
  const user = await requireMailCoordinator(req);
  const id = mailCaseId(req.params.id);
  const [row] = await db.select({
    objectPath: coordinatorMailAttachmentsTable.objectPath,
    status: coordinatorMailAttachmentsTable.status,
    contentType: coordinatorMailAttachmentsTable.contentType,
    fileName: coordinatorMailAttachmentsTable.fileName,
  }).from(coordinatorMailAttachmentsTable)
    .innerJoin(coordinatorMailMessagesTable, eq(coordinatorMailMessagesTable.id, coordinatorMailAttachmentsTable.messageId))
    .where(and(eq(coordinatorMailAttachmentsTable.id, id), eq(coordinatorMailMessagesTable.ownerId, user.id)))
    .limit(1);
  if (!row?.objectPath || row.status !== "ready") throw new AttendanceError(404, "No se encontró el adjunto.");
  const stored = await storage.getObjectEntityFile(row.objectPath);
  const fileResponse = await storage.downloadObject(stored, 0);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(row.fileName)}`);
  res.status(200);
  if (fileResponse.body) {
    await pipeline(Readable.fromWeb(fileResponse.body as unknown as NodeReadableStream<Uint8Array>), res);
  } else res.end();
}));

export default router;
