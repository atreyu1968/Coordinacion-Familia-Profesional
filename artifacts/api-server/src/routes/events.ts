import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import {
  eq,
  and,
  or,
  isNull,
  gte,
  lte,
  desc,
  asc,
  inArray,
  type SQL,
} from "drizzle-orm";
import {
  db,
  eventsTable,
  eventAccreditationsTable,
  eventStaffTable,
  eventSpacesTable,
  eventRsvpsTable,
  calendarEntriesTable,
  centersTable,
  usersTable,
  meetingsTable,
  moduleMembershipsTable,
  type User,
} from "@workspace/db";
import {
  ListEventsQueryParams,
  ListEventsResponse,
  CreateEventBody,
  GetEventParams,
  DeleteEventParams,
  UpdateEventParams,
  UpdateEventBody,
  ListAccreditationsParams,
  ListAccreditationsResponse,
  CreateAccreditationParams,
  CreateAccreditationBody,
  CheckInAccreditationBody,
  ListEventStaffParams,
  ListEventStaffResponse,
  AssignEventStaffParams,
  AssignEventStaffBody,
  ListEventSpacesParams,
  ListEventSpacesResponse,
  CreateEventSpaceParams,
  CreateEventSpaceBody,
  RsvpEventParams,
  RsvpEventBody,
  IssueCertificatesParams,
  ListCalendarEventsQueryParams,
  ListCalendarEventsResponse,
  CreateCalendarEntryBody,
} from "@workspace/api-zod";
import {
  requireAuth,
  requireRole,
  resolveReadScope,
  type ReadScope,
} from "../middlewares/auth";
import {
  toEvent,
  toAccreditation,
  toEventSpace,
  toEventStaff,
  toCalendarEntry,
} from "../lib/mappers";
import { sendEmail, buildAccreditationEmail } from "../lib/email";
import { generateQrDataUrl, generateCertificatePdfBase64 } from "../lib/documents";

const router: IRouter = Router();

async function resolveEffectiveProvinceId(
  scope: ReadScope,
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

function canManageEvents(role: string | undefined): boolean {
  return role === "superadmin" || role === "coordinator";
}

// Whether the caller may see/interact with a province-scoped resource. Global
// resources (provinceId null) are visible to everyone; province-scoped ones
// only to superadmins and users within that province.
async function callerCanAccessProvince(
  scope: ReadScope,
  provinceId: number | null,
): Promise<boolean> {
  if (scope.kind === "global") return true;
  if (provinceId == null) return true;
  const effective = await resolveEffectiveProvinceId(scope);
  return effective != null && effective === provinceId;
}

// Resolve the province an event creator/calendar author may pin to: superadmin
// chooses freely (incl. global); coordinators are bound to their own province.
function resolveCreateProvinceId(
  caller: User,
  requested: number | null | undefined,
): { ok: true; provinceId: number | null } | { ok: false; message: string } {
  if (caller.role === "superadmin") {
    return { ok: true, provinceId: requested ?? null };
  }
  if (caller.provinceId == null) {
    return { ok: false, message: "No tienes una provincia asignada" };
  }
  return { ok: true, provinceId: caller.provinceId };
}

// Load an event by id (excluding soft-deleted) and enforce the caller's scope.
async function loadAccessibleEvent(
  id: number,
  caller: User,
): Promise<
  | { ok: true; event: typeof eventsTable.$inferSelect }
  | { ok: false; status: number; message: string }
> {
  const [event] = await db
    .select()
    .from(eventsTable)
    .where(and(eq(eventsTable.id, id), isNull(eventsTable.deletedAt)));
  if (!event) return { ok: false, status: 404, message: "Evento no encontrado" };
  if (
    !(await callerCanAccessProvince(resolveReadScope(caller), event.provinceId))
  ) {
    return { ok: false, status: 403, message: "Permiso denegado" };
  }
  return { ok: true, event };
}

// ---------------------------------------------------------------------------
// List events (province + global scoped)
// ---------------------------------------------------------------------------
router.get("/events", requireAuth, async (req, res): Promise<void> => {
  const query = ListEventsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }
  const caller = req.user!;
  const scope = resolveReadScope(caller);

  const filters: SQL[] = [isNull(eventsTable.deletedAt)];

  if (scope.kind !== "global") {
    const provinceId = await resolveEffectiveProvinceId(scope);
    const scopeMatch =
      provinceId != null
        ? or(
            isNull(eventsTable.provinceId),
            eq(eventsTable.provinceId, provinceId),
          )
        : isNull(eventsTable.provinceId);
    if (scopeMatch) filters.push(scopeMatch);
  }

  if (query.data.type) filters.push(eq(eventsTable.type, query.data.type));
  if (query.data.provinceId != null) {
    filters.push(eq(eventsTable.provinceId, query.data.provinceId));
  }

  const rows = await db
    .select()
    .from(eventsTable)
    .where(and(...filters))
    .orderBy(desc(eventsTable.startAt), desc(eventsTable.createdAt));

  res.json(ListEventsResponse.parse(rows.map(toEvent)));
});

// ---------------------------------------------------------------------------
// Create event (superadmin any province; coordinator pinned to own province)
// ---------------------------------------------------------------------------
router.post(
  "/events",
  requireAuth,
  requireRole("superadmin", "coordinator"),
  async (req, res): Promise<void> => {
    const parsed = CreateEventBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const caller = req.user!;
    const data = parsed.data;

    const province = resolveCreateProvinceId(caller, data.provinceId);
    if (!province.ok) {
      res.status(403).json({ message: province.message });
      return;
    }

    const [event] = await db
      .insert(eventsTable)
      .values({
        name: data.name,
        type: data.type,
        description: data.description ?? null,
        location: data.location ?? null,
        provinceId: province.provinceId,
        startAt: data.startAt ?? null,
        endAt: data.endAt ?? null,
        status: "planned",
        createdById: caller.id,
      })
      .returning();

    // Mirror the event onto the unified calendar so it shows up automatically.
    if (event!.startAt) {
      await db.insert(calendarEntriesTable).values({
        title: event!.name,
        type: "event",
        date: toDateString(event!.startAt),
        endDate: event!.endAt ? toDateString(event!.endAt) : null,
        provinceId: event!.provinceId,
        description: event!.description,
        eventId: event!.id,
        createdById: caller.id,
      });
    }

    res.status(201).json(toEvent(event!));
  },
);

function toDateString(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Get event detail (with counts and spaces)
// ---------------------------------------------------------------------------
router.get("/events/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ message: params.error.message });
    return;
  }
  const loaded = await loadAccessibleEvent(params.data.id, req.user!);
  if (!loaded.ok) {
    res.status(loaded.status).json({ message: loaded.message });
    return;
  }
  const event = loaded.event;

  const accreditations = await db
    .select({ checkedInAt: eventAccreditationsTable.checkedInAt })
    .from(eventAccreditationsTable)
    .where(eq(eventAccreditationsTable.eventId, event.id));
  const accredits = accreditations.length;
  const checkedInTotal = accreditations.filter((a) => a.checkedInAt).length;

  const spaces = await db
    .select()
    .from(eventSpacesTable)
    .where(eq(eventSpacesTable.eventId, event.id))
    .orderBy(asc(eventSpacesTable.id));

  res.json({
    ...toEvent(event),
    accreditationsCount: accredits,
    checkedInCount: checkedInTotal,
    spaces: spaces.map(toEventSpace),
  });
});

// ---------------------------------------------------------------------------
// Update event (managers within scope)
// ---------------------------------------------------------------------------
router.patch(
  "/events/:id",
  requireAuth,
  requireRole("superadmin", "coordinator"),
  async (req, res): Promise<void> => {
    const params = UpdateEventParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const parsed = UpdateEventBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const caller = req.user!;
    const loaded = await loadAccessibleEvent(params.data.id, caller);
    if (!loaded.ok) {
      res.status(loaded.status).json({ message: loaded.message });
      return;
    }
    if (
      caller.role === "coordinator" &&
      loaded.event.provinceId !== caller.provinceId
    ) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    const data = parsed.data;
    const updates: Partial<typeof eventsTable.$inferInsert> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.type !== undefined) updates.type = data.type;
    if (data.description !== undefined)
      updates.description = data.description ?? null;
    if (data.location !== undefined) updates.location = data.location ?? null;
    if (data.startAt !== undefined)
      updates.startAt = data.startAt ? new Date(data.startAt) : null;
    if (data.endAt !== undefined)
      updates.endAt = data.endAt ? new Date(data.endAt) : null;
    // Only superadmins may move an event to another province.
    if (data.provinceId !== undefined) {
      const province = resolveCreateProvinceId(caller, data.provinceId);
      if (!province.ok) {
        res.status(403).json({ message: province.message });
        return;
      }
      updates.provinceId = province.provinceId;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ message: "No hay cambios que guardar" });
      return;
    }

    const [event] = await db
      .update(eventsTable)
      .set(updates)
      .where(eq(eventsTable.id, loaded.event.id))
      .returning();

    // Keep the mirrored calendar entry in sync with the edited event.
    await db
      .delete(calendarEntriesTable)
      .where(eq(calendarEntriesTable.eventId, event!.id));
    if (event!.startAt) {
      await db.insert(calendarEntriesTable).values({
        title: event!.name,
        type: "event",
        date: toDateString(event!.startAt),
        endDate: event!.endAt ? toDateString(event!.endAt) : null,
        provinceId: event!.provinceId,
        description: event!.description,
        eventId: event!.id,
        createdById: caller.id,
      });
    }

    res.json(toEvent(event!));
  },
);

// ---------------------------------------------------------------------------
// Delete event (soft delete; managers within scope)
// ---------------------------------------------------------------------------
router.delete(
  "/events/:id",
  requireAuth,
  requireRole("superadmin", "coordinator"),
  async (req, res): Promise<void> => {
    const params = DeleteEventParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;
    const loaded = await loadAccessibleEvent(params.data.id, caller);
    if (!loaded.ok) {
      res.status(loaded.status).json({ message: loaded.message });
      return;
    }
    if (
      caller.role === "coordinator" &&
      loaded.event.provinceId !== caller.provinceId
    ) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    await db
      .update(eventsTable)
      .set({ deletedAt: new Date() })
      .where(eq(eventsTable.id, loaded.event.id));
    // Remove the mirrored calendar entry so the deleted event stops appearing
    // in the unified calendar and its exports.
    await db
      .delete(calendarEntriesTable)
      .where(eq(calendarEntriesTable.eventId, loaded.event.id));
    res.status(204).end();
  },
);

// ---------------------------------------------------------------------------
// Accreditations
// ---------------------------------------------------------------------------
router.get(
  "/events/:id/accreditations",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = ListAccreditationsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const loaded = await loadAccessibleEvent(params.data.id, req.user!);
    if (!loaded.ok) {
      res.status(loaded.status).json({ message: loaded.message });
      return;
    }
    const rows = await db
      .select()
      .from(eventAccreditationsTable)
      .where(eq(eventAccreditationsTable.eventId, loaded.event.id))
      .orderBy(asc(eventAccreditationsTable.id));
    res.json(ListAccreditationsResponse.parse(rows.map(toAccreditation)));
  },
);

router.post(
  "/events/:id/accreditations",
  requireAuth,
  requireRole("superadmin", "coordinator"),
  async (req, res): Promise<void> => {
    const params = CreateAccreditationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const body = CreateAccreditationBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ message: body.error.message });
      return;
    }
    const caller = req.user!;
    const loaded = await loadAccessibleEvent(params.data.id, caller);
    if (!loaded.ok) {
      res.status(loaded.status).json({ message: loaded.message });
      return;
    }
    if (
      caller.role === "coordinator" &&
      loaded.event.provinceId !== caller.provinceId
    ) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    const qrToken = randomBytes(24).toString("base64url");

    // Try to email the QR pass when an address is provided; degrade gracefully.
    let sentAt: Date | null = null;
    if (body.data.holderEmail) {
      const qrDataUrl = await generateQrDataUrl(qrToken);
      const { subject, html } = buildAccreditationEmail({
        eventName: loaded.event.name,
        holderName: body.data.holderName,
        role: body.data.role,
        location: loaded.event.location,
        startAt: loaded.event.startAt,
        qrToken,
        qrDataUrl,
      });
      const result = await sendEmail({
        to: body.data.holderEmail,
        subject,
        html,
      });
      if (result.sent) sentAt = new Date();
    }

    const [accreditation] = await db
      .insert(eventAccreditationsTable)
      .values({
        eventId: loaded.event.id,
        holderName: body.data.holderName,
        holderEmail: body.data.holderEmail ?? null,
        role: body.data.role,
        qrToken,
        sentAt,
      })
      .returning();

    res.status(201).json(toAccreditation(accreditation!));
  },
);

// Check-in: validate a QR token (consumed by the mobile scanner). Returns the
// accreditation and whether it had already been checked in.
router.post(
  "/accreditations/check-in",
  requireAuth,
  requireRole("superadmin", "coordinator", "department_head", "teacher"),
  async (req, res): Promise<void> => {
    const body = CheckInAccreditationBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ message: body.error.message });
      return;
    }
    const caller = req.user!;

    const [accreditation] = await db
      .select()
      .from(eventAccreditationsTable)
      .where(eq(eventAccreditationsTable.qrToken, body.data.qrToken));

    if (!accreditation) {
      res.status(404).json({ message: "Acreditación no válida" });
      return;
    }

    // Enforce that the scanner belongs to the event's province scope.
    const loaded = await loadAccessibleEvent(accreditation.eventId, caller);
    if (!loaded.ok) {
      res.status(loaded.status).json({ message: loaded.message });
      return;
    }

    if (accreditation.checkedInAt) {
      res.json({
        ok: true,
        alreadyCheckedIn: true,
        accreditation: toAccreditation(accreditation),
      });
      return;
    }

    const [updated] = await db
      .update(eventAccreditationsTable)
      .set({ checkedInAt: new Date() })
      .where(eq(eventAccreditationsTable.id, accreditation.id))
      .returning();

    res.json({
      ok: true,
      alreadyCheckedIn: false,
      accreditation: toAccreditation(updated!),
    });
  },
);

// ---------------------------------------------------------------------------
// Staff / volunteering
// ---------------------------------------------------------------------------
router.get(
  "/events/:id/staff",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = ListEventStaffParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const loaded = await loadAccessibleEvent(params.data.id, req.user!);
    if (!loaded.ok) {
      res.status(loaded.status).json({ message: loaded.message });
      return;
    }
    const rows = await db
      .select({
        id: eventStaffTable.id,
        eventId: eventStaffTable.eventId,
        userId: eventStaffTable.userId,
        userName: usersTable.name,
        task: eventStaffTable.task,
        role: eventStaffTable.role,
        shiftStart: eventStaffTable.shiftStart,
        shiftEnd: eventStaffTable.shiftEnd,
      })
      .from(eventStaffTable)
      .leftJoin(usersTable, eq(usersTable.id, eventStaffTable.userId))
      .where(eq(eventStaffTable.eventId, loaded.event.id))
      .orderBy(asc(eventStaffTable.id));
    res.json(ListEventStaffResponse.parse(rows.map(toEventStaff)));
  },
);

router.post(
  "/events/:id/staff",
  requireAuth,
  requireRole("superadmin", "coordinator"),
  async (req, res): Promise<void> => {
    const params = AssignEventStaffParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const body = AssignEventStaffBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ message: body.error.message });
      return;
    }
    const caller = req.user!;
    const loaded = await loadAccessibleEvent(params.data.id, caller);
    if (!loaded.ok) {
      res.status(loaded.status).json({ message: loaded.message });
      return;
    }
    if (
      caller.role === "coordinator" &&
      loaded.event.provinceId !== caller.provinceId
    ) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    // The assigned user must exist and be active.
    const [user] = await db
      .select({ id: usersTable.id, fullName: usersTable.name })
      .from(usersTable)
      .where(
        and(eq(usersTable.id, body.data.userId), isNull(usersTable.deletedAt)),
      );
    if (!user) {
      res.status(400).json({ message: "Usuario no encontrado" });
      return;
    }

    const [staff] = await db
      .insert(eventStaffTable)
      .values({
        eventId: loaded.event.id,
        userId: body.data.userId,
        task: body.data.task ?? null,
        role: body.data.role ?? null,
        shiftStart: body.data.shiftStart ?? null,
        shiftEnd: body.data.shiftEnd ?? null,
      })
      .returning();

    res.status(201).json(
      toEventStaff({ ...staff!, userName: user.fullName }),
    );
  },
);

// ---------------------------------------------------------------------------
// Spaces
// ---------------------------------------------------------------------------
router.get(
  "/events/:id/spaces",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = ListEventSpacesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const loaded = await loadAccessibleEvent(params.data.id, req.user!);
    if (!loaded.ok) {
      res.status(loaded.status).json({ message: loaded.message });
      return;
    }
    const rows = await db
      .select()
      .from(eventSpacesTable)
      .where(eq(eventSpacesTable.eventId, loaded.event.id))
      .orderBy(asc(eventSpacesTable.id));
    res.json(ListEventSpacesResponse.parse(rows.map(toEventSpace)));
  },
);

router.post(
  "/events/:id/spaces",
  requireAuth,
  requireRole("superadmin", "coordinator"),
  async (req, res): Promise<void> => {
    const params = CreateEventSpaceParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const body = CreateEventSpaceBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ message: body.error.message });
      return;
    }
    const caller = req.user!;
    const loaded = await loadAccessibleEvent(params.data.id, caller);
    if (!loaded.ok) {
      res.status(loaded.status).json({ message: loaded.message });
      return;
    }
    if (
      caller.role === "coordinator" &&
      loaded.event.provinceId !== caller.provinceId
    ) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    const [space] = await db
      .insert(eventSpacesTable)
      .values({
        eventId: loaded.event.id,
        name: body.data.name,
        capacity: body.data.capacity ?? null,
        resources: body.data.resources ?? [],
      })
      .returning();

    res.status(201).json(toEventSpace(space!));
  },
);

// ---------------------------------------------------------------------------
// RSVP (attendance confirmation) — upsert per user
// ---------------------------------------------------------------------------
router.post(
  "/events/:id/rsvp",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = RsvpEventParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const body = RsvpEventBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ message: body.error.message });
      return;
    }
    const caller = req.user!;
    const loaded = await loadAccessibleEvent(params.data.id, caller);
    if (!loaded.ok) {
      res.status(loaded.status).json({ message: loaded.message });
      return;
    }

    await db
      .insert(eventRsvpsTable)
      .values({
        eventId: loaded.event.id,
        userId: caller.id,
        status: body.data.status,
      })
      .onConflictDoUpdate({
        target: [eventRsvpsTable.eventId, eventRsvpsTable.userId],
        set: { status: body.data.status },
      });

    res.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Issue attendance certificates (PDF) to confirmed attendees
// ---------------------------------------------------------------------------
router.post(
  "/events/:id/certificates",
  requireAuth,
  requireRole("superadmin", "coordinator"),
  async (req, res): Promise<void> => {
    const params = IssueCertificatesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;
    const loaded = await loadAccessibleEvent(params.data.id, caller);
    if (!loaded.ok) {
      res.status(loaded.status).json({ message: loaded.message });
      return;
    }
    if (
      caller.role === "coordinator" &&
      loaded.event.provinceId !== caller.provinceId
    ) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    // Attendees = users who RSVP'd "yes".
    const attendees = await db
      .select({
        rsvpId: eventRsvpsTable.id,
        userId: eventRsvpsTable.userId,
        email: usersTable.email,
        fullName: usersTable.name,
      })
      .from(eventRsvpsTable)
      .leftJoin(usersTable, eq(usersTable.id, eventRsvpsTable.userId))
      .where(
        and(
          eq(eventRsvpsTable.eventId, loaded.event.id),
          eq(eventRsvpsTable.status, "yes"),
        ),
      );

    let issued = 0;
    for (const attendee of attendees) {
      if (!attendee.email || !attendee.fullName) continue;
      const pdfBase64 = await generateCertificatePdfBase64({
        attendeeName: attendee.fullName,
        eventName: loaded.event.name,
        location: loaded.event.location,
        date: loaded.event.startAt,
      });
      const result = await sendEmail({
        to: attendee.email,
        subject: `Certificado de asistencia · ${loaded.event.name}`,
        html: `<div style="font-family: Arial, sans-serif; max-width:560px;margin:0 auto;">
          <h2>Coordina ADG</h2>
          <p>Hola ${attendee.fullName}, adjuntamos tu certificado de asistencia a
          <strong>${loaded.event.name}</strong>.</p></div>`,
        attachments: [
          {
            filename: `certificado-${loaded.event.id}.pdf`,
            content: pdfBase64,
          },
        ],
      });
      if (result.sent) {
        await db
          .update(eventRsvpsTable)
          .set({ certificateIssuedAt: new Date() })
          .where(eq(eventRsvpsTable.id, attendee.rsvpId));
        issued += 1;
      }
    }

    res.json({ ok: true, issued });
  },
);

// ---------------------------------------------------------------------------
// Unified provincial calendar
// ---------------------------------------------------------------------------
router.get("/calendar", requireAuth, async (req, res): Promise<void> => {
  const query = ListCalendarEventsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }
  const caller = req.user!;
  const scope = resolveReadScope(caller);

  const filters: SQL[] = [];
  if (scope.kind !== "global") {
    const provinceId = await resolveEffectiveProvinceId(scope);
    const scopeMatch =
      provinceId != null
        ? or(
            isNull(calendarEntriesTable.provinceId),
            eq(calendarEntriesTable.provinceId, provinceId),
          )
        : isNull(calendarEntriesTable.provinceId);
    if (scopeMatch) filters.push(scopeMatch);
  }
  if (query.data.provinceId != null) {
    filters.push(eq(calendarEntriesTable.provinceId, query.data.provinceId));
  }
  if (query.data.from) {
    filters.push(gte(calendarEntriesTable.date, toDateString(query.data.from)));
  }
  if (query.data.to) {
    filters.push(lte(calendarEntriesTable.date, toDateString(query.data.to)));
  }

  const rows = await db
    .select()
    .from(calendarEntriesTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(calendarEntriesTable.date));

  // Mirror visible videoconferences (meetings) into the calendar so their
  // participants see them as events. Managers see all; others see only
  // meetings of modules they belong to. A province filter excludes meetings
  // (they are module-scoped, not province-scoped).
  const isManager = caller.role === "superadmin" || caller.role === "coordinator";
  let includeMeetings = query.data.provinceId == null;
  const meetingConds: SQL[] = [isNull(meetingsTable.deletedAt)];
  if (includeMeetings && !isManager) {
    const memberRows = await db
      .select({ moduleId: moduleMembershipsTable.moduleId })
      .from(moduleMembershipsTable)
      .where(
        and(
          eq(moduleMembershipsTable.userId, caller.id),
          isNull(moduleMembershipsTable.deletedAt),
        ),
      );
    const ids = memberRows.map((r) => r.moduleId);
    if (ids.length === 0) includeMeetings = false;
    else meetingConds.push(inArray(meetingsTable.moduleId, ids));
  }

  const meetingEntries = includeMeetings
    ? (
        await db
          .select({
            id: meetingsTable.id,
            title: meetingsTable.title,
            description: meetingsTable.description,
            roomName: meetingsTable.roomName,
            scheduledAt: meetingsTable.scheduledAt,
          })
          .from(meetingsTable)
          .where(and(...meetingConds))
      )
        .filter((m) => m.scheduledAt != null)
        .map((m) => ({
          id: -m.id,
          title: m.title,
          type: "meeting",
          date: toDateString(m.scheduledAt!),
          endDate: null,
          provinceId: null,
          description: m.description,
          meetingId: m.id,
          roomName: m.roomName,
        }))
        .filter((e) => {
          if (query.data.from && e.date < toDateString(query.data.from))
            return false;
          if (query.data.to && e.date > toDateString(query.data.to))
            return false;
          return true;
        })
    : [];

  const all = [...rows.map(toCalendarEntry), ...meetingEntries].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  res.json(ListCalendarEventsResponse.parse(all));
});

router.post(
  "/calendar",
  requireAuth,
  requireRole("superadmin", "coordinator"),
  async (req, res): Promise<void> => {
    const body = CreateCalendarEntryBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ message: body.error.message });
      return;
    }
    const caller = req.user!;
    const province = resolveCreateProvinceId(caller, body.data.provinceId);
    if (!province.ok) {
      res.status(403).json({ message: province.message });
      return;
    }

    const [entry] = await db
      .insert(calendarEntriesTable)
      .values({
        title: body.data.title,
        type: body.data.type ?? null,
        date: toDateString(body.data.date),
        endDate: body.data.endDate ? toDateString(body.data.endDate) : null,
        provinceId: province.provinceId,
        description: body.data.description ?? null,
        createdById: caller.id,
      })
      .returning();

    res.status(201).json(toCalendarEntry(entry!));
  },
);

export default router;
