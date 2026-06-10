import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { createWriteStream, promises as fs } from "fs";
import path from "path";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";
import { writeLocalMeta } from "../lib/objectAcl";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload. Authenticated users only.
 * The client sends JSON metadata (name, size, contentType) — NOT the file —
 * then uploads the file directly to the returned presigned URL.
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

      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
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
 * active. The unguessable UUID embedded in the path is the access control for
 * the write, mirroring the presigned-URL model of the cloud backend. Disabled
 * when the cloud backend is in use.
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
    if (!objectStorageService.verifyLocalUploadSignature(key, exp, sig)) {
      res
        .status(403)
        .json({ message: "Enlace de subida no válido o caducado" });
      return;
    }

    try {
      const target = objectStorageService.resolveLocalUploadPath(key);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await pipeline(req, createWriteStream(target));

      const stat = await fs.stat(target);
      await writeLocalMeta(target, {
        contentType:
          (req.headers["content-type"] as string) || "application/octet-stream",
        size: stat.size,
      });

      res.status(200).json({ ok: true });
    } catch (error) {
      req.log.error({ err: error }, "Error storing local upload");
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
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join("/") : raw;
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
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
      req.log.error({ err: error }, "Error serving public object");
      res.status(500).json({ message: "No se pudo servir el archivo" });
    }
  },
);

export default router;
