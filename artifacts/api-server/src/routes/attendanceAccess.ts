import { Router } from "express";
import { randomInt } from "node:crypto";
import { and, eq, isNull, desc } from "drizzle-orm";
import {
  db, eventsTable, eventAttendanceSettingsTable as settingsTable,
  eventAttendancesTable as attendanceTable, eventAttendanceCertificatesTable as certificatesTable,
  certificateEmailVerificationsTable as emailTable,
} from "@workspace/db";
import { VerifyAttendanceEmailBody, IssueMyAttendanceCertificateBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { loadAccessibleEvent } from "./events";
import { attendanceHandler, positiveId } from "./eventAttendance";
import { AttendanceError, issueAttendanceCertificate, renderCertificate, certificateAppUrl } from "../lib/eventCertificates";
import { notifyCertificateRecipients } from "../lib/certificateNotifications";
import { normalizedEmail } from "../lib/attendanceCsv";
import { getAppBaseUrl } from "../lib/appUrl";
import { hashPassword, verifyPassword } from "../lib/auth";
import { sendEmail } from "../lib/email";

const router = Router();
const validToken = (token: unknown): string => {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AttendanceError(404, "Enlace no encontrado.");
  return token;
};

// Public verification is the only unauthenticated endpoint in this module.
// Bounded, ephemeral throttling; no personal data, IPs or tokens persisted.
const verificationRates = new Map<string, { count: number; until: number }>();
router.get("/public/certificates/:token", attendanceHandler(async (req, res) => {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" });
  const key = req.ip ?? "unknown";
  const now = Date.now();
  let rate = verificationRates.get(key);
  if (!rate || rate.until < now) {
    if (verificationRates.size >= 10000) verificationRates.delete(verificationRates.keys().next().value!);
    rate = { count: 0, until: now + 60000 }; verificationRates.set(key, rate);
  }
  if (++rate.count > 120) throw new AttendanceError(429, "Demasiadas comprobaciones. Espera un minuto.");
  const [certificate] = await db.select().from(certificatesTable).where(eq(certificatesTable.verificationToken, validToken(req.params.token)));
  if (!certificate) throw new AttendanceError(404, "No consta un certificado con este código.");
  const s = certificate.snapshot;
  res.json({
    code: s.code, valid: !certificate.revokedAt, attendeeName: s.attendeeName,
    eventName: s.eventName, startAt: s.startAt, endAt: s.endAt, modality: s.modality,
    location: s.location, durationMinutes: s.durationMinutes, signerName: s.signerName,
    signerRole: s.signerRole, issueDate: s.issueDate, issuedAt: certificate.issuedAt.toISOString(),
    revokedAt: certificate.revokedAt?.toISOString() ?? null,
  });
}));

async function registration(req: Parameters<typeof getAppBaseUrl>[0]) {
  const [settings] = await db.select().from(settingsTable).where(eq(settingsTable.registrationToken, validToken(req.params.token)));
  if (!settings) throw new AttendanceError(404, "Enlace de registro no encontrado.");
  const loaded = await loadAccessibleEvent(settings.eventId, req.user!);
  if (!loaded.ok) throw new AttendanceError(loaded.status, loaded.message);
  return { settings, event: loaded.event, open: settings.registrationOpen && loaded.event.status !== "done" };
}
router.get("/attendance/registration/:token", requireAuth, attendanceHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  const { event, open } = await registration(req);
  const [attendance] = await db.select().from(attendanceTable).where(and(
    eq(attendanceTable.eventId, event.id), eq(attendanceTable.email, normalizedEmail(req.user!.email)),
  ));
  res.json({
    eventId: event.id, eventName: event.name, location: event.location,
    startAt: event.startAt?.toISOString() ?? null, endAt: event.endAt?.toISOString() ?? null,
    open, attendanceStatus: attendance?.status ?? null,
  });
}));
router.post("/attendance/registration/:token", requireAuth, attendanceHandler(async (req, res) => {
  const { event, open } = await registration(req);
  if (!open) throw new AttendanceError(410, "El registro de asistencia está cerrado.");
  const user = req.user!;
  await db.insert(attendanceTable).values({
    eventId: event.id, userId: user.id, fullName: user.name.trim().normalize("NFC"),
    email: normalizedEmail(user.email), source: "app", status: "pending",
  }).onConflictDoNothing();
  res.json({ ok: true });
}));

async function emailVerified(userId: number, email: string) {
  const [record] = await db.select().from(emailTable).where(and(eq(emailTable.userId, userId), eq(emailTable.email, normalizedEmail(email))));
  return !!record?.verifiedAt;
}
router.get("/me/attendance-certificates", requireAuth, attendanceHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  const user = req.user!;
  if (!await emailVerified(user.id, user.email)) { res.json({ emailVerified: false, items: [], pendingEvents: [] }); return; }
  const matching = eq(attendanceTable.email, normalizedEmail(user.email));
  const certificates = await db.select({ certificate: certificatesTable }).from(certificatesTable)
    .innerJoin(attendanceTable, eq(attendanceTable.id, certificatesTable.attendanceId))
    .where(matching).orderBy(desc(certificatesTable.id));
  const pending = await db.select({ attendance: attendanceTable, event: eventsTable }).from(attendanceTable)
    .innerJoin(eventsTable, and(eq(eventsTable.id, attendanceTable.eventId), isNull(eventsTable.deletedAt)))
    .leftJoin(certificatesTable, and(eq(certificatesTable.attendanceId, attendanceTable.id), isNull(certificatesTable.revokedAt)))
    .where(and(matching, eq(attendanceTable.status, "confirmed"), isNull(certificatesTable.id)));
  res.json({
    emailVerified: true,
    items: certificates.map(({ certificate: c }) => ({
      id: c.id, code: c.snapshot.code, eventName: c.snapshot.eventName,
      attendeeName: c.snapshot.attendeeName, issuedAt: c.issuedAt.toISOString(),
      revokedAt: c.revokedAt?.toISOString() ?? null,
    })),
    pendingEvents: pending.map(({ event }) => ({ eventId: event.id, eventName: event.name })),
  });
}));
router.post("/me/attendance-certificates/email-code", requireAuth, attendanceHandler(async (req, res) => {
  const user = req.user!;
  const email = normalizedEmail(user.email);
  if (await emailVerified(user.id, email)) { res.json({ ok: true }); return; }
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  const codeHash = await hashPassword(code);
  await db.transaction(async (tx) => {
    await tx.insert(emailTable).values({ userId: user.id, email }).onConflictDoNothing();
    const [state] = await tx.select().from(emailTable).where(eq(emailTable.userId, user.id)).for("update");
    if (state!.sentAt && Date.now() - +state!.sentAt < 60000) throw new AttendanceError(429, "Espera un minuto antes de pedir otro código.");
    await tx.update(emailTable).set({
      email, codeHash, sentAt: new Date(), expiresAt: new Date(Date.now() + 10 * 60000), attempts: 0, verifiedAt: null,
    }).where(eq(emailTable.userId, user.id));
  });
  const result = await sendEmail({
    to: email, subject: "Verifica tu correo para descargar tus certificados",
    html: `<p>Tu código de verificación es:</p><p style="font-size:28px;font-weight:bold;letter-spacing:5px">${code}</p><p>Caduca en 10 minutos. No lo compartas. Si no lo has solicitado, ignora este mensaje.</p>`,
  });
  if (!result.sent) {
    await db.update(emailTable).set({ codeHash: null, sentAt: null, expiresAt: null })
      .where(and(eq(emailTable.userId, user.id), eq(emailTable.codeHash, codeHash)));
    throw new AttendanceError(503, "No se ha podido enviar el código. La organización debe revisar el servicio de correo.");
  }
  res.json({ ok: true });
}));
router.post("/me/attendance-certificates/verify-email", requireAuth, attendanceHandler(async (req, res) => {
  const parsed = VerifyAttendanceEmailBody.safeParse(req.body);
  if (!parsed.success) throw new AttendanceError(400, "Introduce el código de seis cifras.");
  // Commit failed-attempt counts too: throwing inside this transaction would
  // roll them back and let an attacker guess indefinitely.
  const valid = await db.transaction(async (tx) => {
    const [state] = await tx.select().from(emailTable).where(eq(emailTable.userId, req.user!.id)).for("update");
    if (!state || state.email !== normalizedEmail(req.user!.email) || !state.codeHash ||
      !state.expiresAt || state.expiresAt <= new Date() || state.attempts >= 5) return false;
    const matches = await verifyPassword(parsed.data.code, state.codeHash);
    await tx.update(emailTable).set(matches
      ? { verifiedAt: new Date(), codeHash: null, expiresAt: null }
      : { attempts: state.attempts + 1 },
    ).where(eq(emailTable.userId, req.user!.id));
    return matches;
  });
  if (!valid) throw new AttendanceError(400, "Código incorrecto, agotado o caducado. Solicita uno nuevo si es necesario.");
  res.json({ ok: true });
}));
router.get("/me/attendance-certificates/:certificateId/pdf", requireAuth, attendanceHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!await emailVerified(req.user!.id, req.user!.email)) throw new AttendanceError(403, "Verifica primero el correo de tu cuenta.");
  const [row] = await db.select({ certificate: certificatesTable }).from(certificatesTable)
    .innerJoin(attendanceTable, eq(attendanceTable.id, certificatesTable.attendanceId))
    .where(and(eq(certificatesTable.id, positiveId(req.params.certificateId)), eq(attendanceTable.email, normalizedEmail(req.user!.email))));
  if (!row) throw new AttendanceError(404, "Certificado no encontrado.");
  if (row.certificate.revokedAt) throw new AttendanceError(409, "Este certificado ha sido anulado y no puede descargarse como válido.");
  res.json(await renderCertificate(row.certificate));
}));
router.post("/me/attendance-certificates/issue", requireAuth, attendanceHandler(async (req, res) => {
  if (!await emailVerified(req.user!.id, req.user!.email)) throw new AttendanceError(403, "Verifica primero el correo de tu cuenta.");
  const parsed = IssueMyAttendanceCertificateBody.safeParse(req.body);
  if (!parsed.success) throw new AttendanceError(400, parsed.error.message);
  const [attendance] = await db.select().from(attendanceTable).where(and(
    eq(attendanceTable.eventId, parsed.data.eventId),
    eq(attendanceTable.email, normalizedEmail(req.user!.email)),
    eq(attendanceTable.status, "confirmed"),
  ));
  if (!attendance) throw new AttendanceError(404, "No consta una asistencia validada para tu correo en ese evento.");
  const certificate = await issueAttendanceCertificate(attendance.eventId, attendance.id, req.user!.id, certificateAppUrl(req));
  if (certificate.created) await notifyCertificateRecipients([attendance.id], certificate.snapshot.eventName);
  res.json(await renderCertificate(certificate));
}));
export default router;
