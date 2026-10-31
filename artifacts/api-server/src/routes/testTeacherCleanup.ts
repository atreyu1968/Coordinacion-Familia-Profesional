import { Router } from "express";
import {
  GetUserParams,
  PermanentlyDeleteUserBody,
  PermanentlyDeleteUserResponse,
  PreviewTestTeacherCleanupResponse,
  PreviewUserPermanentDeletionResponse,
  PurgeTestTeachersBody,
  PurgeTestTeachersResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import {
  permanentlyDeleteUser,
  PermanentUserDeletionError,
  previewPermanentUserDeletion,
  previewTestTeacherCleanup,
  purgeTestTeachers,
  TestTeacherCleanupError,
} from "../lib/testTeacherCleanup";

export const testTeacherCleanupRouter = Router();
testTeacherCleanupRouter.use("/users/test-teachers/cleanup", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
testTeacherCleanupRouter.use("/users/:id/permanent-delete-preview", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
testTeacherCleanupRouter.get(
  "/users/:id/permanent-delete-preview",
  requireAuth,
  requireRole("superadmin"),
  async (req, res, next) => {
    const params = GetUserParams.safeParse(req.params);
    if (!params.success) { res.status(400).json({ message: "Identificador de usuario no válido." }); return; }
    try {
      res.json(PreviewUserPermanentDeletionResponse.parse(
        await previewPermanentUserDeletion(req.user!, params.data.id),
      ));
    } catch (error) {
      if (error instanceof PermanentUserDeletionError) res.status(error.status).json({ message: error.message });
      else next(error);
    }
  },
);
testTeacherCleanupRouter.post(
  "/users/:id/permanent-delete",
  requireAuth,
  requireRole("superadmin"),
  async (req, res, next) => {
    const params = GetUserParams.safeParse(req.params);
    const body = PermanentlyDeleteUserBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ message: "Revisa la vista previa y los datos de confirmación." });
      return;
    }
    try {
      res.json(PermanentlyDeleteUserResponse.parse(
        await permanentlyDeleteUser(
          req.user!,
          params.data.id,
          body.data.fingerprint,
          body.data.confirmation,
        ),
      ));
    } catch (error) {
      if (error instanceof PermanentUserDeletionError) res.status(error.status).json({ message: error.message });
      else next(error);
    }
  },
);

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
