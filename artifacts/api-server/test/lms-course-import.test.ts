import { describe, expect, it } from "vitest";
import {
  CourseImportValidationError,
  parseCourseImportManifest,
  validateCourseAssetPath,
} from "../src/lib/lms-course-import";

describe("course ZIP manifest", () => {
  it("parses ordered lessons and applies safe defaults", () => {
    const manifest = parseCourseImportManifest(JSON.stringify({
      format: "coordina-adg-course",
      version: 1,
      course: { title: "Curso de prueba" },
      lessons: [
        {
          title: "Primera lección",
          kind: "text",
          content: { text: "Contenido de prueba" },
        },
        {
          title: "Documento",
          kind: "file",
          file: "assets/material.pdf",
          required: false,
        },
      ],
    }));

    expect(manifest.course).toEqual({
      title: "Curso de prueba",
      description: "",
      certificateEnabled: true,
    });
    expect(manifest.lessons.map(({ title }) => title)).toEqual([
      "Primera lección",
      "Documento",
    ]);
    expect(manifest.lessons[0]?.required).toBe(true);
    expect(manifest.lessons[1]?.required).toBe(false);
  });

  it("requires valid text, URLs, quiz answers, and referenced paths", () => {
    const base = {
      format: "coordina-adg-course",
      version: 1,
      course: { title: "Curso" },
    };
    const expectInvalid = (lesson: Record<string, unknown>) =>
      expect(() => parseCourseImportManifest(JSON.stringify({
        ...base,
        lessons: [lesson],
      }))).toThrow(CourseImportValidationError);

    expectInvalid({ title: "Texto", kind: "text", content: { text: " " } });
    expectInvalid({ title: "Vídeo", kind: "video", content: { url: "javascript:alert(1)" } });
    expectInvalid({
      title: "Cuestionario",
      kind: "quiz",
      content: {
        questions: [{
          prompt: "Pregunta",
          options: ["A", "B"],
          correctIndex: 2,
        }],
      },
    });
    expectInvalid({ title: "Archivo", kind: "file", file: "assets/../secreto.pdf" });
  });

  it("only accepts asset paths rooted in assets/", () => {
    expect(validateCourseAssetPath("assets/tema 1/ficha.pdf"))
      .toBe("assets/tema 1/ficha.pdf");
    expect(() => validateCourseAssetPath("/assets/ficha.pdf")).toThrow();
    expect(() => validateCourseAssetPath("assets/%2e%2e/ficha.pdf")).toThrow();
    expect(() => validateCourseAssetPath("assets\\ficha.pdf")).toThrow();
  });
});
