import { Router } from "express";
import { PreviewTestTeacherCleanupResponse, PurgeTestTeachersBody, PurgeTestTeachersResponse } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { previewTestTeacherCleanup, purgeTestTeachers, TestTeacherCleanupError } from "../lib/testTeacherCleanup";

export const testTeacherCleanupRouter = Router();
testTeacherCleanupRouter.use("/users/test-teachers/cleanup", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
testTeacherCleanupRouter.get("/users/test-teachers/cleanup", requireAuth, requireRole("superadmin"), async (_req, res, next) => {
  try { res.json(PreviewTestTeacherCleanupResponse.parse(await previewTestTeacherCleanup())); }
  catch (error) { next(error); }
});
testTeacherCleanupRouter.post("/users/test-teachers/cleanup", requireAuth, requireRole("superadmin"), async (req, res, next) => {
  const body = PurgeTestTeachersBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ message: "Revisa la vista previa y escribe la confirmación exacta." }); return; }
  try {
    res.json(PurgeTestTeachersResponse.parse(await purgeTestTeachers(req.user!, body.data.fingerprint, body.data.confirmation)));
  } catch (error) {
    if (error instanceof TestTeacherCleanupError) res.status(error.status).json({ message: error.message });
    else next(error);
  }
});
