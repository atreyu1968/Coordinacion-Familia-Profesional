import { Router, type IRouter } from "express";
import { eq, and, isNull } from "drizzle-orm";
import {
  db,
  provincesTable,
  islandsTable,
  municipalitiesTable,
} from "@workspace/db";
import {
  ListProvincesResponse,
  CreateProvinceBody,
  ListIslandsQueryParams,
  ListIslandsResponse,
  ListMunicipalitiesQueryParams,
  ListMunicipalitiesResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { toProvince } from "../lib/mappers";

const router: IRouter = Router();

router.get("/provinces", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(provincesTable)
    .where(isNull(provincesTable.deletedAt))
    .orderBy(provincesTable.name);
  res.json(ListProvincesResponse.parse(rows.map(toProvince)));
});

router.post(
  "/provinces",
  requireAuth,
  requireRole("superadmin"),
  async (req, res): Promise<void> => {
    const parsed = CreateProvinceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const [province] = await db
      .insert(provincesTable)
      .values({ name: parsed.data.name, code: parsed.data.code ?? null })
      .returning();
    res.status(201).json(toProvince(province));
  },
);

router.get("/islands", async (req, res): Promise<void> => {
  const query = ListIslandsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }
  const filters = [isNull(islandsTable.deletedAt)];
  if (query.data.provinceId != null) {
    filters.push(eq(islandsTable.provinceId, query.data.provinceId));
  }
  const rows = await db
    .select()
    .from(islandsTable)
    .where(and(...filters))
    .orderBy(islandsTable.name);
  res.json(ListIslandsResponse.parse(rows));
});

router.get("/municipalities", async (req, res): Promise<void> => {
  const query = ListMunicipalitiesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }
  const filters = [isNull(municipalitiesTable.deletedAt)];
  if (query.data.islandId != null) {
    filters.push(eq(municipalitiesTable.islandId, query.data.islandId));
  }
  const rows = await db
    .select()
    .from(municipalitiesTable)
    .where(and(...filters))
    .orderBy(municipalitiesTable.name);
  res.json(ListMunicipalitiesResponse.parse(rows));
});

export default router;
