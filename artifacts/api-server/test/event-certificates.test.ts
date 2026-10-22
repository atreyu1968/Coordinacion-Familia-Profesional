import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import {
  db, eventsTable, eventAttendancesTable as attendanceTable,
  eventAttendanceCertificatesTable as certificatesTable,
  certificateEmailVerificationsTable as verificationTable,
} from "@workspace/db";
import app from "../src/app";
import { authHeader, cleanup, createProvince, createUser } from "./helpers";
import { parseAttendanceCsv } from "../src/lib/attendanceCsv";

const { inbox } = vi.hoisted(() => ({ inbox: [] as { to: string; html: string }[] }));
vi.mock("../src/lib/email", async (original) => ({
  ...await original<typeof import("../src/lib/email")>(),
  sendEmail: vi.fn(async (message: { to: string; html: string }) => { inbox.push(message); return { sent: true }; }),
}));
type SeedUser = Awaited<ReturnType<typeof createUser>>;
let admin: SeedUser; let teacher: SeedUser; let other: SeedUser; let coordinator: SeedUser; let unscopedCoordinator: SeedUser;
let eventId: number; let token: string; let attendanceId: number; let certificateId: number; let certificateToken: string;
const eventIds: number[] = [];
const settings = {
  signerName: "Coordinadora de prueba", signerRole: "Coordinación de la Familia Profesional",
  issuePlace: "Canarias", issueDate: null, modality: "videoconferencia", durationMinutes: null,
  additionalText: "Actividad de coordinación docente.", registrationOpen: true,
};
const call = (method: "get" | "post" | "patch" | "put", path: string, user = admin) =>
  request(app)[method](`/api${path}`).set(authHeader(user.token));
const csv = (name: string, email: string) => `nombre,email\n${name},${email}`;

beforeAll(async () => {
  admin = await createUser({ role: "superadmin" });
  const provinceId = await createProvince();
  teacher = await createUser({ role: "teacher", provinceId });
  other = await createUser({ role: "teacher", provinceId });
  coordinator = await createUser({ role: "coordinator", provinceId: await createProvince() });
  unscopedCoordinator = await createUser({ role: "coordinator", provinceId: null });
  const [event] = await db.insert(eventsTable).values({
    name: `Reunión de coordinación ${Date.now()}`, type: "other", provinceId,
    startAt: new Date(Date.now() - 7200000), endAt: new Date(Date.now() - 3600000), location: "Videoconferencia",
  }).returning();
  eventId = event!.id; eventIds.push(eventId);
});
afterAll(async () => {
  await db.delete(eventsTable).where(inArray(eventsTable.id, eventIds));
  await cleanup();
});

describe("bounded CSV parser", () => {
  it("accepts BOM, semicolons, CRLF, accents and quoted names", () => {
    const p = parseAttendanceCsv('\uFEFFnombre;correo\r\n"García, María"; MARIA@example.test \r\n');
    expect(p.rows[0]).toMatchObject({ fullName: "García, María", email: "maria@example.test", status: "ready" });
  });
  it("finds repeated addresses without changing their first name", () => {
    expect(parseAttendanceCsv("nombre,email\nAna,ANA@example.test\nOtra,ana@example.test").duplicates).toBe(1);
  });
  it("rejects invalid emails, malformed quotes and oversized rosters", () => {
    expect(parseAttendanceCsv("nombre,email\nAna,no-mail").errors).toBe(1);
    expect(() => parseAttendanceCsv('nombre,email\n"Ana,ana@example.test')).toThrow();
    expect(() => parseAttendanceCsv(`nombre,email\n${"Ana,a@example.test\n".repeat(501)}`)).toThrow();
  });
});

describe("event attendance certificates", () => {
  it("protects settings and private lists; applies management scope", async () => {
    expect((await request(app).get(`/api/events/${eventId}/attendance`)).status).toBe(401);
    expect((await call("get", `/events/${eventId}/attendance`, teacher)).status).toBe(403);
    expect((await call("put", `/events/${eventId}/attendance-settings`, coordinator).send(settings)).status).toBe(403);
    const response = await call("put", `/events/${eventId}/attendance-settings`).send(settings);
    expect(response.status).toBe(200);
    expect(response.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    token = response.body.registrationUrl.split("/").pop();
    expect(token).toHaveLength(43);
  });
  it("registration is authenticated, derives identity and is idempotent", async () => {
    expect((await request(app).get(`/api/attendance/registration/${token}`)).status).toBe(401);
    expect((await request(app).post(`/api/attendance/registration/${token}`).send({ name: "Inventado" })).status).toBe(401);
    const response = await call("post", `/attendance/registration/${token}`, teacher).send({ userId: other.user.id, email: other.user.email });
    expect(response.status).toBe(200);
    await call("post", `/attendance/registration/${token}`, teacher);
    const rows = await db.select().from(attendanceTable).where(eq(attendanceTable.eventId, eventId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: teacher.user.email.toLowerCase(), userId: teacher.user.id, status: "pending" });
    attendanceId = rows[0]!.id;
  });
  it("does not issue from a QR scan or allow a teacher to confirm themself", async () => {
    expect((await call("post", `/events/${eventId}/attendance/${attendanceId}/certificate`)).status).toBe(409);
    expect((await call("patch", `/events/${eventId}/attendance/${attendanceId}`, teacher).send({ status: "confirmed" })).status).toBe(403);
    expect((await call("patch", `/events/${eventId}/attendance/${attendanceId}`).send({ status: "confirmed" })).status).toBe(200);
  });
  it("previews are watermarked and create no certificates", async () => {
    const before = await db.select().from(certificatesTable).where(eq(certificatesTable.eventId, eventId));
    const response = await call("post", `/events/${eventId}/certificate-preview`).send(settings);
    expect(response.status).toBe(200);
    expect((await PDFDocument.load(Buffer.from(response.body.contentBase64, "base64"))).getPageCount()).toBe(1);
    expect(response.body.certificateId).toBeNull();
    expect(await db.select().from(certificatesTable).where(eq(certificatesTable.eventId, eventId))).toHaveLength(before.length);
  });
  it("serializes concurrent issuance into one certificate and one QR identity", async () => {
    const results = await Promise.all([1, 2].map(() => call("post", `/events/${eventId}/attendance/${attendanceId}/certificate`)));
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results[0]!.body.certificateId).toBe(results[1]!.body.certificateId);
    certificateId = results[0]!.body.certificateId;
    const [record] = await db.select().from(certificatesTable).where(eq(certificatesTable.id, certificateId));
    certificateToken = record!.verificationToken;
    expect(record!.snapshot.verificationUrl).toContain(`/verificar-certificado/${certificateToken}`);
    expect(record!.snapshot.durationMinutes).toBe(60);
    expect((await PDFDocument.load(Buffer.from(results[0]!.body.contentBase64, "base64"))).getPageCount()).toBe(1);
  });
  it("public verification exposes original facts, never emails or private lists", async () => {
    const response = await request(app).get(`/api/public/certificates/${certificateToken}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ valid: true, attendeeName: teacher.user.name, modality: "videoconferencia" });
    expect(JSON.stringify(response.body)).not.toContain(teacher.user.email);
    expect(response.body).not.toHaveProperty("email");
    expect((await request(app).get(`/api/public/certificates/${"x".repeat(43)}`)).status).toBe(404);
  });
  it("cannot alter issued certificates through subsequent event or settings edits", async () => {
    const original = (await db.select().from(certificatesTable).where(eq(certificatesTable.id, certificateId)))[0]!.snapshot;
    await db.update(eventsTable).set({ name: "Nombre cambiado posteriormente" }).where(eq(eventsTable.id, eventId));
    await call("put", `/events/${eventId}/attendance-settings`).send({ ...settings, signerName: "Otro firmante" });
    const response = await request(app).get(`/api/public/certificates/${certificateToken}`);
    expect(response.body.eventName).toBe(original.eventName);
    expect(response.body.signerName).toBe(original.signerName);
  });
  it("requires email ownership, limits OTP guessing and consumes successful codes", async () => {
    const before = await call("get", "/me/attendance-certificates", teacher);
    expect(before.body).toMatchObject({ emailVerified: false, items: [] });
    expect((await call("get", `/me/attendance-certificates/${certificateId}/pdf`, teacher)).status).toBe(403);
    expect((await call("post", "/me/attendance-certificates/email-code", teacher)).status).toBe(200);
    expect((await call("post", "/me/attendance-certificates/email-code", teacher)).status).toBe(429);
    const code = inbox.find((m) => m.to === teacher.user.email)!.html.match(/\b\d{6}\b/)![0];
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await call("post", "/me/attendance-certificates/verify-email", teacher).send({ code: wrong })).status).toBe(400);
    expect((await call("post", "/me/attendance-certificates/verify-email", teacher).send({ code })).status).toBe(400);
    const [state] = await db.select().from(verificationTable).where(eq(verificationTable.userId, teacher.user.id));
    expect(state!.attempts).toBe(5);
    await db.update(verificationTable).set({ sentAt: new Date(0) }).where(eq(verificationTable.userId, teacher.user.id));
    await call("post", "/me/attendance-certificates/email-code", teacher);
    const nextCode = inbox.filter((m) => m.to === teacher.user.email).at(-1)!.html.match(/\b\d{6}\b/)![0];
    expect((await call("post", "/me/attendance-certificates/verify-email", teacher).send({ code: nextCode })).status).toBe(200);
    expect((await call("post", "/me/attendance-certificates/verify-email", teacher).send({ code: nextCode })).status).toBe(400);
    expect((await call("get", `/me/attendance-certificates/${certificateId}/pdf`, teacher)).status).toBe(200);
  });
  it("never permits a different verified account to download another recipient's PDF", async () => {
    await db.insert(verificationTable).values({ userId: other.user.id, email: other.user.email, verifiedAt: new Date() });
    expect((await call("get", "/me/attendance-certificates", other)).body.items).toEqual([]);
    expect((await call("get", `/me/attendance-certificates/${certificateId}/pdf`, other)).status).toBe(404);
    expect((await call("post", "/me/attendance-certificates/issue", other).send({ eventId })).status).toBe(404);
  });
  it("CSV validation is all-or-nothing; reimports do not duplicate or overwrite attendance", async () => {
    const bad = `${csv("Persona CSV", other.user.email)}\nSin correo,incorrecto`;
    expect((await call("post", `/events/${eventId}/attendance/csv-preview`).send({ csv: bad })).body.errors).toBe(1);
    expect((await call("post", `/events/${eventId}/attendance/csv-import`).send({ csv: bad, confirmAttendance: true })).status).toBe(400);
    expect(await db.select().from(attendanceTable).where(and(eq(attendanceTable.eventId, eventId), eq(attendanceTable.email, other.user.email)))).toHaveLength(0);
    expect((await call("post", `/events/${eventId}/attendance/csv-import`).send({ csv: csv("Persona CSV", other.user.email), confirmAttendance: false })).status).toBe(400);
    const payload = { csv: csv("Persona CSV", other.user.email), confirmAttendance: true };
    expect((await call("post", `/events/${eventId}/attendance/csv-import`).send(payload)).body.imported).toBe(1);
    expect((await call("post", `/events/${eventId}/attendance/csv-import`).send(payload)).body.duplicates).toBe(1);
    const mine = await call("get", "/me/attendance-certificates", other);
    expect(mine.body.pendingEvents).toContainEqual({ eventId, eventName: "Nombre cambiado posteriormente" });
    const own = await call("post", "/me/attendance-certificates/issue", other).send({ eventId });
    expect(own.status).toBe(200);
    expect((await call("get", "/me/attendance-certificates", other)).body.items[0].attendeeName).toBe("Persona CSV");
  });
  it("returns personalized PDFs in a ZIP, with no new account required for organizer generation", async () => {
    const response = await call("post", `/events/${eventId}/attendance/certificates-zip`);
    expect(response.status).toBe(200);
    const zip = await JSZip.loadAsync(Buffer.from(response.body.contentBase64, "base64"));
    expect(Object.keys(zip.files).filter((name) => name.endsWith(".pdf"))).toHaveLength(2);
  });
  it("revocation remains public and blocks downloads; replacement uses a different QR", async () => {
    expect((await call("patch", `/events/${eventId}/attendance/${attendanceId}`).send({ status: "rejected" })).status).toBe(409);
    expect((await call("post", `/events/${eventId}/certificates/${certificateId}/revoke`).send({ reason: "Corrección del certificado" })).status).toBe(200);
    expect((await request(app).get(`/api/public/certificates/${certificateToken}`)).body.valid).toBe(false);
    expect((await call("get", `/me/attendance-certificates/${certificateId}/pdf`, teacher)).status).toBe(409);
    expect((await call("post", "/me/attendance-certificates/issue", teacher).send({ eventId })).status).toBe(404);
    expect((await call("get", "/me/attendance-certificates", teacher)).body.pendingEvents).toEqual([]);
    expect((await call("post", `/events/${eventId}/attendance/${attendanceId}/certificate`)).status).toBe(409);
    await call("patch", `/events/${eventId}/attendance/${attendanceId}`).send({ status: "confirmed" });
    const replacement = await call("post", `/events/${eventId}/attendance/${attendanceId}/certificate`);
    expect(replacement.status).toBe(200);
    expect(replacement.body.certificateId).not.toBe(certificateId);
  });
  it("closed QR and future events cannot be used to register or issue prematurely", async () => {
    await call("put", `/events/${eventId}/attendance-settings`).send({ ...settings, registrationOpen: false });
    expect((await call("post", `/attendance/registration/${token}`, teacher)).status).toBe(410);
    const [future] = await db.insert(eventsTable).values({ name: "Evento futuro", type: "jornada", startAt: new Date(Date.now() + 86400000), endAt: new Date(Date.now() + 90000000) }).returning();
    eventIds.push(future!.id);
    expect((await call("put", `/events/${future!.id}/attendance-settings`, unscopedCoordinator).send(settings)).status).toBe(403);
    await call("put", `/events/${future!.id}/attendance-settings`).send(settings);
    expect((await call("post", `/events/${future!.id}/attendance/csv-import`).send({ csv: csv("Persona futura", other.user.email), confirmAttendance: true })).status).toBe(409);
  });
});
