import { Router, type IRouter } from "express";
import { eq, and, or, isNull, ilike, desc, type SQL } from "drizzle-orm";
import {
  db,
  companyAlertsTable,
  gdcanResourcesTable,
  usersTable,
  centersTable,
} from "@workspace/db";
import {
  ListCompanyAlertsQueryParams,
  ListCompanyAlertsResponse,
  CreateCompanyAlertBody,
  DeleteCompanyAlertParams,
  ListGdcanResourcesQueryParams,
  ListGdcanResourcesResponse,
  CreateGdcanResourceBody,
} from "@workspace/api-zod";
import {
  requireAuth,
  requireRole,
  resolveReadScope,
} from "../middlewares/auth";
import { toCompanyAlert, toGdcanResource } from "../lib/mappers";
import { sendEmail, buildCompanyAlertEmail } from "../lib/email";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Resolve the caller's effective province id. Province roles carry it directly;
// center roles derive it from their center. Returns null when it cannot be
// determined (e.g. superadmin or a user without province/center).
async function resolveEffectiveProvinceId(
  scope: ReturnType<typeof resolveReadScope>,
): Promise<number | null> {
  if (scope.kind === "province") return scope.provinceId;
  if (scope.kind === "center") {
    const [center] = await db
      .select({ provinceId: centersTable.provinceId })
      .from(centersTable)
      .where(eq(centersTable.id, scope.centerId));
    return center?.provinceId ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Company alerts (FCT/Dual prospecting)
// ---------------------------------------------------------------------------
router.get("/company-alerts", requireAuth, async (req, res): Promise<void> => {
  const query = ListCompanyAlertsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }
  const scope = resolveReadScope(req.user!);

  const filters: SQL[] = [isNull(companyAlertsTable.deletedAt)];
  if (query.data.search) {
    const term = `%${query.data.search}%`;
    const match = or(
      ilike(companyAlertsTable.companyName, term),
      ilike(companyAlertsTable.sector, term),
      ilike(companyAlertsTable.location, term),
    );
    if (match) filters.push(match);
  }

  // Visibility: superadmin sees all; everyone else sees alerts in their own
  // province plus global alerts (provinceId IS NULL). An explicit province
  // filter narrows within what the caller may already see.
  if (scope.kind !== "global") {
    const provinceId = await resolveEffectiveProvinceId(scope);
    const scopeMatch =
      provinceId != null
        ? or(
            isNull(companyAlertsTable.provinceId),
            eq(companyAlertsTable.provinceId, provinceId),
          )
        : isNull(companyAlertsTable.provinceId);
    if (scopeMatch) filters.push(scopeMatch);
  }
  if (query.data.provinceId != null) {
    filters.push(eq(companyAlertsTable.provinceId, query.data.provinceId));
  }

  const rows = await db
    .select({
      id: companyAlertsTable.id,
      companyName: companyAlertsTable.companyName,
      sector: companyAlertsTable.sector,
      location: companyAlertsTable.location,
      positions: companyAlertsTable.positions,
      description: companyAlertsTable.description,
      contact: companyAlertsTable.contact,
      provinceId: companyAlertsTable.provinceId,
      createdById: companyAlertsTable.createdById,
      createdByName: usersTable.name,
      createdAt: companyAlertsTable.createdAt,
    })
    .from(companyAlertsTable)
    .leftJoin(usersTable, eq(usersTable.id, companyAlertsTable.createdById))
    .where(and(...filters))
    .orderBy(desc(companyAlertsTable.createdAt));

  res.json(ListCompanyAlertsResponse.parse(rows.map(toCompanyAlert)));
});

router.post(
  "/company-alerts",
  requireAuth,
  requireRole("superadmin", "coordinator", "prospector"),
  async (req, res): Promise<void> => {
    const parsed = CreateCompanyAlertBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const caller = req.user!;

    // Non-superadmin publishers are province-bound: the alert is pinned to the
    // caller's own province regardless of what the body requested.
    let provinceId: number | null;
    if (caller.role === "superadmin") {
      provinceId = parsed.data.provinceId ?? null;
    } else {
      if (caller.provinceId == null) {
        res
          .status(403)
          .json({ message: "No tienes una provincia asignada" });
        return;
      }
      provinceId = caller.provinceId;
    }

    const [created] = await db
      .insert(companyAlertsTable)
      .values({
        companyName: parsed.data.companyName.trim(),
        sector: parsed.data.sector ?? null,
        location: parsed.data.location ?? null,
        positions: parsed.data.positions ?? null,
        description: parsed.data.description ?? null,
        contact: parsed.data.contact ?? null,
        provinceId,
        createdById: caller.id,
      })
      .returning();

    // Best-effort notification to FCT tutors (teachers) in the alert's
    // province. Degrades gracefully when Resend is not configured.
    void notifyFctTutors(created.id, provinceId, {
      companyName: created.companyName,
      sector: created.sector,
      location: created.location,
      positions: created.positions,
      description: created.description,
      contact: created.contact,
      publishedByName: caller.name,
    });

    res.status(201).json(
      toCompanyAlert({ ...created, createdByName: caller.name }),
    );
  },
);

router.delete(
  "/company-alerts/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = DeleteCompanyAlertParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;
    const [alert] = await db
      .select()
      .from(companyAlertsTable)
      .where(
        and(
          eq(companyAlertsTable.id, params.data.id),
          isNull(companyAlertsTable.deletedAt),
        ),
      );
    if (!alert) {
      res.status(404).json({ message: "Alerta no encontrada" });
      return;
    }

    // The creator may always remove their own alert. Superadmin may remove any.
    // A coordinator may remove alerts within their own province.
    const isOwner = alert.createdById === caller.id;
    const isManager =
      caller.role === "superadmin" ||
      (caller.role === "coordinator" &&
        caller.provinceId != null &&
        alert.provinceId === caller.provinceId);
    if (!isOwner && !isManager) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    await db
      .update(companyAlertsTable)
      .set({ deletedAt: new Date() })
      .where(eq(companyAlertsTable.id, params.data.id));
    res.status(204).end();
  },
);

async function notifyFctTutors(
  alertId: number,
  provinceId: number | null,
  payload: {
    companyName: string;
    sector: string | null;
    location: string | null;
    positions: number | null;
    description: string | null;
    contact: string | null;
    publishedByName: string | null;
  },
): Promise<void> {
  try {
    const teacherFilters: SQL[] = [
      eq(usersTable.role, "teacher"),
      eq(usersTable.status, "active"),
      isNull(usersTable.deletedAt),
    ];
    // Province-scoped alerts notify teachers whose center is in that province.
    if (provinceId != null) {
      teacherFilters.push(
        eq(centersTable.provinceId, provinceId),
      );
    }
    const recipients = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .leftJoin(centersTable, eq(centersTable.id, usersTable.centerId))
      .where(and(...teacherFilters));

    if (recipients.length === 0) return;
    const email = buildCompanyAlertEmail(payload);
    await Promise.allSettled(
      recipients.map((r) =>
        sendEmail({ to: r.email, subject: email.subject, html: email.html }),
      ),
    );
  } catch (err) {
    logger.error({ err, alertId }, "Company alert notification failed");
  }
}

// ---------------------------------------------------------------------------
// GDCAN resources (manuals, FAQs and links — global reference material)
// ---------------------------------------------------------------------------
router.get("/gdcan-resources", requireAuth, async (req, res): Promise<void> => {
  const query = ListGdcanResourcesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }
  const filters: SQL[] = [isNull(gdcanResourcesTable.deletedAt)];
  if (query.data.type) {
    filters.push(eq(gdcanResourcesTable.type, query.data.type));
  }
  const rows = await db
    .select()
    .from(gdcanResourcesTable)
    .where(and(...filters))
    .orderBy(desc(gdcanResourcesTable.createdAt));
  res.json(ListGdcanResourcesResponse.parse(rows.map(toGdcanResource)));
});

router.post(
  "/gdcan-resources",
  requireAuth,
  requireRole("superadmin", "coordinator", "prospector"),
  async (req, res): Promise<void> => {
    const parsed = CreateGdcanResourceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const [created] = await db
      .insert(gdcanResourcesTable)
      .values({
        title: parsed.data.title.trim(),
        type: parsed.data.type,
        url: parsed.data.url ?? null,
        content: parsed.data.content ?? null,
      })
      .returning();
    res.status(201).json(toGdcanResource(created));
  },
);

export default router;
