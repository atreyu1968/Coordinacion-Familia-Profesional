import { Router, type IRouter } from "express";
import {
  eq,
  and,
  or,
  isNull,
  gte,
  inArray,
  count,
  sql,
  desc,
  type SQL,
} from "drizzle-orm";
import {
  db,
  centersTable,
  usersTable,
  islandsTable,
  resourcesTable,
  surveysTable,
  eventsTable,
  companyAlertsTable,
  annualReportsTable,
} from "@workspace/db";
import type { User } from "@workspace/db";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  GetDashboardSummaryQueryParams,
  GetDashboardSummaryResponse,
  GetDashboardStatisticsQueryParams,
  GetDashboardStatisticsResponse,
  ListReportsResponse,
  GenerateReportBody,
} from "@workspace/api-zod";
import { requireAuth, requireRole, resolveReadScope } from "../middlewares/auth";
import { getSettings, isDeepseekConfigured, professionalFamilyOf } from "../lib/settings";
import { toAnnualReport } from "../lib/mappers";

const router: IRouter = Router();

const ROLE_LABELS: Record<string, string> = {
  superadmin: "Superadministración",
  coordinator: "Coordinación",
  prospector: "Prospección",
  department_head: "Jefatura de departamento",
  teacher: "Profesorado",
};

const SURVEY_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  open: "Abierta",
  closed: "Cerrada",
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

// Province-scoped tables (surveys, events, company alerts, annual reports) keep
// a nullable provinceId where null means "regional/autonómica" (visible to
// everyone). A province caller sees their province plus regional rows; a center
// caller — who has no province column to match — sees only regional rows.
function provinceColFilter(
  provinceCol: AnyPgColumn,
  scope: DashboardScope,
): SQL | undefined {
  if (scope.centerId != null) return isNull(provinceCol);
  if (scope.provinceId != null) {
    return or(eq(provinceCol, scope.provinceId), isNull(provinceCol));
  }
  return undefined;
}

// Resources have no provinceId; they hang off a center. A province caller sees
// resources whose center belongs to the province (plus center-less resources);
// a center caller sees only their center's resources.
function resourceScopeFilters(scope: DashboardScope): SQL[] {
  const filters: SQL[] = [isNull(resourcesTable.deletedAt)];
  if (scope.centerId != null) {
    filters.push(eq(resourcesTable.centerId, scope.centerId));
  } else if (scope.provinceId != null) {
    const centerIds = db
      .select({ id: centersTable.id })
      .from(centersTable)
      .where(
        and(
          isNull(centersTable.deletedAt),
          eq(centersTable.provinceId, scope.provinceId),
        ),
      );
    filters.push(
      or(inArray(resourcesTable.centerId, centerIds), isNull(resourcesTable.centerId))!,
    );
  }
  return filters;
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

  const [resourcesCount] = await db
    .select({ value: count() })
    .from(resourcesTable)
    .where(and(...resourceScopeFilters(scope)));

  const surveyFilters: SQL[] = [
    isNull(surveysTable.deletedAt),
    eq(surveysTable.status, "open"),
  ];
  const surveyScope = provinceColFilter(surveysTable.provinceId, scope);
  if (surveyScope) surveyFilters.push(surveyScope);
  const [activeSurveysCount] = await db
    .select({ value: count() })
    .from(surveysTable)
    .where(and(...surveyFilters));

  const eventFilters: SQL[] = [
    isNull(eventsTable.deletedAt),
    gte(eventsTable.startAt, new Date()),
  ];
  const eventScope = provinceColFilter(eventsTable.provinceId, scope);
  if (eventScope) eventFilters.push(eventScope);
  const [upcomingEventsCount] = await db
    .select({ value: count() })
    .from(eventsTable)
    .where(and(...eventFilters));

  const alertFilters: SQL[] = [isNull(companyAlertsTable.deletedAt)];
  const alertScope = provinceColFilter(companyAlertsTable.provinceId, scope);
  if (alertScope) alertFilters.push(alertScope);
  const [companyAlertsCount] = await db
    .select({ value: count() })
    .from(companyAlertsTable)
    .where(and(...alertFilters));

  res.json(
    GetDashboardSummaryResponse.parse({
      centers: centersCount?.value ?? 0,
      teachers: teachersCount?.value ?? 0,
      resources: resourcesCount?.value ?? 0,
      activeSurveys: activeSurveysCount?.value ?? 0,
      upcomingEvents: upcomingEventsCount?.value ?? 0,
      companyAlerts: companyAlertsCount?.value ?? 0,
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
        eventsByMonth: [],
        surveysByStatus: [],
      }),
    );
    return;
  }

  const resourceMonth = sql<string>`to_char(${resourcesTable.createdAt}, 'YYYY-MM')`;
  const resourcesByMonthRows = await db
    .select({ label: resourceMonth, value: count() })
    .from(resourcesTable)
    .where(and(...resourceScopeFilters(scope)))
    .groupBy(resourceMonth)
    .orderBy(resourceMonth);

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

  const eventMonth = sql<string>`to_char(coalesce(${eventsTable.startAt}, ${eventsTable.createdAt}), 'YYYY-MM')`;
  const eventFilters: SQL[] = [isNull(eventsTable.deletedAt)];
  const eventScope = provinceColFilter(eventsTable.provinceId, scope);
  if (eventScope) eventFilters.push(eventScope);
  const eventsByMonthRows = await db
    .select({ label: eventMonth, value: count() })
    .from(eventsTable)
    .where(and(...eventFilters))
    .groupBy(eventMonth)
    .orderBy(eventMonth);

  const surveyFilters: SQL[] = [isNull(surveysTable.deletedAt)];
  const surveyScope = provinceColFilter(surveysTable.provinceId, scope);
  if (surveyScope) surveyFilters.push(surveyScope);
  const surveysByStatusRows = await db
    .select({ status: surveysTable.status, value: count() })
    .from(surveysTable)
    .where(and(...surveyFilters))
    .groupBy(surveysTable.status);

  res.json(
    GetDashboardStatisticsResponse.parse({
      resourcesByMonth: resourcesByMonthRows.map((r) => ({
        label: r.label,
        value: r.value,
      })),
      usersByRole: usersByRoleRows.map((r) => ({
        label: ROLE_LABELS[r.role] ?? r.role,
        value: r.value,
      })),
      centersByIsland: centersByIslandRows.map((r) => ({
        label: r.label,
        value: r.value,
      })),
      eventsByMonth: eventsByMonthRows.map((r) => ({
        label: r.label,
        value: r.value,
      })),
      surveysByStatus: surveysByStatusRows.map((r) => ({
        label: SURVEY_STATUS_LABELS[r.status] ?? r.status,
        value: r.value,
      })),
    }),
  );
});

router.get("/reports", requireAuth, requireRole("superadmin", "coordinator"), async (req, res): Promise<void> => {
  const scope = resolveScope(req.user!);
  // Default-deny: roles with no read scope see no reports at all.
  if (scope.empty) {
    res.json(ListReportsResponse.parse([]));
    return;
  }
  const filters: SQL[] = [isNull(annualReportsTable.deletedAt)];
  if (scope.centerId != null) {
    filters.push(isNull(annualReportsTable.provinceId));
  } else if (scope.provinceId != null) {
    filters.push(
      or(
        eq(annualReportsTable.provinceId, scope.provinceId),
        isNull(annualReportsTable.provinceId),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(annualReportsTable)
    .where(and(...filters))
    .orderBy(desc(annualReportsTable.generatedAt));

  res.json(ListReportsResponse.parse(rows.map(toAnnualReport)));
});

// Compute a compact set of aggregate figures for a province scope, used to
// ground the AI-generated annual report in real platform data.
async function gatherReportStats(scope: DashboardScope) {
  const centerFilters: SQL[] = [isNull(centersTable.deletedAt)];
  if (scope.provinceId != null) {
    centerFilters.push(eq(centersTable.provinceId, scope.provinceId));
  }
  const [centers] = await db
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
  const [teachers] = await db
    .select({ value: count() })
    .from(usersTable)
    .where(and(...teacherFilters));

  const [resources] = await db
    .select({ value: count() })
    .from(resourcesTable)
    .where(and(...resourceScopeFilters(scope)));

  const surveyFilters: SQL[] = [isNull(surveysTable.deletedAt)];
  const surveyScope = provinceColFilter(surveysTable.provinceId, scope);
  if (surveyScope) surveyFilters.push(surveyScope);
  const [surveys] = await db
    .select({ value: count() })
    .from(surveysTable)
    .where(and(...surveyFilters));

  const eventFilters: SQL[] = [isNull(eventsTable.deletedAt)];
  const eventScope = provinceColFilter(eventsTable.provinceId, scope);
  if (eventScope) eventFilters.push(eventScope);
  const [events] = await db
    .select({ value: count() })
    .from(eventsTable)
    .where(and(...eventFilters));

  const alertFilters: SQL[] = [isNull(companyAlertsTable.deletedAt)];
  const alertScope = provinceColFilter(companyAlertsTable.provinceId, scope);
  if (alertScope) alertFilters.push(alertScope);
  const [alerts] = await db
    .select({ value: count() })
    .from(companyAlertsTable)
    .where(and(...alertFilters));

  return {
    centers: centers?.value ?? 0,
    teachers: teachers?.value ?? 0,
    resources: resources?.value ?? 0,
    surveys: surveys?.value ?? 0,
    events: events?.value ?? 0,
    alerts: alerts?.value ?? 0,
  };
}

router.post(
  "/reports",
  requireAuth,
  requireRole("superadmin", "coordinator"),
  async (req, res): Promise<void> => {
    const parsed = GenerateReportBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }

    const caller = req.user!;
    // Coordinators are locked to their own province; superadmin may target a
    // specific province or the whole region (provinceId null = autonómica).
    let provinceId: number | null;
    if (caller.role === "superadmin") {
      provinceId = parsed.data.provinceId ?? null;
    } else {
      // A coordinator with no province cannot generate any report.
      if (caller.provinceId == null) {
        res.status(403).json({
          message: "Tu cuenta no tiene una provincia asignada.",
        });
        return;
      }
      provinceId = caller.provinceId;
    }

    const settings = await getSettings();
    if (!isDeepseekConfigured(settings)) {
      res.status(503).json({
        message:
          "El generador de memorias está pendiente de configuración. Un administrador debe añadir la clave de DeepSeek.",
        code: "ai_not_configured",
      });
      return;
    }

    const scope: DashboardScope = {
      provinceId,
      centerId: null,
      empty: false,
    };
    const stats = await gatherReportStats(scope);
    const ambito = provinceId == null ? "autonómico (toda Canarias)" : "provincial";
    const family = professionalFamilyOf(settings);

    const systemPrompt =
      `Eres un técnico de coordinación de la familia profesional de ${family} ` +
      "(FP) en Canarias. Redactas memorias anuales institucionales en español, con tono formal, " +
      "estructura clara y secciones con encabezados.";
    const userPrompt =
      `Redacta la memoria anual del curso ${parsed.data.schoolYear} para el ámbito ${ambito} ` +
      `de la familia profesional de ${family} en Canarias. ` +
      "Utiliza los siguientes datos reales de la plataforma como base cuantitativa:\n" +
      `- Centros educativos: ${stats.centers}\n` +
      `- Profesorado: ${stats.teachers}\n` +
      `- Recursos didácticos compartidos: ${stats.resources}\n` +
      `- Encuestas y votaciones realizadas: ${stats.surveys}\n` +
      `- Eventos profesionales organizados: ${stats.events}\n` +
      `- Alertas/ofertas de empresas registradas: ${stats.alerts}\n\n` +
      "Incluye secciones de: introducción, recursos didácticos, participación y encuestas, " +
      "eventos y actividades, relación con el tejido empresarial, y conclusiones con propuestas " +
      "de mejora. No inventes cifras distintas a las proporcionadas.";

    let content: string;
    try {
      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.deepseekApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });
      if (!response.ok) {
        res.status(503).json({
          message: "El generador de memorias no está disponible ahora mismo",
        });
        return;
      }
      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      content = data.choices?.[0]?.message?.content ?? "";
    } catch {
      res.status(503).json({
        message: "El generador de memorias no está disponible ahora mismo",
      });
      return;
    }

    // Do not persist an empty/blank report: treat it as a generation failure.
    if (content.trim().length === 0) {
      res.status(503).json({
        message: "El generador de memorias no devolvió contenido. Inténtalo de nuevo.",
      });
      return;
    }

    const [created] = await db
      .insert(annualReportsTable)
      .values({
        schoolYear: parsed.data.schoolYear,
        provinceId,
        content,
        status: "draft",
        generatedById: caller.id,
      })
      .returning();

    res.status(201).json(toAnnualReport(created));
  },
);

export default router;
