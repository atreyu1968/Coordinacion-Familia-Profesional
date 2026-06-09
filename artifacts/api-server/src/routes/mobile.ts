import { Router, type IRouter } from "express";
import { GetMobileAppResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/mobile-app", requireAuth, (_req, res): void => {
  const result: {
    expoGoUrl?: string;
    iosUrl?: string;
    androidUrl?: string;
  } = {};

  const expoDomain = process.env["REPLIT_EXPO_DEV_DOMAIN"]
    ?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
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

export default router;
