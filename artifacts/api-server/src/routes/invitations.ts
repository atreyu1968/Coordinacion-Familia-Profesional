import { Router, type IRouter } from "express";
import { eq, and, isNull, desc } from "drizzle-orm";
import {
  db,
  invitationsTable,
  usersTable,
  centersTable,
} from "@workspace/db";
import {
  ListInvitationsQueryParams,
  ListInvitationsResponse,
  CreateInvitationBody,
  RevokeInvitationParams,
  ResendInvitationParams,
  ResendInvitationResponse,
} from "@workspace/api-zod";
import { requireAuth, canInvite, hasScopeOver } from "../middlewares/auth";
import { generateInvitationCode, getAppBaseUrl } from "../lib/auth";
import { sendEmail, buildInvitationEmail } from "../lib/email";
import { toInvitation } from "../lib/mappers";

const router: IRouter = Router();

router.get("/invitations", requireAuth, async (req, res): Promise<void> => {
  const query = ListInvitationsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }

  const filters = [isNull(invitationsTable.deletedAt)];
  if (req.user!.role !== "superadmin") {
    filters.push(eq(invitationsTable.invitedBy, req.user!.id));
  }
  if (query.data.status) {
    filters.push(eq(invitationsTable.status, query.data.status));
  }

  const rows = await db
    .select()
    .from(invitationsTable)
    .where(and(...filters))
    .orderBy(desc(invitationsTable.createdAt));

  res.json(ListInvitationsResponse.parse(rows.map(toInvitation)));
});

router.post("/invitations", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateInvitationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }

  const inviter = req.user!;
  if (!canInvite(inviter.role, parsed.data.role)) {
    res.status(403).json({
      message: "No tienes permiso para invitar a este rol",
    });
    return;
  }

  const isSuper = inviter.role === "superadmin";
  let provinceId: number | null;
  let centerId: number | null;

  if (isSuper) {
    provinceId = parsed.data.provinceId ?? null;
    centerId = parsed.data.centerId ?? null;
  } else if (inviter.role === "coordinator") {
    // Tenant boundary: province is forced to the coordinator's own province.
    provinceId = inviter.provinceId ?? null;
    // A center may be targeted but must belong to the coordinator's province.
    if (parsed.data.centerId != null) {
      const [center] = await db
        .select()
        .from(centersTable)
        .where(
          and(
            eq(centersTable.id, parsed.data.centerId),
            isNull(centersTable.deletedAt),
          ),
        );
      if (!center || center.provinceId !== provinceId) {
        res.status(403).json({ message: "Centro fuera de tu ámbito" });
        return;
      }
      centerId = center.id;
    } else {
      centerId = null;
    }
  } else {
    // department_head: scope is fully forced to the inviter's own center.
    provinceId = inviter.provinceId ?? null;
    centerId = inviter.centerId ?? null;
  }

  const code = generateInvitationCode();
  const hours = parsed.data.expiresInHours ?? 72;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

  const [invitation] = await db
    .insert(invitationsTable)
    .values({
      code,
      email: parsed.data.email.trim().toLowerCase(),
      name: parsed.data.name ?? null,
      role: parsed.data.role,
      provinceId,
      centerId,
      status: "pending",
      invitedBy: inviter.id,
      expiresAt,
    })
    .returning();

  const inviteUrl = `${getAppBaseUrl()}/register?token=${code}`;
  const email = buildInvitationEmail({
    inviterName: inviter.name,
    inviteUrl,
    role: parsed.data.role,
  });
  const result = await sendEmail({
    to: invitation.email,
    subject: email.subject,
    html: email.html,
  });

  res.status(201).json({
    invitation: toInvitation(invitation),
    inviteUrl,
    emailSent: result.sent,
    emailPending: result.pending,
  });
});

router.delete("/invitations/:id", requireAuth, async (req, res): Promise<void> => {
  const params = RevokeInvitationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ message: params.error.message });
    return;
  }

  const [invitation] = await db
    .select()
    .from(invitationsTable)
    .where(
      and(
        eq(invitationsTable.id, params.data.id),
        isNull(invitationsTable.deletedAt),
      ),
    );

  if (!invitation) {
    res.status(404).json({ message: "Invitación no encontrada" });
    return;
  }

  const caller = req.user!;
  const canManage =
    caller.role === "superadmin" ||
    invitation.invitedBy === caller.id ||
    hasScopeOver(caller, invitation);
  if (!canManage) {
    res.status(403).json({ message: "Permiso denegado" });
    return;
  }

  await db
    .update(invitationsTable)
    .set({ status: "revoked", deletedAt: new Date() })
    .where(eq(invitationsTable.id, params.data.id));

  res.sendStatus(204);
});

router.post("/invitations/:id/resend", requireAuth, async (req, res): Promise<void> => {
  const params = ResendInvitationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ message: params.error.message });
    return;
  }

  const [invitation] = await db
    .select()
    .from(invitationsTable)
    .where(
      and(
        eq(invitationsTable.id, params.data.id),
        isNull(invitationsTable.deletedAt),
      ),
    );

  if (!invitation) {
    res.status(404).json({ message: "Invitación no encontrada" });
    return;
  }

  const caller = req.user!;
  const canManage =
    caller.role === "superadmin" ||
    invitation.invitedBy === caller.id ||
    hasScopeOver(caller, invitation);
  if (!canManage) {
    res.status(403).json({ message: "Permiso denegado" });
    return;
  }

  const inviteUrl = `${getAppBaseUrl()}/register?token=${invitation.code}`;
  let inviterName = "Coordina ADG";
  if (invitation.invitedBy) {
    const [inviter] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, invitation.invitedBy));
    if (inviter) inviterName = inviter.name;
  }

  const email = buildInvitationEmail({
    inviterName,
    inviteUrl,
    role: invitation.role,
  });
  const result = await sendEmail({
    to: invitation.email,
    subject: email.subject,
    html: email.html,
  });

  res.json(
    ResendInvitationResponse.parse({
      invitation: toInvitation(invitation),
      inviteUrl,
      emailSent: result.sent,
      emailPending: result.pending,
    }),
  );
});

export default router;
