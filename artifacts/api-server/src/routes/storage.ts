import { Router, type IRouter, type Request, type Response } from "express";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { createWriteStream, promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import {
  MAX_UPLOAD_BYTES,
  ObjectStorageConfigurationError,
  ObjectStorageService,
} from "../lib/objectStorage";
import {
  canAccessObject,
  getObjectAclPolicy,
  ObjectPermission,
  writeLocalMeta,
} from "../lib/objectAcl";
import { getAppBaseUrl } from "../lib/appUrl";
import { optionalAuth, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

class UploadLimitExceededError extends Error {}
class UploadSizeMismatchError extends Error {}

function createByteLimiter(maxBytes: number, expectedBytes?: number) {
  let receivedBytes = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) {
        callback(new UploadLimitExceededError());
        return;
      }
      if (expectedBytes !== undefined && receivedBytes > expectedBytes) {
        callback(new UploadSizeMismatchError());
        return;
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (receivedBytes < 1) {
        callback(new UploadSizeMismatchError());
        return;
      }
      if (expectedBytes !== undefined && receivedBytes !== expectedBytes) {
        callback(new UploadSizeMismatchError());
        return;
      }
      callback();
    },
  });
  return { stream, receivedBytes: () => receivedBytes };
}

function validateDeclaredUploadSize(
  req: Request,
  res: Response,
  maxBytes: number,
  expectedBytes?: number,
): boolean {
  const contentLength = req.headers["content-length"];
  if (contentLength === undefined) return true;
  const declaredBytes = Number(contentLength);
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
    res.status(400).json({ message: "Longitud de subida no válida" });
    return false;
  }
  if (declaredBytes > maxBytes) {
    res.status(413).json({ message: "El archivo supera el límite de subida" });
    return false;
  }
  if (expectedBytes !== undefined && declaredBytes !== expectedBytes) {
    res.status(400).json({ message: "El tamaño no coincide con el solicitado" });
    return false;
  }
  return true;
}

/**
 * POST /storage/uploads/request-url
 *
 * Request a short-lived, size-bound URL for file upload. Authenticated users only.
 * The client sends JSON metadata (name, size, contentType) — NOT the file —
 * then PUTs the file to the returned upload URL.
 */
router.post(
  "/storage/uploads/request-url",
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Datos de archivo no válidos" });
      return;
    }

    try {
      const { name, size, contentType } = parsed.data;
      if (!Number.isSafeInteger(size) || size < 1) {
        res.status(400).json({ message: "El tamaño del archivo no es válido" });
        return;
      }
      if (size > MAX_UPLOAD_BYTES) {
        res.status(413).json({ message: "El archivo supera el máximo de 100 MB" });
        return;
      }

      const uploadURL = new URL(
        await objectStorageService.getObjectEntityUploadURL({
          maxBytes: size,
          expectedBytes: size,
        }),
        getAppBaseUrl(req),
      ).toString();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, "Error generating upload URL");
      res.status(500).json({ message: "No se pudo generar la URL de subida" });
    }
  },
);

/**
 * PUT /storage/local-upload/uploads/*
 *
 * Receives a direct file upload when the local (self-hosted) storage driver is
 * active. The unguessable UUID and signed byte limit embedded in the URL gate
 * the write. Disabled when the cloud backend is in use.
 */
router.put(
  "/storage/local-upload/*key",
  async (req: Request, res: Response) => {
    if (!objectStorageService.isLocal()) {
      res.status(404).json({ message: "No disponible" });
      return;
    }

    const raw = req.params.key;
    const key = Array.isArray(raw) ? raw.join("/") : raw;

    // Only writes under the "uploads/" prefix are accepted.
    if (!key || !key.replace(/^\/+/, "").startsWith("uploads/")) {
      res.status(400).json({ message: "Ruta de subida no válida" });
      return;
    }

    // Enforce the short-lived signature minted by getObjectEntityUploadURL so a
    // leaked URL cannot be reused indefinitely (matches cloud presigned URLs).
    const exp = typeof req.query.exp === "string" ? req.query.exp : undefined;
    const sig = typeof req.query.sig === "string" ? req.query.sig : undefined;
    const maxBytesRaw =
      typeof req.query.max === "string" ? req.query.max : undefined;
    const expectedBytesRaw =
      typeof req.query.expected === "string" ? req.query.expected : undefined;
    if (
      !objectStorageService.verifyLocalUploadSignature(
        key,
        exp,
        sig,
        maxBytesRaw,
        expectedBytesRaw,
      )
    ) {
      res
        .status(403)
        .json({ message: "Enlace de subida no válido o caducado" });
      return;
    }

    const maxBytes =
      maxBytesRaw === undefined ? MAX_UPLOAD_BYTES : Number(maxBytesRaw);
    const expectedBytes =
      expectedBytesRaw === undefined ? undefined : Number(expectedBytesRaw);
    if (!validateDeclaredUploadSize(req, res, maxBytes, expectedBytes)) return;

    let lockHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
    let target: string | undefined;
    let tempTarget: string | undefined;
    let installed = false;
    try {
      target = objectStorageService.resolveLocalUploadPath(key);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const lockPath = `${target}.upload-lock`;
      try {
        lockHandle = await fs.open(lockPath, "wx");
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        ) {
          res.status(409).json({ message: "Esta subida ya está en curso" });
          return;
        }
        throw error;
      }

      try {
        await fs.access(target);
        res.status(409).json({ message: "El archivo ya se ha recibido" });
        return;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
          throw error;
        }
      }

      tempTarget = `${target}.${randomUUID()}.uploading`;
      const { stream: byteLimiter, receivedBytes } = createByteLimiter(
        maxBytes,
        expectedBytes,
      );
      await pipeline(
        req,
        byteLimiter,
        createWriteStream(tempTarget, { flags: "wx" }),
      );

      const stat = await fs.stat(tempTarget);
      if (stat.size !== receivedBytes()) {
        throw new UploadSizeMismatchError();
      }
      await fs.rename(tempTarget, target);
      installed = true;
      await writeLocalMeta(target, {
        contentType:
          (req.headers["content-type"] as string) || "application/octet-stream",
        size: receivedBytes(),
      });
      installed = false;

      res.status(200).json({ ok: true });
    } catch (error) {
      if (tempTarget) await fs.unlink(tempTarget).catch(() => undefined);
      if (installed && target) {
        await fs.unlink(target).catch(() => undefined);
        await fs.unlink(`${target}.meta.json`).catch(() => undefined);
      }
      if (error instanceof UploadLimitExceededError) {
        res.status(413).json({ message: "El archivo supera el límite de subida" });
        return;
      }
      if (error instanceof UploadSizeMismatchError) {
        res.status(400).json({ message: "El tamaño del archivo no coincide" });
        return;
      }
      req.log.error({ err: error }, "Error storing local upload");
      res.status(500).json({ message: "No se pudo guardar el archivo" });
    } finally {
      if (lockHandle) {
        const lockPath = `${target}.upload-lock`;
        await lockHandle.close().catch(() => undefined);
        await fs.unlink(lockPath).catch(() => undefined);
      }
    }
  },
);

/**
 * PUT /storage/cloud-upload/uploads/*
 *
 * The client contract remains a direct PUT to the returned uploadURL, but the
 * cloud driver proxies bytes through this API so the byte limit is enforced
 * before the object is committed to private object storage.
 */
router.put(
  "/storage/cloud-upload/*key",
  async (req: Request, res: Response) => {
    if (objectStorageService.isLocal()) {
      res.status(404).json({ message: "No disponible" });
      return;
    }

    const raw = req.params.key;
    const key = Array.isArray(raw) ? raw.join("/") : raw;
    if (!key || !/^uploads\/[0-9a-f-]{36}$/i.test(key)) {
      res.status(400).json({ message: "Ruta de subida no válida" });
      return;
    }

    const exp = typeof req.query.exp === "string" ? req.query.exp : undefined;
    const sig = typeof req.query.sig === "string" ? req.query.sig : undefined;
    const maxBytesRaw =
      typeof req.query.max === "string" ? req.query.max : undefined;
    const expectedBytesRaw =
      typeof req.query.expected === "string" ? req.query.expected : undefined;
    if (
      !objectStorageService.verifyUploadSignature(
        key,
        exp,
        sig,
        maxBytesRaw,
        expectedBytesRaw,
      )
    ) {
      res
        .status(403)
        .json({ message: "Enlace de subida no válido o caducado" });
      return;
    }

    const maxBytes = Number(maxBytesRaw);
    const expectedBytes =
      expectedBytesRaw === undefined ? undefined : Number(expectedBytesRaw);
    if (!validateDeclaredUploadSize(req, res, maxBytes, expectedBytes)) return;

    const tempKey = `${key}.uploading-${randomUUID()}`;
    try {
      if (await objectStorageService.privateUploadExists(key)) {
        res.status(409).json({ message: "El archivo ya se ha recibido" });
        return;
      }

      const contentType =
        (req.headers["content-type"] as string) || "application/octet-stream";
      const limiter = createByteLimiter(maxBytes, expectedBytes);
      await pipeline(
        req,
        limiter.stream,
        objectStorageService.createPrivateUploadWriteStream(
          tempKey,
          contentType,
        ),
      );
      await objectStorageService.commitPrivateUpload(tempKey, key);
      res.status(200).json({ ok: true });
    } catch (error) {
      await objectStorageService.discardPrivateUpload(tempKey);
      if (error instanceof UploadLimitExceededError) {
        res.status(413).json({ message: "El archivo supera el límite de subida" });
        return;
      }
      if (error instanceof UploadSizeMismatchError) {
        res.status(400).json({ message: "El tamaño del archivo no coincide" });
        return;
      }
      if (
        error instanceof Error &&
        "code" in error &&
        Number(error.code) === 412
      ) {
        res.status(409).json({ message: "El archivo ya se ha recibido" });
        return;
      }
      req.log.error({ err: error }, "Error storing cloud upload");
      res.status(500).json({ message: "No se pudo guardar el archivo" });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS — unconditionally public.
 * Private documents are NOT served here; they are streamed through the
 * document-forms domain route which enforces admin-or-owner authorization.
 */
router.get(
  "/storage/public-objects/*filePath",
  optionalAuth,
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join("/") : raw;
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        res.status(404).json({ message: "Archivo no encontrado" });
        return;
      }

      const aclPolicy = await getObjectAclPolicy(file);
      // Missing ACL metadata is intentionally allowed for assets found beneath
      // a configured public search prefix (legacy public assets). The storage
      // service first proves that these prefixes cannot overlap private storage.
      if (
        aclPolicy &&
        !(await canAccessObject({
          userId: req.user ? String(req.user.id) : undefined,
          objectFile: file,
          requestedPermission: ObjectPermission.READ,
        }))
      ) {
        res.status(404).json({ message: "Archivo no encontrado" });
        return;
      }

      const response = await objectStorageService.downloadObject(file);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectStorageConfigurationError) {
        res
          .status(503)
          .json({ message: "El almacenamiento público no está configurado de forma segura" });
        return;
      }
      req.log.error({ err: error }, "Error serving public object");
      res.status(500).json({ message: "No se pudo servir el archivo" });
    }
  },
);

export default router;
