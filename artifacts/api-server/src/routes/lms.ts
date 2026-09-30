import { Router, type IRouter } from "express";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import jwt from "jsonwebtoken";
import JSZip from "jszip";
import {
  db,
  lmsCoursesTable,
  lmsLessonsTable,
  lmsCourseManagersTable,
  lmsLessonProgressTable,
  lmsCertificatesTable,
  lmsUploadIntentsTable,
  modulesTable,
  usersTable,
} from "@workspace/db";
import type { User } from "@workspace/db";
import {
  ListLmsCoursesResponse,
  GetLmsCourseResponse,
  CreateLmsCourseBody,
  GetLmsCourseParams,
  UpdateLmsCourseParams,
  UpdateLmsCourseBody,
  CreateLmsLessonParams,
  CreateLmsLessonBody,
  UpdateLmsLessonParams,
  UpdateLmsLessonBody,
  RequestLmsUploadUrlBody,
  RequestLmsUploadUrlResponse,
  CompleteLmsLessonParams,
  SubmitLmsQuizAttemptParams,
  SubmitLmsQuizAttemptBody,
} from "@workspace/api-zod";
import { requireAuth, isModuleCoordinator } from "../middlewares/auth";
import { ObjectStorageService } from "../lib/objectStorage";
import { getObjectAclPolicy } from "../lib/objectAcl";
import { getActiveFamily } from "../lib/settings";
import { moduleFamilyFilter } from "../lib/familyCatalog";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const scormZipCache = new Map<string, { zip: JSZip; expiresAt: number }>();

type SignedLmsToken = {
  userId: number;
  lessonId: number;
};

function signLmsToken(
  purpose: "lms_scorm" | "lms_file",
  userId: number,
  lessonId: number,
): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required for LMS access tokens");
  return jwt.sign({ purpose, lessonId }, secret, {
    subject: String(userId),
    expiresIn: purpose === "lms_scorm" ? 1800 : 600,
  });
}

function verifyLmsToken(
  token: string | string[],
  purpose: "lms_scorm" | "lms_file",
): SignedLmsToken | undefined {
  const secret = process.env.JWT_SECRET;
  if (!secret) return undefined;
  try {
    const value = Array.isArray(token) ? token[0] : token;
    const payload = jwt.verify(value, secret);
    if (
      typeof payload !== "object" ||
      payload.purpose !== purpose ||
      !Number.isInteger(Number(payload.sub)) ||
      !Number.isInteger(Number(payload.lessonId))
    ) {
      return undefined;
    }
    return { userId: Number(payload.sub), lessonId: Number(payload.lessonId) };
  } catch {
    return undefined;
  }
}

function idParam(value: string | string[]): number {
  return Number(Array.isArray(value) ? value[0] : value);
}

async function canManageCourse(user: User, course: { moduleId: number | null }): Promise<boolean> {
  if (user.role === "superadmin") return true;
  const [delegate] = await db.select().from(lmsCourseManagersTable).where(and(
    eq(lmsCourseManagersTable.userId, user.id),
    course.moduleId == null ? eq(lmsCourseManagersTable.isGeneral, true) : eq(lmsCourseManagersTable.moduleId, course.moduleId),
    isNull(lmsCourseManagersTable.deletedAt),
  ));
  if (delegate) return true;
  return course.moduleId != null && await isModuleCoordinator(user.id, course.moduleId);
}

async function isActiveFamilyModule(moduleId: number): Promise<boolean> {
  const family = await getActiveFamily();
  const [module] = await db
    .select({ id: modulesTable.id })
    .from(modulesTable)
    .where(and(
      eq(modulesTable.id, moduleId),
      isNull(modulesTable.deletedAt),
      moduleFamilyFilter(family),
    ));
  return Boolean(module);
}

async function visibleCourse(user: User, course: { moduleId: number | null; status: string }): Promise<boolean> {
  if (course.status !== "published" && !(await canManageCourse(user, course))) return false;
  if (course.moduleId == null) return true;
  const family = await getActiveFamily();
  const [module] = await db.select({ id: modulesTable.id }).from(modulesTable)
    .where(and(eq(modulesTable.id, course.moduleId), isNull(modulesTable.deletedAt), moduleFamilyFilter(family)));
  return !!module;
}

function learnerSafeLessonContent(
  content: Record<string, unknown>,
): Record<string, unknown> {
  const { answerKey: _answerKey, correctAnswers: _correctAnswers, ...safe } = content;
  if (!Array.isArray(content.questions)) return safe;
  return {
    ...safe,
    questions: content.questions.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const {
        correctIndex: _correctIndex,
        answerIndex: _answerIndex,
        correctAnswer: _correctAnswer,
        answer: _answer,
        ...question
      } = value as Record<string, unknown>;
      return question;
    }),
  };
}

async function courseDetail(courseId: number, user: User) {
  const [course] = await db.select().from(lmsCoursesTable).where(and(eq(lmsCoursesTable.id, courseId), isNull(lmsCoursesTable.deletedAt)));
  if (!course || !(await visibleCourse(user, course))) return undefined;
  const managerView = await canManageCourse(user, course);
  const lessons = await db.select().from(lmsLessonsTable)
    .where(and(eq(lmsLessonsTable.courseId, courseId), isNull(lmsLessonsTable.deletedAt)))
    .orderBy(asc(lmsLessonsTable.position), asc(lmsLessonsTable.id));
  const progress = await db.select().from(lmsLessonProgressTable)
    .where(and(eq(lmsLessonProgressTable.courseId, courseId), eq(lmsLessonProgressTable.userId, user.id)));
  const required = lessons.filter((l) => l.required);
  const completed = required.length > 0 && required.every((l) => progress.some((p) => p.lessonId === l.id && p.status === "completed"));
  return {
    id: course.id, title: course.title, description: course.description, moduleId: course.moduleId,
    status: course.status, certificateEnabled: course.certificateEnabled, lessonCount: lessons.length,
    completed, certificateAvailable: completed && course.certificateEnabled,
    lessons: lessons.map(({ objectPath: _path, ...lesson }) => ({
      ...lesson,
      content: managerView ? lesson.content : learnerSafeLessonContent(lesson.content),
    })),
    progress: progress.map((p) => ({ lessonId: p.lessonId, status: p.status, score: p.score, attempts: p.attempts, completedAt: p.completedAt })),
  };
}

router.get("/lms/courses", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const rows = await db.select().from(lmsCoursesTable).where(isNull(lmsCoursesTable.deletedAt)).orderBy(asc(lmsCoursesTable.title));
  const result = [];
  for (const course of rows) {
    if (!(await visibleCourse(user, course))) continue;
    const lessons = await db.select({ id: lmsLessonsTable.id, required: lmsLessonsTable.required }).from(lmsLessonsTable)
      .where(and(eq(lmsLessonsTable.courseId, course.id), isNull(lmsLessonsTable.deletedAt)));
    const progress = await db.select().from(lmsLessonProgressTable).where(and(eq(lmsLessonProgressTable.courseId, course.id), eq(lmsLessonProgressTable.userId, user.id)));
    const required = lessons.filter((l) => l.required);
    const completed = required.length > 0 && required.every((l) => progress.some((p) => p.lessonId === l.id && p.status === "completed"));
    result.push({ id: course.id, title: course.title, description: course.description, moduleId: course.moduleId, status: course.status, certificateEnabled: course.certificateEnabled, lessonCount: lessons.length, completed, certificateAvailable: completed && course.certificateEnabled });
  }
  res.json(ListLmsCoursesResponse.parse(result));
});

router.get("/lms/courses/:courseId", requireAuth, async (req, res): Promise<void> => {
  const parsed = GetLmsCourseParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ message: parsed.error.message }); return; }
  const detail = await courseDetail(parsed.data.courseId, req.user!);
  if (!detail) { res.status(404).json({ message: "Curso no encontrado" }); return; }
  res.json(GetLmsCourseResponse.parse(detail));
});

router.post("/lms/courses", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateLmsCourseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: parsed.error.message }); return; }
  const moduleId = parsed.data.moduleId ?? null;
  if (moduleId != null && !(await isActiveFamilyModule(moduleId))) {
    res.status(404).json({ message: "Módulo no encontrado en la familia activa" }); return;
  }
  if (!(await canManageCourse(req.user!, { moduleId }))) {
    res.status(403).json({ message: "No puedes crear cursos en este ámbito" }); return;
  }
  const [course] = await db.insert(lmsCoursesTable).values({ ...parsed.data, moduleId, createdBy: req.user!.id }).returning();
  const detail = await courseDetail(course.id, req.user!);
  res.status(201).json(detail);
});

router.patch("/lms/courses/:courseId", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateLmsCourseParams.safeParse(req.params);
  const parsed = UpdateLmsCourseBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ message: "Datos no válidos" }); return; }
  const [course] = await db.select().from(lmsCoursesTable).where(and(eq(lmsCoursesTable.id, params.data.courseId), isNull(lmsCoursesTable.deletedAt)));
  if (!course) { res.status(404).json({ message: "Curso no encontrado" }); return; }
  if (!(await canManageCourse(req.user!, course))) { res.status(403).json({ message: "Permiso denegado" }); return; }
  const nextModuleId = parsed.data.moduleId === undefined ? course.moduleId : parsed.data.moduleId;
  if (
    (nextModuleId != null && !(await isActiveFamilyModule(nextModuleId))) ||
    !(await canManageCourse(req.user!, { moduleId: nextModuleId }))
  ) {
    res.status(403).json({ message: "No puedes trasladar el curso a ese ámbito" }); return;
  }
  await db.update(lmsCoursesTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(lmsCoursesTable.id, course.id));
  res.json(await courseDetail(course.id, req.user!));
});

router.delete("/lms/courses/:courseId", requireAuth, async (req, res): Promise<void> => {
  const id = idParam(req.params.courseId);
  const [course] = await db.select().from(lmsCoursesTable).where(and(eq(lmsCoursesTable.id, id), isNull(lmsCoursesTable.deletedAt)));
  if (!course) { res.status(404).json({ message: "Curso no encontrado" }); return; }
  if (!(await canManageCourse(req.user!, course))) { res.status(403).json({ message: "Permiso denegado" }); return; }
  await db.update(lmsCoursesTable).set({ deletedAt: new Date() }).where(eq(lmsCoursesTable.id, id));
  res.sendStatus(204);
});

router.post("/lms/courses/:courseId/publish", requireAuth, async (req, res): Promise<void> => {
  const id = idParam(req.params.courseId);
  const [course] = await db.select().from(lmsCoursesTable).where(and(eq(lmsCoursesTable.id, id), isNull(lmsCoursesTable.deletedAt)));
  if (!course) { res.status(404).json({ message: "Curso no encontrado" }); return; }
  if (!(await canManageCourse(req.user!, course))) { res.status(403).json({ message: "Permiso denegado" }); return; }
  const [lesson] = await db.select({ id: lmsLessonsTable.id }).from(lmsLessonsTable)
    .where(and(eq(lmsLessonsTable.courseId, id), isNull(lmsLessonsTable.deletedAt))).limit(1);
  if (!lesson) { res.status(409).json({ message: "Añade al menos una lección antes de publicar el curso" }); return; }
  await db.update(lmsCoursesTable).set({ status: "published", publishedAt: new Date(), updatedAt: new Date() }).where(eq(lmsCoursesTable.id, id));
  res.json(await courseDetail(id, req.user!));
});

async function consumeUploadIntent(
  userId: number,
  courseId: number,
  intentToken: string,
  objectPath: string,
): Promise<{ objectPath: string; objectName: string; objectContentType: string; objectSize: number } | undefined> {
  const tokenHash = createHash("sha256").update(intentToken).digest("hex");
  const [intent] = await db.select().from(lmsUploadIntentsTable).where(and(
    eq(lmsUploadIntentsTable.tokenHash, tokenHash),
    eq(lmsUploadIntentsTable.userId, userId),
    eq(lmsUploadIntentsTable.courseId, courseId),
    isNull(lmsUploadIntentsTable.consumedAt),
  ));
  if (!intent || intent.expiresAt.getTime() < Date.now() || intent.objectPath !== objectPath) {
    return undefined;
  }

  const objectFile = await storage.getObjectEntityFile(intent.objectPath);
  const acl = await getObjectAclPolicy(objectFile);
  if (acl?.owner && acl.owner !== String(userId)) return undefined;
  await storage.trySetObjectEntityAclPolicy(intent.objectPath, {
    owner: String(userId),
    visibility: "private",
  });
  const [consumed] = await db.update(lmsUploadIntentsTable)
    .set({ consumedAt: new Date() })
    .where(and(eq(lmsUploadIntentsTable.id, intent.id), isNull(lmsUploadIntentsTable.consumedAt)))
    .returning({ id: lmsUploadIntentsTable.id });
  if (!consumed) return undefined;
  return {
    objectPath: intent.objectPath,
    objectName: intent.name,
    objectContentType: intent.contentType,
    objectSize: intent.size,
  };
}

function normalizedZipPath(value: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value).replace(/\\/g, "/");
  } catch {
    return undefined;
  }
  const normalized = path.posix.normalize(decoded).replace(/^\.\/+/, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    return undefined;
  }
  return normalized;
}

async function loadScormZip(objectPath: string): Promise<JSZip> {
  const cached = scormZipCache.get(objectPath);
  if (cached && cached.expiresAt > Date.now()) return cached.zip;

  const objectFile = await storage.getObjectEntityFile(objectPath);
  const response = await storage.downloadObject(objectFile, 0);
  const archive = Buffer.from(await response.arrayBuffer());
  if (archive.byteLength > 100 * 1024 * 1024) {
    throw new Error("El paquete SCORM supera el tamaño máximo permitido.");
  }
  const zip = await JSZip.loadAsync(archive);
  const entries = Object.values(zip.files);
  if (entries.length > 5000) throw new Error("El paquete SCORM contiene demasiados archivos.");
  let expandedSize = 0;
  for (const entry of entries) {
    if (!normalizedZipPath(entry.name)) throw new Error("El paquete SCORM contiene una ruta no válida.");
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    expandedSize += size;
    if (expandedSize > 250 * 1024 * 1024) {
      throw new Error("El paquete SCORM supera el tamaño descomprimido máximo permitido.");
    }
  }
  scormZipCache.clear();
  scormZipCache.set(objectPath, { zip, expiresAt: Date.now() + 30 * 60_000 });
  return zip;
}

async function getScormLaunch(
  objectPath: string,
  kind: "scorm12" | "scorm2004",
): Promise<{ scormVersion: string; scormLaunchPath: string }> {
  const zip = await loadScormZip(objectPath);
  const manifestFile = zip.file("imsmanifest.xml");
  if (!manifestFile) throw new Error("El paquete no contiene imsmanifest.xml en su raíz.");
  const manifest = await manifestFile.async("string");
  let launchPath: string | undefined;
  for (const match of manifest.matchAll(/<resource\b([^>]*?)(?:\/>|>([\s\S]*?)<\/resource>)/gi)) {
    const attributes = match[1] ?? "";
    const href = attributes.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const scormType = attributes.match(/\b(?:adlcp:)?scormtype\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!scormType || scormType.toLowerCase() === "sco") {
      launchPath = normalizedZipPath(href);
      if (launchPath) break;
    }
  }
  if (!launchPath || !zip.file(launchPath)) {
    throw new Error("No se ha encontrado un archivo de inicio SCO válido.");
  }
  return {
    scormVersion: kind === "scorm2004" ? "2004" : "1.2",
    scormLaunchPath: launchPath,
  };
}

router.post("/lms/courses/:courseId/lessons", requireAuth, async (req, res): Promise<void> => {
  const params = CreateLmsLessonParams.safeParse(req.params);
  const parsed = CreateLmsLessonBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ message: "Datos no válidos" }); return; }
  const [course] = await db.select().from(lmsCoursesTable).where(and(eq(lmsCoursesTable.id, params.data.courseId), isNull(lmsCoursesTable.deletedAt)));
  if (!course || !(await canManageCourse(req.user!, course))) { res.status(403).json({ message: "Permiso denegado" }); return; }
  const {
    intentToken,
    objectName: _untrustedName,
    objectContentType: _untrustedContentType,
    objectSize: _untrustedSize,
    ...lessonInput
  } = parsed.data;
  let uploadMetadata: Awaited<ReturnType<typeof consumeUploadIntent>> | undefined;
  if (lessonInput.objectPath || intentToken) {
    if (!lessonInput.objectPath || !intentToken) { res.status(400).json({ message: "Falta el token de subida" }); return; }
    try {
      uploadMetadata = await consumeUploadIntent(req.user!.id, course.id, intentToken, lessonInput.objectPath);
    } catch {
      res.status(400).json({ message: "No se ha encontrado el archivo subido" }); return;
    }
    if (!uploadMetadata) { res.status(403).json({ message: "La subida no es válida o ha caducado" }); return; }
  }
  if ((lessonInput.kind === "scorm12" || lessonInput.kind === "scorm2004") && !uploadMetadata) {
    res.status(400).json({ message: "Debes subir un paquete SCORM válido." }); return;
  }
  let scormMetadata: { scormVersion: string; scormLaunchPath: string } | undefined;
  if (lessonInput.kind === "scorm12" || lessonInput.kind === "scorm2004") {
    try {
      scormMetadata = await getScormLaunch(uploadMetadata!.objectPath, lessonInput.kind);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Paquete SCORM no válido." }); return;
    }
  }
  const [lesson] = await db.insert(lmsLessonsTable).values({
    ...lessonInput,
    ...(uploadMetadata ?? {}),
    ...(scormMetadata ?? {}),
    courseId: course.id,
  }).returning();
  const { objectPath: _path, ...safe } = lesson;
  res.status(201).json(safe);
});

router.patch("/lms/lessons/:lessonId", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateLmsLessonParams.safeParse(req.params);
  const parsed = UpdateLmsLessonBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ message: "Datos no válidos" }); return; }
  const [lesson] = await db.select().from(lmsLessonsTable).where(and(eq(lmsLessonsTable.id, params.data.lessonId), isNull(lmsLessonsTable.deletedAt)));
  if (!lesson) { res.status(404).json({ message: "Lección no encontrada" }); return; }
  const [course] = await db.select().from(lmsCoursesTable).where(eq(lmsCoursesTable.id, lesson.courseId));
  if (!course || !(await canManageCourse(req.user!, course))) { res.status(403).json({ message: "Permiso denegado" }); return; }
  const {
    intentToken,
    objectPath: requestedObjectPath,
    objectName: _untrustedName,
    objectContentType: _untrustedContentType,
    objectSize: _untrustedSize,
    ...lessonFields
  } = parsed.data;
  let uploadMetadata: Awaited<ReturnType<typeof consumeUploadIntent>> | undefined;
  if (requestedObjectPath || intentToken) {
    if (!requestedObjectPath || !intentToken) { res.status(400).json({ message: "Falta el token de subida" }); return; }
    try {
      uploadMetadata = await consumeUploadIntent(req.user!.id, course.id, intentToken, requestedObjectPath);
    } catch {
      res.status(400).json({ message: "No se ha encontrado el archivo subido" }); return;
    }
    if (!uploadMetadata) { res.status(403).json({ message: "La subida no es válida o ha caducado" }); return; }
  }
  const nextKind = lessonFields.kind ?? lesson.kind;
  const nextObjectPath = uploadMetadata?.objectPath ?? lesson.objectPath;
  let scormMetadata: { scormVersion: string; scormLaunchPath: string } | { scormVersion: null; scormLaunchPath: null } | undefined;
  if (nextKind === "scorm12" || nextKind === "scorm2004") {
    if (!nextObjectPath) { res.status(400).json({ message: "Debes subir un paquete SCORM válido." }); return; }
    try {
      scormMetadata = await getScormLaunch(nextObjectPath, nextKind);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Paquete SCORM no válido." }); return;
    }
  } else if (lesson.kind === "scorm12" || lesson.kind === "scorm2004") {
    scormMetadata = { scormVersion: null, scormLaunchPath: null };
  }
  const [updated] = await db.update(lmsLessonsTable).set({
    ...lessonFields,
    ...(uploadMetadata ?? {}),
    ...(scormMetadata ?? {}),
    updatedAt: new Date(),
  }).where(eq(lmsLessonsTable.id, lesson.id)).returning();
  const { objectPath: _path, ...safe } = updated;
  res.json(safe);
});

router.delete("/lms/lessons/:lessonId", requireAuth, async (req, res): Promise<void> => {
  const id = idParam(req.params.lessonId);
  const [lesson] = await db.select().from(lmsLessonsTable).where(and(eq(lmsLessonsTable.id, id), isNull(lmsLessonsTable.deletedAt)));
  if (!lesson) { res.status(404).json({ message: "Lección no encontrada" }); return; }
  const [course] = await db.select().from(lmsCoursesTable).where(eq(lmsCoursesTable.id, lesson.courseId));
  if (!course || !(await canManageCourse(req.user!, course))) { res.status(403).json({ message: "Permiso denegado" }); return; }
  await db.update(lmsLessonsTable).set({ deletedAt: new Date() }).where(eq(lmsLessonsTable.id, id));
  res.sendStatus(204);
});

router.post("/lms/uploads/request-url", requireAuth, async (req, res): Promise<void> => {
  const parsed = RequestLmsUploadUrlBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: parsed.error.message }); return; }
  const [course] = await db.select().from(lmsCoursesTable).where(and(
    eq(lmsCoursesTable.id, parsed.data.courseId),
    isNull(lmsCoursesTable.deletedAt),
  ));
  if (!course || !(await canManageCourse(req.user!, course))) {
    res.status(403).json({ message: "No tienes permiso para adjuntar archivos a este curso" }); return;
  }
  const uploadURL = await storage.getObjectEntityUploadURL();
  const objectPath = storage.normalizeObjectEntityPath(uploadURL);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  await db.insert(lmsUploadIntentsTable).values({
    tokenHash: createHash("sha256").update(token).digest("hex"),
    userId: req.user!.id,
    courseId: course.id,
    objectPath,
    name: parsed.data.name,
    contentType: parsed.data.contentType,
    size: parsed.data.size,
    expiresAt,
  });
  res.json(RequestLmsUploadUrlResponse.parse({ uploadURL, objectPath, intentToken: token, expiresAt }));
});

router.post("/lms/lessons/:lessonId/complete", requireAuth, async (req, res): Promise<void> => {
  const params = CompleteLmsLessonParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ message: params.error.message }); return; }
  const [lesson] = await db.select().from(lmsLessonsTable).where(and(eq(lmsLessonsTable.id, params.data.lessonId), isNull(lmsLessonsTable.deletedAt)));
  if (!lesson) { res.status(404).json({ message: "Lección no encontrada" }); return; }
  if (lesson.kind === "quiz" || lesson.kind === "scorm12" || lesson.kind === "scorm2004") {
    res.status(400).json({ message: "Esta lección solo se completa al superar su evaluación." }); return;
  }
  const [course] = await db.select().from(lmsCoursesTable).where(eq(lmsCoursesTable.id, lesson.courseId));
  if (!course || !(await visibleCourse(req.user!, course))) { res.status(404).json({ message: "Curso no encontrado" }); return; }
  const now = new Date();
  const [progress] = await db.insert(lmsLessonProgressTable).values({ userId: req.user!.id, courseId: course.id, lessonId: lesson.id, status: "completed", attempts: 1, startedAt: now, completedAt: now }).onConflictDoUpdate({ target: [lmsLessonProgressTable.userId, lmsLessonProgressTable.lessonId], set: { status: "completed", completedAt: now, updatedAt: now } }).returning();
  await issueCertificateIfComplete(course.id, req.user!.id);
  res.json({ lessonId: progress.lessonId, status: progress.status, score: progress.score, attempts: progress.attempts, completedAt: progress.completedAt });
});

async function issueCertificateIfComplete(courseId: number, userId: number): Promise<void> {
  const [course] = await db.select().from(lmsCoursesTable).where(and(
    eq(lmsCoursesTable.id, courseId),
    isNull(lmsCoursesTable.deletedAt),
  ));
  if (!course?.certificateEnabled) return;
  const required = await db.select({ id: lmsLessonsTable.id }).from(lmsLessonsTable)
    .where(and(
      eq(lmsLessonsTable.courseId, courseId),
      eq(lmsLessonsTable.required, true),
      isNull(lmsLessonsTable.deletedAt),
    ));
  if (!required.length) return;
  const completed = await db.select({ lessonId: lmsLessonProgressTable.lessonId }).from(lmsLessonProgressTable)
    .where(and(
      eq(lmsLessonProgressTable.userId, userId),
      eq(lmsLessonProgressTable.courseId, courseId),
      eq(lmsLessonProgressTable.status, "completed"),
    ));
  if (!required.every((lesson) => completed.some((row) => row.lessonId === lesson.id))) return;
  await db.insert(lmsCertificatesTable).values({
    courseId,
    userId,
    certificateNumber: `ADG-${randomUUID()}`,
  }).onConflictDoNothing({ target: [lmsCertificatesTable.courseId, lmsCertificatesTable.userId] });
}

router.post("/lms/lessons/:lessonId/quiz-attempt", requireAuth, async (req, res): Promise<void> => {
  const params = SubmitLmsQuizAttemptParams.safeParse(req.params);
  const parsed = SubmitLmsQuizAttemptBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ message: "Datos no válidos" }); return; }
  const [lesson] = await db.select().from(lmsLessonsTable).where(and(eq(lmsLessonsTable.id, params.data.lessonId), eq(lmsLessonsTable.kind, "quiz"), isNull(lmsLessonsTable.deletedAt)));
  if (!lesson) { res.status(404).json({ message: "Cuestionario no encontrado" }); return; }
  const [course] = await db.select().from(lmsCoursesTable).where(eq(lmsCoursesTable.id, lesson.courseId));
  if (!course || !(await visibleCourse(req.user!, course))) { res.status(404).json({ message: "Curso no encontrado" }); return; }
  const questions = Array.isArray(lesson.content.questions)
    ? lesson.content.questions as Array<{ correctIndex?: number; options?: unknown[] }>
    : [];
  if (
    questions.length === 0 ||
    parsed.data.selectedIndexes.length !== questions.length ||
    questions.some((question, index) =>
      !Number.isInteger(question.correctIndex) ||
      !Array.isArray(question.options) ||
      !Number.isInteger(parsed.data.selectedIndexes[index]) ||
      parsed.data.selectedIndexes[index] < 0 ||
      parsed.data.selectedIndexes[index] >= question.options.length
    )
  ) {
    res.status(400).json({ message: "El cuestionario no tiene preguntas o las respuestas no son válidas." }); return;
  }
  const score = Math.round(questions.reduce((n, q, i) => n + (q.correctIndex === parsed.data.selectedIndexes[i] ? 1 : 0), 0) * 100 / questions.length);
  const [previous] = await db.select().from(lmsLessonProgressTable).where(and(
    eq(lmsLessonProgressTable.userId, req.user!.id),
    eq(lmsLessonProgressTable.lessonId, lesson.id),
  ));
  const passed = score >= 70 || previous?.status === "completed";
  const recordedScore = Math.max(score, previous?.score ?? 0);
  const now = new Date();
  const [progress] = await db.insert(lmsLessonProgressTable).values({ userId: req.user!.id, courseId: lesson.courseId, lessonId: lesson.id, status: passed ? "completed" : "failed", score: recordedScore, attempts: 1, completedAt: passed ? (previous?.completedAt ?? now) : null }).onConflictDoUpdate({ target: [lmsLessonProgressTable.userId, lmsLessonProgressTable.lessonId], set: { status: passed ? "completed" : "failed", score: recordedScore, attempts: sql`${lmsLessonProgressTable.attempts} + 1`, completedAt: passed ? (previous?.completedAt ?? now) : null, updatedAt: now } }).returning();
  if (passed) await issueCertificateIfComplete(course.id, req.user!.id);
  res.json({ lessonId: progress.lessonId, status: progress.status, score: recordedScore, attempts: progress.attempts, completedAt: progress.completedAt, passed });
});

router.get("/lms/management/scopes", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const scopes: Array<{ moduleId: number | null; label: string; canManage: boolean }> = [];
  if (await canManageCourse(user, { moduleId: null })) {
    scopes.push({ moduleId: null, label: "Cursos generales", canManage: true });
  }
  const family = await getActiveFamily();
  const modules = await db.select({ id: modulesTable.id, name: modulesTable.name }).from(modulesTable)
    .where(and(isNull(modulesTable.deletedAt), moduleFamilyFilter(family)));
  for (const module of modules) {
    if (await canManageCourse(user, { moduleId: module.id })) {
      scopes.push({ moduleId: module.id, label: module.name, canManage: true });
    }
  }
  res.json(scopes);
});

async function managerList(moduleId: number | null) {
  const rows = await db.select({ userId: lmsCourseManagersTable.userId, name: usersTable.name, email: usersTable.email })
    .from(lmsCourseManagersTable).innerJoin(usersTable, eq(usersTable.id, lmsCourseManagersTable.userId))
    .where(and(
      moduleId == null ? eq(lmsCourseManagersTable.isGeneral, true) : eq(lmsCourseManagersTable.moduleId, moduleId),
      isNull(lmsCourseManagersTable.deletedAt),
      isNull(usersTable.deletedAt),
      eq(usersTable.status, "active"),
    ));
  return rows.map((row) => ({ userId: row.userId, name: row.name ?? "", email: row.email }));
}

async function replaceManagers(req: import("express").Request, res: import("express").Response, moduleId: number | null): Promise<void> {
  const user = req.user!;
  if (user.role !== "superadmin" && (moduleId == null || !(await isModuleCoordinator(user.id, moduleId)))) {
    res.status(403).json({ message: "Permiso denegado" }); return;
  }
  if (moduleId != null && !(await isActiveFamilyModule(moduleId))) {
    res.status(404).json({ message: "Módulo no encontrado en la familia activa" }); return;
  }
  if (!Array.isArray(req.body?.userIds) || req.body.userIds.some((id: unknown) => !Number.isInteger(id) || Number(id) < 1)) {
    res.status(400).json({ message: "La lista de responsables no es válida" }); return;
  }
  const ids = [...new Set(req.body.userIds as number[])].filter((id) => id !== user.id);
  const activeUsers = ids.length
    ? await db.select({ id: usersTable.id }).from(usersTable).where(and(
      inArray(usersTable.id, ids),
      eq(usersTable.status, "active"),
      isNull(usersTable.deletedAt),
    ))
    : [];
  if (activeUsers.length !== ids.length) {
    res.status(400).json({ message: "La lista incluye usuarios inexistentes o inactivos" }); return;
  }
  const existing = await db.select().from(lmsCourseManagersTable).where(
    moduleId == null ? eq(lmsCourseManagersTable.isGeneral, true) : eq(lmsCourseManagersTable.moduleId, moduleId),
  );
  for (const row of existing) {
    if (row.deletedAt == null && !ids.includes(row.userId)) {
      await db.update(lmsCourseManagersTable).set({ deletedAt: new Date() }).where(eq(lmsCourseManagersTable.id, row.id));
    }
  }
  for (const id of ids) {
    const found = existing.find((row) => row.userId === id);
    if (found) { await db.update(lmsCourseManagersTable).set({ deletedAt: null }).where(eq(lmsCourseManagersTable.id, found.id)); }
    else await db.insert(lmsCourseManagersTable).values({ userId: id, moduleId, isGeneral: moduleId == null, grantedBy: user.id });
  }
  res.json(await managerList(moduleId));
}

router.get("/lms/general/managers", requireAuth, async (req, res): Promise<void> => {
  if (!(await canManageCourse(req.user!, { moduleId: null }))) { res.status(403).json({ message: "Permiso denegado" }); return; }
  res.json(await managerList(null));
});
router.put("/lms/general/managers", requireAuth, async (req, res): Promise<void> => replaceManagers(req, res, null));
router.get("/lms/modules/:moduleId/managers", requireAuth, async (req, res): Promise<void> => {
  const moduleId = idParam(req.params.moduleId);
  if (!(await canManageCourse(req.user!, { moduleId }))) { res.status(403).json({ message: "Permiso denegado" }); return; }
  res.json(await managerList(moduleId));
});
router.put("/lms/modules/:moduleId/managers", requireAuth, async (req, res): Promise<void> => replaceManagers(req, res, idParam(req.params.moduleId)));

async function scormSessionResponse(token: string): Promise<{
  user: User;
  lesson: typeof lmsLessonsTable.$inferSelect;
  course: typeof lmsCoursesTable.$inferSelect;
  response: { token: string; launchPath: string; version: string; expiresAt: Date; cmiData: Record<string, unknown> };
} | undefined> {
  const claims = verifyLmsToken(token, "lms_scorm");
  if (!claims) return undefined;
  const [user] = await db.select().from(usersTable).where(and(
    eq(usersTable.id, claims.userId),
    eq(usersTable.status, "active"),
    isNull(usersTable.deletedAt),
  ));
  if (!user) return undefined;
  const [lesson] = await db.select().from(lmsLessonsTable).where(and(
    eq(lmsLessonsTable.id, claims.lessonId),
    isNull(lmsLessonsTable.deletedAt),
  ));
  if (!lesson || !lesson.objectPath || !lesson.scormLaunchPath) return undefined;
  const [course] = await db.select().from(lmsCoursesTable).where(and(
    eq(lmsCoursesTable.id, lesson.courseId),
    isNull(lmsCoursesTable.deletedAt),
  ));
  if (!course || !(await visibleCourse(user, course))) return undefined;
  const [progress] = await db.select().from(lmsLessonProgressTable).where(and(
    eq(lmsLessonProgressTable.userId, user.id),
    eq(lmsLessonProgressTable.lessonId, lesson.id),
  ));
  const expires = jwt.decode(token);
  const exp = typeof expires === "object" && expires && typeof expires.exp === "number"
    ? expires.exp
    : Math.floor(Date.now() / 1000) + 1;
  return {
    user,
    lesson,
    course,
    response: {
      token,
      launchPath: `/api/lms/scorm/sessions/${token}/content/${lesson.scormLaunchPath.split("/").map(encodeURIComponent).join("/")}`,
      version: lesson.scormVersion ?? lesson.kind,
      expiresAt: new Date(exp * 1000),
      cmiData: progress?.cmiData ?? {},
    },
  };
}

async function startScormSession(user: User, lesson: typeof lmsLessonsTable.$inferSelect) {
  const token = signLmsToken("lms_scorm", user.id, lesson.id);
  const now = new Date();
  await db.insert(lmsLessonProgressTable).values({
    userId: user.id,
    courseId: lesson.courseId,
    lessonId: lesson.id,
    status: "in_progress",
    attempts: 1,
    startedAt: now,
  }).onConflictDoUpdate({
    target: [lmsLessonProgressTable.userId, lmsLessonProgressTable.lessonId],
    set: {
      status: sql`CASE WHEN ${lmsLessonProgressTable.status} = 'completed' THEN 'completed' ELSE 'in_progress' END`,
      attempts: sql`${lmsLessonProgressTable.attempts} + 1`,
      startedAt: sql`COALESCE(${lmsLessonProgressTable.startedAt}, ${now})`,
      updatedAt: now,
    },
  });
  return (await scormSessionResponse(token))?.response;
}

router.post("/lms/courses/:courseId/scorm-session", requireAuth, async (req, res): Promise<void> => {
  const courseId = idParam(req.params.courseId);
  const lessonId = Number(req.body?.lessonId);
  if (!Number.isInteger(courseId) || courseId < 1 || !Number.isInteger(lessonId) || lessonId < 1) {
    res.status(400).json({ message: "Curso o lección no válidos" }); return;
  }
  const [lesson] = await db.select().from(lmsLessonsTable).where(and(
    eq(lmsLessonsTable.id, lessonId),
    eq(lmsLessonsTable.courseId, courseId),
    isNull(lmsLessonsTable.deletedAt),
  ));
  const [course] = await db.select().from(lmsCoursesTable).where(and(
    eq(lmsCoursesTable.id, courseId),
    isNull(lmsCoursesTable.deletedAt),
  ));
  if (
    !lesson ||
    !["scorm12", "scorm2004"].includes(lesson.kind) ||
    !course ||
    !(await visibleCourse(req.user!, course))
  ) {
    res.status(404).json({ message: "Contenido SCORM no encontrado" }); return;
  }
  res.json(await startScormSession(req.user!, lesson));
});

router.post("/lms/lessons/:lessonId/scorm-session", requireAuth, async (req, res): Promise<void> => {
  const lessonId = idParam(req.params.lessonId);
  if (!Number.isInteger(lessonId) || lessonId < 1) { res.status(400).json({ message: "Lección no válida" }); return; }
  const [lesson] = await db.select().from(lmsLessonsTable).where(and(
    eq(lmsLessonsTable.id, lessonId),
    isNull(lmsLessonsTable.deletedAt),
  ));
  if (!lesson || !["scorm12", "scorm2004"].includes(lesson.kind)) {
    res.status(404).json({ message: "Contenido SCORM no encontrado" }); return;
  }
  const [course] = await db.select().from(lmsCoursesTable).where(and(
    eq(lmsCoursesTable.id, lesson.courseId),
    isNull(lmsCoursesTable.deletedAt),
  ));
  if (!course || !(await visibleCourse(req.user!, course))) {
    res.status(404).json({ message: "Curso no encontrado" }); return;
  }
  res.json(await startScormSession(req.user!, lesson));
});

router.get("/lms/scorm/session", async (req, res): Promise<void> => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = await scormSessionResponse(token);
  if (!session) { res.status(404).json({ message: "Sesión SCORM no válida" }); return; }
  res.json(session.response);
});

router.get("/lms/scorm/runtime/cross-frame-api.js", (_req, res): void => {
  const runtimePath = path.resolve(
    process.cwd(),
    "node_modules/scorm-again/dist/esm/cross-frame-api.min.js",
  );
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.type("application/javascript").sendFile(runtimePath);
});

router.get("/lms/scorm/sessions/:token/content/*assetPath", async (req, res): Promise<void> => {
  const session = await scormSessionResponse(req.params.token);
  if (!session) { res.status(404).json({ message: "Sesión SCORM no válida" }); return; }
  const rawPath = Array.isArray(req.params.assetPath) ? req.params.assetPath.join("/") : req.params.assetPath;
  const assetPath = normalizedZipPath(rawPath);
  if (!assetPath) { res.status(404).json({ message: "Archivo no encontrado" }); return; }
  const zip = await loadScormZip(session.lesson.objectPath!);
  const file = zip.file(assetPath);
  if (!file || file.dir) { res.status(404).json({ message: "Archivo no encontrado" }); return; }
  let content = await file.async("nodebuffer");
  const extension = path.posix.extname(assetPath).toLowerCase();
  const contentTypes: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  if (extension === ".html" || extension === ".htm") {
    const html = content.toString("utf8");
    const bridge = `<script type="module">import CrossFrameAPI from "/api/lms/scorm/runtime/cross-frame-api.js";const parentOrigin=document.referrer?new URL(document.referrer).origin:window.location.origin;window.API=window.API_1484_11=new CrossFrameAPI(parentOrigin,window.parent);</script>`;
    content = Buffer.from(/<head\b[^>]*>/i.test(html)
      ? html.replace(/<head\b[^>]*>/i, (head) => `${head}${bridge}`)
      : `${bridge}${html}`);
  }
  res.setHeader("Content-Type", contentTypes[extension] ?? "application/octet-stream");
  res.setHeader("Content-Security-Policy", "sandbox allow-scripts allow-forms allow-downloads");
  res.setHeader("Referrer-Policy", "origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.send(content);
});

router.post("/lms/scorm/commit", async (req, res): Promise<void> => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = await scormSessionResponse(token);
  if (!session) { res.status(404).json({ message: "Sesión SCORM no válida" }); return; }
  const cmiData = req.body?.cmiData;
  if (!cmiData || typeof cmiData !== "object" || Array.isArray(cmiData)) {
    res.status(400).json({ message: "Datos SCORM no válidos" }); return;
  }
  const flatten = (value: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};
    const walk = (current: unknown, prefix = "") => {
      if (!current || typeof current !== "object" || Array.isArray(current)) return;
      for (const [key, item] of Object.entries(current as Record<string, unknown>)) {
        const pathKey = prefix ? `${prefix}.${key}` : key;
        if (item && typeof item === "object" && !Array.isArray(item)) walk(item, pathKey);
        else result[pathKey] = item;
      }
    };
    walk(value);
    return result;
  };
  const flattened = flatten(cmiData as Record<string, unknown>);
  const rawStatus = String(
    req.body?.status ??
    flattened["cmi.core.lesson_status"] ??
    flattened["cmi.completion_status"] ??
    flattened["cmi.success_status"] ??
    "",
  ).toLowerCase();
  const scoreValue = Number(
    req.body?.score ??
    flattened["cmi.core.score.raw"] ??
    flattened["cmi.score.raw"],
  );
  const score = Number.isFinite(scoreValue) ? Math.max(0, Math.min(100, Math.round(scoreValue))) : null;
  const passedStatus = rawStatus === "completed" || rawStatus === "passed";
  const [previous] = await db.select().from(lmsLessonProgressTable).where(and(
    eq(lmsLessonProgressTable.userId, session.user.id),
    eq(lmsLessonProgressTable.lessonId, session.lesson.id),
  ));
  const completed = passedStatus || previous?.status === "completed";
  const now = new Date();
  const [progress] = await db.insert(lmsLessonProgressTable).values({
    userId: session.user.id,
    courseId: session.course.id,
    lessonId: session.lesson.id,
    status: completed ? "completed" : "in_progress",
    score,
    attempts: 1,
    cmiData: cmiData as Record<string, unknown>,
    startedAt: now,
    completedAt: completed ? (previous?.completedAt ?? now) : null,
  }).onConflictDoUpdate({
    target: [lmsLessonProgressTable.userId, lmsLessonProgressTable.lessonId],
    set: {
      status: completed ? "completed" : "in_progress",
      score: score === null ? previous?.score ?? null : Math.max(score, previous?.score ?? 0),
      cmiData: cmiData as Record<string, unknown>,
      completedAt: completed ? (previous?.completedAt ?? now) : null,
      updatedAt: now,
    },
  }).returning();
  if (completed) await issueCertificateIfComplete(session.course.id, session.user.id);
  res.json({ lessonId: progress.lessonId, status: progress.status, score: progress.score, attempts: progress.attempts, completedAt: progress.completedAt });
});

router.post("/lms/lessons/:lessonId/download-token", requireAuth, async (req, res): Promise<void> => {
  const lessonId = idParam(req.params.lessonId);
  const [lesson] = await db.select().from(lmsLessonsTable).where(and(
    eq(lmsLessonsTable.id, lessonId),
    isNull(lmsLessonsTable.deletedAt),
  ));
  if (!lesson || !lesson.objectPath) { res.status(404).json({ message: "Archivo no encontrado" }); return; }
  const [course] = await db.select().from(lmsCoursesTable).where(and(
    eq(lmsCoursesTable.id, lesson.courseId),
    isNull(lmsCoursesTable.deletedAt),
  ));
  if (!course || !(await visibleCourse(req.user!, course))) { res.status(404).json({ message: "Curso no encontrado" }); return; }
  const token = signLmsToken("lms_file", req.user!.id, lesson.id);
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  res.json({ url: `/api/lms/files?token=${encodeURIComponent(token)}`, expiresAt });
});

router.get("/lms/files", async (req, res): Promise<void> => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const claims = verifyLmsToken(token, "lms_file");
  if (!claims) { res.status(404).json({ message: "Enlace no válido o caducado" }); return; }
  const [user] = await db.select().from(usersTable).where(and(
    eq(usersTable.id, claims.userId),
    eq(usersTable.status, "active"),
    isNull(usersTable.deletedAt),
  ));
  const [lesson] = await db.select().from(lmsLessonsTable).where(and(
    eq(lmsLessonsTable.id, claims.lessonId),
    isNull(lmsLessonsTable.deletedAt),
  ));
  const [course] = lesson ? await db.select().from(lmsCoursesTable).where(and(
    eq(lmsCoursesTable.id, lesson.courseId),
    isNull(lmsCoursesTable.deletedAt),
  )) : [];
  if (!user || !lesson?.objectPath || !course || !(await visibleCourse(user, course))) {
    res.status(404).json({ message: "Archivo no encontrado" }); return;
  }
  const file = await storage.getObjectEntityFile(lesson.objectPath);
  const response = await storage.downloadObject(file, 0);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(lesson.objectName ?? "archivo")}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (response.body) Readable.fromWeb(response.body as never).pipe(res);
  else res.send(Buffer.from(await response.arrayBuffer()));
});

router.get("/lms/courses/:courseId/certificate", requireAuth, async (req, res): Promise<void> => {
  const detail = await courseDetail(idParam(req.params.courseId), req.user!);
  if (!detail?.completed || !detail.certificateEnabled) { res.status(409).json({ message: "El curso aún no está completado" }); return; }
  const existing = await db.select().from(lmsCertificatesTable).where(and(eq(lmsCertificatesTable.courseId, detail.id), eq(lmsCertificatesTable.userId, req.user!.id)));
  const certificate = existing[0] ?? (await db.insert(lmsCertificatesTable).values({ courseId: detail.id, userId: req.user!.id, certificateNumber: `ADG-${randomUUID()}` }).returning())[0];
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 420]);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText("Certificado de finalización", { x: 150, y: 290, size: 24, font, color: rgb(0.08, 0.2, 0.35) });
  page.drawText(detail.title, { x: 150, y: 240, size: 18, font });
  page.drawText(`N.º ${certificate.certificateNumber}`, { x: 150, y: 190, size: 12 });
  res.type("application/pdf").set("Content-Disposition", `attachment; filename="certificado-${certificate.certificateNumber}.pdf"`).send(Buffer.from(await pdf.save()));
});

export default router;