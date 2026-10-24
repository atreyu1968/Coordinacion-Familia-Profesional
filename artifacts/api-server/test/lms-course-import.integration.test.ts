import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { realpathSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import type { SeededUser } from "./helpers";

vi.mock("../src/lib/lms-course-import", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/lms-course-import")>();
  return {
    ...actual,
    MAX_MULTI_COURSE_EXPORT_SIZE: 8_000,
  };
});

let t: typeof import("@workspace/db");
let helpers: typeof import("./helpers");
let api: typeof import("../src/app").default;
let request: typeof import("supertest").default;

const testRoot = () => process.env.COORDINA_LMS_IMPORT_TEST_ROOT || "";
const localStorageRoot = () => process.env.LOCAL_STORAGE_DIR || "";

beforeAll(async () => {
  const root = testRoot();
  if (!root || !/\/coordina-db-test\.[a-zA-Z0-9]+$/.test(root)) {
    throw new Error(
      "Use bash deploy/test-db.sh --lms-course-import-only; an isolated cluster is required.",
    );
  }
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (
    url.pathname !== "/coordina_lms_course_import" ||
    url.searchParams.get("host") !== join(root, "socket") ||
    realpathSync(root) !== root
  ) {
    throw new Error("Refusing to connect outside the runner's temporary PostgreSQL socket.");
  }
  if (
    process.env.STORAGE_DRIVER !== "local" ||
    realpathSync(localStorageRoot()) !== join(root, "lms-storage")
  ) {
    throw new Error("Refusing to use storage outside the isolated local test directory.");
  }

  vi.stubEnv("JWT_SECRET", "isolated-lms-course-import-test-key-not-for-production");
  t = await import("@workspace/db");
  const identity = await t.db.execute(sql`
    SELECT current_database() AS name,
      current_setting('data_directory') AS directory,
      current_setting('listen_addresses') AS listeners
  `);
  expect(identity.rows[0]).toEqual({
    name: "coordina_lms_course_import",
    directory: join(root, "data"),
    listeners: "",
  });

  [{ default: api }, { default: request }, helpers] = await Promise.all([
    import("../src/app"),
    import("supertest"),
    import("./helpers"),
  ]);
});

afterEach(async () => {
  if (!t) return;
  await t.db.execute(sql`
    TRUNCATE TABLE
      lms_lesson_progress,
      lms_certificates,
      lms_upload_intents,
      lms_course_import_intents,
      lms_lessons,
      lms_courses,
      lms_course_managers
    RESTART IDENTITY CASCADE
  `);
  await rm(join(localStorageRoot(), "private"), { recursive: true, force: true });
  await helpers?.cleanup();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await t?.pool.end();
});

async function createGeneralManager(): Promise<SeededUser> {
  const manager = await helpers.createUser({ role: "teacher" });
  const grantor = await helpers.createUser({ role: "superadmin" });
  await t.db.insert(t.lmsCourseManagersTable).values({
    userId: manager.user.id,
    moduleId: null,
    isGeneral: true,
    grantedBy: grantor.user.id,
  });
  return manager;
}

async function courseArchive(
  manifest: Record<string, unknown>,
  assets: Record<string, Buffer | string> = {},
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("coordina-course.json", JSON.stringify(manifest));
  for (const [name, content] of Object.entries(assets)) zip.file(name, content);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function validManifest(title: string, lessons: unknown[] = [{
  title: "Introducción",
  kind: "text",
  content: { text: "Contenido inicial" },
}]): Record<string, unknown> {
  return {
    format: "coordina-adg-course",
    version: 1,
    course: { title, description: "Curso importado" },
    lessons,
  };
}

async function requestUploadUrl(user: SeededUser, archive: Buffer) {
  const response = await request(api)
    .post("/api/lms/course-imports/request-url")
    .set(helpers.authHeader(user.token))
    .send({
      moduleId: null,
      name: "curso.zip",
      size: archive.length,
      contentType: "application/zip",
    });
  return response;
}

async function uploadThroughSignedUrl(uploadUrl: string, archive: Buffer) {
  const url = new URL(uploadUrl, "http://localhost");
  return request(api)
    .put(`${url.pathname}${url.search}`)
    .set("Content-Type", "application/zip")
    .send(archive);
}

async function importArchive(user: SeededUser, upload: {
  body: { moduleId?: number | null; objectPath: string; intentToken: string };
}) {
  return request(api)
    .post("/api/lms/courses/import")
    .set(helpers.authHeader(user.token))
    .send({
      moduleId: upload.body.moduleId ?? null,
      objectPath: upload.body.objectPath,
      intentToken: upload.body.intentToken,
    });
}

function noisyText(length: number, seed: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let state = seed;
  let text = "";
  for (let index = 0; index < length; index += 1) {
    state = (state * 1_103_515_245 + 12_345) & 0x7fffffff;
    text += alphabet[state % alphabet.length];
  }
  return text;
}

async function privateFiles(): Promise<string[]> {
  const root = join(localStorageRoot(), "private");
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else files.push(path);
    }
  }
  await visit(root);
  return files.sort();
}

describe("course ZIP import end-to-end with isolated local storage", () => {
  it("omits the overflowing course and explains why in the readable batch report", async () => {
    const manager = await createGeneralManager();
    const courses = await t.db.insert(t.lmsCoursesTable).values([
      {
        title: "Curso que permanece",
        description: "",
        createdBy: manager.user.id,
      },
      {
        title: "Curso que debe omitirse",
        description: "",
        createdBy: manager.user.id,
      },
    ]).returning();
    const [remainingCourse, omittedCourse] = courses;
    expect(remainingCourse).toBeDefined();
    expect(omittedCourse).toBeDefined();
    if (!remainingCourse || !omittedCourse) return;

    const remainingText = noisyText(7_000, 81);
    const omittedText = noisyText(7_000, 92);
    await t.db.insert(t.lmsLessonsTable).values([
      {
        courseId: remainingCourse.id,
        title: "Contenido conservado",
        kind: "text",
        content: { text: remainingText },
      },
      {
        courseId: omittedCourse.id,
        title: "Contenido que no debe aparecer",
        kind: "text",
        content: { text: omittedText },
      },
    ]);

    const response = await request(api)
      .post("/api/lms/courses/export")
      .set(helpers.authHeader(manager.token))
      .send({ courseIds: [remainingCourse.id, omittedCourse.id] })
      .buffer(true)
      .parse((stream, callback) => {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
        stream.on("end", () => callback(null, Buffer.concat(chunks)));
        stream.on("error", callback);
      });

    expect(response.status).toBe(200);
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.length).toBeLessThanOrEqual(8_000);

    const zip = await JSZip.loadAsync(response.body as Buffer);
    const entryNames = Object.keys(zip.files);
    const omittedPrefix = `cursos/Curso-que-debe-omitirse-${omittedCourse.id}/`;
    expect(entryNames.filter((name) => name.startsWith(omittedPrefix))).toEqual([]);
    const entryContents = await Promise.all(
      Object.values(zip.files)
        .filter((entry) => !entry.dir)
        .map((entry) => entry.async("string")),
    );
    expect(entryContents.join("\n")).not.toContain(omittedText);

    const reportEntry = zip.file("informe-exportacion.json");
    expect(reportEntry).toBeTruthy();
    const report = JSON.parse(await reportEntry!.async("string")) as {
      included: Array<{ title: string }>;
      excluded: Array<{ title: string; reason: string }>;
    };
    expect(report.included.map(({ title }) => title)).toContain("Curso que permanece");
    expect(report.excluded).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "Curso que debe omitirse",
        reason: "Al incluir este curso se superaría el límite comprimido de 100 MB.",
      }),
    ]));

    const remainingManifestEntry = zip.file(
      `cursos/Curso-que-permanece-${remainingCourse.id}/coordina-course.json`,
    );
    expect(remainingManifestEntry).toBeTruthy();
    const remainingManifest = JSON.parse(await remainingManifestEntry!.async("string"));
    expect(remainingManifest.course.title).toBe("Curso que permanece");
    expect(remainingManifest.lessons[0].content.text).toBe(remainingText);
  });

  it("imports a draft course and its lessons, keeps extracted files private, and rejects token replay", async () => {
    const manager = await createGeneralManager();
    const pdf = Buffer.from("private course attachment");
    const archive = await courseArchive(validManifest("Importación autorizada", [
      { title: "Documento", kind: "file", file: "assets/material.pdf" },
      { title: "Texto", kind: "text", content: { text: "Lección de texto" } },
    ]), { "assets/material.pdf": pdf });

    const uploadUrlResponse = await requestUploadUrl(manager, archive);
    expect(uploadUrlResponse.status).toBe(200);
    const uploaded = await uploadThroughSignedUrl(uploadUrlResponse.body.uploadURL, archive);
    expect(uploaded.status).toBe(200);
    expect(await privateFiles()).toHaveLength(2);

    const imported = await importArchive(manager, uploadUrlResponse);
    expect(imported.status).toBe(201);
    expect(imported.body.importedLessonCount).toBe(2);
    expect(imported.body.course).toMatchObject({
      title: "Importación autorizada",
      status: "draft",
      lessonCount: 2,
      description: "Curso importado",
    });

    const [course] = await t.db.select().from(t.lmsCoursesTable)
      .where(eq(t.lmsCoursesTable.title, "Importación autorizada"));
    expect(course).toMatchObject({ status: "draft", publishedAt: null });
    const lessons = await t.db.select().from(t.lmsLessonsTable)
      .where(eq(t.lmsLessonsTable.courseId, course!.id));
    expect(lessons.map(({ title, position }) => ({ title, position }))).toEqual([
      { title: "Documento", position: 0 },
      { title: "Texto", position: 1 },
    ]);
    const assetLesson = lessons.find((lesson) => lesson.title === "Documento");
    expect(assetLesson).toMatchObject({
      objectName: "material.pdf",
      objectContentType: "application/pdf",
      objectSize: pdf.length,
    });
    const { ObjectStorageService } = await import("../src/lib/objectStorage");
    const { getObjectAclPolicy } = await import("../src/lib/objectAcl");
    const storage = new ObjectStorageService();
    const objectFile = await storage.getObjectEntityFile(assetLesson!.objectPath!);
    expect(await getObjectAclPolicy(objectFile)).toEqual({
      owner: String(manager.user.id),
      visibility: "private",
    });
    const fileResponse = await storage.downloadObject(objectFile);
    expect(Buffer.from(await fileResponse.arrayBuffer())).toEqual(pdf);

    const replay = await importArchive(manager, uploadUrlResponse);
    expect(replay.status).toBe(403);
    expect(await t.db.select().from(t.lmsCoursesTable)).toHaveLength(1);
    expect(await t.db.select().from(t.lmsLessonsTable)).toHaveLength(2);
    const remainingFiles = await privateFiles();
    expect(remainingFiles).toHaveLength(2);
    expect(remainingFiles.every((file) => file.includes(assetLesson!.objectPath!.replace("/objects/", ""))))
      .toBe(true);
  });

  it("removes the uploaded ZIP and intent if permission is missing or revoked", async () => {
    const manager = await createGeneralManager();
    const outsider = await helpers.createUser({ role: "teacher" });
    const archive = await courseArchive(validManifest("No debe importarse"));

    const deniedUrl = await requestUploadUrl(outsider, archive);
    expect(deniedUrl.status).toBe(403);
    expect(await privateFiles()).toEqual([]);
    expect(await t.db.select().from(t.lmsCourseImportIntentsTable)).toHaveLength(0);

    const uploadUrlResponse = await requestUploadUrl(manager, archive);
    expect(uploadUrlResponse.status).toBe(200);
    expect((await uploadThroughSignedUrl(uploadUrlResponse.body.uploadURL, archive)).status).toBe(200);
    await t.db.update(t.lmsCourseManagersTable)
      .set({ deletedAt: new Date() })
      .where(eq(t.lmsCourseManagersTable.userId, manager.user.id));

    const deniedImport = await importArchive(manager, uploadUrlResponse);
    expect(deniedImport.status).toBe(403);
    expect(await privateFiles()).toEqual([]);
    expect(await t.db.select().from(t.lmsCourseImportIntentsTable)).toHaveLength(0);
    expect(await t.db.select().from(t.lmsCoursesTable)).toHaveLength(0);
    expect(await t.db.select().from(t.lmsLessonsTable)).toHaveLength(0);
  });

  it("cleans malformed ZIPs and partially extracted assets after invalid imports", async () => {
    const manager = await createGeneralManager();
    const malformedArchive = Buffer.from("this is not a ZIP archive");
    const malformedUpload = await requestUploadUrl(manager, malformedArchive);
    expect(malformedUpload.status).toBe(200);
    expect((await uploadThroughSignedUrl(malformedUpload.body.uploadURL, malformedArchive)).status).toBe(200);

    const malformed = await importArchive(manager, malformedUpload);
    expect(malformed.status).toBe(400);
    expect(await privateFiles()).toEqual([]);
    expect(await t.db.select().from(t.lmsCourseImportIntentsTable)).toHaveLength(0);
    expect(await t.db.select().from(t.lmsCoursesTable)).toHaveLength(0);
    expect(await t.db.select().from(t.lmsLessonsTable)).toHaveLength(0);

    const archive = await courseArchive(validManifest("ZIP incompleto", [
      { title: "Documento válido", kind: "file", file: "assets/primero.pdf" },
      { title: "Documento ausente", kind: "file", file: "assets/no-existe.pdf" },
    ]), { "assets/primero.pdf": "este archivo se extrae antes del error" });

    const uploadUrlResponse = await requestUploadUrl(manager, archive);
    expect(uploadUrlResponse.status).toBe(200);
    expect((await uploadThroughSignedUrl(uploadUrlResponse.body.uploadURL, archive)).status).toBe(200);

    const failed = await importArchive(manager, uploadUrlResponse);
    expect(failed.status).toBe(400);
    expect(await privateFiles()).toEqual([]);
    expect(await t.db.select().from(t.lmsCourseImportIntentsTable)).toHaveLength(0);
    expect(await t.db.select().from(t.lmsCoursesTable)).toHaveLength(0);
    expect(await t.db.select().from(t.lmsLessonsTable)).toHaveLength(0);
  });
});
