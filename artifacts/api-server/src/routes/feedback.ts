import { Router, type IRouter } from "express";
import { eq, and, isNull, desc, type SQL } from "drizzle-orm";
import { db, appFeedbackTable, usersTable } from "@workspace/db";
import {
  ListFeedbackQueryParams,
  ListFeedbackResponse,
  CreateFeedbackBody,
  UpdateFeedbackParams,
  UpdateFeedbackBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { toFeedback } from "../lib/mappers";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// List feedback: superadmin sees everything (with the author's name); every
// other user sees only their own submissions.
// ---------------------------------------------------------------------------
router.get("/feedback", requireAuth, async (req, res): Promise<void> => {
  const query = ListFeedbackQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }
  const caller = req.user!;
  const isAdmin = caller.role === "superadmin";

  const filters: SQL[] = [isNull(appFeedbackTable.deletedAt)];
  if (!isAdmin) filters.push(eq(appFeedbackTable.userId, caller.id));
  if (query.data.type) filters.push(eq(appFeedbackTable.type, query.data.type));
  if (query.data.status) {
    filters.push(eq(appFeedbackTable.status, query.data.status));
  }

  const rows = await db
    .select({
      id: appFeedbackTable.id,
      userId: appFeedbackTable.userId,
      userName: usersTable.name,
      type: appFeedbackTable.type,
      subject: appFeedbackTable.subject,
      message: appFeedbackTable.message,
      status: appFeedbackTable.status,
      createdAt: appFeedbackTable.createdAt,
      deletedAt: appFeedbackTable.deletedAt,
    })
    .from(appFeedbackTable)
    .leftJoin(usersTable, eq(usersTable.id, appFeedbackTable.userId))
    .where(and(...filters))
    .orderBy(desc(appFeedbackTable.createdAt));

  res.json(ListFeedbackResponse.parse(rows.map(toFeedback)));
});

// ---------------------------------------------------------------------------
// Create feedback: any authenticated user may submit a suggestion or incident.
// ---------------------------------------------------------------------------
router.post("/feedback", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateFeedbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  const caller = req.user!;
  const data = parsed.data;

  const [row] = await db
    .insert(appFeedbackTable)
    .values({
      userId: caller.id,
      type: data.type,
      subject: data.subject.trim(),
      message: data.message.trim(),
      status: "open",
    })
    .returning();

  res.status(201).json(toFeedback({ ...row!, userName: caller.name }));
});

// ---------------------------------------------------------------------------
// Update feedback status (superadmin only).
// ---------------------------------------------------------------------------
router.patch("/feedback/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateFeedbackParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ message: params.error.message });
    return;
  }
  const body = UpdateFeedbackBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ message: body.error.message });
    return;
  }
  if (req.user!.role !== "superadmin") {
    res.status(403).json({ message: "Permiso denegado" });
    return;
  }

  const [existing] = await db
    .select()
    .from(appFeedbackTable)
    .where(
      and(
        eq(appFeedbackTable.id, params.data.id),
        isNull(appFeedbackTable.deletedAt),
      ),
    );
  if (!existing) {
    res.status(404).json({ message: "Sugerencia no encontrada" });
    return;
  }

  const [updated] = await db
    .update(appFeedbackTable)
    .set({ status: body.data.status })
    .where(eq(appFeedbackTable.id, existing.id))
    .returning();

  const [author] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, updated!.userId));

  res.json(toFeedback({ ...updated!, userName: author?.name ?? null }));
});

export default router;
