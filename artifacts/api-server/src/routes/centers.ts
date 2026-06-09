import { Router, type IRouter } from "express";
import { eq, and, isNull, ilike, type SQL } from "drizzle-orm";
import { db, centersTable, trainingOfferTable } from "@workspace/db";
import {
  ListCentersQueryParams,
  ListCentersResponse,
  CreateCenterBody,
  GetCenterParams,
  GetCenterResponse,
  UpdateCenterParams,
  UpdateCenterBody,
  UpdateCenterResponse,
  DeleteCenterParams,
  ListTrainingOfferParams,
  ListTrainingOfferResponse,
  AddTrainingOfferParams,
  AddTrainingOfferBody,
} from "@workspace/api-zod";
import { requireAuth, requireRole, hasScopeOver } from "../middlewares/auth";
import { toCenter, toTrainingOffer } from "../lib/mappers";

const router: IRouter = Router();

router.get("/centers", async (req, res): Promise<void> => {
  const query = ListCentersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }
  const filters: SQL[] = [isNull(centersTable.deletedAt)];
  if (query.data.provinceId != null)
    filters.push(eq(centersTable.provinceId, query.data.provinceId));
  if (query.data.islandId != null)
    filters.push(eq(centersTable.islandId, query.data.islandId));
  if (query.data.municipalityId != null)
    filters.push(eq(centersTable.municipalityId, query.data.municipalityId));
  if (query.data.search)
    filters.push(ilike(centersTable.name, `%${query.data.search}%`));

  const rows = await db
    .select()
    .from(centersTable)
    .where(and(...filters))
    .orderBy(centersTable.name);
  res.json(ListCentersResponse.parse(rows.map(toCenter)));
});

// Creating a center is a province-level administrative action: only superadmin
// and coordinators may do it. A department head's scope is a single existing
// center, so "alta" of new centers does not apply to them; they manage
// (edición/baja lógica) their own center via PATCH/DELETE below.
router.post(
  "/centers",
  requireAuth,
  requireRole("superadmin", "coordinator"),
  async (req, res): Promise<void> => {
    const parsed = CreateCenterBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const caller = req.user!;
    // Coordinators may only create centers inside their own province.
    const provinceId =
      caller.role === "superadmin"
        ? parsed.data.provinceId
        : (caller.provinceId ?? null);
    if (caller.role === "coordinator" && provinceId == null) {
      res.status(403).json({ message: "Sin provincia asignada" });
      return;
    }
    const [center] = await db
      .insert(centersTable)
      .values({ ...parsed.data, provinceId, createdBy: caller.id })
      .returning();
    res.status(201).json(toCenter(center));
  },
);

router.get("/centers/:id", async (req, res): Promise<void> => {
  const params = GetCenterParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ message: params.error.message });
    return;
  }
  const [center] = await db
    .select()
    .from(centersTable)
    .where(
      and(eq(centersTable.id, params.data.id), isNull(centersTable.deletedAt)),
    );
  if (!center) {
    res.status(404).json({ message: "Centro no encontrado" });
    return;
  }
  const offer = await db
    .select()
    .from(trainingOfferTable)
    .where(
      and(
        eq(trainingOfferTable.centerId, center.id),
        isNull(trainingOfferTable.deletedAt),
      ),
    );
  res.json(
    GetCenterResponse.parse({
      ...toCenter(center),
      trainingOffer: offer.map(toTrainingOffer),
    }),
  );
});

router.patch(
  "/centers/:id",
  requireAuth,
  requireRole("superadmin", "coordinator", "department_head"),
  async (req, res): Promise<void> => {
    const params = UpdateCenterParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const parsed = UpdateCenterBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const [existing] = await db
      .select()
      .from(centersTable)
      .where(
        and(eq(centersTable.id, params.data.id), isNull(centersTable.deletedAt)),
      );
    if (!existing) {
      res.status(404).json({ message: "Centro no encontrado" });
      return;
    }
    if (
      !hasScopeOver(req.user!, {
        provinceId: existing.provinceId,
        centerId: existing.id,
      })
    ) {
      res.status(403).json({ message: "Centro fuera de tu ámbito" });
      return;
    }
    // Only superadmin may move a center to a different province; for everyone
    // else, validate the post-update province still falls within their scope so
    // a coordinator cannot relocate a center out of (or into) their tenant.
    const updates = { ...parsed.data };
    if (req.user!.role !== "superadmin") {
      if (
        updates.provinceId !== undefined &&
        updates.provinceId !== existing.provinceId
      ) {
        res.status(403).json({
          message: "No puedes cambiar la provincia de un centro",
        });
        return;
      }
      delete updates.provinceId;
    }
    const [center] = await db
      .update(centersTable)
      .set(updates)
      .where(
        and(eq(centersTable.id, params.data.id), isNull(centersTable.deletedAt)),
      )
      .returning();
    res.json(UpdateCenterResponse.parse(toCenter(center)));
  },
);

router.delete(
  "/centers/:id",
  requireAuth,
  requireRole("superadmin", "coordinator", "department_head"),
  async (req, res): Promise<void> => {
    const params = DeleteCenterParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const [existing] = await db
      .select()
      .from(centersTable)
      .where(
        and(eq(centersTable.id, params.data.id), isNull(centersTable.deletedAt)),
      );
    if (!existing) {
      res.status(404).json({ message: "Centro no encontrado" });
      return;
    }
    if (
      !hasScopeOver(req.user!, {
        provinceId: existing.provinceId,
        centerId: existing.id,
      })
    ) {
      res.status(403).json({ message: "Centro fuera de tu ámbito" });
      return;
    }
    await db
      .update(centersTable)
      .set({ deletedAt: new Date() })
      .where(eq(centersTable.id, params.data.id));
    res.sendStatus(204);
  },
);

router.get("/centers/:id/training-offer", async (req, res): Promise<void> => {
  const params = ListTrainingOfferParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ message: params.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(trainingOfferTable)
    .where(
      and(
        eq(trainingOfferTable.centerId, params.data.id),
        isNull(trainingOfferTable.deletedAt),
      ),
    );
  res.json(ListTrainingOfferResponse.parse(rows.map(toTrainingOffer)));
});

router.post(
  "/centers/:id/training-offer",
  requireAuth,
  requireRole("superadmin", "coordinator", "department_head"),
  async (req, res): Promise<void> => {
    const params = AddTrainingOfferParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const parsed = AddTrainingOfferBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const [center] = await db
      .select()
      .from(centersTable)
      .where(
        and(eq(centersTable.id, params.data.id), isNull(centersTable.deletedAt)),
      );
    if (!center) {
      res.status(404).json({ message: "Centro no encontrado" });
      return;
    }
    if (
      !hasScopeOver(req.user!, {
        provinceId: center.provinceId,
        centerId: center.id,
      })
    ) {
      res.status(403).json({ message: "Centro fuera de tu ámbito" });
      return;
    }
    const [offer] = await db
      .insert(trainingOfferTable)
      .values({
        centerId: params.data.id,
        cycleName: parsed.data.cycleName,
        level: parsed.data.level ?? null,
        shift: parsed.data.shift ?? null,
      })
      .returning();
    res.status(201).json(toTrainingOffer(offer));
  },
);

export default router;
