import { Router, type IRouter } from "express";
import { eq, and, isNull } from "drizzle-orm";
import { db, usersTable, invitationsTable } from "@workspace/db";
import {
  LoginBody,
  LoginResponse,
  GetCurrentUserResponse,
  GetInvitationByTokenParams,
  GetInvitationByTokenResponse,
  RegisterWithTokenBody,
  RegisterWithTokenResponse,
} from "@workspace/api-zod";
import {
  hashPassword,
  verifyPassword,
  signToken,
} from "../lib/auth";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.email, email), isNull(usersTable.deletedAt)));

  if (!user || user.status !== "active") {
    res.status(401).json({ message: "Credenciales incorrectas" });
    return;
  }

  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ message: "Credenciales incorrectas" });
    return;
  }

  const token = signToken({ sub: user.id, role: user.role });
  res.json(LoginResponse.parse({ token, user }));
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  res.json(GetCurrentUserResponse.parse(req.user));
});

router.get("/auth/invitations/:token", async (req, res): Promise<void> => {
  const params = GetInvitationByTokenParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ message: params.error.message });
    return;
  }

  const [invitation] = await db
    .select()
    .from(invitationsTable)
    .where(
      and(
        eq(invitationsTable.code, params.data.token),
        isNull(invitationsTable.deletedAt),
      ),
    );

  if (
    !invitation ||
    invitation.status !== "pending" ||
    invitation.expiresAt.getTime() < Date.now()
  ) {
    res.status(404).json({ message: "Invitación no válida o caducada" });
    return;
  }

  let inviterName: string | undefined;
  if (invitation.invitedBy) {
    const [inviter] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, invitation.invitedBy));
    inviterName = inviter?.name;
  }

  res.json(
    GetInvitationByTokenResponse.parse({
      email: invitation.email,
      role: invitation.role,
      inviterName,
      expiresAt: invitation.expiresAt,
    }),
  );
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterWithTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }

  const [invitation] = await db
    .select()
    .from(invitationsTable)
    .where(
      and(
        eq(invitationsTable.code, parsed.data.token),
        isNull(invitationsTable.deletedAt),
      ),
    );

  if (
    !invitation ||
    invitation.status !== "pending" ||
    invitation.expiresAt.getTime() < Date.now()
  ) {
    res.status(400).json({ message: "Invitación no válida o caducada" });
    return;
  }

  const email = invitation.email.trim().toLowerCase();
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));
  if (existing) {
    res.status(400).json({ message: "Ya existe una cuenta con este correo" });
    return;
  }

  const name =
    parsed.data.name?.trim() || invitation.name || invitation.email;
  const passwordHash = await hashPassword(parsed.data.password);

  const [user] = await db
    .insert(usersTable)
    .values({
      name,
      email,
      passwordHash,
      role: invitation.role,
      status: "active",
      provinceId: invitation.provinceId,
      centerId: invitation.centerId,
      departmentId: invitation.departmentId,
      createdBy: invitation.invitedBy,
    })
    .returning();

  await db
    .update(invitationsTable)
    .set({ status: "used", usedAt: new Date() })
    .where(eq(invitationsTable.id, invitation.id));

  const token = signToken({ sub: user.id, role: user.role });
  res.json(RegisterWithTokenResponse.parse({ token, user }));
});

export default router;
