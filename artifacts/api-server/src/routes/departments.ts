import { Router, type IRouter } from "express";
import { eq, and, isNull } from "drizzle-orm";
import { db, departmentsTable, centersTable } from "@workspace/db";
import {
  ListDepartmentsQueryParams,
  ListDepartmentsResponse,
  CreateDepartmentBody,
} from "@workspace/api-zod";
import { requireAuth, requireRole, hasScopeOver } from "../middlewares/auth";
import { toDepartment } from "../lib/mappers";

const router: IRouter = Router();

router.get("/departments", requireAuth, async (req, res): Promise<void> => {
  const query = ListDepartmentsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }
  const filters = [isNull(departmentsTable.deletedAt)];
  if (query.data.centerId != null) {
    filters.push(eq(departmentsTable.centerId, query.data.centerId));
  }
  const rows = await db
    .select()
    .from(departmentsTable)
    .where(and(...filters))
    .orderBy(departmentsTable.name);
  res.json(ListDepartmentsResponse.parse(rows.map(toDepartment)));
});

router.post(
  "/departments",
  requireAuth,
  requireRole("superadmin", "coordinator", "department_head"),
  async (req, res): Promise<void> => {
    const parsed = CreateDepartmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const [center] = await db
      .select()
      .from(centersTable)
      .where(
        and(
          eq(centersTable.id, parsed.data.centerId),
          isNull(centersTable.deletedAt),
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
    const [department] = await db
      .insert(departmentsTable)
      .values({
        centerId: parsed.data.centerId,
        name: parsed.data.name,
        headUserId: parsed.data.headUserId ?? null,
      })
      .returning();
    res.status(201).json(toDepartment(department));
  },
);

export default router;
