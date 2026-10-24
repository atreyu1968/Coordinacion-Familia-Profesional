import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import JSZip from "jszip";
import { normalizeCourseCover, MAX_COURSE_COVER_SIZE } from "../src/lib/lms-course-cover";
import { buildCourseExportArchive, parseCourseImportManifest } from "../src/lib/lms-course-import";

describe("course cover validation", () => {
  it.each(["png", "jpeg", "webp"] as const)("decodes and normalizes %s to WebP", async (format) => {
    const input = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#246abc" } })
      .toFormat(format).toBuffer();
    const output = await normalizeCourseCover(input);
    expect(await sharp(output).metadata()).toMatchObject({ format: "webp", width: 1920, height: 960 });
  });
  it("rejects empty, oversized, corrupt and active image formats", async () => {
    for (const bytes of [
      Buffer.alloc(0), Buffer.alloc(MAX_COURSE_COVER_SIZE + 1),
      Buffer.from("not an image"),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>alert(1)</script></svg>'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ]) await expect(normalizeCourseCover(bytes)).rejects.toThrow();
  });
  it("rejects images over the decoded pixel limit", async () => {
    const input = await sharp({ create: { width: 5001, height: 5000, channels: 3, background: "#fff" } }).png().toBuffer();
    await expect(normalizeCourseCover(input)).rejects.toThrow("25 megapíxeles");
  });
  it("rejects an oversized encoded result even when the original is valid and below the upload limit", async () => {
    const input = await sharp({ create: { width: 64, height: 36, channels: 3, background: "#246abc" } }).jpeg().toBuffer();
    expect(input.length).toBeLessThan(MAX_COURSE_COVER_SIZE);
    // Simulate a worst-case encoder expansion without allocating a huge decoded image.
    const encode = vi.spyOn(sharp.prototype, "toBuffer").mockResolvedValueOnce(Buffer.alloc(MAX_COURSE_COVER_SIZE + 1));
    try {
      await expect(normalizeCourseCover(input)).rejects.toThrow("La portada convertida supera los 5 MB");
    } finally {
      encode.mockRestore();
    }
  });
});

describe("course cover ZIP compatibility", () => {
  const lessons = [{ title: "Lectura", kind: "text" as const, required: true, content: { text: "Hola" }, objectPath: null, objectName: null }];
  it("includes cover bytes without exposing storage paths and preserves the legacy format", async () => {
    const image = await sharp({ create: { width: 32, height: 18, channels: 3, background: "#123456" } }).webp().toBuffer();
    const zip = await JSZip.loadAsync(await buildCourseExportArchive({
      title: "Con portada", description: "", certificateEnabled: false, coverObjectPath: "/objects/private-cover",
    }, lessons, async (asset) => {
      expect(asset.objectPath).toBe("/objects/private-cover");
      return image;
    }));
    const raw = await zip.file("coordina-course.json")!.async("string");
    expect(raw).not.toContain("/objects/");
    expect(parseCourseImportManifest(raw).course.cover).toBe("assets/portada.webp");
    expect(await zip.file("assets/portada.webp")!.async("nodebuffer")).toEqual(image);
  });
  it("still reads and writes archives without a cover", async () => {
    const zip = await JSZip.loadAsync(await buildCourseExportArchive({
      title: "Sin portada", description: "", certificateEnabled: true,
    }, lessons, async () => { throw new Error("No asset expected"); }));
    expect(parseCourseImportManifest(await zip.file("coordina-course.json")!.async("string")).course.cover).toBeUndefined();
  });
  it.each(["../cover.png", "/objects/private-cover", "https://example.com/a.jpg", "assets/../cover.png"])("rejects unsafe cover path %s", (cover) => {
    expect(() => parseCourseImportManifest(JSON.stringify({
      format: "coordina-adg-course", version: 1, course: { title: "Curso", cover },
      lessons: [{ title: "Texto", kind: "text", content: { text: "Hola" } }],
    }))).toThrow();
  });
});
