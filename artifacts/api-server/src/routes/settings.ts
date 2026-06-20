import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { eq } from "drizzle-orm";
import { db, integrationSettingsTable } from "@workspace/db";
import type { IntegrationSettings } from "@workspace/db";
import {
  GetIntegrationSettingsResponse,
  UpdateIntegrationSettingsBody,
  UpdateIntegrationSettingsResponse,
  GetBrandingResponse,
  UpdateBrandingBody,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "../lib/objectStorage";
import {
  getSettings,
  professionalFamilyOf,
  isDeepseekConfigured,
  isResendConfigured,
  isJaasConfigured,
  isNextcloudConfigured,
  isOutlineConfigured,
} from "../lib/settings";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// Build the public branding payload. `version` busts client image caches: it
// changes whenever the row is updated (logo/favicon may be replaced in place).
function brandingResponse(s: IntegrationSettings) {
  return GetBrandingResponse.parse({
    appName: s.appName ?? null,
    professionalFamily: professionalFamilyOf(s),
    hasLogo: !!s.logoPath,
    hasFavicon: !!s.faviconPath,
    version: String(s.updatedAt instanceof Date ? s.updatedAt.getTime() : Date.now()),
  });
}

// Uploaded objects live under the private "uploads/" prefix; only accept those
// normalized entity paths as branding sources. The branding image routes are
// PUBLIC, so this guard must be strict: a loose `startsWith` check would let a
// crafted path (e.g. "/objects/uploads/../secret") traverse out of the uploads
// prefix and publicly expose unrelated private objects. We therefore require a
// canonical, single-segment id with no traversal, slashes, or encoded escapes.
function isValidUploadPath(p: string): boolean {
  return /^\/objects\/uploads\/[A-Za-z0-9._-]+$/.test(p);
}

// Stream a stored object-entity branding asset (logo/favicon) publicly. The
// underlying object is private, but branding images are intentionally public
// (the login screen renders them before authentication), so we serve them
// through our own route instead of exposing the object directly.
async function serveBrandingObject(
  res: Response,
  req: Request,
  objectPath: string | null,
): Promise<void> {
  if (!objectPath || !isValidUploadPath(objectPath)) {
    res.status(404).json({ message: "No configurado" });
    return;
  }
  try {
    const file = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => {
      // Override caching: these are public assets keyed by the ?v= version.
      if (key.toLowerCase() === "cache-control") return;
      res.setHeader(key, value);
    });
    res.setHeader("Cache-Control", "public, max-age=300");

    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ message: "No encontrado" });
      return;
    }
    req.log.error({ err: error }, "Error serving branding asset");
    res.status(500).json({ message: "No se pudo servir el recurso" });
  }
}

router.get("/settings/branding", async (_req, res): Promise<void> => {
  const settings = await getSettings();
  res.json(brandingResponse(settings));
});

router.put(
  "/settings/branding",
  requireAuth,
  requireRole("superadmin"),
  async (req, res): Promise<void> => {
    const parsed = UpdateBrandingBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }

    const current = await getSettings();
    const updates: Record<string, string | null> = {};

    if (parsed.data.appName !== undefined) {
      const name = (parsed.data.appName ?? "").trim();
      updates["appName"] = name || null;
    }
    if (parsed.data.professionalFamily !== undefined) {
      const fam = (parsed.data.professionalFamily ?? "").trim();
      updates["professionalFamily"] = fam || null;
    }
    if (parsed.data.logoPath !== undefined) {
      const p = (parsed.data.logoPath ?? "").trim();
      if (p && !isValidUploadPath(p)) {
        res.status(400).json({ message: "Ruta de logo no válida" });
        return;
      }
      updates["logoPath"] = p || null;
    }
    if (parsed.data.faviconPath !== undefined) {
      const p = (parsed.data.faviconPath ?? "").trim();
      if (p && !isValidUploadPath(p)) {
        res.status(400).json({ message: "Ruta de favicon no válida" });
        return;
      }
      updates["faviconPath"] = p || null;
    }

    const [updated] = await db
      .update(integrationSettingsTable)
      .set(updates)
      .where(eq(integrationSettingsTable.id, current.id))
      .returning();

    res.json(brandingResponse(updated));
  },
);

router.get("/settings/branding/logo", async (req, res): Promise<void> => {
  const settings = await getSettings();
  await serveBrandingObject(res, req, settings.logoPath);
});

router.get("/settings/branding/favicon", async (req, res): Promise<void> => {
  const settings = await getSettings();
  await serveBrandingObject(res, req, settings.faviconPath);
});

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
      nextcloudConfigured: isNextcloudConfigured(settings),
      nextcloudAdminPasswordConfigured: !!settings.nextcloudAdminPassword,
      nextcloudOidcClientSecretConfigured: !!settings.nextcloudOidcClientSecret,
      nextcloudUrl: settings.nextcloudUrl,
      collaboraUrl: settings.collaboraUrl,
      nextcloudAdminUser: settings.nextcloudAdminUser,
      nextcloudOidcClientId: settings.nextcloudOidcClientId,
      outlineConfigured: isOutlineConfigured(settings),
      outlineOidcClientSecretConfigured: !!settings.outlineOidcClientSecret,
      outlineApiTokenConfigured: !!settings.outlineApiToken,
      outlineUrl: settings.outlineUrl,
      outlineOidcClientId: settings.outlineOidcClientId,
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
    if (parsed.data.nextcloudUrl !== undefined) {
      updates["nextcloudUrl"] = parsed.data.nextcloudUrl
        ? parsed.data.nextcloudUrl.trim().replace(/\/+$/, "")
        : null;
    }
    if (parsed.data.collaboraUrl !== undefined) {
      updates["collaboraUrl"] = parsed.data.collaboraUrl
        ? parsed.data.collaboraUrl.trim().replace(/\/+$/, "")
        : null;
    }
    if (parsed.data.nextcloudAdminUser !== undefined) {
      updates["nextcloudAdminUser"] = parsed.data.nextcloudAdminUser || null;
    }
    if (parsed.data.nextcloudAdminPassword !== undefined) {
      updates["nextcloudAdminPassword"] =
        parsed.data.nextcloudAdminPassword || null;
    }
    if (parsed.data.nextcloudOidcClientId !== undefined) {
      updates["nextcloudOidcClientId"] = parsed.data.nextcloudOidcClientId || null;
    }
    if (parsed.data.nextcloudOidcClientSecret !== undefined) {
      updates["nextcloudOidcClientSecret"] =
        parsed.data.nextcloudOidcClientSecret || null;
    }
    if (parsed.data.outlineUrl !== undefined) {
      updates["outlineUrl"] = parsed.data.outlineUrl
        ? parsed.data.outlineUrl.trim().replace(/\/+$/, "")
        : null;
    }
    if (parsed.data.outlineOidcClientId !== undefined) {
      updates["outlineOidcClientId"] = parsed.data.outlineOidcClientId || null;
    }
    if (parsed.data.outlineOidcClientSecret !== undefined) {
      updates["outlineOidcClientSecret"] =
        parsed.data.outlineOidcClientSecret || null;
    }
    if (parsed.data.outlineApiToken !== undefined) {
      updates["outlineApiToken"] = parsed.data.outlineApiToken || null;
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
        nextcloudConfigured: isNextcloudConfigured(updated),
        nextcloudAdminPasswordConfigured: !!updated.nextcloudAdminPassword,
        nextcloudOidcClientSecretConfigured: !!updated.nextcloudOidcClientSecret,
        nextcloudUrl: updated.nextcloudUrl,
        collaboraUrl: updated.collaboraUrl,
        nextcloudAdminUser: updated.nextcloudAdminUser,
        nextcloudOidcClientId: updated.nextcloudOidcClientId,
        outlineConfigured: isOutlineConfigured(updated),
        outlineOidcClientSecretConfigured: !!updated.outlineOidcClientSecret,
        outlineApiTokenConfigured: !!updated.outlineApiToken,
        outlineUrl: updated.outlineUrl,
        outlineOidcClientId: updated.outlineOidcClientId,
      }),
    );
  },
);

export default router;
