// This executable is test-only; never imported by the production API.
import { realpathSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:https";
import { execFileSync } from "node:child_process";
import express from "express";
import { eq, sql } from "drizzle-orm";

const root = process.env.COORDINA_PROFILE_UI_ROOT;
if (!root || !/\/coordina-profile-ui\.[a-zA-Z0-9]+$/.test(root) || realpathSync(root) !== root) {
  throw new Error("Use bash scripts/test-profile-ui.sh; shared databases are forbidden.");
}
const url = new URL(process.env.DATABASE_URL ?? "");
if (url.pathname !== "/coordina_profile_ui" || url.searchParams.get("host") !== join(root, "socket")) {
  throw new Error("Refusing a database outside the disposable private socket.");
}
const { db, pool, integrationSettingsTable, lmsCoursesTable, lmsLessonsTable } = await import("@workspace/db");
const identity = await db.execute(sql`
  SELECT current_database() AS name, current_setting('data_directory') AS directory,
         current_setting('listen_addresses') AS listeners
`);
const row = identity.rows[0];
if (row.name !== "coordina_profile_ui" || row.directory !== join(root, "data") || row.listeners !== "") {
  await pool.end();
  throw new Error("PostgreSQL identity does not match the disposable runner.");
}

// Only after verifying the server's identity may fixtures or app code run.
const { getSettings } = await import("../src/lib/settings");
const { createProvince, createCenter, createModule, createUser } = await import("../test/helpers");
const settings = await getSettings();
const year = "2098-2099";
await db.update(integrationSettingsTable).set({ activeAcademicYear: year })
  .where(eq(integrationSettingsTable.id, settings.id));
const provinceId = await createProvince("Provincia UI sintética");
const centerId = await createCenter(provinceId);
const moduleName = "Módulo UI sintético";
const moduleId = await createModule({ centerId, name: moduleName });
const { centersTable } = await import("@workspace/db");
const [center] = await db.select().from(centersTable).where(eq(centersTable.id, centerId));
const accounts: Record<string, { email: string; password: string; id: number }> = {};
for (const surface of ["desktop", "mobile"]) {
  for (const role of ["teacher", "department_head", "coordinator", "superadmin"] as const) {
    for (const state of ["no-center", "no-modules"]) {
      const account = await createUser({
        role, incompleteProfile: true, provinceId,
        centerId: state === "no-center" ? null : centerId,
        name: `UI ${surface} ${role} ${state}`,
      });
      accounts[`${surface}/${role}/${state}`] = {
        email: account.email, password: account.password, id: account.user.id,
      };
    }
  }
}
const classroomAccounts: Record<string, { email: string; password: string; id: number }> = {};
for (const surface of ["desktop", "mobile"]) {
  const account = await createUser({
    role: "teacher",
    provinceId,
    centerId,
    name: `Docente de prueba para el aula (${surface})`,
  });
  classroomAccounts[surface] = {
    email: account.email,
    password: account.password,
    id: account.user.id,
  };
}
const [classroomCourse] = await db.insert(lmsCoursesTable).values({
  title: "VERI*FACTU: curso de demostración",
  description: "Curso de prueba para comprobar el aula de aprendizaje.",
  status: "published",
  certificateEnabled: false,
  createdBy: classroomAccounts.desktop!.id,
  publishedAt: new Date(),
}).returning();
const classroomLessons = [
  ["Presentación y objetivos", "Contenido de prueba: presentación y objetivos."],
  ["Normativa y comprobación", "Contenido de prueba: normativa y comprobación."],
  ["Caso práctico", "Contenido de prueba: caso práctico."],
] as const;
await db.insert(lmsLessonsTable).values(classroomLessons.map(([title, text], position) => ({
  courseId: classroomCourse!.id,
  title,
  kind: "text",
  position,
  required: true,
  content: { text },
})));
const { ObjectStorageService } = await import("../src/lib/objectStorage");
const { PDFDocument } = await import("pdf-lib");
const { default: JSZip } = await import("jszip");
const storage = new ObjectStorageService();
const pdf = await PDFDocument.create();
pdf.addPage([440, 620]).drawText("Guia PDF del aula de prueba", { x: 35, y: 550, size: 18 });
const pdfBytes = Buffer.from(await pdf.save());
// Navigation fixtures are inserted only after the disposable database identity
// check above. No notice delivery, email, push, AI or production data is involved.
const {
  eventsTable, meetingMinutesTable, meetingMinutesSourcesTable,
  eventAttendancesTable, eventAttendanceCertificatesTable,
  certificateEmailVerificationsTable,
} = await import("@workspace/db");
const { default: jwt } = await import("jsonwebtoken");
const notificationAccounts = {};
const navigationUsers = {
  member: await createUser({ role: "teacher", provinceId, centerId }),
  outsider: await createUser({ role: "teacher", provinceId: await createProvince("Otra provincia UI") }),
  incomplete: await createUser({ role: "teacher", provinceId, centerId, incompleteProfile: true }),
};
for (const [key, account] of Object.entries(navigationUsers)) {
  Object.assign(notificationAccounts, {
    [key]: { email: account.email, password: account.password, id: account.user.id, user: account.user,
      token: account.token,
      expiredToken: jwt.sign({
        sub: account.user.id, role: account.user.role, tokenVersion: account.user.tokenVersion,
        sessionNonce: account.user.sessionNonce, exp: 1,
      }, process.env.JWT_SECRET!) },
  });
  await db.insert(certificateEmailVerificationsTable).values({
    userId: account.user.id, email: account.email, verifiedAt: new Date(),
  });
}
const [notificationEvent] = await db.insert(eventsTable).values({
  name: "Reunión destino de aviso UI", type: "coordination_meeting", provinceId,
  createdById: classroomAccounts.desktop!.id, startAt: new Date("2098-10-01T10:00:00Z"),
}).returning();
const finalPath = await storage.savePrivateObjectBytes(pdfBytes, "application/pdf", String(navigationUsers.member.user.id));
await db.insert(meetingMinutesTable).values({
  eventId: notificationEvent!.id, enabled: true, publishedText: "Acta oficial UI",
  publishedAt: new Date(), draftText: "BORRADOR PRIVADO NO VISIBLE UI",
});
await db.insert(meetingMinutesSourcesTable).values({
  eventId: notificationEvent!.id, objectPath: finalPath, fileName: "acta-navegacion-ui.pdf",
  contentType: "application/pdf", size: pdfBytes.length, purpose: "final_document",
  status: "ready", createdAt: new Date(Date.now() - 1000),
});
const [attendance] = await db.insert(eventAttendancesTable).values({
  eventId: notificationEvent!.id, userId: navigationUsers.member.user.id,
  fullName: navigationUsers.member.user.name, email: navigationUsers.member.email, status: "confirmed",
}).returning();
const [navigationCertificate] = await db.insert(eventAttendanceCertificatesTable).values({
  eventId: notificationEvent!.id, attendanceId: attendance!.id, verificationToken: "ui-navigation-certificate",
  snapshot: {
    attendeeName: navigationUsers.member.user.name, eventName: notificationEvent!.name,
    startAt: "2098-10-01T10:00:00Z", endAt: "2098-10-01T11:00:00Z",
    location: null, modality: "presencial", durationMinutes: 60, signerName: "Firmante UI",
    signerRole: "Coordinación", issuePlace: "Provincia UI", issueDate: "2098-10-01",
    additionalText: "", professionalFamily: "Familia UI", appName: "Coordina UI",
    verificationUrl: "", code: "CERTIFICADO-DESTINO-UI", issuedAt: "2098-10-01T12:00:00Z",
  },
}).returning();
const scormZip = new JSZip();
scormZip.file("imsmanifest.xml", "<manifest/>");
scormZip.file("index.html", "<!doctype html><html lang='es'><body><h1>Actividad SCORM ejecutada dentro del aula</h1></body></html>");
const scormBytes = await scormZip.generateAsync({ type: "nodebuffer" });
const owner = String(classroomAccounts.desktop!.id);
const pdfPath = await storage.savePrivateObjectBytes(pdfBytes, "application/pdf", owner);
const scormPath = await storage.savePrivateObjectBytes(scormBytes, "application/zip", owner);
await db.insert(lmsLessonsTable).values([
  { courseId: classroomCourse!.id, title: "Guía PDF de prueba", kind: "file", position: 3, required: true,
    objectPath: pdfPath, objectName: "guia-aula.pdf", objectContentType: "application/pdf", objectSize: pdfBytes.length },
  { courseId: classroomCourse!.id, title: "Actividad SCORM de prueba", kind: "scorm12", position: 4, required: true,
    objectPath: scormPath, objectName: "actividad.zip", objectContentType: "application/zip", objectSize: scormBytes.length,
    scormLaunchPath: "index.html", scormVersion: "1.2" },
  { courseId: classroomCourse!.id, title: "Vídeo de prueba", kind: "video", position: 5, required: true,
    content: { url: "/demo-classroom.mp4" } },
]);
const demoVideo = execFileSync("ffmpeg", [
  "-v", "error", "-f", "lavfi", "-i", "color=c=navy:s=320x180:d=1",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-f", "mp4",
  "-movflags", "frag_keyframe+empty_moov", "pipe:1",
]);
const api = (await import("../src/app")).default;
const { initRealtime } = await import("../src/lib/realtime");
const certificates = {
  key: readFileSync(join(root, "key.pem")),
  cert: readFileSync(join(root, "cert.pem")),
};
const servers: ReturnType<typeof createServer>[] = [];
for (const [client, origin] of [
  ["web", process.env.PROFILE_UI_WEB_URL],
  ["mobile", process.env.PROFILE_UI_MOBILE_URL],
] as const) {
  const parsed = new URL(origin!);
  if (parsed.hostname !== "127.0.0.1" || parsed.protocol !== "https:") {
    throw new Error("The browser fixtures must use loopback HTTPS only.");
  }
  const app = express();
  app.get("/demo-classroom.mp4", (_req, res) => res.type("video/mp4").send(demoVideo));
  app.use(api);
  app.get("/scorm-player", (_req, res) => res.sendFile(join(root, "web", "index.html")));
  app.use("/assets", express.static(join(root, "web", "assets")));
  app.use(express.static(join(root, client)));
  app.get("/{*path}", (_req, res) => res.sendFile(join(root, client, "index.html")));
  const server = createServer(certificates, app);
  // Profile saves reconnect Socket.io; exercise the real handshake as well.
  initRealtime(server);
  await new Promise<void>(resolve => server.listen(Number(parsed.port), "127.0.0.1", resolve));
  servers.push(server);
}
writeFileSync(join(root, "ready.json"), JSON.stringify({
  accounts,
  classroomAccounts,
  classroomCourseId: classroomCourse!.id,
  notificationAccounts,
  notificationEvent: { id: notificationEvent!.id, name: notificationEvent!.name },
  notificationCertificateId: navigationCertificate!.id,
  centerId, centerName: center.name, provinceId, moduleId, moduleName, year,
}));
const stop = async () => {
  for (const server of servers) server.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
