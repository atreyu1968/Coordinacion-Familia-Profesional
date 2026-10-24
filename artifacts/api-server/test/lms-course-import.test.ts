import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  appendCourseArchiveToBatch,
  buildCourseExportArchive,
  createCourseExportManifest,
  CourseImportValidationError,
  CourseExportValidationError,
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

  it("exports a version 1 ZIP that the importer can read without changing lesson order or content", async () => {
    const scormZip = new JSZip();
    scormZip.file("imsmanifest.xml", "<manifest/>");
    scormZip.file("launch.html", "<html>SCORM</html>");
    const scormBytes = await scormZip.generateAsync({ type: "nodebuffer" });
    const sourceLessons = [
      {
        title: "Introducción",
        kind: "text" as const,
        required: true,
        content: { text: "Contenido íntegro" },
        objectPath: null,
        objectName: null,
      },
      {
        title: "Vídeo",
        kind: "video" as const,
        required: false,
        content: { url: "https://example.org/video.mp4" },
        objectPath: null,
        objectName: null,
      },
      {
        title: "Evaluación",
        kind: "quiz" as const,
        required: true,
        content: {
          questions: [{ prompt: "Pregunta", options: ["A", "B"], correctIndex: 1 }],
        },
        objectPath: null,
        objectName: null,
      },
      {
        title: "Material",
        kind: "file" as const,
        required: false,
        content: {},
        objectPath: "/objects/material",
        objectName: "material.pdf",
      },
      {
        title: "Paquete 1.2",
        kind: "scorm12" as const,
        required: true,
        content: {},
        objectPath: "/objects/scorm12",
        objectName: "paquete-scorm.zip",
      },
      {
        title: "Paquete 2004",
        kind: "scorm2004" as const,
        required: false,
        content: {},
        objectPath: "/objects/scorm2004",
        objectName: "paquete-scorm.zip",
      },
    ];
    const exportedAssets = createCourseExportManifest({
      title: "Curso completo",
      description: "Descripción",
      certificateEnabled: false,
    }, sourceLessons).assets;
    const archive = await buildCourseExportArchive({
      title: "Curso completo",
      description: "Descripción",
      certificateEnabled: false,
    }, sourceLessons, async (asset) => asset.objectPath === "/objects/material"
      ? Buffer.from("PDF bytes")
      : scormBytes);
    const importedZip = await JSZip.loadAsync(archive);
    const manifestEntry = importedZip.file("coordina-course.json");
    expect(manifestEntry).toBeTruthy();
    const imported = parseCourseImportManifest(await manifestEntry!.async("string"));

    expect(imported.course).toEqual({
      title: "Curso completo",
      description: "Descripción",
      certificateEnabled: false,
    });
    expect(imported.lessons).toEqual(sourceLessons.map((lesson, index) => ({
      title: lesson.title,
      kind: lesson.kind,
      required: lesson.required,
      content: lesson.content,
      ...(lesson.objectPath ? { file: exportedAssets.find((asset) => asset.lessonIndex === index)?.filePath } : {}),
    })));
    expect(await importedZip.file(exportedAssets[0]!.filePath)!.async("string")).toBe("PDF bytes");
    for (const asset of exportedAssets.slice(1)) {
      const reimportedScorm = await JSZip.loadAsync(
        await importedZip.file(asset.filePath)!.async("nodebuffer"),
      );
      expect(reimportedScorm.file("imsmanifest.xml")).toBeTruthy();
      expect(await reimportedScorm.file("launch.html")!.async("string")).toContain("SCORM");
    }
  });

  it("puts each course manifest and same-named assets in a collision-free folder", async () => {
    const courseArchive = (content: string) => buildCourseExportArchive({
      title: "Curso compartido",
      description: "",
      certificateEnabled: true,
    }, [{
      title: "Material",
      kind: "file",
      required: true,
      content: {},
      objectPath: "/objects/material",
      objectName: "material.pdf",
    }], async () => Buffer.from(content));
    const batch = new JSZip();
    const first = await appendCourseArchiveToBatch(
      batch, 41, "Curso compartido", await courseArchive("archivo uno"), 250_000_000, 4_999,
    );
    const second = await appendCourseArchiveToBatch(
      batch, 42, "Curso compartido", await courseArchive("archivo dos"), 250_000_000 - first.expandedBytes, 4_999 - first.fileCount,
    );
    const archive = await batch.generateAsync({ type: "nodebuffer" });
    const result = await JSZip.loadAsync(archive);

    expect(first.folderName).not.toBe(second.folderName);
    const firstManifest = result.file(`cursos/${first.folderName}/coordina-course.json`);
    const secondManifest = result.file(`cursos/${second.folderName}/coordina-course.json`);
    expect(firstManifest).toBeTruthy();
    expect(secondManifest).toBeTruthy();
    expect(parseCourseImportManifest(await firstManifest!.async("string")).course.title)
      .toBe("Curso compartido");
    expect(parseCourseImportManifest(await secondManifest!.async("string")).course.title)
      .toBe("Curso compartido");
    expect(await result.file(`cursos/${first.folderName}/assets/leccion-001-material.pdf`)!.async("string"))
      .toBe("archivo uno");
    expect(await result.file(`cursos/${second.folderName}/assets/leccion-001-material.pdf`)!.async("string"))
      .toBe("archivo dos");
  });

  it("does not add a course when it exceeds the remaining aggregate export allowance", async () => {
    const archive = await buildCourseExportArchive({
      title: "Curso",
      description: "",
      certificateEnabled: true,
    }, [{
      title: "Texto",
      kind: "text",
      required: true,
      content: { text: "Contenido del curso" },
      objectPath: null,
      objectName: null,
    }], async () => Buffer.alloc(0));
    const batch = new JSZip();

    await expect(appendCourseArchiveToBatch(batch, 1, "Curso", archive, 1, 4_999))
      .rejects.toBeInstanceOf(CourseExportValidationError);
    expect(Object.values(batch.files).filter((entry) => !entry.dir)).toHaveLength(0);
  });

  it("rejects exporting file lessons whose private attachment is missing", () => {
    expect(() => createCourseExportManifest(
      { title: "Curso", description: "", certificateEnabled: false },
      [{
        title: "Material",
        kind: "file",
        required: true,
        content: {},
        objectPath: null,
        objectName: "material.pdf",
      }],
    )).toThrow("no tiene un archivo disponible");
  });
});
