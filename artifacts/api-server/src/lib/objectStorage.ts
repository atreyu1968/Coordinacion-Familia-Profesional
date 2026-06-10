import { Storage, File } from "@google-cloud/storage";
import { Readable } from "stream";
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

// Browser-facing prefix used to build the local upload URL. When the app is
// served at the domain root (the default for the self-hosted installer) this is
// "" and the URL is a root-relative "/api/...". Set PUBLIC_APP_URL to an origin
// (e.g. https://example.org) only if the API is reached cross-origin.
function localUploadUrlBase(): string {
  return (process.env.PUBLIC_APP_URL || "").replace(/\/$/, "");
}

function localStorageDir(): string {
  const dir = process.env.LOCAL_STORAGE_DIR || path.resolve(process.cwd(), "storage");
  return path.resolve(dir);
}

// Local upload URLs are signed with an expiry so they behave like the cloud
// presigned URLs (a leaked link stops working after the TTL). The signature is
// an HMAC over "<key>:<expiry>" keyed by JWT_SECRET (always set in production).
const LOCAL_UPLOAD_TTL_SEC = 900;

function localUploadSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET not set; required to sign local upload URLs");
  }
  return secret;
}

function signLocalUpload(key: string, expMs: number): string {
  return createHmac("sha256", localUploadSecret())
    .update(`${key}:${expMs}`)
    .digest("base64url");
}

// Constant-time verification of a local upload URL signature + expiry.
function checkLocalUploadSignature(
  key: string,
  exp?: string,
  sig?: string,
): boolean {
  if (!exp || !sig) return false;
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false;
  const expected = Buffer.from(signLocalUpload(key, expMs));
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
  verifyLocalUploadSignature(key: string, exp?: string, sig?: string): boolean {
    return checkLocalUploadSignature(key, exp, sig);
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
    return paths;
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
      const abs = resolveWithin(localPublicDir(), filePath);
      try {
        const stat = await fs.stat(abs);
        if (stat.isFile()) {
          return { kind: "local", absPath: abs };
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

  async getObjectEntityUploadURL(): Promise<string> {
    const objectId = randomUUID();

    if (this.isLocal()) {
      // The browser PUTs the file directly to this endpoint, which streams it to
      // disk. The unguessable UUID plus a short-lived HMAC signature gate the
      // write, mirroring the presigned-URL model used by the cloud backend.
      const key = `uploads/${objectId}`;
      const exp = Date.now() + LOCAL_UPLOAD_TTL_SEC * 1000;
      const sig = signLocalUpload(key, exp);
      return `${localUploadUrlBase()}/api/storage/local-upload/${key}?exp=${exp}&sig=${sig}`;
    }

    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
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

  normalizeObjectEntityPath(rawPath: string): string {
    // Local upload URLs look like ".../api/storage/local-upload/uploads/<id>";
    // store them as the canonical "/objects/uploads/<id>" entity path.
    const localMarker = "/api/storage/local-upload/";
    const localIdx = rawPath.indexOf(localMarker);
    if (localIdx !== -1) {
      // Drop the signing query string (?exp=...&sig=...) from the stored path.
      const after = rawPath.slice(localIdx + localMarker.length).split("?")[0];
      return `/objects/${after}`;
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

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = (await response.json()) as {
    signed_url: string;
  };
  return signedURL;
}

// Re-exported for consumers that previously imported the GCS File type.
export type { File };
