import { Router, type IRouter, type RequestHandler } from "express";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db, normativaPublicationsTable as publications, normativaSourcesTable as sources } from "@workspace/db";
import { ListNormativaQueryParams, ListNormativaResponse, ReviewNormativaBody, ReviewNormativaParams, ReviewNormativaResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { getActiveFamily } from "../lib/settings";
import { normativaIsRunning, queueNormativaCheck } from "../lib/normativaMonitor";

const router: IRouter = Router();
// Same authority as general wiki edit; module-only grants confer no global rights.
const manage: RequestHandler = (req, res, next) => {
  if (!["superadmin", "coordinator"].includes(req.user!.role)) {
    res.status(403).json({ error: "Se requiere permiso para gestionar Documentación general" });
    return;
  }
  next();
};
const superadminOnly: RequestHandler = (req, res, next) => {
  if (req.user!.role !== "superadmin") {
    res.status(403).json({ error: "Solo el superadministrador puede revisar publicaciones normativas pendientes" });
    return;
  }
  next();
};
const serialize = (value: unknown) => JSON.parse(JSON.stringify(value));

router.get("/wiki/normativa", requireAuth, manage, async (req, res): Promise<void> => {
  const parsed = ListNormativaQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Filtros no válidos" }); return; }
  const { status, offset } = parsed.data;
  const relevantOnly = ne(publications.relevance, "other");
  const hiddenPending = req.user!.role === "superadmin" ? undefined : ne(publications.status, "pending");
  const selectedStatus = status === "all" ? undefined : eq(publications.status, status);
  const where = and(relevantOnly, hiddenPending, selectedStatus);
  const [items, count, sourceRows, family] = await Promise.all([
    db.select().from(publications).where(where).orderBy(desc(publications.detectedAt), desc(publications.id)).limit(25).offset(offset),
    db.select({ total: sql<number>`count(*)::integer` }).from(publications).where(where),
    db.select().from(sources).orderBy(sources.source),
    getActiveFamily(),
  ]);
  res.json(ListNormativaResponse.parse(serialize({ items, total: count[0]!.total, sources: sourceRows,
    running: normativaIsRunning(), enabled: family === "Administración y Gestión" })));
});
router.post("/wiki/normativa/check", requireAuth, manage, superadminOnly, async (_req, res): Promise<void> => {
  if (await getActiveFamily() !== "Administración y Gestión") {
    res.status(409).json({ error: "El seguimiento está preparado para Administración y Gestión; no se aplica automáticamente a otras familias" }); return;
  }
  queueNormativaCheck();
  res.sendStatus(202);
});
router.patch("/wiki/normativa/:id/review", requireAuth, manage, superadminOnly, async (req, res): Promise<void> => {
  const params = ReviewNormativaParams.safeParse(req.params);
  const body = ReviewNormativaBody.safeParse(req.body);
  if (!params.success || !body.success || !body.data.reviewNote.trim()) { res.status(400).json({ error: "Indica el resultado y una nota de revisión" }); return; }
  const [updated] = await db.update(publications).set({
    status: body.data.status, reviewNote: body.data.reviewNote.trim(), reviewedBy: req.user!.id, reviewedAt: new Date(),
  }).where(and(eq(publications.id, params.data.id), eq(publications.status, body.data.expectedStatus))).returning();
  if (!updated) {
    const [exists] = await db.select({ id: publications.id }).from(publications).where(eq(publications.id, params.data.id));
    res.status(exists ? 409 : 404).json({ error: exists ? "Otro responsable ya ha revisado la publicación. Actualiza la lista." : "Publicación no encontrada" }); return;
  }
  res.json(ReviewNormativaResponse.parse(serialize(updated)));
});
export default router;
