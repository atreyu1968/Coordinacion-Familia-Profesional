import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { eq, and, isNull, desc } from "drizzle-orm";
import { db, meetingsTable, usersTable } from "@workspace/db";
import {
  ListMeetingsResponse,
  CreateMeetingBody,
  DeleteMeetingParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { toMeeting } from "../lib/mappers";

const router: IRouter = Router();

// Only these roles may open (create/invite to) a meeting room.
const CAN_CREATE = ["superadmin", "coordinator"];

// ---------------------------------------------------------------------------
// List meeting rooms: any authenticated user may see and join them.
// ---------------------------------------------------------------------------
router.get("/meetings", requireAuth, async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: meetingsTable.id,
      title: meetingsTable.title,
      description: meetingsTable.description,
      roomName: meetingsTable.roomName,
      hostId: meetingsTable.hostId,
      hostName: usersTable.name,
      scheduledAt: meetingsTable.scheduledAt,
      createdAt: meetingsTable.createdAt,
      deletedAt: meetingsTable.deletedAt,
    })
    .from(meetingsTable)
    .leftJoin(usersTable, eq(usersTable.id, meetingsTable.hostId))
    .where(isNull(meetingsTable.deletedAt))
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
  if (!CAN_CREATE.includes(caller.role)) {
    res.status(403).json({ message: "Permiso denegado" });
    return;
  }
  const data = parsed.data;
  const roomName = `coordinaadg-${randomUUID()}`;

  const [row] = await db
    .insert(meetingsTable)
    .values({
      title: data.title.trim(),
      description: data.description?.trim() || null,
      roomName,
      hostId: caller.id,
      scheduledAt: data.scheduledAt ?? null,
    })
    .returning();

  res.status(201).json(toMeeting({ ...row!, hostName: caller.name }));
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
  if (caller.role !== "superadmin" && existing.hostId !== caller.id) {
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
