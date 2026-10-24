import sharp from "sharp";
import { CourseImportValidationError } from "./lms-course-import";

export const MAX_COURSE_COVER_SIZE = 5 * 1024 * 1024;

/** Decode and re-encode, stripping metadata and active/extra payloads. */
export async function normalizeCourseCover(bytes: Buffer): Promise<Buffer> {
  if (!bytes.length || bytes.length > MAX_COURSE_COVER_SIZE) {
    throw new CourseImportValidationError("La portada debe pesar entre 1 byte y 5 MB.");
  }
  try {
    const image = sharp(bytes, { limitInputPixels: 25_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) {
      throw new Error("Unsupported image");
    }
    const normalized = await image.rotate().resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 }).toBuffer();
    if (normalized.length > MAX_COURSE_COVER_SIZE) {
      throw new CourseImportValidationError("La portada convertida supera los 5 MB. Reduce sus dimensiones o calidad e inténtalo de nuevo.");
    }
    return normalized;
  } catch (error) {
    if (error instanceof CourseImportValidationError) throw error;
    throw new CourseImportValidationError("La portada debe ser una imagen JPEG, PNG o WebP válida, sin animación y de hasta 25 megapíxeles.");
  }
}
