import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { eq, and, isNull, desc } from "drizzle-orm";
import {
  db,
  meetingsTable,
  usersTable,
  modulesTable,
  centersTable,
  type User,
} from "@workspace/db";
import {
  ListMeetingsResponse,
  CreateMeetingBody,
  DeleteMeetingParams,
  GetMeetingTokenBody,
  GetMeetingTokenResponse,
} from "@workspace/api-zod";
import {
  requireAuth,
  isModuleCoordinator,
  hasScopeOver,
} from "../middlewares/auth";
import {
  getViewerContext,
  isInAudience,
  validateAudience,
  canManageAudience,
  canCreateFormsSurveys,
  resolveAudienceUserIds,
  type ViewerContext,
} from "../lib/audience";
import { toMeeting } from "../lib/mappers";
import { resolveJaasCreds, buildJaasUrl, publicJitsiUrl } from "../lib/jaas";
import { getSettings } from "../lib/settings";
import { notifyUsers } from "../lib/notify";

const router: IRouter = Router();

// Roles that always join meetings as moderators (signed JWT → no login). Module
// coordinators also moderate meetings targeted at their own module.
const CAN_CREATE = ["superadmin", "coordinator"];

// A short human-readable label for a meeting's audience, shown on cards. We keep
// it lightweight (no extra name lookups) beyond the already-joined module name.
function audienceLabel(
  type: string,
  ids: number[] | null | undefined,
  moduleName?: string | null,
): string {
  const n = (ids ?? []).length;
  switch (type) {
    case "all":
      return "Todos los usuarios";
    case "module":
      return moduleName ?? (n > 1 ? `${n} módulos` : "Módulo");
    case "province":
      return n > 1 ? `${n} provincias` : "Provincia";
    case "island":
      return n > 1 ? `${n} islas` : "Isla";
    case "center":
      return n > 1 ? `${n} centros` : "Centro";
    case "users":
      return n > 1 ? `${n} usuarios` : "1 usuario";
    case "department_head":
      return "Jefes de departamento";
    case "coordinator":
      return "Coordinadores provinciales";
    default:
      return "Destinatarios";
  }
}

// Whether a manager (superadmin / provincial coordinator / department head) has
// administrative scope over a module via its center, mirroring academics.ts.
async function managerScopeOverModule(
  caller: User,
  moduleId: number,
): Promise<boolean> {
  if (caller.role === "superadmin") return true;
  const [module] = await db
    .select({ centerId: modulesTable.centerId })
    .from(modulesTable)
    .where(eq(modulesTable.id, moduleId));
  if (!module) return false;
  if (module.centerId == null) return caller.role === "coordinator";
  const [center] = await db
    .select({ provinceId: centersTable.provinceId })
    .from(centersTable)
    .where(eq(centersTable.id, module.centerId));
  return hasScopeOver(caller, {
    provinceId: center?.provinceId ?? null,
    centerId: module.centerId,
  });
}

// Whether `caller` may see / join a registered meeting. Meetings are primarily
// scoped by module membership: a module-bound meeting is visible to the host,
// the module's members, and managers with scope over the module. Non-module
// meetings honor specific audience targeting (province/island/center/users/
// role); the catch-all "all" audience (also the column default on legacy rows)
// is NOT a public grant — such meetings are visible only to the host and
// scoped managers, so leaked/guessed rooms can't be joined by outsiders.
async function callerCanSeeMeeting(
  caller: User,
  ctx: ViewerContext,
  row: {
    hostId: number;
    moduleId: number | null;
    audienceType: string;
    audienceIds: number[] | null;
  },
): Promise<boolean> {
  if (row.hostId === caller.id) return true;
  if (caller.role === "superadmin") return true;
  if (row.moduleId != null) {
    if (ctx.moduleIds.includes(row.moduleId)) return true;
    return managerScopeOverModule(caller, row.moduleId);
  }
  if (
    row.audienceType !== "all" &&
    isInAudience(row.audienceType, row.audienceIds, ctx)
  ) {
    return true;
  }
  return canManageAudience(caller, row.audienceType, row.audienceIds);
}

// ---------------------------------------------------------------------------
// List meeting rooms: a user sees a meeting if they host it, belong to its
// module (module meetings), fall within a specific targeted audience, or have
// management authority over it (superadmin always; provincial coordinators /
// department heads within their scope).
// ---------------------------------------------------------------------------
router.get("/meetings", requireAuth, async (req, res): Promise<void> => {
  const caller = req.user!;

  const rows = await db
    .select({
      id: meetingsTable.id,
      title: meetingsTable.title,
      description: meetingsTable.description,
      roomName: meetingsTable.roomName,
      hostId: meetingsTable.hostId,
      hostName: usersTable.name,
      moduleId: meetingsTable.moduleId,
      moduleName: modulesTable.name,
      audienceType: meetingsTable.audienceType,
      audienceIds: meetingsTable.audienceIds,
      scheduledAt: meetingsTable.scheduledAt,
      createdAt: meetingsTable.createdAt,
      deletedAt: meetingsTable.deletedAt,
    })
    .from(meetingsTable)
    .leftJoin(usersTable, eq(usersTable.id, meetingsTable.hostId))
    .leftJoin(modulesTable, eq(modulesTable.id, meetingsTable.moduleId))
    .where(isNull(meetingsTable.deletedAt))
    .orderBy(desc(meetingsTable.createdAt));

  const ctx = await getViewerContext(caller);
  const visible = [];
  for (const row of rows) {
    if (await callerCanSeeMeeting(caller, ctx, row)) visible.push(row);
  }

  res.json(
    ListMeetingsResponse.parse(
      visible.map((r) =>
        toMeeting({
          ...r,
          audienceLabel: audienceLabel(r.audienceType, r.audienceIds, r.moduleName),
        }),
      ),
    ),
  );
});

// ---------------------------------------------------------------------------
// Create a meeting room. Anyone who may create forms/surveys may create a
// meeting (superadmin, provincial coordinators, module coordinators). The
// audience is validated/normalized against the caller's authority. The room
// name is a random, unguessable slug used to build the join URL.
// ---------------------------------------------------------------------------
router.post("/meetings", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateMeetingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  const caller = req.user!;
  const data = parsed.data;

  if (!(await canCreateFormsSurveys(caller))) {
    res.status(403).json({ message: "Permiso denegado" });
    return;
  }

  const audience = await validateAudience(
    caller,
    data.audienceType,
    data.audienceIds,
  );
  if (!audience.ok) {
    res.status(400).json({ message: audience.message });
    return;
  }

  // When the audience is a single module, mirror it on `moduleId` so module
  // coordinators get moderator rights and the card can show the module name.
  let moduleId: number | null = null;
  let moduleName: string | null = null;
  if (audience.audienceType === "module" && audience.audienceIds.length === 1) {
    moduleId = audience.audienceIds[0]!;
    const [module] = await db
      .select({ name: modulesTable.name })
      .from(modulesTable)
      .where(and(eq(modulesTable.id, moduleId), isNull(modulesTable.deletedAt)));
    if (!module) {
      res.status(404).json({ message: "Módulo no encontrado" });
      return;
    }
    moduleName = module.name;
  }

  const roomName = `coordinaadg-${randomUUID()}`;

  const [row] = await db
    .insert(meetingsTable)
    .values({
      title: data.title.trim(),
      description: data.description?.trim() || null,
      roomName,
      hostId: caller.id,
      moduleId,
      audienceType: audience.audienceType,
      audienceIds: audience.audienceIds,
      scheduledAt: data.scheduledAt ?? null,
    })
    .returning();

  // Invite (notify) every user in the audience of the new videoconference.
  const recipientIds = (
    await resolveAudienceUserIds(audience.audienceType, audience.audienceIds)
  ).filter((id) => id !== caller.id);
  if (recipientIds.length > 0) {
    await notifyUsers(recipientIds, {
      title: `Nueva videoconferencia: ${row!.title}`,
      body: moduleName
        ? `Se ha programado una videoconferencia en el módulo ${moduleName}.`
        : "Se ha programado una nueva videoconferencia.",
      type: "meeting",
    });
  }

  res.status(201).json(
    toMeeting({
      ...row!,
      hostName: caller.name,
      moduleName,
      audienceLabel: audienceLabel(
        audience.audienceType,
        audience.audienceIds,
        moduleName,
      ),
    }),
  );
});

// ---------------------------------------------------------------------------
// Issue a ready-to-join meeting URL for a room. With JaaS (8x8) configured —
// either in the superadmin control panel or via env vars — coordinators/admins
// join as moderators with a signed JWT (no login screen) and everyone else
// joins the same room as a guest, which keeps usage within the free tier.
// Without it we fall back to the public meet.jit.si server (which limits
// embedded calls). Keyed by room name so ad-hoc chat calls are covered too.
// ---------------------------------------------------------------------------
router.post("/meetings/token", requireAuth, async (req, res): Promise<void> => {
  const parsed = GetMeetingTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  const room = parsed.data.room.trim();
  if (!room) {
    res.status(400).json({ message: "Sala no válida" });
    return;
  }
  const audioOnly = parsed.data.audioOnly ?? false;
  const caller = req.user!;

  // If the room belongs to a registered meeting, enforce the same access policy
  // as the listing so a leaked/guessed room name can't bypass audience scoping.
  // Ad-hoc rooms (e.g. 1:1 chat calls) have no meeting row and stay open to any
  // authenticated caller who already holds the room name.
  const [meeting] = await db
    .select({
      moduleId: meetingsTable.moduleId,
      hostId: meetingsTable.hostId,
      audienceType: meetingsTable.audienceType,
      audienceIds: meetingsTable.audienceIds,
    })
    .from(meetingsTable)
    .where(
      and(eq(meetingsTable.roomName, room), isNull(meetingsTable.deletedAt)),
    );
  if (meeting) {
    const ctx = await getViewerContext(caller);
    if (!(await callerCanSeeMeeting(caller, ctx, meeting))) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }
  }

  // Superadmin/coordinators, the host, and (for module meetings) the module
  // coordinator join as moderators (signed JWT → no login); everyone else joins
  // the same room as a guest, which keeps usage in the free tier.
  let moderator = CAN_CREATE.includes(caller.role);
  if (meeting && !moderator) {
    moderator =
      meeting.hostId === caller.id ||
      (meeting.moduleId != null &&
        (await isModuleCoordinator(caller.id, meeting.moduleId)));
  }

  const creds = resolveJaasCreds(await getSettings());
  if (creds) {
    const url = buildJaasUrl({
      creds,
      room,
      user: { id: caller.id, name: caller.name, email: caller.email },
      moderator,
      audioOnly,
    });
    if (url) {
      res.json(GetMeetingTokenResponse.parse({ provider: "jaas", url }));
      return;
    }
  }

  res.json(
    GetMeetingTokenResponse.parse({
      provider: "public",
      url: publicJitsiUrl(room, audioOnly),
    }),
  );
});

// ---------------------------------------------------------------------------
// Delete a meeting room (soft delete): the host always may; otherwise a manager
// with authority over the meeting's audience (superadmin globally, provincial
// coordinator within their province).
// ---------------------------------------------------------------------------
router.delete("/meetings/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteMeetingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ message: params.error.message });
    return;
  }
  const caller = req.user!;

  const [existing] = await db
    .select()
    .from(meetingsTable)
    .where(
      and(eq(meetingsTable.id, params.data.id), isNull(meetingsTable.deletedAt)),
    );
  if (!existing) {
    res.status(404).json({ message: "Reunión no encontrada" });
    return;
  }
  const allowed =
    existing.hostId === caller.id ||
    (await canManageAudience(
      caller,
      existing.audienceType,
      existing.audienceIds,
    ));
  if (!allowed) {
    res.status(403).json({ message: "Permiso denegado" });
    return;
  }

  await db
    .update(meetingsTable)
    .set({ deletedAt: new Date() })
    .where(eq(meetingsTable.id, existing.id));

  res.status(204).send();
});

export default router;
