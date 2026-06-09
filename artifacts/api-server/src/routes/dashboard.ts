import { Router, type IRouter } from "express";
import { eq, and, isNull, count, sql, type SQL } from "drizzle-orm";
import {
  db,
  centersTable,
  usersTable,
  islandsTable,
} from "@workspace/db";
import type { User } from "@workspace/db";
import {
  GetDashboardSummaryQueryParams,
  GetDashboardSummaryResponse,
  GetDashboardStatisticsQueryParams,
  GetDashboardStatisticsResponse,
} from "@workspace/api-zod";
import { requireAuth, resolveReadScope } from "../middlewares/auth";

const router: IRouter = Router();

const ROLE_LABELS: Record<string, string> = {
  superadmin: "Superadministración",
  coordinator: "Coordinación",
  prospector: "Prospección",
  department_head: "Jefatura de departamento",
  teacher: "Profesorado",
  student: "Alumnado",
};

type DashboardScope = {
  provinceId: number | null;
  centerId: number | null;
  empty: boolean;
};

// Constrain dashboard aggregates to the caller's tenant scope. Scope is
// role-driven (see resolveReadScope): superadmin sees everything (optionally
// narrowed by an explicit province filter); province roles are locked to their
// province; center roles to their center; everyone else sees nothing.
function resolveScope(
  caller: User,
  requestedProvinceId?: number | null,
): DashboardScope {
  const scope = resolveReadScope(caller);
  switch (scope.kind) {
    case "global":
      return {
        provinceId: requestedProvinceId ?? null,
        centerId: null,
        empty: false,
      };
    case "province":
      return { provinceId: scope.provinceId, centerId: null, empty: false };
    case "center":
      return { provinceId: null, centerId: scope.centerId, empty: false };
    case "none":
      return { provinceId: null, centerId: null, empty: true };
  }
}

router.get("/dashboard/summary", requireAuth, async (req, res): Promise<void> => {
  const query = GetDashboardSummaryQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }

  const scope = resolveScope(req.user!, query.data.provinceId);
  if (scope.empty) {
    res.json(
      GetDashboardSummaryResponse.parse({
        centers: 0,
        teachers: 0,
        resources: 0,
        activeSurveys: 0,
        upcomingEvents: 0,
        companyAlerts: 0,
      }),
    );
    return;
  }

  const centerFilters: SQL[] = [isNull(centersTable.deletedAt)];
  if (scope.provinceId != null) {
    centerFilters.push(eq(centersTable.provinceId, scope.provinceId));
  }
  if (scope.centerId != null) {
    centerFilters.push(eq(centersTable.id, scope.centerId));
  }
  const [centersCount] = await db
    .select({ value: count() })
    .from(centersTable)
    .where(and(...centerFilters));

  const teacherFilters: SQL[] = [
    isNull(usersTable.deletedAt),
    eq(usersTable.role, "teacher"),
  ];
  if (scope.provinceId != null) {
    teacherFilters.push(eq(usersTable.provinceId, scope.provinceId));
  }
  if (scope.centerId != null) {
    teacherFilters.push(eq(usersTable.centerId, scope.centerId));
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

  const scope = resolveScope(req.user!, query.data.provinceId);
  if (scope.empty) {
    res.json(
      GetDashboardStatisticsResponse.parse({
        resourcesByMonth: [],
        usersByRole: [],
        centersByIsland: [],
      }),
    );
    return;
  }

  const userFilters: SQL[] = [isNull(usersTable.deletedAt)];
  if (scope.provinceId != null) {
    userFilters.push(eq(usersTable.provinceId, scope.provinceId));
  }
  if (scope.centerId != null) {
    userFilters.push(eq(usersTable.centerId, scope.centerId));
  }
  const usersByRoleRows = await db
    .select({ role: usersTable.role, value: count() })
    .from(usersTable)
    .where(and(...userFilters))
    .groupBy(usersTable.role);

  const centerFilters: SQL[] = [isNull(centersTable.deletedAt)];
  if (scope.provinceId != null) {
    centerFilters.push(eq(centersTable.provinceId, scope.provinceId));
  }
  if (scope.centerId != null) {
    centerFilters.push(eq(centersTable.id, scope.centerId));
  }
  const centersByIslandRows = await db
    .select({
      label: sql<string>`coalesce(${islandsTable.name}, 'Sin isla')`,
      value: count(centersTable.id),
    })
    .from(centersTable)
    .leftJoin(islandsTable, eq(centersTable.islandId, islandsTable.id))
    .where(and(...centerFilters))
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
