import { Router, type IRouter } from "express";
import { eq, and, isNull, ne, desc } from "drizzle-orm";
import {
  db,
  usersTable,
  invitationsTable,
  passwordResetTokensTable,
} from "@workspace/db";
import {
  LoginBody,
  LoginResponse,
  GetCurrentUserResponse,
  GetInvitationByTokenParams,
  GetInvitationByTokenResponse,
  RegisterWithTokenBody,
  RegisterWithTokenResponse,
  UpdateProfileBody,
  UpdateProfileResponse,
  ForgotPasswordBody,
  ResetPasswordBody,
} from "@workspace/api-zod";
import {
  hashPassword,
  verifyPassword,
  signToken,
  generateResetCode,
} from "../lib/auth";
import { sendEmail, buildPasswordResetEmail } from "../lib/email";
import { requireAuth } from "../middlewares/auth";

const RESET_CODE_TTL_MS = 15 * 60 * 1000;
const RESET_MAX_ATTEMPTS = 5;

class RegisterError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

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

  if (!user) {
    res.status(401).json({ message: "Credenciales incorrectas" });
    return;
  }

  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ message: "Credenciales incorrectas" });
    return;
  }

  // Credentials are valid: if the account is not active (e.g. deactivated for
  // not confirming the academic year in time), give a clear message so the user
  // knows to ask the administrator to reactivate it, instead of the generic
  // "wrong credentials" error.
  if (user.status !== "active") {
    res.status(403).json({
      message:
        "Tu cuenta está desactivada. Solicita al administrador que la reactive para poder acceder.",
    });
    return;
  }

  const token = signToken({ sub: user.id, role: user.role });
  res.json(LoginResponse.parse({ token, user }));
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  res.json(GetCurrentUserResponse.parse(req.user));
});

router.patch("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }

  const caller = req.user!;
  const updates: {
    name?: string;
    email?: string;
    passwordHash?: string;
  } = {};

  if (parsed.data.name !== undefined) {
    const name = parsed.data.name.trim();
    if (!name) {
      res.status(400).json({ message: "El nombre no puede estar vacío" });
      return;
    }
    updates.name = name;
  }

  if (parsed.data.email !== undefined) {
    const email = parsed.data.email.trim().toLowerCase();
    if (!email) {
      res.status(400).json({ message: "El correo no puede estar vacío" });
      return;
    }
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.email, email), ne(usersTable.id, caller.id)));
    if (existing) {
      res.status(400).json({ message: "Ya existe una cuenta con este correo" });
      return;
    }
    updates.email = email;
  }

  if (parsed.data.newPassword !== undefined) {
    if (!parsed.data.currentPassword) {
      res
        .status(400)
        .json({ message: "Introduce tu contraseña actual para cambiarla" });
      return;
    }
    const ok = await verifyPassword(
      parsed.data.currentPassword,
      caller.passwordHash,
    );
    if (!ok) {
      res.status(400).json({ message: "La contraseña actual no es correcta" });
      return;
    }
    updates.passwordHash = await hashPassword(parsed.data.newPassword);
  }

  if (Object.keys(updates).length === 0) {
    res.json(UpdateProfileResponse.parse(caller));
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, caller.id))
    .returning();

  res.json(UpdateProfileResponse.parse(user));
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

  const email = parsed.data.email.trim().toLowerCase();
  const passwordHash = await hashPassword(parsed.data.password);

  let user;
  try {
    user = await db.transaction(async (tx) => {
      // Lock the invitation row so concurrent registrations cannot consume the
      // same single-use token (TOCTOU on status/email).
      const [invitation] = await tx
        .select()
        .from(invitationsTable)
        .where(
          and(
            eq(invitationsTable.code, parsed.data.token),
            isNull(invitationsTable.deletedAt),
          ),
        )
        .for("update");

      if (
        !invitation ||
        invitation.status !== "pending" ||
        invitation.expiresAt.getTime() < Date.now()
      ) {
        throw new RegisterError(400, "Invitación no válida o caducada");
      }

      const [existing] = await tx
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, email));
      if (existing) {
        throw new RegisterError(400, "Ya existe una cuenta con este correo");
      }

      const name = parsed.data.name?.trim() || invitation.name || email;

      const [created] = await tx
        .insert(usersTable)
        .values({
          name,
          email,
          passwordHash,
          role: invitation.role,
          status: "active",
          provinceId: invitation.provinceId,
          centerId: invitation.centerId,
          createdBy: invitation.invitedBy,
        })
        .returning();

      await tx
        .update(invitationsTable)
        .set({ status: "used", usedAt: new Date(), email })
        .where(eq(invitationsTable.id, invitation.id));

      return created;
    });
  } catch (err) {
    if (err instanceof RegisterError) {
      res.status(err.status).json({ message: err.message });
      return;
    }
    throw err;
  }

  const token = signToken({ sub: user.id, role: user.role });
  res.json(RegisterWithTokenResponse.parse({ token, user }));
});

router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const parsed = ForgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();

  // Always respond the same way so callers can't probe which emails exist.
  const ok = { ok: true };

  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.email, email), isNull(usersTable.deletedAt)));

  if (!user || user.status !== "active") {
    res.json(ok);
    return;
  }

  // Invalidate any previous unused codes so only the newest one works.
  await db
    .update(passwordResetTokensTable)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokensTable.userId, user.id),
        isNull(passwordResetTokensTable.usedAt),
      ),
    );

  const code = generateResetCode();
  const codeHash = await hashPassword(code);
  await db.insert(passwordResetTokensTable).values({
    userId: user.id,
    codeHash,
    expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS),
  });

  const { subject, html } = buildPasswordResetEmail({ code });
  await sendEmail({ to: user.email, subject, html });

  res.json(ok);
});

router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const invalid = "Código no válido o caducado. Solicita uno nuevo.";

  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.email, email), isNull(usersTable.deletedAt)));

  if (!user || user.status !== "active") {
    res.status(400).json({ message: invalid });
    return;
  }

  const [token] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(
      and(
        eq(passwordResetTokensTable.userId, user.id),
        isNull(passwordResetTokensTable.usedAt),
      ),
    )
    .orderBy(desc(passwordResetTokensTable.createdAt))
    .limit(1);

  if (
    !token ||
    token.expiresAt.getTime() < Date.now() ||
    token.attempts >= RESET_MAX_ATTEMPTS
  ) {
    res.status(400).json({ message: invalid });
    return;
  }

  const codeOk = await verifyPassword(parsed.data.code, token.codeHash);
  if (!codeOk) {
    await db
      .update(passwordResetTokensTable)
      .set({ attempts: token.attempts + 1 })
      .where(eq(passwordResetTokensTable.id, token.id));
    res.status(400).json({ message: invalid });
    return;
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  const consumed = await db.transaction(async (tx) => {
    // Atomically claim the token: only the first concurrent request whose
    // conditional update still sees `used_at IS NULL` may proceed, so a single
    // OTP can never reset the password more than once.
    const marked = await tx
      .update(passwordResetTokensTable)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResetTokensTable.id, token.id),
          isNull(passwordResetTokensTable.usedAt),
        ),
      )
      .returning({ id: passwordResetTokensTable.id });
    if (marked.length === 0) {
      return false;
    }
    await tx
      .update(usersTable)
      .set({ passwordHash })
      .where(eq(usersTable.id, user.id));
    return true;
  });

  if (!consumed) {
    res.status(400).json({ message: invalid });
    return;
  }

  res.json({ ok: true });
});

export default router;
