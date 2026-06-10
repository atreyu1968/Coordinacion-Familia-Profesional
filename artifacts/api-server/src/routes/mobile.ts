import { Router, type IRouter } from "express";
import {
  GetMobileAppResponse,
  GetVapidPublicKeyResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { getVapidPublicKey } from "../lib/push";
import { getSettings } from "../lib/settings";

const router: IRouter = Router();

router.get("/mobile-app", requireAuth, async (_req, res): Promise<void> => {
  const result: {
    webUrl?: string;
    expoGoUrl?: string;
    iosUrl?: string;
    androidUrl?: string;
  } = {};

  const expoDomain = process.env["REPLIT_EXPO_DEV_DOMAIN"]
    ?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");

  // Public web app URL: prefer the value set in the control panel (DB), then the
  // MOBILE_WEB_URL env var, then the Replit Expo dev domain (clean root origin).
  const settings = await getSettings();
  const dbWebUrl = settings.mobileWebUrl?.trim().replace(/\/+$/, "");
  const webOverride = process.env["MOBILE_WEB_URL"]?.trim().replace(/\/+$/, "");
  if (dbWebUrl) {
    result.webUrl = dbWebUrl;
  } else if (webOverride) {
    result.webUrl = webOverride;
  } else if (expoDomain) {
    result.webUrl = `https://${expoDomain}`;
  }

  if (expoDomain) {
    result.expoGoUrl = `exp://${expoDomain}`;
  }

  const iosUrl = process.env["MOBILE_IOS_URL"];
  if (iosUrl) {
    result.iosUrl = iosUrl;
  }

  const androidUrl = process.env["MOBILE_ANDROID_URL"];
  if (androidUrl) {
    result.androidUrl = androidUrl;
  }

  res.json(GetMobileAppResponse.parse(result));
});

router.get(
  "/push/vapid-public-key",
  requireAuth,
  async (_req, res): Promise<void> => {
    const key = await getVapidPublicKey();
    res.json(GetVapidPublicKeyResponse.parse(key ? { key } : {}));
  },
);

export default router;
