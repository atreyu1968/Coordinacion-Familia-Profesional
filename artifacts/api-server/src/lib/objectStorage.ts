import { Storage, File } from "@google-cloud/storage";
import { Readable, type Writable } from "stream";
import { randomUUID, createHmac, timingSafeEqual } from "crypto";
import { promises as fs, createReadStream } from "fs";
import path from "path";
import {
  ObjectAclPolicy,
  ObjectPermission,
  StoredObject,
  canAccessObject,
  getObjectAclPolicy,
  readLocalMeta,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

// Storage driver selection:
// - "local"  -> files are stored on the server's filesystem (self-hosted, no cloud).
// - anything else / unset -> Replit App Storage (GCS via the Replit sidecar).
// Keeping the default unchanged preserves the Replit dev/runtime behavior.
const STORAGE_DRIVER = (process.env.STORAGE_DRIVER || "").trim().toLowerCase();

export function isLocalStorage(): boolean {
  return STORAGE_DRIVER === "local";
}

// Browser-facing prefix for API-mediated upload URLs. When the app is served at
// the domain root this is empty; set PUBLIC_APP_URL if the API is cross-origin.
function uploadUrlBase(): string {
  const configured = (process.env.PUBLIC_APP_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  const replitDomain =
    process.env.REPLIT_DEV_DOMAIN ||
    process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  return replitDomain ? `https://${replitDomain}` : "";
}

function localStorageDir(): string {
  const dir = process.env.LOCAL_STORAGE_DIR || path.resolve(process.cwd(), "storage");
  return path.resolve(dir);
}

// Local upload URLs are signed with an expiry and byte limit so they behave
// like cloud presigned URLs (a leaked link stops working after the TTL).
const LOCAL_UPLOAD_TTL_SEC = 900;
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export interface ObjectUploadLimits {
  maxBytes?: number;
  expectedBytes?: number;
}

function localUploadSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET not set; required to sign local upload URLs");
  }
  return secret;
}

function signLocalUpload(
  key: string,
  expMs: number,
  maxBytes: number,
  expectedBytes?: number,
): string {
  return createHmac("sha256", localUploadSecret())
    .update(`${key}:${expMs}:${maxBytes}:${expectedBytes ?? ""}`)
    .digest("base64url");
}

// Constant-time verification of a local upload URL signature + expiry.
function checkLocalUploadSignature(
  key: string,
  exp?: string,
  sig?: string,
  maxBytesRaw?: string,
  expectedBytesRaw?: string,
): boolean {
  if (!exp || !sig || maxBytesRaw === undefined) return false;
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false;
  const maxBytes = Number(maxBytesRaw);
  const expectedBytes =
    expectedBytesRaw === undefined ? undefined : Number(expectedBytesRaw);
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_UPLOAD_BYTES ||
    (expectedBytes !== undefined &&
      (!Number.isSafeInteger(expectedBytes) ||
        expectedBytes < 1 ||
        expectedBytes > maxBytes))
  ) {
    return false;
  }
  const expected = Buffer.from(
    signLocalUpload(key, expMs, maxBytes, expectedBytes),
  );
  const provided = Buffer.from(sig);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

function localPrivateDir(): string {
  return path.join(localStorageDir(), "private");
}

function localPublicDir(): string {
  return path.join(localStorageDir(), "public");
}

// Resolve a relative object key against a base dir and guarantee the result
// stays inside it (defense against "../" path traversal).
function resolveWithin(baseDir: string, relKey: string): string {
  const cleaned = relKey.replace(/^\/+/, "");
  const abs = path.resolve(baseDir, cleaned);
  const baseResolved = path.resolve(baseDir);
  if (abs !== baseResolved && !abs.startsWith(baseResolved + path.sep)) {
    throw new ObjectNotFoundError();
  }
  return abs;
}

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectStorageConfigurationError";
    Object.setPrototypeOf(this, ObjectStorageConfigurationError.prototype);
  }
}

const EXT_CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
};

function contentTypeForExt(p: string): string {
  return EXT_CONTENT_TYPES[path.extname(p).toLowerCase()] || "application/octet-stream";
}

export class ObjectStorageService {
  constructor() {}

  isLocal(): boolean {
    return isLocalStorage();
  }

  // Absolute path on disk where a local PUT upload for `key` should be written.
  // `key` is the trailing segment of the upload URL (e.g. "uploads/<uuid>").
  resolveLocalUploadPath(key: string): string {
    return resolveWithin(localPrivateDir(), key);
  }

  // Validate the signed, time-limited signature on a local upload URL.
  verifyLocalUploadSignature(
    key: string,
    exp?: string,
    sig?: string,
    maxBytes?: string,
    expectedBytes?: string,
  ): boolean {
    return checkLocalUploadSignature(key, exp, sig, maxBytes, expectedBytes);
  }

  verifyUploadSignature(
    key: string,
    exp?: string,
    sig?: string,
    maxBytes?: string,
    expectedBytes?: string,
  ): boolean {
    return checkLocalUploadSignature(key, exp, sig, maxBytes, expectedBytes);
  }

  private privateUploadFile(key: string): File {
    if (
      !key.startsWith("uploads/") ||
      key.split("/").some((part) => !part || part === "." || part === "..")
    ) {
      throw new ObjectNotFoundError();
    }
    const fullPath =
      `${this.getPrivateObjectDir().replace(/\/+$/, "")}/${key}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    return objectStorageClient.bucket(bucketName).file(objectName);
  }

  createPrivateUploadWriteStream(
    key: string,
    contentType: string,
  ): Writable {
    if (this.isLocal()) {
      throw new ObjectStorageConfigurationError(
        "Cloud upload stream requested with local storage enabled",
      );
    }
    return this.privateUploadFile(key).createWriteStream({
      metadata: { contentType },
    });
  }

  async privateUploadExists(key: string): Promise<boolean> {
    const [exists] = await this.privateUploadFile(key).exists();
    return exists;
  }

  async commitPrivateUpload(tempKey: string, key: string): Promise<void> {
    const source = this.privateUploadFile(tempKey);
    const destination = this.privateUploadFile(key);
    await source.copy(destination, {
      preconditionOpts: { ifGenerationMatch: 0 },
    });
    await source.delete({ ignoreNotFound: true }).catch(() => undefined);
  }

  async discardPrivateUpload(key: string): Promise<void> {
    await this.privateUploadFile(key)
      .delete({ ignoreNotFound: true })
      .catch(() => undefined);
  }

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    this.assertPublicPrivatePathIsolation(paths);
    return paths;
  }

  private assertPublicPrivatePathIsolation(publicPaths: string[]): void {
    if (this.isLocal()) {
      const publicDir = path.resolve(localPublicDir());
      const privateDir = path.resolve(localPrivateDir());
      const isWithin = (parent: string, child: string) => {
        const relative = path.relative(parent, child);
        return (
          relative === "" ||
          (!path.isAbsolute(relative) &&
            relative !== ".." &&
            !relative.startsWith(`..${path.sep}`))
        );
      };
      if (isWithin(publicDir, privateDir) || isWithin(privateDir, publicDir)) {
        throw new ObjectStorageConfigurationError(
          "Las carpetas de almacenamiento público y privado se solapan",
        );
      }
      return;
    }

    const privateObjectDir = (process.env.PRIVATE_OBJECT_DIR || "").trim();
    // Installations that only serve deliberately public legacy assets need not
    // configure a private store. If one is configured, prove it is disjoint
    // from all public search prefixes before serving any raw public-object path.
    if (!privateObjectDir) return;

    const privateLocation = parseObjectPath(privateObjectDir);
    const normalizePrefix = (prefix: string) => {
      const parts = prefix.split("/").filter((part) => part && part !== ".");
      if (parts.some((part) => part === "..")) {
        throw new ObjectStorageConfigurationError(
          "Las rutas de almacenamiento no pueden contener segmentos '..'",
        );
      }
      return parts.join("/");
    };
    const containsPrefix = (parent: string, child: string) =>
      parent === "" || child === parent || child.startsWith(`${parent}/`);
    const overlaps = (left: string, right: string) =>
      containsPrefix(left, right) || containsPrefix(right, left);

    for (const publicPath of publicPaths) {
      const publicLocation = parseObjectPath(publicPath);
      const publicPrefix = normalizePrefix(publicLocation.objectName);
      const privatePrefix = normalizePrefix(privateLocation.objectName);
      if (
        publicLocation.bucketName === privateLocation.bucketName &&
        overlaps(publicPrefix, privatePrefix)
      ) {
        throw new ObjectStorageConfigurationError(
          "Las rutas de búsqueda pública se solapan con el almacenamiento privado",
        );
      }
    }
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<StoredObject | null> {
    if (this.isLocal()) {
      this.assertPublicPrivatePathIsolation([]);
      const abs = resolveWithin(localPublicDir(), filePath);
      try {
        const publicRoot = await fs.realpath(localPublicDir());
        const realFile = await fs.realpath(abs);
        const privateRoot = await fs.realpath(localPrivateDir()).catch(() =>
          path.resolve(localPrivateDir()),
        );
        const stat = await fs.stat(realFile);
        const isWithin = (parent: string, child: string) => {
          const relative = path.relative(parent, child);
          return (
            relative === "" ||
            (!path.isAbsolute(relative) &&
              relative !== ".." &&
              !relative.startsWith(`..${path.sep}`))
          );
        };
        if (
          stat.isFile() &&
          isWithin(publicRoot, realFile) &&
          !isWithin(privateRoot, realFile)
        ) {
          return { kind: "local", absPath: realFile };
        }
      } catch {
        // fall through
      }
      return null;
    }

    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return { kind: "gcs", file };
      }
    }

    return null;
  }

  async downloadObject(
    objectFile: StoredObject,
    cacheTtlSec: number = 3600,
  ): Promise<Response> {
    if (objectFile.kind === "local") {
      const meta = await readLocalMeta(objectFile.absPath);
      const stat = await fs.stat(objectFile.absPath);
      const isPublic = meta.acl?.visibility === "public";
      const nodeStream = createReadStream(objectFile.absPath);
      const webStream = Readable.toWeb(nodeStream) as ReadableStream;

      const headers: Record<string, string> = {
        "Content-Type": meta.contentType || contentTypeForExt(objectFile.absPath),
        "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
        "Content-Length": String(meta.size ?? stat.size),
      };
      return new Response(webStream, { headers });
    }

    const file = objectFile.file;
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(objectFile);
    const isPublic = aclPolicy?.visibility === "public";

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(
    limits: ObjectUploadLimits = {},
  ): Promise<string> {
    const objectId = randomUUID();
    const maxBytes = limits.maxBytes ?? MAX_UPLOAD_BYTES;
    const expectedBytes = limits.expectedBytes;
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > MAX_UPLOAD_BYTES ||
      (expectedBytes !== undefined &&
        (!Number.isSafeInteger(expectedBytes) ||
          expectedBytes < 1 ||
          expectedBytes > maxBytes))
    ) {
      throw new Error("Límite de subida no válido");
    }

    if (this.isLocal()) {
      // The browser PUTs the file directly to this endpoint, which streams it to
      // disk. The unguessable UUID plus a short-lived HMAC signature gate the
      // write and bind its maximum/expected byte count.
      const key = `uploads/${objectId}`;
      const exp = Date.now() + LOCAL_UPLOAD_TTL_SEC * 1000;
      const sig = signLocalUpload(key, exp, maxBytes, expectedBytes);
      const expected =
        expectedBytes === undefined ? "" : `&expected=${expectedBytes}`;
      return `${uploadUrlBase()}/api/storage/local-upload/${key}?exp=${exp}&max=${maxBytes}${expected}&sig=${sig}`;
    }

    // The sidecar's direct signed-PUT interface does not expose a verified
    // content-length-range policy. Keep the client's PUT contract, but route
    // cloud uploads through our byte-counting API proxy instead.
    this.getPrivateObjectDir();
    const key = `uploads/${objectId}`;
    const exp = Date.now() + LOCAL_UPLOAD_TTL_SEC * 1000;
    const sig = signLocalUpload(key, exp, maxBytes, expectedBytes);
    const expected =
      expectedBytes === undefined ? "" : `&expected=${expectedBytes}`;
    return `${uploadUrlBase()}/api/storage/cloud-upload/${key}?exp=${exp}&max=${maxBytes}${expected}&sig=${sig}`;
  }

  async getObjectEntityFile(objectPath: string): Promise<StoredObject> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");

    if (this.isLocal()) {
      const abs = resolveWithin(localPrivateDir(), entityId);
      try {
        const stat = await fs.stat(abs);
        if (!stat.isFile()) {
          throw new ObjectNotFoundError();
        }
      } catch {
        throw new ObjectNotFoundError();
      }
      return { kind: "local", absPath: abs };
    }

    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return { kind: "gcs", file: objectFile };
  }

  async deleteObjectEntity(objectPath: string): Promise<void> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (
      parts.length < 3 ||
      parts[0] !== "objects" ||
      parts.some((part) => !part || part === "." || part === "..")
    ) {
      throw new ObjectNotFoundError();
    }
    const entityId = parts.slice(1).join("/");

    if (this.isLocal()) {
      const abs = resolveWithin(localPrivateDir(), entityId);
      const unlinkIfPresent = async (filePath: string) => {
        try {
          await fs.unlink(filePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
      };
      await unlinkIfPresent(abs);
      await unlinkIfPresent(`${abs}.meta.json`);
      return;
    }

    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const { bucketName, objectName } = parseObjectPath(
      `${entityDir}${entityId}`,
    );
    await objectStorageClient
      .bucket(bucketName)
      .file(objectName)
      .delete({ ignoreNotFound: true });
  }

  normalizeObjectEntityPath(rawPath: string): string {
    // API-mediated upload URLs (local or cloud) map to canonical object paths.
    for (const marker of [
      "/api/storage/local-upload/",
      "/api/storage/cloud-upload/",
    ]) {
      const markerIdx = rawPath.indexOf(marker);
      if (markerIdx !== -1) {
        const after = rawPath.slice(markerIdx + marker.length).split("?")[0];
        return `/objects/${after}`;
      }
    }

    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: StoredObject;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

// Re-exported for consumers that previously imported the GCS File type.
export type { File };
