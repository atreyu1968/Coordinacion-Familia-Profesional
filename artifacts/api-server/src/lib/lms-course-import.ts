import { z } from "zod/v4";

const MAX_LESSON_TEXT = 100_000;

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
  };
  lessons: CourseImportLesson[];
};

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
      certificateEnabled: result.data.course.certificateEnabled ?? true,
    },
    lessons,
  };
}
