import { Router, type IRouter } from "express";
import { eq, and, isNull, ne, desc, sql, inArray, or } from "drizzle-orm";
import {
  db,
  usersTable,
  invitationsTable,
  passwordResetTokensTable,
  centersTable,
  provincesTable,
  modulesTable,
  teachingAssignmentsTable,
  teacherYearConfirmationsTable,
  syncModuleChatGroup,
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
  GetMyTeachingProfileQueryParams,
  GetMyTeachingProfileResponse,
  UpdateMyTeachingProfileBody,
  UpdateMyTeachingProfileResponse,
} from "@workspace/api-zod";
import {
  hashPassword,
  verifyPassword,
  signToken,
  generateResetCode,
} from "../lib/auth";
import { sendEmail, buildPasswordResetEmail } from "../lib/email";
import { requireAuth, requireRole } from "../middlewares/auth";
import { disconnectUserSessions } from "../lib/realtime";
import { getActiveAcademicYear, getActiveFamily } from "../lib/settings";
import { moduleFamilyFilter } from "../lib/familyCatalog";
import { logger } from "../lib/logger";

const RESET_CODE_TTL_MS = 15 * 60 * 1000;
const RESET_MAX_ATTEMPTS = 5;
// Keep in sync with the published documents in artifacts/web/src/lib/legal-content.ts.
const CURRENT_LEGAL_VERSION = "borrador-2026-09-30-4";

class RegisterError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

class PasswordResetConflict extends Error {}

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

  const token = signToken({
    sub: user.id,
    role: user.role,
    tokenVersion: user.tokenVersion,
    sessionNonce: user.sessionNonce,
  });
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
  const passwordChanged = parsed.data.newPassword !== undefined;

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

  const updateWhere = [eq(usersTable.id, caller.id)];
  if (passwordChanged) {
    updateWhere.push(
      eq(usersTable.tokenVersion, caller.tokenVersion),
      eq(usersTable.passwordHash, caller.passwordHash),
    );
  }
  const updateValues = passwordChanged
    ? { ...updates, tokenVersion: sql`${usersTable.tokenVersion} + 1` }
    : updates;
  const [user] = await db
    .update(usersTable)
    .set(updateValues)
    .where(and(...updateWhere))
    .returning();

  if (!user) {
    res.status(401).json({ message: "La sesión ya no es válida" });
    return;
  }
  if (passwordChanged) disconnectUserSessions(caller.id);

  const response = UpdateProfileResponse.parse(user);
  if (passwordChanged) {
    res.json({
      ...response,
      requiresReauthentication: true,
      message: "Contraseña actualizada. Inicia sesión de nuevo para continuar.",
    });
    return;
  }
  res.json(response);
});

router.get(
  "/auth/me/teaching-profile",
  requireAuth,
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    const query = GetMyTeachingProfileQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ message: query.error.message });
      return;
    }

    const caller = req.user!;
    const targetCenterId = query.data.targetCenterId ?? caller.centerId;
    const activeYear = await getActiveAcademicYear();
    const activeFamily = await getActiveFamily();

    let targetCenter:
      | {
          id: number;
          name: string;
          provinceId: number | null;
          provinceName: string | null;
        }
      | undefined;
    if (targetCenterId != null) {
      const [center] = await db
        .select({
          id: centersTable.id,
          name: centersTable.name,
          provinceId: centersTable.provinceId,
          provinceName: provincesTable.name,
        })
        .from(centersTable)
        .leftJoin(
          provincesTable,
          eq(provincesTable.id, centersTable.provinceId),
        )
        .where(
          and(
            eq(centersTable.id, targetCenterId),
            isNull(centersTable.deletedAt),
            sql`${centersTable.families} @> ${JSON.stringify([activeFamily])}::jsonb`,
          ),
        );
      if (!center) {
        res.status(404).json({ message: "El centro no existe o no está disponible" });
        return;
      }
      targetCenter = center;
    }

    const modules = targetCenter
      ? await db
          .select({
            id: modulesTable.id,
            code: modulesTable.code,
            name: modulesTable.name,
            cycleName: modulesTable.cycleName,
            cycleId: modulesTable.cycleId,
            centerId: modulesTable.centerId,
          })
          .from(modulesTable)
          .where(
            and(
              isNull(modulesTable.deletedAt),
              moduleFamilyFilter(activeFamily),
              or(
                isNull(modulesTable.centerId),
                eq(modulesTable.centerId, targetCenter.id),
              ),
            ),
          )
          .orderBy(modulesTable.cycleName, modulesTable.name)
      : [];

    let moduleIds: number[] = [];
    if (
      activeYear &&
      targetCenter &&
      caller.centerId === targetCenter.id
    ) {
      const assignments = await db
        .select({ moduleId: teachingAssignmentsTable.moduleId })
        .from(teachingAssignmentsTable)
        .where(
          and(
            eq(teachingAssignmentsTable.teacherId, caller.id),
            eq(teachingAssignmentsTable.schoolYear, activeYear),
            eq(teachingAssignmentsTable.centerId, targetCenter.id),
            isNull(teachingAssignmentsTable.deletedAt),
          ),
        );
      const availableModuleIds = new Set(modules.map((module) => module.id));
      moduleIds = [
        ...new Set(
          assignments
            .map((assignment) => assignment.moduleId)
            .filter((id) => availableModuleIds.has(id)),
        ),
      ];
    }

    res.json(
      GetMyTeachingProfileResponse.parse({
        user: GetCurrentUserResponse.parse(caller),
        activeYear,
        targetCenterId: targetCenter?.id ?? null,
        targetCenterName: targetCenter?.name ?? null,
        targetProvinceId: targetCenter?.provinceId ?? null,
        targetProvinceName: targetCenter?.provinceName ?? null,
        moduleIds,
        modules,
      }),
    );
  },
);

router.patch(
  "/auth/me/teaching-profile",
  requireAuth,
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    const parsed = UpdateMyTeachingProfileBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }

    const caller = req.user!;
    const activeYear = await getActiveAcademicYear();
    const activeFamily = await getActiveFamily();
    const moduleIds = [...new Set(parsed.data.moduleIds)];
    if (activeYear && moduleIds.length === 0) {
      res.status(400).json({
        message: "Selecciona al menos un módulo que impartes en el curso activo",
      });
      return;
    }
    if (!activeYear && moduleIds.length > 0) {
      res.status(409).json({
        message: "No hay un curso activo para guardar módulos",
      });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [lockedUser] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.id, caller.id),
            eq(usersTable.role, "teacher"),
            eq(usersTable.status, "active"),
            isNull(usersTable.deletedAt),
          ),
        )
        .for("update");
      if (!lockedUser) return { kind: "user" as const };

      const [center] = await tx
        .select()
        .from(centersTable)
        .where(
          and(
            eq(centersTable.id, parsed.data.centerId),
            isNull(centersTable.deletedAt),
            sql`${centersTable.families} @> ${JSON.stringify([activeFamily])}::jsonb`,
          ),
        )
        .for("update");
      if (!center) return { kind: "center" as const };

      if (activeYear && moduleIds.length > 0) {
        const validModules = await tx
          .select({
            id: modulesTable.id,
            centerId: modulesTable.centerId,
          })
          .from(modulesTable)
          .where(
            and(
              inArray(modulesTable.id, moduleIds),
              isNull(modulesTable.deletedAt),
              moduleFamilyFilter(activeFamily),
            ),
          );
        const validIds = new Set(validModules.map((module) => module.id));
        if (moduleIds.some((id) => !validIds.has(id))) {
          return { kind: "modules" as const };
        }
        if (
          validModules.some(
            (module) =>
              module.centerId != null && module.centerId !== center.id,
          )
        ) {
          return { kind: "modules" as const };
        }
      }

      const [updatedUser] = await tx
        .update(usersTable)
        .set({ centerId: center.id, provinceId: center.provinceId })
        .where(eq(usersTable.id, caller.id))
        .returning();
      if (!updatedUser) return { kind: "user" as const };

      const touchedModuleIds = new Set<number>();
      if (activeYear) {
        const assignments = await tx
          .select()
          .from(teachingAssignmentsTable)
          .where(
            and(
              eq(teachingAssignmentsTable.teacherId, caller.id),
              eq(teachingAssignmentsTable.schoolYear, activeYear),
            ),
          )
          .for("update");
        const selectedModules = new Set(moduleIds);
        const activeAssignments = assignments.filter(
          (assignment) => assignment.deletedAt == null,
        );

        for (const assignment of activeAssignments) {
          if (selectedModules.has(assignment.moduleId)) continue;
          await tx
            .update(teachingAssignmentsTable)
            .set({ deletedAt: new Date() })
            .where(eq(teachingAssignmentsTable.id, assignment.id));
          touchedModuleIds.add(assignment.moduleId);
        }

        for (const moduleId of moduleIds) {
          const moduleAssignments = assignments.filter(
            (assignment) => assignment.moduleId === moduleId,
          );
          const activeForModule = moduleAssignments.filter(
            (assignment) => assignment.deletedAt == null,
          );
          if (activeForModule.length > 0) {
            for (const assignment of activeForModule) {
              if (assignment.centerId === center.id) continue;
              await tx
                .update(teachingAssignmentsTable)
                .set({ centerId: center.id, groupId: null })
                .where(eq(teachingAssignmentsTable.id, assignment.id));
              touchedModuleIds.add(moduleId);
            }
            continue;
          }

          const previous = moduleAssignments.find(
            (assignment) => assignment.deletedAt != null,
          );
          if (previous) {
            await tx
              .update(teachingAssignmentsTable)
              .set({
                deletedAt: null,
                centerId: center.id,
                groupId:
                  previous.centerId === center.id ? previous.groupId : null,
              })
              .where(eq(teachingAssignmentsTable.id, previous.id));
          } else {
            await tx.insert(teachingAssignmentsTable).values({
              teacherId: caller.id,
              moduleId,
              centerId: center.id,
              schoolYear: activeYear,
            });
          }
          touchedModuleIds.add(moduleId);
        }

        await tx
          .update(teacherYearConfirmationsTable)
          .set({ centerId: center.id })
          .where(
            and(
              eq(teacherYearConfirmationsTable.teacherId, caller.id),
              eq(teacherYearConfirmationsTable.schoolYear, activeYear),
            ),
          );
      }

      return {
        kind: "success" as const,
        user: updatedUser,
        moduleIds: activeYear ? moduleIds : [],
        touchedModuleIds: [...touchedModuleIds],
      };
    });

    if (result.kind === "user") {
      res.status(403).json({ message: "La cuenta de profesorado no está activa" });
      return;
    }
    if (result.kind === "center") {
      res.status(404).json({
        message: "El centro no existe o no pertenece a la familia activa",
      });
      return;
    }
    if (result.kind === "modules") {
      res.status(400).json({
        message: "Algún módulo no está disponible para el centro seleccionado",
      });
      return;
    }

    for (const moduleId of result.touchedModuleIds) {
      try {
        await syncModuleChatGroup(moduleId);
      } catch (err) {
        logger.error(
          { err, moduleId },
          "syncModuleChatGroup (teacher profile) failed",
        );
      }
    }

    res.json(
      UpdateMyTeachingProfileResponse.parse({
        user: GetCurrentUserResponse.parse(result.user),
        activeYear,
        moduleIds: result.moduleIds,
      }),
    );
  },
);

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
    (invitation.maxUses !== null && invitation.usedCount >= invitation.maxUses) ||
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
      remainingUses: invitation.maxUses === null ? null : invitation.maxUses - invitation.usedCount,
      legalVersion: CURRENT_LEGAL_VERSION,
    }),
  );
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterWithTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  if (
    parsed.data.termsAccepted !== true ||
    parsed.data.privacyAcknowledged !== true ||
    parsed.data.legalVersion !== CURRENT_LEGAL_VERSION
  ) {
    res.status(400).json({ message: "Debes leer y aceptar la versión actual de los textos legales" });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const passwordHash = await hashPassword(parsed.data.password);

  let user;
  try {
    user = await db.transaction(async (tx) => {
      // Serialize registrations for this code; the final place cannot be
      // consumed twice by concurrent requests.
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
        (invitation.maxUses !== null && invitation.usedCount >= invitation.maxUses) ||
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
          legalAcceptedAt: new Date(),
          legalTermsVersion: CURRENT_LEGAL_VERSION,
          legalPrivacyVersion: CURRENT_LEGAL_VERSION,
        })
        .returning();

      await tx
        .update(invitationsTable)
        .set({
          usedCount: invitation.usedCount + 1,
          status: invitation.maxUses !== null && invitation.usedCount + 1 >= invitation.maxUses ? "used" : "pending",
          usedAt: new Date(),
          // A multi-person invitation must not display one registrant as its recipient.
          email: invitation.maxUses === 1 ? email : null,
        })
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

  const token = signToken({
    sub: user.id,
    role: user.role,
    tokenVersion: user.tokenVersion,
    sessionNonce: user.sessionNonce,
  });
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
  let consumed: boolean;
  try {
    consumed = await db.transaction(async (tx) => {
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
      const [updatedUser] = await tx
        .update(usersTable)
        .set({
          passwordHash,
          tokenVersion: sql`${usersTable.tokenVersion} + 1`,
        })
        .where(
          and(
            eq(usersTable.id, user.id),
            eq(usersTable.tokenVersion, user.tokenVersion),
            eq(usersTable.status, "active"),
            isNull(usersTable.deletedAt),
          ),
        )
        .returning({ id: usersTable.id });
      if (!updatedUser) {
        throw new PasswordResetConflict();
      }
      return true;
    });
  } catch (err) {
    if (err instanceof PasswordResetConflict) {
      res.status(400).json({ message: invalid });
      return;
    }
    throw err;
  }

  if (!consumed) {
    res.status(400).json({ message: invalid });
    return;
  }

  disconnectUserSessions(user.id);
  res.json({ ok: true });
});

export default router;
