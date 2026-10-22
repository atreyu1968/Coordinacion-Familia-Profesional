import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  db, eventsTable, eventAttendancesTable, eventAttendanceSettingsTable,
  eventAttendanceCertificatesTable, type AttendanceCertificateSnapshot,
} from "@workspace/db";
import { attendanceCertificatePdf, canaryDay } from "./attendanceCertificatePdf";
import { getSettings, professionalFamilyOf } from "./settings";
import type { Request } from "express";
import { getAppBaseUrl } from "./appUrl";

export class AttendanceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function certificateAppUrl(req: Request): string {
  // Never let a recipient choose the verification authority via forwarded
  // headers. The self-hosted installer sets PUBLIC_APP_URL.
  if (process.env.NODE_ENV === "production" && !process.env.PUBLIC_APP_URL?.trim()) {
    throw new AttendanceError(503, "Configura PUBLIC_APP_URL con el dominio público de la aplicación antes de generar los QR.");
  }
  let url: URL;
  try { url = new URL(getAppBaseUrl(req)); }
  catch { throw new AttendanceError(503, "El dominio público de la aplicación no es válido."); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new AttendanceError(503, "Revisa el dominio público de la aplicación.");
  }
  return url.href.replace(/\/+$/, "");
}
export type CertificateSettings = Pick<typeof eventAttendanceSettingsTable.$inferSelect,
  "signerName" | "signerRole" | "issuePlace" | "issueDate" | "modality" | "durationMinutes" | "additionalText" | "registrationOpen">;

export async function certificateSnapshot(
  event: typeof eventsTable.$inferSelect, settings: CertificateSettings,
  attendeeName: string, verificationUrl: string, code: string, draft = false,
): Promise<AttendanceCertificateSnapshot> {
  if (!event.startAt || !event.endAt || event.endAt <= event.startAt) {
    throw new AttendanceError(400, "Completa las fechas y horas de inicio y fin del evento.");
  }
  if (!draft && event.endAt > new Date()) throw new AttendanceError(409, "El evento debe haber finalizado antes de expedir certificados.");
  const issueDate = settings.issueDate ?? canaryDay();
  if (!draft && (issueDate < canaryDay(event.endAt) || issueDate > canaryDay())) {
    throw new AttendanceError(400, "La fecha de expedición debe estar entre la finalización del evento y hoy.");
  }
  const global = await getSettings();
  return {
    attendeeName, eventName: event.name, location: event.location,
    startAt: event.startAt.toISOString(), endAt: event.endAt.toISOString(),
    modality: settings.modality, durationMinutes: settings.durationMinutes ?? Math.max(1, Math.round((+event.endAt - +event.startAt) / 60000)),
    signerName: settings.signerName, signerRole: settings.signerRole,
    issuePlace: settings.issuePlace, issueDate, additionalText: settings.additionalText,
    professionalFamily: professionalFamilyOf(global), appName: global.appName?.trim() || "Coordina ADG",
    verificationUrl, code, issuedAt: new Date().toISOString(),
  };
}

export async function renderCertificate(
  certificate: typeof eventAttendanceCertificatesTable.$inferSelect & { renderedPdf?: string },
) {
  return {
    certificateId: certificate.id,
    filename: `certificado-${certificate.eventId}-${certificate.snapshot.code}.pdf`,
    contentBase64: certificate.renderedPdf ?? await attendanceCertificatePdf(certificate.snapshot, { revoked: !!certificate.revokedAt }),
  };
}

/** Row lock serializes issuance, review and revocation for one attendance. */
export async function issueAttendanceCertificate(eventId: number, attendanceId: number, issuedBy: number, appUrl: string) {
  return db.transaction(async (tx) => {
    const [attendance] = await tx.select().from(eventAttendancesTable)
      .where(and(eq(eventAttendancesTable.id, attendanceId), eq(eventAttendancesTable.eventId, eventId))).for("update");
    if (!attendance) throw new AttendanceError(404, "Asistencia no encontrada.");
    if (attendance.status !== "confirmed") throw new AttendanceError(409, "La organización debe validar primero la asistencia.");
    const [existing] = await tx.select().from(eventAttendanceCertificatesTable).where(and(
      eq(eventAttendanceCertificatesTable.attendanceId, attendanceId),
      isNull(eventAttendanceCertificatesTable.revokedAt),
    ));
    if (existing) return existing;
    const [event] = await tx.select().from(eventsTable).where(and(eq(eventsTable.id, eventId), isNull(eventsTable.deletedAt)));
    if (!event) throw new AttendanceError(404, "Evento no encontrado.");
    const [settings] = await tx.select().from(eventAttendanceSettingsTable).where(eq(eventAttendanceSettingsTable.eventId, eventId));
    if (!settings) throw new AttendanceError(400, "Configura y guarda primero los datos del certificado de este evento.");
    const token = randomBytes(32).toString("base64url");
    const snapshot = await certificateSnapshot(event, settings, attendance.fullName,
      `${appUrl}/verificar-certificado/${token}`, `CFP-${token.slice(0, 12)}`);
    // Render before recording issuance: invalid/overlong text must not create a
    // seemingly valid certificate which cannot actually be downloaded.
    const renderedPdf = await attendanceCertificatePdf(snapshot);
    const [certificate] = await tx.insert(eventAttendanceCertificatesTable).values({
      eventId, attendanceId, issuedBy, verificationToken: token, snapshot,
      issuedAt: new Date(snapshot.issuedAt),
    }).returning();
    return { ...certificate!, renderedPdf };
  });
}
