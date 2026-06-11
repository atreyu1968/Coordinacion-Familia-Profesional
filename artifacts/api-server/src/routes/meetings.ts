import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { eq, and, or, isNull, desc, inArray, type SQL } from "drizzle-orm";
import {
  db,
  meetingsTable,
  usersTable,
  modulesTable,
  moduleMembershipsTable,
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
  isModuleMember,
  hasScopeOver,
} from "../middlewares/auth";
import { toMeeting } from "../lib/mappers";
import { resolveJaasCreds, buildJaasUrl, publicJitsiUrl } from "../lib/jaas";
import { getSettings } from "../lib/settings";
import { notifyUsers } from "../lib/notify";

const router: IRouter = Router();

// Roles that may always create/manage meetings regardless of module. Module
// coordinators may additionally create meetings for their own module.
const CAN_CREATE = ["superadmin", "coordinator"];

// Active member user ids of a module (any role).
async function moduleMemberIds(moduleId: number): Promise<number[]> {
  const rows = await db
    .select({ userId: moduleMembershipsTable.userId })
    .from(moduleMembershipsTable)
    .where(
      and(
        eq(moduleMembershipsTable.moduleId, moduleId),
        isNull(moduleMembershipsTable.deletedAt),
      ),
    );
  return rows.map((r) => r.userId);
}

// Whether a global/provincial manager has authority over a module (or a legacy
// null-module meeting). Superadmin: always. Coordinator: their province (plus
// global modules with no center, and legacy null-module meetings, which the
// spec keeps visible to any superadmin/coordinator). Anyone else: false.
async function managerScopeOverModule(
  caller: User,
  moduleId: number | null,
): Promise<boolean> {
  if (caller.role === "superadmin") return true;
  if (caller.role !== "coordinator") return false;
  if (moduleId == null) return true;
  const [module] = await db
    .select({ centerId: modulesTable.centerId })
    .from(modulesTable)
    .where(eq(modulesTable.id, moduleId));
  if (!module) return false;
  if (module.centerId == null) return true;
  const [center] = await db
    .select({ provinceId: centersTable.provinceId })
    .from(centersTable)
    .where(eq(centersTable.id, module.centerId));
  return hasScopeOver(caller, {
    provinceId: center?.provinceId ?? null,
    centerId: module.centerId,
  });
}

// Whether the caller may see/join a given meeting: a manager in scope of the
// meeting's module, or (for module meetings) an enrolled member of the module.
// Legacy null-module meetings are visible only to superadmin/coordinator.
async function canAccessMeeting(
  caller: User,
  meeting: { moduleId: number | null; hostId: number },
): Promise<boolean> {
  if (meeting.hostId === caller.id) return true;
  if (await managerScopeOverModule(caller, meeting.moduleId)) return true;
  if (meeting.moduleId == null) return false;
  return isModuleMember(caller.id, meeting.moduleId);
}

// ---------------------------------------------------------------------------
// List meeting rooms: any authenticated user may see and join them.
// ---------------------------------------------------------------------------
router.get("/meetings", requireAuth, async (req, res): Promise<void> => {
  const caller = req.user!;

  const conditions: SQL[] = [isNull(meetingsTable.deletedAt)];
  if (caller.role !== "superadmin") {
    // Non-superadmins only see meetings they host plus meetings of the modules
    // they can reach: enrolled modules for everyone, and (for provincial
    // coordinators) every module in their province or with no center, plus the
    // legacy null-module meetings the spec keeps visible to coordinators.
    const memberRows = await db
      .select({ moduleId: moduleMembershipsTable.moduleId })
      .from(moduleMembershipsTable)
      .where(
        and(
          eq(moduleMembershipsTable.userId, caller.id),
          isNull(moduleMembershipsTable.deletedAt),
        ),
      );
    const moduleIds = new Set(memberRows.map((r) => r.moduleId));
    let includeLegacy = false;

    if (caller.role === "coordinator" && caller.provinceId != null) {
      const scoped = await db
        .select({ id: modulesTable.id })
        .from(modulesTable)
        .leftJoin(centersTable, eq(centersTable.id, modulesTable.centerId))
        .where(
          and(
            isNull(modulesTable.deletedAt),
            or(
              isNull(modulesTable.centerId),
              eq(centersTable.provinceId, caller.provinceId),
            ),
          ),
        );
      scoped.forEach((m) => moduleIds.add(m.id));
      includeLegacy = true;
    }

    const visibility: SQL[] = [eq(meetingsTable.hostId, caller.id)];
    if (moduleIds.size > 0) {
      visibility.push(inArray(meetingsTable.moduleId, [...moduleIds]));
    }
    if (includeLegacy) {
      visibility.push(isNull(meetingsTable.moduleId));
    }
    conditions.push(or(...visibility)!);
  }

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
      scheduledAt: meetingsTable.scheduledAt,
      createdAt: meetingsTable.createdAt,
      deletedAt: meetingsTable.deletedAt,
    })
    .from(meetingsTable)
    .leftJoin(usersTable, eq(usersTable.id, meetingsTable.hostId))
    .leftJoin(modulesTable, eq(modulesTable.id, meetingsTable.moduleId))
    .where(and(...conditions))
    .orderBy(desc(meetingsTable.createdAt));

  res.json(ListMeetingsResponse.parse(rows.map(toMeeting)));
});

// ---------------------------------------------------------------------------
// Create a meeting room: coordinator or superadmin only. The room name is a
// random, unguessable slug used to build the public meet.jit.si URL.
// ---------------------------------------------------------------------------
router.post("/meetings", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateMeetingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  const caller = req.user!;
  const data = parsed.data;
  const moduleId = data.moduleId ?? null;

  // Validate the module (if any) and authorize: managers may create meetings
  // within their scope; module coordinators may create meetings for their own
  // module. Legacy null-module meetings are reserved for superadmin/coordinator.
  let moduleName: string | null = null;
  if (moduleId == null) {
    if (!(await managerScopeOverModule(caller, null))) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }
  } else {
    const [module] = await db
      .select()
      .from(modulesTable)
      .where(
        and(eq(modulesTable.id, moduleId), isNull(modulesTable.deletedAt)),
      );
    if (!module) {
      res.status(404).json({ message: "Módulo no encontrado" });
      return;
    }
    moduleName = module.name;
    const allowed =
      (await managerScopeOverModule(caller, moduleId)) ||
      (await isModuleCoordinator(caller.id, moduleId));
    if (!allowed) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }
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
      scheduledAt: data.scheduledAt ?? null,
    })
    .returning();

  // Invite (notify) the module's members of the new videoconference.
  if (moduleId != null) {
    const memberIds = (await moduleMemberIds(moduleId)).filter(
      (id) => id !== caller.id,
    );
    await notifyUsers(memberIds, {
      title: `Nueva videoconferencia: ${row!.title}`,
      body: moduleName
        ? `Se ha programado una videoconferencia en el módulo ${moduleName}.`
        : null,
      type: "meeting",
    });
  }

  res
    .status(201)
    .json(toMeeting({ ...row!, hostName: caller.name, moduleName }));
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
  // as the listing so a leaked/guessed room name can't bypass module scoping.
  // Ad-hoc rooms (e.g. 1:1 chat calls) have no meeting row and stay open to any
  // authenticated caller who already holds the room name.
  const [meeting] = await db
    .select({
      moduleId: meetingsTable.moduleId,
      hostId: meetingsTable.hostId,
    })
    .from(meetingsTable)
    .where(
      and(eq(meetingsTable.roomName, room), isNull(meetingsTable.deletedAt)),
    );
  if (meeting && !(await canAccessMeeting(caller, meeting))) {
    res.status(403).json({ message: "Permiso denegado" });
    return;
  }

  // Managers in scope, the host, and the module coordinator join as moderators
  // (signed JWT → no login); everyone else joins the same room as a guest,
  // which keeps usage in the free tier.
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
// Delete a meeting room (soft delete): only its host or the superadmin.
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
  // The host may always delete their own room; managers may delete any meeting
  // within their scope (superadmin globally, coordinator in their province).
  const allowed =
    existing.hostId === caller.id ||
    (await managerScopeOverModule(caller, existing.moduleId));
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
