import { Router, type Request, type Response } from "express";
import { and, eq, inArray, isNull, or, sql, asc } from "drizzle-orm";
import {
  db, collaborativeSpacesTable as spaces, collaborativeSpaceMembersTable as members,
  usersTable as users, centersTable as centers,
} from "@workspace/db";
import {
  CreateCollaborativeSpaceBody, UpdateCollaborativeSpaceBody, AddCollaborativeSpaceMembersBody,
  ListCollaborativeSpacesResponse, GetCollaborativeSpaceResponse, GetCollaborativeSpaceCandidatesResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { getSettings, getActiveFamily } from "../lib/settings";
import {
  isNextcloudConfigured, resolveNextcloudConfig, resolveNextcloudUrl,
  provisionIndependentSpace, revokeIndependentSpaceMember,
} from "../lib/nextcloud";
import { createIndependentSpaceTicket } from "../lib/oidc";
import { getAppBaseUrl } from "../lib/appUrl";
import { logger } from "../lib/logger";
import { notifyUsers } from "../lib/notify";

const router = Router();
// Run only after membership commits: notification failures must never roll it back.
async function notifyNewMembers(userIds: number[], space: { id: number; name: string }) {
  if (!userIds.length) return;
  try {
    await notifyUsers(userIds, {
      title: "Te han añadido a un espacio colaborativo",
      body: `Ya formas parte de «${space.name}». Accede desde Espacio colaborativo.`,
      type: "collaborative_space",
      data: { spaceId: space.id },
    });
  } catch (error) {
    logger.error({ err: error, spaceId: space.id }, "Unable to notify new collaborative space members");
  }
}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class SpaceError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const handle = (action: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
  try { await action(req, res); }
  catch (error) {
    if (error instanceof SpaceError) { res.status(error.status).json({ message: error.message }); return; }
    logger.error({ err: error }, "Independent collaborative space operation failed");
    res.status(500).json({ message: "No se pudo completar la operación del espacio" });
  }
};
const idOf = (value: unknown) => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) throw new SpaceError(400, "Identificador inválido");
  return id;
};
const lock = (tx: Tx, id: number) => tx.execute(sql`SELECT pg_advisory_xact_lock(29001, ${id})`);
async function load(tx: Tx | typeof db, id: number) {
  const [space] = await tx.select().from(spaces).where(eq(spaces.id, id));
  if (!space) throw new SpaceError(404, "Espacio no encontrado");
  return space;
}
async function member(tx: Tx | typeof db, spaceId: number, userId: number) {
  const [row] = await tx.select().from(members).where(and(eq(members.spaceId, spaceId), eq(members.userId, userId)));
  return row;
}
const fields = {
  id: spaces.id, name: spaces.name, description: spaces.description, createdAt: spaces.createdAt,
  memberCount: sql<number>`(SELECT count(*)::integer FROM ${members} WHERE ${members.spaceId} = ${spaces.id})`,
};
async function info(tx: Tx | typeof db, id: number, canManage = true) {
  const [space] = await tx.select(fields).from(spaces).where(eq(spaces.id, id));
  if (!space) throw new SpaceError(404, "Espacio no encontrado");
  return { ...space, canManage };
}
const personFields = {
  id: users.id, name: users.name, email: users.email, role: users.role, status: users.status,
  centerId: users.centerId, centerName: centers.name,
};

async function resolveSelection(tx: Tx, input: { userIds?: number[]; centerIds?: number[] }) {
  const selectedUsers = [...new Set(input.userIds ?? [])];
  const selectedCenters = [...new Set(input.centerIds ?? [])];
  if (selectedCenters.length) {
    const family = await getActiveFamily();
    const valid = await tx.select({ id: centers.id }).from(centers).where(and(
      inArray(centers.id, selectedCenters), isNull(centers.deletedAt),
      sql`${centers.families} @> ${JSON.stringify([family])}::jsonb`,
    ));
    if (valid.length !== selectedCenters.length) throw new SpaceError(400, "Hay centros que ya no están disponibles");
  }
  if (selectedUsers.length) {
    const valid = await tx.select({ id: users.id }).from(users).where(and(
      inArray(users.id, selectedUsers), eq(users.status, "active"), isNull(users.deletedAt),
    ));
    if (valid.length !== selectedUsers.length) throw new SpaceError(400, "Hay usuarios que ya no están activos o disponibles");
  }
  if (!selectedUsers.length && !selectedCenters.length) return [];
  const rows = await tx.select({ id: users.id }).from(users).where(and(
    eq(users.status, "active"), isNull(users.deletedAt),
    or(selectedUsers.length ? inArray(users.id, selectedUsers) : undefined,
      selectedCenters.length ? inArray(users.centerId, selectedCenters) : undefined),
  ));
  return rows.map((row) => row.id);
}

router.get("/collab/candidates", requireAuth, requireRole("superadmin"), handle(async (_req, res) => {
  const family = await getActiveFamily();
  const people = await db.select(personFields).from(users).leftJoin(centers, eq(users.centerId, centers.id))
    .where(and(eq(users.status, "active"), isNull(users.deletedAt))).orderBy(asc(users.name), asc(users.id));
  const availableCenters = await db.select({ id: centers.id, name: centers.name }).from(centers)
    .where(and(isNull(centers.deletedAt), sql`${centers.families} @> ${JSON.stringify([family])}::jsonb`))
    .orderBy(asc(centers.name), asc(centers.id));
  res.json(GetCollaborativeSpaceCandidatesResponse.parse({ users: people, centers: availableCenters }));
}));

router.get("/collab/spaces", requireAuth, handle(async (req, res) => {
  const admin = req.user!.role === "superadmin";
  const rows = await db.select(fields).from(spaces).where(admin ? undefined :
    sql`EXISTS (SELECT 1 FROM ${members} WHERE ${members.spaceId} = ${spaces.id} AND ${members.userId} = ${req.user!.id})`)
    .orderBy(asc(spaces.name), asc(spaces.id));
  res.json(ListCollaborativeSpacesResponse.parse(rows.map((row) => ({ ...row, canManage: admin }))));
}));

router.post("/collab/spaces", requireAuth, requireRole("superadmin"), handle(async (req, res) => {
  const parsed = CreateCollaborativeSpaceBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.name.trim()) throw new SpaceError(400, "Indica un nombre y una selección válidos");
  const result = await db.transaction(async (tx) => {
    const userIds = await resolveSelection(tx, parsed.data);
    const [space] = await tx.insert(spaces).values({
      name: parsed.data.name.trim(), description: parsed.data.description?.trim() ?? "", createdBy: req.user!.id,
    }).returning();
    if (userIds.length) await tx.insert(members).values(userIds.map((userId) => ({ spaceId: space!.id, userId })));
    return { space: await info(tx, space!.id), addedUserIds: userIds };
  });
  await notifyNewMembers(result.addedUserIds, result.space);
  res.status(201).json(result.space);
}));

router.get("/collab/spaces/:id", requireAuth, requireRole("superadmin"), handle(async (req, res) => {
  const id = idOf(req.params["id"]);
  const space = await info(db, id);
  const people = await db.select(personFields).from(members).innerJoin(users, eq(users.id, members.userId))
    .leftJoin(centers, eq(users.centerId, centers.id)).where(eq(members.spaceId, id))
    .orderBy(asc(users.name), asc(users.id));
  res.json(GetCollaborativeSpaceResponse.parse({ ...space, members: people }));
}));

router.patch("/collab/spaces/:id", requireAuth, requireRole("superadmin"), handle(async (req, res) => {
  const id = idOf(req.params["id"]);
  const parsed = UpdateCollaborativeSpaceBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.name.trim()) throw new SpaceError(400, "Indica un nombre y una descripción válidos");
  const result = await db.transaction(async (tx) => {
    await lock(tx, id); await load(tx, id);
    await tx.update(spaces).set({ name: parsed.data.name.trim(), ...(parsed.data.description !== undefined ? { description: parsed.data.description.trim() } : {}) })
      .where(eq(spaces.id, id));
    return info(tx, id);
  });
  res.json(result);
}));

router.post("/collab/spaces/:id/members", requireAuth, requireRole("superadmin"), handle(async (req, res) => {
  const id = idOf(req.params["id"]);
  const parsed = AddCollaborativeSpaceMembersBody.safeParse(req.body);
  if (!parsed.success) throw new SpaceError(400, "Selección inválida");
  const result = await db.transaction(async (tx) => {
    await lock(tx, id); await load(tx, id);
    const userIds = await resolveSelection(tx, parsed.data);
    const inserted = userIds.length
      ? await tx.insert(members).values(userIds.map((userId) => ({ spaceId: id, userId })))
        .onConflictDoNothing().returning({ userId: members.userId })
      : [];
    return { space: await info(tx, id), addedUserIds: inserted.map((row) => row.userId) };
  });
  await notifyNewMembers(result.addedUserIds, result.space);
  res.json(result.space);
}));

router.delete("/collab/spaces/:id/members/:userId", requireAuth, requireRole("superadmin"), handle(async (req, res) => {
  const id = idOf(req.params["id"]), userId = idOf(req.params["userId"]);
  await db.transaction(async (tx) => {
    await lock(tx, id);
    const space = await load(tx, id);
    if (!await member(tx, id, userId)) throw new SpaceError(404, "Participante no encontrado");
    if (space.provisioningStartedAt) {
      const settings = await getSettings();
      if (!isNextcloudConfigured(settings)) throw new SpaceError(503, "Configura Nextcloud para retirar también el acceso a los archivos. No se ha eliminado al participante.");
      try { await revokeIndependentSpaceMember(resolveNextcloudConfig(settings)!, id, userId); }
      catch (error) {
        logger.error({ err: error, spaceId: id }, "Unable to revoke independent space membership");
        throw new SpaceError(502, "No se pudo retirar el acceso en Nextcloud. El participante se conserva; vuelve a intentarlo.");
      }
    }
    await tx.delete(members).where(and(eq(members.spaceId, id), eq(members.userId, userId)));
  });
  res.sendStatus(204);
}));

router.post("/collab/spaces/:id/open", requireAuth, handle(async (req, res) => {
  const id = idOf(req.params["id"]), caller = req.user!;
  await load(db, id);
  if (caller.role !== "superadmin" && !await member(db, id, caller.id)) throw new SpaceError(403, "No perteneces a este espacio");
  const settings = await getSettings();
  if (!isNextcloudConfigured(settings)) throw new SpaceError(503, "Espacio colaborativo no configurado");
  // Commit this conservative marker BEFORE any remote grants. If provisioning
  // partly fails, removal still has to revoke possible remote permissions.
  await db.update(spaces).set({ provisioningStartedAt: sql`COALESCE(${spaces.provisioningStartedAt}, now())` }).where(eq(spaces.id, id));
  const ticket = await db.transaction(async (tx) => {
    await lock(tx, id); await load(tx, id);
    if (caller.role !== "superadmin" && !await member(tx, id, caller.id)) throw new SpaceError(403, "Ya no perteneces a este espacio");
    const rows = await tx.select({ userId: users.id, name: users.name, email: users.email }).from(users).where(and(
      eq(users.status, "active"), isNull(users.deletedAt),
      or(eq(users.role, "superadmin"), sql`EXISTS (SELECT 1 FROM ${members} WHERE ${members.spaceId} = ${id} AND ${members.userId} = ${users.id})`),
    ));
    try { await provisionIndependentSpace(resolveNextcloudConfig(settings)!, { spaceId: id, members: rows }); }
    catch (error) {
      logger.error({ err: error, spaceId: id }, "Unable to provision independent collaborative space");
      throw new SpaceError(502, "No se pudo preparar el espacio en Nextcloud. Vuelve a intentarlo.");
    }
    return createIndependentSpaceTicket(caller.id, id);
  });
  res.json({ url: `${getAppBaseUrl(req)}/api/oidc/start?ticket=${encodeURIComponent(ticket)}`, nextcloudUrl: resolveNextcloudUrl(settings)! });
}));

export default router;
