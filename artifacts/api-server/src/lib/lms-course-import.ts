import { z } from "zod/v4";
import JSZip from "jszip";

const MAX_LESSON_TEXT = 100_000;
const MAX_EXPORT_FILE_SIZE = 100 * 1024 * 1024;
const MAX_EXPORT_EXPANDED_SIZE = 250 * 1024 * 1024;
export const MAX_MULTI_COURSE_EXPORT_SIZE = 100 * 1024 * 1024;
export const MAX_MULTI_COURSE_EXPANDED_SIZE = 250 * 1024 * 1024;
export const MAX_MULTI_COURSE_EXPORT_FILES = 5_000;

const QuizQuestionSchema = z.object({
  prompt: z.string().trim().min(1).max(2_000),
  options: z.array(z.string().trim().min(1).max(500)).min(2).max(20),
  correctIndex: z.number().int().min(0),
}).strict();

const ImportLessonSchema = z.object({
  title: z.string().trim().min(1).max(180),
  kind: z.enum(["text", "file", "video", "quiz", "scorm12", "scorm2004"]),
  required: z.boolean().optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  file: z.string().min(1).max(512).optional(),
}).strict();

const CourseManifestSchema = z.object({
  format: z.literal("coordina-adg-course"),
  version: z.literal(1),
  course: z.object({
    title: z.string().trim().min(1).max(180),
    description: z.string().max(10_000).optional(),
    certificateEnabled: z.boolean().optional(),
    cover: z.string().min(1).max(512).optional(),
  }).strict(),
  lessons: z.array(ImportLessonSchema).min(1).max(200),
}).strict();

export type CourseImportLesson = {
  title: string;
  kind: "text" | "file" | "video" | "quiz" | "scorm12" | "scorm2004";
  required: boolean;
  content: Record<string, unknown>;
  file?: string;
};

export type CourseImportManifest = {
  course: {
    title: string;
    description: string;
    certificateEnabled: boolean;
    cover?: string;
  };
  lessons: CourseImportLesson[];
};

export type CourseExportSourceLesson = {
  title: string;
  kind: CourseImportLesson["kind"];
  required: boolean;
  content: Record<string, unknown>;
  objectPath: string | null;
  objectName: string | null;
};

export type CourseExportManifest = {
  format: "coordina-adg-course";
  version: 1;
  course: {
    title: string;
    description: string;
    cover?: string;
  };
  lessons: Array<{
    title: string;
    kind: CourseImportLesson["kind"];
    required: boolean;
    content?: Record<string, unknown>;
    file?: string;
  }>;
};

export class CourseExportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CourseExportValidationError";
  }
}

function exportAssetName(objectName: string | null, index: number): string {
  const rawName = objectName?.split(/[\\/]/).pop() ?? "";
  const safeName = rawName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 100);
  return `assets/leccion-${String(index + 1).padStart(3, "0")}-${safeName || "archivo.bin"}`;
}

export function createCourseExportManifest(
  course: { title: string; description: string; certificateEnabled: boolean; coverObjectPath?: string | null },
  sourceLessons: CourseExportSourceLesson[],
): {
  manifest: CourseExportManifest;
  assets: Array<{ lessonIndex: number; filePath: string; objectPath: string }>;
} {
  if (sourceLessons.length < 1 || sourceLessons.length > 200) {
    throw new CourseExportValidationError("El curso debe tener entre 1 y 200 lecciones para exportarse.");
  }

  const assets: Array<{ lessonIndex: number; filePath: string; objectPath: string }> = [];
  const lessons = sourceLessons.map((lesson, lessonIndex) => {
    const isFile = lesson.kind === "file" || lesson.kind === "scorm12" || lesson.kind === "scorm2004";
    if (isFile && !lesson.objectPath) {
      throw new CourseExportValidationError(
        `La lección «${lesson.title}» no tiene un archivo disponible para exportar.`,
      );
    }

    if (isFile) {
      const filePath = exportAssetName(lesson.objectName, lessonIndex);
      assets.push({ lessonIndex, filePath, objectPath: lesson.objectPath! });
      return {
        title: lesson.title,
        kind: lesson.kind,
        required: lesson.required,
        file: filePath,
      };
    }

    return {
      title: lesson.title,
      kind: lesson.kind,
      required: lesson.required,
      content: lesson.content,
    };
  });

  if (course.coverObjectPath) {
    assets.push({ lessonIndex: -1, filePath: "assets/portada.webp", objectPath: course.coverObjectPath });
  }
  return {
    manifest: {
      format: "coordina-adg-course",
      version: 1,
      course: {
        title: course.title,
        description: course.description,
        ...(course.coverObjectPath ? { cover: "assets/portada.webp" } : {}),
      },
      lessons,
    },
    assets,
  };
}

export async function buildCourseExportArchive(
  course: { title: string; description: string; certificateEnabled: boolean; coverObjectPath?: string | null },
  lessons: CourseExportSourceLesson[],
  readAsset: (asset: { lessonIndex: number; filePath: string; objectPath: string }) => Promise<Buffer>,
): Promise<Buffer> {
  const { manifest, assets } = createCourseExportManifest(course, lessons);
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
  if (manifestBytes.length > 1024 * 1024) {
    throw new CourseExportValidationError("El manifiesto del curso supera el límite de 1 MB.");
  }

  const zip = new JSZip();
  zip.file("coordina-course.json", manifestBytes);
  let expandedSize = manifestBytes.length;
  for (const asset of assets) {
    const bytes = await readAsset(asset);
    if (bytes.length < 1 || bytes.length > MAX_EXPORT_FILE_SIZE) {
      throw new CourseExportValidationError("Un archivo del curso supera el límite de 100 MB o está vacío.");
    }
    expandedSize += bytes.length;
    if (expandedSize > MAX_EXPORT_EXPANDED_SIZE) {
      throw new CourseExportValidationError("El curso supera los 250 MB descomprimidos permitidos.");
    }
    zip.file(asset.filePath, bytes);
  }

  if (assets.length + 1 > 5_000) {
    throw new CourseExportValidationError("El curso contiene demasiados elementos para exportarse.");
  }
  const archive = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 3 },
  });
  if (archive.length > MAX_EXPORT_FILE_SIZE) {
    throw new CourseExportValidationError("El ZIP generado supera el límite comprimido de 100 MB.");
  }
  return archive;
}

export async function appendCourseArchiveToBatch(
  batch: JSZip,
  courseId: number,
  title: string,
  archive: Buffer,
  remainingExpandedBytes: number,
  remainingFileCount: number,
): Promise<{ expandedBytes: number; fileCount: number; folderName: string }> {
  const courseZip = await JSZip.loadAsync(archive);
  const entries = Object.values(courseZip.files).filter((entry) => !entry.dir);
  const folderName = safeCourseExportFolderName(title, courseId);

  if (entries.length > remainingFileCount) {
    throw new CourseExportValidationError(
      "La exportación conjunta supera el límite de 5.000 archivos.",
    );
  }

  const files: Array<{ name: string; bytes: Buffer }> = [];
  let expandedBytes = 0;
  for (const entry of entries) {
    const segments = entry.name.split("/");
    if (
      entry.name.startsWith("/") ||
      segments.some((segment) => segment === "." || segment === "..")
    ) {
      throw new CourseExportValidationError(
        "El curso contiene una ruta de archivo no válida.",
      );
    }
    const bytes = await entry.async("nodebuffer");
    expandedBytes += bytes.length;
    if (expandedBytes > remainingExpandedBytes) {
      throw new CourseExportValidationError(
        "La exportación conjunta supera los 250 MB descomprimidos permitidos.",
      );
    }
    files.push({ name: entry.name, bytes });
  }

  const prefix = `cursos/${folderName}`;
  for (const file of files) {
    batch.file(`${prefix}/${file.name}`, file.bytes);
  }
  return { expandedBytes, fileCount: files.length, folderName };
}

export function safeCourseExportFolderName(title: string, courseId: number): string {
  const safeTitle = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "curso";
  return `${safeTitle}-${courseId}`;
}

export class CourseImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CourseImportValidationError";
  }
}

export function validateCourseAssetPath(value: string): string {
  if (
    value !== value.trim() ||
    !value.startsWith("assets/") ||
    value.includes("\\") ||
    value.includes("%") ||
    value.includes("?") ||
    value.includes("#")
  ) {
    throw new CourseImportValidationError(
      `La ruta de recurso «${value}» no es válida; debe estar dentro de assets/.`,
    );
  }

  const segments = value.split("/");
  if (
    segments.some(
      (segment) => !segment || segment === "." || segment === "..",
    )
  ) {
    throw new CourseImportValidationError(
      `La ruta de recurso «${value}» contiene segmentos no permitidos.`,
    );
  }
  return value;
}

export function parseCourseImportManifest(source: string): CourseImportManifest {
  let decoded: unknown;
  try {
    decoded = JSON.parse(source);
  } catch {
    throw new CourseImportValidationError(
      "coordina-course.json no contiene JSON válido.",
    );
  }

  const result = CourseManifestSchema.safeParse(decoded);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.length ? ` (${issue.path.join(".")})` : "";
    throw new CourseImportValidationError(
      `El manifiesto del curso no es válido${field}.`,
    );
  }

  const lessons = result.data.lessons.map((lesson, index): CourseImportLesson => {
    const field = `Lección ${index + 1}`;
    const content = lesson.content ?? {};

    if (lesson.kind === "text") {
      const text = content.text;
      if (typeof text !== "string" || !text.trim() || text.length > MAX_LESSON_TEXT) {
        throw new CourseImportValidationError(
          `${field}: el contenido de texto es obligatorio y no puede superar ${MAX_LESSON_TEXT} caracteres.`,
        );
      }
      return {
        title: lesson.title,
        kind: lesson.kind,
        required: lesson.required ?? true,
        content: { text },
      };
    }

    if (lesson.kind === "video") {
      const value = content.url;
      if (typeof value !== "string" || value.length > 2_048) {
        throw new CourseImportValidationError(
          `${field}: indica una URL de vídeo válida.`,
        );
      }
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new CourseImportValidationError(
          `${field}: indica una URL de vídeo válida.`,
        );
      }
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username.length > 0 ||
        url.password.length > 0
      ) {
        throw new CourseImportValidationError(
          `${field}: la URL debe usar HTTP o HTTPS y no incluir credenciales.`,
        );
      }
      return {
        title: lesson.title,
        kind: lesson.kind,
        required: lesson.required ?? true,
        content: { url: url.toString() },
      };
    }

    if (lesson.kind === "quiz") {
      const questionsResult = z.array(QuizQuestionSchema).min(1).max(100)
        .safeParse(content.questions);
      if (
        !questionsResult.success ||
        questionsResult.data.some(
          (question) => question.correctIndex >= question.options.length,
        )
      ) {
        throw new CourseImportValidationError(
          `${field}: el cuestionario debe tener preguntas, dos o más opciones y una respuesta correcta válida.`,
        );
      }
      return {
        title: lesson.title,
        kind: lesson.kind,
        required: lesson.required ?? true,
        content: { questions: questionsResult.data },
      };
    }

    if (!lesson.file) {
      throw new CourseImportValidationError(
        `${field}: selecciona la ruta de archivo en el manifiesto.`,
      );
    }
    const file = validateCourseAssetPath(lesson.file);
    if (
      (lesson.kind === "scorm12" || lesson.kind === "scorm2004") &&
      !file.toLowerCase().endsWith(".zip")
    ) {
      throw new CourseImportValidationError(
        `${field}: el contenido SCORM debe ser un archivo ZIP.`,
      );
    }

    return {
      title: lesson.title,
      kind: lesson.kind,
      required: lesson.required ?? true,
      content: {},
      file,
    };
  });

  return {
    course: {
      title: result.data.course.title,
      description: result.data.course.description ?? "",
      certificateEnabled: false,
      ...(result.data.course.cover ? { cover: validateCourseAssetPath(result.data.course.cover) } : {}),
    },
    lessons,
  };
}
