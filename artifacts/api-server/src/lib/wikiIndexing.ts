import JSZip from "jszip";
import { Readable } from "node:stream";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, wikiAttachmentsTable } from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";
import { logger } from "./logger";

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const MAX_ENTRY_BYTES = 1 * 1024 * 1024;
const MAX_INDEXED_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 1000;
const INDEX_INTERVAL_MS = 5_000;

const objectStorage = new ObjectStorageService();
let workerTimer: ReturnType<typeof setInterval> | undefined;
let workerBusy = false;

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(parseInt(code, 16)),
    );
}

function cleanXmlText(xml: string): string {
  return decodeXmlEntities(xml.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function isPlainTextFile(fileName: string): boolean {
  return /\.(md|markdown|txt|csv|tsv|json|xml|html?|yml|yaml|log|rst|ini|conf)$/i.test(
    fileName,
  );
}

function isOfficePackage(fileName: string): boolean {
  return /\.(docx|pptx|xlsx|odt)$/i.test(fileName);
}

async function readBoundedStream(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    stream.on("data", (rawChunk: Buffer | Uint8Array) => {
      if (settled) return;
      const chunk = Buffer.isBuffer(rawChunk)
        ? rawChunk
        : Buffer.from(rawChunk);
      total += chunk.length;
      if (total > maxBytes) {
        (
          stream as NodeJS.ReadableStream & { destroy?: () => void }
        ).destroy?.();
        fail(new Error("El archivo supera el límite de indexación"));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", fail);
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, total));
    });
    stream.on("close", () => {
      if (!settled)
        fail(new Error("El flujo del archivo se cerró antes de tiempo"));
    });
  });
}

async function readZipEntry(
  entry: JSZip.JSZipObject,
  maxBytes: number,
): Promise<Buffer> {
  return readBoundedStream(entry.nodeStream(), maxBytes);
}

async function extractOfficeText(
  fileName: string,
  bytes: Buffer,
): Promise<string> {
  const archive = await JSZip.loadAsync(bytes, { checkCRC32: false });
  const names = Object.keys(archive.files).filter(
    (name) => !archive.files[name]?.dir,
  );
  let candidates: string[];

  if (/\.docx$/i.test(fileName)) {
    candidates = names.filter(
      (name) =>
        name === "word/document.xml" ||
        /^word\/(header|footer)\d*\.xml$/i.test(name),
    );
  } else if (/\.pptx$/i.test(fileName)) {
    candidates = names.filter((name) =>
      /^ppt\/slides\/slide\d+\.xml$/i.test(name),
    );
  } else if (/\.xlsx$/i.test(fileName)) {
    candidates = names.filter(
      (name) =>
        name === "xl/sharedStrings.xml" ||
        /^xl\/worksheets\/sheet\d+\.xml$/i.test(name),
    );
  } else {
    candidates = names.filter((name) => name === "content.xml");
  }

  const parts: string[] = [];
  let totalBytes = 0;
  for (const name of candidates.slice(0, 100)) {
    const entry = archive.files[name];
    if (!entry) continue;
    try {
      const remaining = Math.min(
        MAX_ENTRY_BYTES,
        MAX_INDEXED_BYTES - totalBytes,
      );
      if (remaining <= 0) break;
      const contents = await readZipEntry(entry, remaining);
      totalBytes += contents.length;
      parts.push(cleanXmlText(contents.toString("utf8")));
    } catch {
      // A large XML part is skipped; the original attachment remains intact.
    }
  }
  return parts.join(" ").slice(0, MAX_INDEXED_BYTES);
}

async function extractZipText(bytes: Buffer): Promise<string> {
  const archive = await JSZip.loadAsync(bytes, { checkCRC32: false });
  const names = Object.keys(archive.files);
  if (names.length > MAX_ZIP_ENTRIES) {
    throw new Error(`El ZIP contiene más de ${MAX_ZIP_ENTRIES} elementos`);
  }

  const parts: string[] = [];
  let totalBytes = 0;
  for (const name of names) {
    if (parts.join(" ").length >= MAX_INDEXED_BYTES) break;
    const entry = archive.files[name];
    if (!entry || entry.dir) continue;
    const baseName = name.replace(/\\/g, "/").slice(-300);
    parts.push(baseName);

    if (!isPlainTextFile(name) && !isOfficePackage(name)) continue;
    try {
      const remaining = Math.min(
        MAX_ENTRY_BYTES,
        MAX_INDEXED_BYTES - totalBytes,
      );
      if (remaining <= 0) break;
      const contents = await readZipEntry(entry, remaining);
      totalBytes += contents.length;
      const extracted = isOfficePackage(name)
        ? await extractOfficeText(name, contents)
        : contents.toString("utf8");
      if (extracted) parts.push(extracted);
    } catch {
      // Index other entries even if one member is too large or malformed.
    }
  }
  return parts.join(" ").slice(0, MAX_INDEXED_BYTES);
}

export async function extractText(
  fileName: string,
  bytes: Buffer,
): Promise<string> {
  const extension = fileName.toLowerCase();
  if (extension.endsWith(".zip")) return extractZipText(bytes);
  if (isOfficePackage(extension)) return extractOfficeText(fileName, bytes);
  if (isPlainTextFile(extension)) {
    const text = bytes.toString("utf8");
    return extension.endsWith(".html") || extension.endsWith(".htm")
      ? cleanXmlText(text)
      : text.slice(0, MAX_INDEXED_BYTES);
  }
  return "";
}

async function downloadBoundedObject(objectPath: string): Promise<Buffer> {
  const storedObject = await objectStorage.getObjectEntityFile(objectPath);
  const response = await objectStorage.downloadObject(storedObject, 0);
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_ATTACHMENT_BYTES) {
    await response.body?.cancel();
    throw new Error("El archivo supera el límite permitido");
  }
  if (!response.body) return Buffer.alloc(0);
  return readBoundedStream(
    readableFromWeb(response.body),
    MAX_ATTACHMENT_BYTES,
  );
}

function readableFromWeb(
  stream: ReadableStream<Uint8Array>,
): NodeJS.ReadableStream {
  return Readable.fromWeb(stream as import("node:stream/web").ReadableStream);
}

export async function indexWikiAttachment(attachmentId: number): Promise<void> {
  const [attachment] = await db
    .select()
    .from(wikiAttachmentsTable)
    .where(
      and(
        eq(wikiAttachmentsTable.id, attachmentId),
        isNull(wikiAttachmentsTable.deletedAt),
      ),
    )
    .limit(1);
  if (!attachment) return;

  const [claimed] = await db
    .update(wikiAttachmentsTable)
    .set({ indexStatus: "processing" })
    .where(
      and(
        eq(wikiAttachmentsTable.id, attachmentId),
        eq(wikiAttachmentsTable.indexStatus, "pending"),
        isNull(wikiAttachmentsTable.deletedAt),
      ),
    )
    .returning({ id: wikiAttachmentsTable.id });
  if (!claimed) return;

  try {
    if (attachment.size > MAX_ATTACHMENT_BYTES) {
      throw new Error("El archivo supera el límite permitido");
    }
    const bytes = await downloadBoundedObject(attachment.objectPath);
    const indexedText = await extractText(attachment.fileName, bytes);
    await db
      .update(wikiAttachmentsTable)
      .set({
        indexedText,
        indexStatus: indexedText ? "indexed" : "skipped",
      })
      .where(eq(wikiAttachmentsTable.id, attachmentId));
  } catch (error) {
    logger.warn(
      { err: error, attachmentId },
      "Could not index wiki attachment",
    );
    await db
      .update(wikiAttachmentsTable)
      .set({ indexStatus: "failed" })
      .where(eq(wikiAttachmentsTable.id, attachmentId));
  }
}

async function processPendingAttachments(): Promise<void> {
  if (workerBusy) return;
  workerBusy = true;
  try {
    const pending = await db
      .select({ id: wikiAttachmentsTable.id })
      .from(wikiAttachmentsTable)
      .where(
        and(
          eq(wikiAttachmentsTable.indexStatus, "pending"),
          isNull(wikiAttachmentsTable.deletedAt),
        ),
      )
      .orderBy(asc(wikiAttachmentsTable.createdAt))
      .limit(3);
    for (const item of pending) {
      await indexWikiAttachment(item.id);
    }
  } catch (error) {
    logger.error({ err: error }, "Wiki attachment indexing pass failed");
  } finally {
    workerBusy = false;
  }
}

export function startWikiIndexing(): void {
  if (workerTimer) return;
  void db
    .update(wikiAttachmentsTable)
    .set({ indexStatus: "pending" })
    .where(eq(wikiAttachmentsTable.indexStatus, "processing"))
    .catch((error: unknown) => {
      logger.warn({ err: error }, "Could not reset interrupted wiki indexing");
    });
  workerTimer = setInterval(() => {
    void processPendingAttachments();
  }, INDEX_INTERVAL_MS);
  workerTimer.unref?.();
  void processPendingAttachments();
}
