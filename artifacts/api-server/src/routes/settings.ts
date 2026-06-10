import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, integrationSettingsTable } from "@workspace/db";
import {
  GetIntegrationSettingsResponse,
  UpdateIntegrationSettingsBody,
  UpdateIntegrationSettingsResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import {
  getSettings,
  isDeepseekConfigured,
  isResendConfigured,
  isJaasConfigured,
} from "../lib/settings";

const router: IRouter = Router();

router.get("/settings/integrations", requireAuth, async (_req, res): Promise<void> => {
  const settings = await getSettings();
  res.json(
    GetIntegrationSettingsResponse.parse({
      deepseekConfigured: isDeepseekConfigured(settings),
      resendConfigured: isResendConfigured(settings),
      resendFromEmail: settings.resendFromEmail,
      jaasConfigured: isJaasConfigured(settings),
      jaasAppId: settings.jaasAppId,
      mobileWebUrl: settings.mobileWebUrl,
    }),
  );
});

router.put(
  "/settings/integrations",
  requireAuth,
  requireRole("superadmin"),
  async (req, res): Promise<void> => {
    const parsed = UpdateIntegrationSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }

    const current = await getSettings();
    const updates: Record<string, string | null> = {};
    if (parsed.data.deepseekApiKey !== undefined) {
      updates["deepseekApiKey"] = parsed.data.deepseekApiKey || null;
    }
    if (parsed.data.resendApiKey !== undefined) {
      updates["resendApiKey"] = parsed.data.resendApiKey || null;
    }
    if (parsed.data.resendFromEmail !== undefined) {
      updates["resendFromEmail"] = parsed.data.resendFromEmail || null;
    }
    if (parsed.data.jaasAppId !== undefined) {
      updates["jaasAppId"] = parsed.data.jaasAppId || null;
    }
    if (parsed.data.jaasKid !== undefined) {
      updates["jaasKid"] = parsed.data.jaasKid || null;
    }
    if (parsed.data.jaasPrivateKey !== undefined) {
      updates["jaasPrivateKey"] = parsed.data.jaasPrivateKey || null;
    }
    if (parsed.data.mobileWebUrl !== undefined) {
      updates["mobileWebUrl"] = parsed.data.mobileWebUrl
        ? parsed.data.mobileWebUrl.trim().replace(/\/+$/, "")
        : null;
    }

    const [updated] = await db
      .update(integrationSettingsTable)
      .set(updates)
      .where(eq(integrationSettingsTable.id, current.id))
      .returning();

    res.json(
      UpdateIntegrationSettingsResponse.parse({
        deepseekConfigured: isDeepseekConfigured(updated),
        resendConfigured: isResendConfigured(updated),
        resendFromEmail: updated.resendFromEmail,
        jaasConfigured: isJaasConfigured(updated),
        jaasAppId: updated.jaasAppId,
        mobileWebUrl: updated.mobileWebUrl,
      }),
    );
  },
);

export default router;
