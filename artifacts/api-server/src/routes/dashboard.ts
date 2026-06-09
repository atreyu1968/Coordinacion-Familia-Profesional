import { Router, type IRouter } from "express";
import { eq, and, isNull, count, sql } from "drizzle-orm";
import {
  db,
  centersTable,
  usersTable,
  islandsTable,
} from "@workspace/db";
import {
  GetDashboardSummaryQueryParams,
  GetDashboardSummaryResponse,
  GetDashboardStatisticsQueryParams,
  GetDashboardStatisticsResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

const ROLE_LABELS: Record<string, string> = {
  superadmin: "Superadministración",
  coordinator: "Coordinación",
  prospector: "Prospección",
  department_head: "Jefatura de departamento",
  teacher: "Profesorado",
  student: "Alumnado",
};

router.get("/dashboard/summary", requireAuth, async (req, res): Promise<void> => {
  const query = GetDashboardSummaryQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }

  const centerFilters = [isNull(centersTable.deletedAt)];
  if (query.data.provinceId != null) {
    centerFilters.push(eq(centersTable.provinceId, query.data.provinceId));
  }
  const [centersCount] = await db
    .select({ value: count() })
    .from(centersTable)
    .where(and(...centerFilters));

  const teacherFilters = [
    isNull(usersTable.deletedAt),
    eq(usersTable.role, "teacher"),
  ];
  if (query.data.provinceId != null) {
    teacherFilters.push(eq(usersTable.provinceId, query.data.provinceId));
  }
  const [teachersCount] = await db
    .select({ value: count() })
    .from(usersTable)
    .where(and(...teacherFilters));

  res.json(
    GetDashboardSummaryResponse.parse({
      centers: centersCount?.value ?? 0,
      teachers: teachersCount?.value ?? 0,
      resources: 0,
      activeSurveys: 0,
      upcomingEvents: 0,
      companyAlerts: 0,
    }),
  );
});

router.get("/dashboard/statistics", requireAuth, async (req, res): Promise<void> => {
  const query = GetDashboardStatisticsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }

  const usersByRoleRows = await db
    .select({ role: usersTable.role, value: count() })
    .from(usersTable)
    .where(isNull(usersTable.deletedAt))
    .groupBy(usersTable.role);

  const centersByIslandRows = await db
    .select({
      label: sql<string>`coalesce(${islandsTable.name}, 'Sin isla')`,
      value: count(centersTable.id),
    })
    .from(centersTable)
    .leftJoin(islandsTable, eq(centersTable.islandId, islandsTable.id))
    .where(isNull(centersTable.deletedAt))
    .groupBy(islandsTable.name);

  res.json(
    GetDashboardStatisticsResponse.parse({
      resourcesByMonth: [],
      usersByRole: usersByRoleRows.map((r) => ({
        label: ROLE_LABELS[r.role] ?? r.role,
        value: r.value,
      })),
      centersByIsland: centersByIslandRows.map((r) => ({
        label: r.label,
        value: r.value,
      })),
    }),
  );
});

export default router;
