import { readFileSync } from "node:fs";
import type { IntegrationSettings } from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";
import { logger } from "./logger";

// Embedded by the API build so delivery never depends on the frontend source
// tree, the public domain, or an external image request by the email client.
declare const __EMAIL_DEFAULT_LOGO_BASE64__: string;
const defaultLogo = typeof __EMAIL_DEFAULT_LOGO_BASE64__ !== "undefined"
  ? __EMAIL_DEFAULT_LOGO_BASE64__
  : readFileSync(new URL("../../../web/src/assets/logo.png", import.meta.url)).toString("base64");

type InlineLogo = { filename: string; content: string; content_id: string };
const fallback: InlineLogo = { filename: "application-logo.png", content: defaultLogo, content_id: "application-logo" };
let cached: { key: string; until: number; promise: Promise<InlineLogo> } | undefined;

export function getEmailLogo(settings: IntegrationSettings): Promise<InlineLogo> {
  if (!settings.logoPath) return Promise.resolve(fallback);
  const key = `${settings.logoPath}:${settings.updatedAt?.toISOString()}`;
  if (cached?.key === key && cached.until > Date.now()) return cached.promise;
  const promise = loadLogo(settings.logoPath);
  cached = { key, until: Date.now() + 60_000, promise };
  return promise;
}

async function loadLogo(path: string): Promise<InlineLogo> {
  try {
    if (!/^\/objects\/uploads\/[A-Za-z0-9._-]+$/.test(path)) throw new Error("Invalid logo path");
    const storage = new ObjectStorageService();
    const response = await storage.downloadObject(await storage.getObjectEntityFile(path));
    if (!response.ok || !response.body) throw new Error("Logo is unavailable");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > 2 * 1024 * 1024) throw new Error("Email logo exceeds 2 MB");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = Buffer.concat(chunks);
    const extension = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "png"
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "jpg"
      : /^GIF8[79]a/.test(bytes.subarray(0, 6).toString()) ? "gif"
      : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" ? "webp" : null;
    if (!extension) throw new Error("Unsupported email logo format");
    return { filename: `application-logo.${extension}`, content: bytes.toString("base64"), content_id: "application-logo" };
  } catch (error) {
    // A logo outage must not block password recovery or other essential mail.
    logger.warn({ err: error }, "Custom email logo unavailable; using the built-in application logo");
    return fallback;
  }
}
