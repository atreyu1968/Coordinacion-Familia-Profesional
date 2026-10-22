import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, desc, count } from "drizzle-orm";
import JSZip from "jszip";
import {
  db, eventAttendanceSettingsTable as settingsTable, eventAttendancesTable as attendanceTable,
  eventAttendanceCertificatesTable as certificatesTable,
} from "@workspace/db";
import {
  UpdateEventAttendanceSettingsBody, UpdateEventAttendanceBody, ImportEventAttendanceCsvBody,
  PreviewEventAttendanceCsvBody, ListEventAttendanceQueryParams, RevokeEventAttendanceCertificateBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { loadAccessibleEvent } from "./events";
import { getSettings, professionalFamilyOf } from "../lib/settings";
import { generateQrDataUrl } from "../lib/documents";
import { AttendanceError, issueAttendanceCertificate, renderCertificate, certificateSnapshot, certificateAppUrl, type CertificateSettings } from "../lib/eventCertificates";
import { attendanceCertificatePdf } from "../lib/attendanceCertificatePdf";
import { parseAttendanceCsv } from "../lib/attendanceCsv";
import { sendEmail } from "../lib/email";
import { escapeEmailHtml } from "../lib/email-layout";

export const attendanceHandler = (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response) => {
    try { await fn(req, res); }
    catch (error) {
      if (error instanceof AttendanceError) { res.status(error.status).json({ message: error.message }); return; }
      throw error;
    }
  };
const router = Router();
export const positiveId = (value: unknown): number => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AttendanceError(400, "Identificador no válido.");
  return id;
};
async function managedEvent(req: Request) {
  if (!["superadmin", "coordinator"].includes(req.user!.role)) throw new AttendanceError(403, "Permiso denegado.");
  const loaded = await loadAccessibleEvent(positiveId(req.params.id), req.user!);
  if (!loaded.ok) throw new AttendanceError(loaded.status, loaded.message);
  if (req.user!.role === "coordinator" && (req.user!.provinceId == null || loaded.event.provinceId !== req.user!.provinceId)) throw new AttendanceError(403, "Este evento está fuera de tu ámbito de gestión.");
  return loaded.event;
}
function parseSettings(body: unknown): CertificateSettings {
  const result = UpdateEventAttendanceSettingsBody.safeParse(body);
  if (!result.success) throw new AttendanceError(400, result.error.message);
  const data = result.data;
  const rawDate = (body as { issueDate?: unknown }).issueDate;
  if (rawDate != null && (typeof rawDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate) || new Date(rawDate).toISOString().slice(0, 10) !== rawDate)) {
    throw new AttendanceError(400, "La fecha de expedición debe tener formato AAAA-MM-DD.");
  }
  const normalized = {
    ...data, signerName: data.signerName.trim().normalize("NFC"),
    signerRole: data.signerRole.trim().normalize("NFC"), issuePlace: data.issuePlace.trim(),
    additionalText: data.additionalText.trim(), issueDate: (rawDate as string | null | undefined) ?? null,
    durationMinutes: data.durationMinutes ?? null,
  };
  if ([normalized.signerName, normalized.signerRole, normalized.issuePlace].some((s) => s.length < 2 || /[\u0000-\u001f]/.test(s))) {
    throw new AttendanceError(400, "Completa el firmante, cargo y lugar de expedición, sin caracteres de control.");
  }
  return normalized;
}
async function settingsResponse(req: Request, values: CertificateSettings & { registrationToken?: string }) {
  const registrationUrl = values.registrationToken ? `${certificateAppUrl(req)}/asistencia/${values.registrationToken}` : null;
  // Never return the table row wholesale; tokens only travel in their intended QR.
  const { registrationToken: _token, ...settings } = values;
  return { ...settings, registrationUrl, qrDataUrl: registrationUrl ? await generateQrDataUrl(registrationUrl) : null };
}
router.get("/events/:id/attendance-settings", requireAuth, attendanceHandler(async (req, res) => {
  const event = await managedEvent(req);
  const [settings] = await db.select().from(settingsTable).where(eq(settingsTable.eventId, event.id));
  const family = professionalFamilyOf(await getSettings());
  res.json(await settingsResponse(req, settings ?? {
    signerName: req.user!.name, signerRole: `Coordinador/a de la Familia Profesional de ${family}`,
    issuePlace: "Canarias", issueDate: null, modality: /video|https?:|online/i.test(event.location ?? "") ? "videoconferencia" : "presencial",
    durationMinutes: null, additionalText: "", registrationOpen: false,
  }));
}));
router.put("/events/:id/attendance-settings", requireAuth, attendanceHandler(async (req, res) => {
  const event = await managedEvent(req);
  const data = parseSettings(req.body);
  const [saved] = await db.insert(settingsTable).values({
    ...data, eventId: event.id, registrationToken: randomBytes(32).toString("base64url"),
  }).onConflictDoUpdate({ target: settingsTable.eventId, set: data }).returning();
  res.json(await settingsResponse(req, saved!));
}));
router.post("/events/:id/certificate-preview", requireAuth, attendanceHandler(async (req, res) => {
  const event = await managedEvent(req);
  const snapshot = await certificateSnapshot(event, parseSettings(req.body), "Nombre y apellidos del asistente", "", "BORRADOR", true);
  res.json({ filename: `borrador-evento-${event.id}.pdf`, certificateId: null, contentBase64: await attendanceCertificatePdf(snapshot, { draft: true }) });
}));
router.get("/events/:id/attendance", requireAuth, attendanceHandler(async (req, res) => {
  const event = await managedEvent(req);
  const parsed = ListEventAttendanceQueryParams.safeParse(req.query);
  if (!parsed.success) throw new AttendanceError(400, parsed.error.message);
  const { page = 1, pageSize = 50 } = parsed.data;
  const filter = eq(attendanceTable.eventId, event.id);
  const [total] = await db.select({ n: count() }).from(attendanceTable).where(filter);
  const rows = await db.select({ attendance: attendanceTable, certificate: certificatesTable }).from(attendanceTable)
    .leftJoin(certificatesTable, and(eq(certificatesTable.attendanceId, attendanceTable.id), isNull(certificatesTable.revokedAt)))
    .where(filter).orderBy(desc(attendanceTable.id)).limit(pageSize).offset((page - 1) * pageSize);
  res.json({ total: total!.n, items: rows.map(({ attendance: a, certificate: c }) => ({
    id: a.id, fullName: a.fullName, email: a.email, status: a.status,
    registeredAt: a.registeredAt.toISOString(), confirmedAt: a.confirmedAt?.toISOString() ?? null,
    certificateId: c?.id ?? null, certificateCode: c?.snapshot.code ?? null,
  })) });
}));
router.patch("/events/:id/attendance/:attendanceId", requireAuth, attendanceHandler(async (req, res) => {
  const event = await managedEvent(req);
  const parsed = UpdateEventAttendanceBody.safeParse(req.body);
  if (!parsed.success) throw new AttendanceError(400, parsed.error.message);
  if (parsed.data.status === "confirmed" && (!event.startAt || event.startAt > new Date())) throw new AttendanceError(409, "No se puede validar una asistencia antes de comenzar el evento.");
  await db.transaction(async (tx) => {
    const [attendance] = await tx.select().from(attendanceTable).where(and(eq(attendanceTable.id, positiveId(req.params.attendanceId)), eq(attendanceTable.eventId, event.id))).for("update");
    if (!attendance) throw new AttendanceError(404, "Asistencia no encontrada.");
    const [certificate] = await tx.select().from(certificatesTable).where(and(eq(certificatesTable.attendanceId, attendance.id), isNull(certificatesTable.revokedAt)));
    if (certificate && parsed.data.status !== "confirmed") throw new AttendanceError(409, "Anula primero el certificado vigente antes de cambiar la asistencia.");
    await tx.update(attendanceTable).set({
      status: parsed.data.status, confirmedAt: parsed.data.status === "confirmed" ? new Date() : null,
      confirmedBy: parsed.data.status === "confirmed" ? req.user!.id : null,
    }).where(eq(attendanceTable.id, attendance.id));
  });
  res.json({ ok: true });
}));
router.post("/events/:id/attendance/:attendanceId/certificate", requireAuth, attendanceHandler(async (req, res) => {
  const event = await managedEvent(req);
  res.json(await renderCertificate(await issueAttendanceCertificate(event.id, positiveId(req.params.attendanceId), req.user!.id, certificateAppUrl(req))));
}));
router.get("/events/:id/certificates/:certificateId/pdf", requireAuth, attendanceHandler(async (req, res) => {
  const event = await managedEvent(req);
  const [certificate] = await db.select().from(certificatesTable).where(and(eq(certificatesTable.eventId, event.id), eq(certificatesTable.id, positiveId(req.params.certificateId))));
  if (!certificate) throw new AttendanceError(404, "Certificado no encontrado.");
  res.json(await renderCertificate(certificate));
}));
router.post("/events/:id/certificates/:certificateId/revoke", requireAuth, attendanceHandler(async (req, res) => {
  const event = await managedEvent(req);
  const parsed = RevokeEventAttendanceCertificateBody.safeParse(req.body);
  if (!parsed.success || parsed.data.reason.trim().length < 3) throw new AttendanceError(400, "Indica el motivo de la anulación.");
  await db.transaction(async (tx) => {
    const [certificate] = await tx.select().from(certificatesTable).where(and(eq(certificatesTable.eventId, event.id), eq(certificatesTable.id, positiveId(req.params.certificateId))));
    if (!certificate) throw new AttendanceError(404, "Certificado no encontrado.");
    await tx.select().from(attendanceTable).where(eq(attendanceTable.id, certificate.attendanceId)).for("update");
    const changed = await tx.update(certificatesTable).set({
      revokedAt: new Date(), revokedBy: req.user!.id, revocationReason: parsed.data.reason.trim(),
    }).where(and(eq(certificatesTable.id, certificate.id), isNull(certificatesTable.revokedAt))).returning({ id: certificatesTable.id });
    // Otherwise a recipient could undo revocation by issuing a replacement
    // themselves. A fresh organizer review is required before any replacement.
    if (changed.length) await tx.update(attendanceTable).set({
      status: "pending", confirmedAt: null, confirmedBy: null,
    }).where(eq(attendanceTable.id, certificate.attendanceId));
  });
  res.json({ ok: true });
}));
async function csvPreview(eventId: number, csv: string) {
  const existing = await db.select({ email: attendanceTable.email }).from(attendanceTable).where(eq(attendanceTable.eventId, eventId));
  try { return parseAttendanceCsv(csv, new Set(existing.map((row) => row.email))); }
  catch (error) { throw new AttendanceError(400, (error as Error).message); }
}
router.post("/events/:id/attendance/csv-preview", requireAuth, attendanceHandler(async (req, res) => {
  const event = await managedEvent(req);
  const parsed = PreviewEventAttendanceCsvBody.safeParse(req.body);
  if (!parsed.success) throw new AttendanceError(400, parsed.error.message);
  res.json(await csvPreview(event.id, parsed.data.csv));
}));
router.post("/events/:id/attendance/csv-import", requireAuth, attendanceHandler(async (req, res) => {
  const event = await managedEvent(req);
  const parsed = ImportEventAttendanceCsvBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.confirmAttendance) throw new AttendanceError(400, "Confirma expresamente que has comprobado la asistencia del listado.");
  if (!event.startAt || event.startAt > new Date()) throw new AttendanceError(409, "No se puede confirmar asistencia antes de comenzar el evento.");
  const preview = await csvPreview(event.id, parsed.data.csv);
  if (preview.errors) throw new AttendanceError(400, "Corrige los errores del CSV antes de importar; no se ha añadido ninguna fila.");
  const ready = preview.rows.filter((row) => row.status === "ready");
  const imported = ready.length ? await db.insert(attendanceTable).values(ready.map((row) => ({
    eventId: event.id, fullName: row.fullName, email: row.email, source: "csv", status: "confirmed",
    confirmedAt: new Date(), confirmedBy: req.user!.id,
  }))).onConflictDoNothing().returning({ id: attendanceTable.id }) : [];
  res.json({ imported: imported.length, duplicates: preview.rows.length - imported.length });
}));
router.post("/events/:id/attendance/certificates-zip", requireAuth, attendanceHandler(async (req, res) => {
  const event = await managedEvent(req);
  const attendees = await db.select({ id: attendanceTable.id }).from(attendanceTable)
    .where(and(eq(attendanceTable.eventId, event.id), eq(attendanceTable.status, "confirmed"))).orderBy(attendanceTable.id).limit(501);
  if (!attendees.length) throw new AttendanceError(409, "No hay asistencias validadas.");
  if (attendees.length > 500) throw new AttendanceError(400, "El ZIP admite hasta 500 certificados por evento. Utiliza las descargas individuales para este evento.");
  const zip = new JSZip();
  for (const attendance of attendees) {
    const pdf = await renderCertificate(await issueAttendanceCertificate(event.id, attendance.id, req.user!.id, certificateAppUrl(req)));
    zip.file(pdf.filename, pdf.contentBase64, { base64: true });
  }
  res.json({ filename: `certificados-evento-${event.id}.zip`, certificateId: null, contentBase64: await zip.generateAsync({ type: "base64", compression: "DEFLATE" }) });
}));

// Legacy URL now notifies of protected app downloads, never emails public PDFs.
export const notifyEventCertificates = attendanceHandler(async (req, res) => {
  const event = await managedEvent(req);
  const attendees = await db.select().from(attendanceTable).where(and(eq(attendanceTable.eventId, event.id), eq(attendanceTable.status, "confirmed")));
  let issued = 0; let failed = 0;
  for (const attendance of attendees) {
    const certificate = await issueAttendanceCertificate(event.id, attendance.id, req.user!.id, certificateAppUrl(req));
    if (certificate.notifiedAt) continue;
    const result = await sendEmail({
      to: attendance.email, subject: `Certificado disponible · ${event.name}`,
      html: `<p>Hola ${escapeEmailHtml(attendance.fullName)}:</p><p>Tu certificado de asistencia a <strong>${escapeEmailHtml(event.name)}</strong> está disponible.</p><p>Accede a <a href="${escapeEmailHtml(certificateAppUrl(req))}/mis-certificados">Mis certificados</a> con una cuenta registrada con este mismo correo y verifica su titularidad. Si no tienes cuenta, solicita una invitación a la organización.</p>`,
    });
    if (result.sent) {
      await db.update(certificatesTable).set({ notifiedAt: new Date() }).where(eq(certificatesTable.id, certificate.id));
      issued++;
    } else failed++;
  }
  res.json({ ok: true, issued, failed });
});
router.post("/events/:id/certificates", requireAuth, notifyEventCertificates);
export default router;
