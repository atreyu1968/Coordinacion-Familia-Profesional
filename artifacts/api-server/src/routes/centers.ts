import { Router, type IRouter } from "express";
import { eq, and, or, isNull, ilike, sql, type SQL } from "drizzle-orm";
import {
  db,
  centersTable,
  trainingOfferTable,
  cyclesTable,
} from "@workspace/db";
import {
  ListCentersQueryParams,
  ListCentersResponse,
  ListCenterFacetsResponse,
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
import { getActiveFamily, getActiveAcademicYear } from "../lib/settings";
import { cycleFamilyFilter } from "../lib/familyCatalog";

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
  if (query.data.nature)
    filters.push(eq(centersTable.nature, query.data.nature));
  if (query.data.centerType)
    filters.push(eq(centersTable.centerType, query.data.centerType));
  // The app instance is locked to a single active professional family: every
  // centers listing is filtered to it for all users (the client no longer offers
  // a family selector). The incoming `family` param is intentionally ignored.
  const activeFamily = await getActiveFamily();
  filters.push(
    sql`${centersTable.families} @> ${JSON.stringify([activeFamily])}::jsonb`,
  );

  const rows = await db
    .select()
    .from(centersTable)
    .where(and(...filters))
    .orderBy(centersTable.name);
  res.json(ListCentersResponse.parse(rows.map(toCenter)));
});

// Distinct values for the Centros page filter selects. Defined before
// "/centers/:id" so Express does not treat "facets" as an :id.
router.get("/centers/facets", async (_req, res): Promise<void> => {
  // Facets must reflect the locked instance too: only derive distinct values
  // from centers that offer the active professional family.
  const activeFamily = await getActiveFamily();
  const familyJson = JSON.stringify([activeFamily]);
  // A center may list several families; expanding them all would leak other
  // families. Keep only the active one (the instance is locked to it).
  const familiesRes = await db.execute<{ value: string }>(
    sql`SELECT DISTINCT elem AS value
        FROM centers, jsonb_array_elements_text(families) AS elem
        WHERE deleted_at IS NULL AND families @> ${familyJson}::jsonb
          AND elem = ${activeFamily} ORDER BY value`,
  );
  const typesRes = await db.execute<{ value: string }>(
    sql`SELECT DISTINCT center_type AS value FROM centers
        WHERE deleted_at IS NULL AND center_type IS NOT NULL
          AND families @> ${familyJson}::jsonb ORDER BY value`,
  );
  const naturesRes = await db.execute<{ value: string }>(
    sql`SELECT DISTINCT nature AS value FROM centers
        WHERE deleted_at IS NULL AND nature IS NOT NULL
          AND families @> ${familyJson}::jsonb ORDER BY value`,
  );
  res.json(
    ListCenterFacetsResponse.parse({
      families: familiesRes.rows.map((r) => r.value),
      centerTypes: typesRes.rows.map((r) => r.value),
      natures: naturesRes.rows.map((r) => r.value),
    }),
  );
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
    const sameName = sql`lower(trim(${centersTable.name})) = ${parsed.data.name.trim().toLowerCase()}`;
    let sameLocation: SQL = sql`true`;
    if (parsed.data.municipalityId != null) {
      const matches: SQL[] = [
        eq(centersTable.municipalityId, parsed.data.municipalityId),
      ];
      if (provinceId != null) {
        const missingMunicipalityMatch = and(
          isNull(centersTable.municipalityId),
          eq(centersTable.provinceId, provinceId),
        );
        if (missingMunicipalityMatch)
          matches.push(missingMunicipalityMatch);
      }
      sameLocation = or(...matches) ?? sql`false`;
    } else if (parsed.data.islandId != null) {
      const matches: SQL[] = [eq(centersTable.islandId, parsed.data.islandId)];
      if (provinceId != null) {
        const missingIslandMatch = and(
          isNull(centersTable.islandId),
          eq(centersTable.provinceId, provinceId),
        );
        if (missingIslandMatch) matches.push(missingIslandMatch);
      }
      sameLocation = or(...matches) ?? sql`false`;
    } else if (provinceId != null) {
      sameLocation = eq(centersTable.provinceId, provinceId);
    }

    const identityChecks: SQL[] = [];
    const sameNameAndLocation = and(sameName, sameLocation);
    if (sameNameAndLocation) identityChecks.push(sameNameAndLocation);
    const code = parsed.data.code?.trim();
    if (code) {
      identityChecks.push(
        sql`lower(trim(${centersTable.code})) = ${code.toLowerCase()}`,
      );
    }
    const duplicateIdentity = or(...identityChecks);
    if (duplicateIdentity) {
      const [duplicate] = await db
        .select({ id: centersTable.id })
        .from(centersTable)
        .where(and(isNull(centersTable.deletedAt), duplicateIdentity));
      if (duplicate) {
        res.status(409).json({
          message: "Ya existe un centro con el mismo código o nombre y ubicación.",
        });
        return;
      }
    }

    const activeFamily = await getActiveFamily();
    const [center] = await db
      .insert(centersTable)
      .values({
        ...parsed.data,
        provinceId,
        families: [activeFamily],
        createdBy: caller.id,
      })
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
  // The instance is locked to the active family: a center outside it does not
  // exist as far as this app is concerned (404), preventing access by direct ID.
  const activeFamily = await getActiveFamily();
  const [center] = await db
    .select()
    .from(centersTable)
    .where(
      and(
        eq(centersTable.id, params.data.id),
        isNull(centersTable.deletedAt),
        sql`${centersTable.families} @> ${JSON.stringify([activeFamily])}::jsonb`,
      ),
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
    const activeFamily = await getActiveFamily();
    const [existing] = await db
      .select()
      .from(centersTable)
      .where(
        and(
          eq(centersTable.id, params.data.id),
          isNull(centersTable.deletedAt),
          sql`${centersTable.families} @> ${JSON.stringify([activeFamily])}::jsonb`,
        ),
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
    const activeFamily = await getActiveFamily();
    const [existing] = await db
      .select()
      .from(centersTable)
      .where(
        and(
          eq(centersTable.id, params.data.id),
          isNull(centersTable.deletedAt),
          sql`${centersTable.families} @> ${JSON.stringify([activeFamily])}::jsonb`,
        ),
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
  // Do not expose the offer of a center outside the active family.
  const activeFamily = await getActiveFamily();
  const [center] = await db
    .select({ id: centersTable.id })
    .from(centersTable)
    .where(
      and(
        eq(centersTable.id, params.data.id),
        isNull(centersTable.deletedAt),
        sql`${centersTable.families} @> ${JSON.stringify([activeFamily])}::jsonb`,
      ),
    );
  if (!center) {
    res.status(404).json({ message: "Centro no encontrado" });
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
    const activeFamily = await getActiveFamily();
    const [center] = await db
      .select()
      .from(centersTable)
      .where(
        and(
          eq(centersTable.id, params.data.id),
          isNull(centersTable.deletedAt),
          sql`${centersTable.families} @> ${JSON.stringify([activeFamily])}::jsonb`,
        ),
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

    // Prefer referencing a catalog cycle; the back-compat cycleName is derived
    // from it. Free-text cycleName is still accepted for compatibility.
    let cycleId: number | null = null;
    let cycleName: string | null = parsed.data.cycleName ?? null;
    let level: string | null = parsed.data.level ?? null;
    if (parsed.data.cycleId != null) {
      const [cycle] = await db
        .select()
        .from(cyclesTable)
        .where(
          and(
            eq(cyclesTable.id, parsed.data.cycleId),
            isNull(cyclesTable.deletedAt),
            cycleFamilyFilter(activeFamily),
          ),
        );
      if (!cycle) {
        res.status(404).json({
          message: "El ciclo no pertenece a la familia profesional activa",
        });
        return;
      }
      cycleId = cycle.id;
      cycleName = cycle.name;
      if (parsed.data.level == null) level = cycle.level ?? null;
    } else if (cycleName) {
      const [activeCycle] = await db
        .select({ id: cyclesTable.id, name: cyclesTable.name })
        .from(cyclesTable)
        .where(
          and(
            eq(cyclesTable.name, cycleName),
            isNull(cyclesTable.deletedAt),
            cycleFamilyFilter(activeFamily),
          ),
        )
        .limit(1);
      if (activeCycle) {
        cycleId = activeCycle.id;
        cycleName = activeCycle.name;
      } else {
        const [catalogCycle] = await db
          .select({ id: cyclesTable.id })
          .from(cyclesTable)
          .where(
            and(
              eq(cyclesTable.name, cycleName),
              isNull(cyclesTable.deletedAt),
            ),
          )
          .limit(1);
        if (catalogCycle) {
          res.status(404).json({
            message: "El ciclo no pertenece a la familia profesional activa",
          });
          return;
        }
      }
    }
    if (!cycleName) {
      res
        .status(400)
        .json({ message: "Debe indicar un ciclo del catálogo o un nombre" });
      return;
    }

    const schoolYear =
      (parsed.data.schoolYear ?? "").trim() ||
      (await getActiveAcademicYear()) ||
      null;

    const [offer] = await db
      .insert(trainingOfferTable)
      .values({
        centerId: params.data.id,
        cycleId,
        cycleName,
        level,
        shift: parsed.data.shift ?? null,
        schoolYear,
      })
      .returning();
    res.status(201).json(toTrainingOffer(offer));
  },
);

export default router;
