import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, usersTable, modulesTable } from "@workspace/db";
import type { User } from "@workspace/db";
import {
  buildDiscovery,
  getJwks,
  signIdToken,
  createAuthCode,
  consumeAuthCode,
  createAccessToken,
  getAccessTokenUser,
  consumeTicket,
  createSession,
  getSessionUser,
  verifyPkce,
  type OidcClaims,
} from "../lib/oidc";
import { getSettings } from "../lib/settings";
import {
  resolveNextcloudOidcClient,
  resolveNextcloudUrl,
  nextcloudUid,
  moduleFolderName,
} from "../lib/nextcloud";
import { getAppBaseUrl, readCookie } from "../lib/appUrl";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// OIDC provider endpoints (mounted under /api). Nextcloud's user_oidc app is
// the only client. The issuer is `${appBaseUrl}/api/oidc`.
// ---------------------------------------------------------------------------

const router: IRouter = Router();

const SESSION_COOKIE = "coordina_oidc_sid";

function issuerFor(req: Request): string {
  return `${getAppBaseUrl(req)}/api/oidc`;
}

function isSecure(req: Request): boolean {
  return (
    req.headers["x-forwarded-proto"]?.toString().split(",")[0]?.trim() ===
      "https" || req.protocol === "https"
  );
}

// Strict redirect_uri policy: the callback must live on the *same origin*
// (scheme + host + port) as the configured Nextcloud base URL, and under the
// user_oidc callback path. A naive `startsWith(nextcloudUrl)` would accept
// prefix-confusable hosts such as `https://drive.example.org.attacker.tld/...`.
// Nextcloud may be served under a subpath (e.g. https://domain/nextcloud), in
// which case the callback carries that base prefix; we strip it before matching
// the user_oidc path so both root and subpath installs work.
export function isAllowedRedirectUri(redirectUri: string, nextcloudUrl: string): boolean {
  let target: URL;
  let base: URL;
  try {
    target = new URL(redirectUri);
    base = new URL(nextcloudUrl);
  } catch {
    return false;
  }
  if (target.protocol !== base.protocol) return false;
  if (target.host !== base.host) return false;
  // Strip the configured base path prefix ("" at the domain root, "/nextcloud"
  // for a subpath install) before matching the callback path. The leading-slash
  // anchor in the regex below rejects prefix-confusable paths such as
  // "/nextcloud-evil/apps/user_oidc/..." (whose remainder lacks a leading "/").
  const basePath = base.pathname.replace(/\/+$/, "");
  if (!target.pathname.startsWith(basePath)) return false;
  const rest = target.pathname.slice(basePath.length);
  // Only allow the Nextcloud user_oidc callback path (with or without the
  // index.php front controller prefix).
  return /^\/(index\.php\/)?apps\/user_oidc\//.test(rest);
}

function claimsFor(user: User): OidcClaims {
  return {
    sub: nextcloudUid(user.id),
    name: user.name,
    email: user.email,
    preferred_username: nextcloudUid(user.id),
  };
}

async function loadActiveUser(userId: number): Promise<User | null> {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), isNull(usersTable.deletedAt)));
  if (!user || user.status !== "active") return null;
  return user;
}

// --- Discovery + JWKS ------------------------------------------------------

router.get(
  "/oidc/.well-known/openid-configuration",
  (req: Request, res: Response): void => {
    res.json(buildDiscovery(issuerFor(req)));
  },
);

router.get("/oidc/jwks", async (_req: Request, res: Response): Promise<void> => {
  res.json(await getJwks());
});

// --- Start: validate one-time ticket, set session, bounce to Nextcloud -----

router.get("/oidc/start", async (req: Request, res: Response): Promise<void> => {
  const ticket = (req.query["ticket"] as string) || "";
  const rec = consumeTicket(ticket);
  if (!rec) {
    res.status(400).send("Enlace caducado. Vuelve a abrir el espacio colaborativo.");
    return;
  }
  const user = await loadActiveUser(rec.userId);
  if (!user) {
    res.status(401).send("Usuario no válido");
    return;
  }
  const settings = await getSettings();
  const nextcloudUrl = resolveNextcloudUrl(settings);
  if (!nextcloudUrl) {
    res.status(503).send("Espacio colaborativo no configurado");
    return;
  }

  const sid = createSession(user.id);
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure(req),
    path: "/api/oidc",
    maxAge: 30 * 60 * 1000,
  });

  // Where the user should land inside Nextcloud after SSO completes.
  let target = "/apps/files";
  const [mod] = await db
    .select()
    .from(modulesTable)
    .where(eq(modulesTable.id, rec.moduleId));
  if (mod) {
    const mount = moduleFolderName({
      moduleId: mod.id,
      name: mod.name,
      code: mod.code,
    });
    target = `/apps/files/?dir=/${encodeURIComponent(mount)}`;
  }

  // Provider id is assigned by Nextcloud when the OIDC provider is registered
  // (the first one is 1). Configurable for installs that add more providers.
  const providerId = (process.env["NEXTCLOUD_OIDC_PROVIDER_ID"] || "1").trim();
  const loginUrl = `${nextcloudUrl}/index.php/apps/user_oidc/login/${encodeURIComponent(
    providerId,
  )}?redirect_url=${encodeURIComponent(target)}`;
  res.redirect(loginUrl);
});

// --- Authorization endpoint ------------------------------------------------

router.get("/oidc/authorize", async (req: Request, res: Response): Promise<void> => {
  const settings = await getSettings();
  const client = resolveNextcloudOidcClient(settings);
  const nextcloudUrl = resolveNextcloudUrl(settings);
  if (!client || !nextcloudUrl) {
    res.status(503).send("Espacio colaborativo no configurado");
    return;
  }

  const clientId = (req.query["client_id"] as string) || "";
  const redirectUri = (req.query["redirect_uri"] as string) || "";
  const responseType = (req.query["response_type"] as string) || "";
  const state = (req.query["state"] as string) || "";
  const nonce = (req.query["nonce"] as string) || undefined;
  const codeChallenge = (req.query["code_challenge"] as string) || undefined;

  if (clientId !== client.clientId) {
    res.status(400).send("client_id desconocido");
    return;
  }
  if (responseType !== "code") {
    res.status(400).send("response_type no soportado");
    return;
  }
  if (!isAllowedRedirectUri(redirectUri, nextcloudUrl)) {
    res.status(400).send("redirect_uri no permitido");
    return;
  }

  const sid = readCookie(req, SESSION_COOKIE);
  const userId = sid ? getSessionUser(sid) : null;
  if (!userId) {
    // No active SSO session — the flow must start from the app.
    res
      .status(401)
      .send("Sesión no encontrada. Abre el espacio colaborativo desde la plataforma.");
    return;
  }

  const code = createAuthCode({
    userId,
    clientId,
    redirectUri,
    nonce,
    codeChallenge,
  });
  const sep = redirectUri.includes("?") ? "&" : "?";
  const loc =
    `${redirectUri}${sep}code=${encodeURIComponent(code)}` +
    (state ? `&state=${encodeURIComponent(state)}` : "");
  res.redirect(loc);
});

// --- Token endpoint --------------------------------------------------------

function clientCreds(
  req: Request,
): { id: string; secret: string } | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Basic ")) {
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx !== -1) {
      return {
        id: decodeURIComponent(decoded.slice(0, idx)),
        secret: decodeURIComponent(decoded.slice(idx + 1)),
      };
    }
  }
  const body = req.body as Record<string, string> | undefined;
  if (body?.["client_id"] && body?.["client_secret"]) {
    return { id: body["client_id"], secret: body["client_secret"] };
  }
  return null;
}

router.post("/oidc/token", async (req: Request, res: Response): Promise<void> => {
  const settings = await getSettings();
  const client = resolveNextcloudOidcClient(settings);
  if (!client) {
    res.status(503).json({ error: "temporarily_unavailable" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, string>;
  if (body["grant_type"] !== "authorization_code") {
    res.status(400).json({ error: "unsupported_grant_type" });
    return;
  }
  const creds = clientCreds(req);
  if (!creds || creds.id !== client.clientId || creds.secret !== client.clientSecret) {
    res.status(401).json({ error: "invalid_client" });
    return;
  }
  const rec = consumeAuthCode(body["code"] || "");
  if (!rec || rec.clientId !== creds.id) {
    res.status(400).json({ error: "invalid_grant" });
    return;
  }
  if (body["redirect_uri"] && body["redirect_uri"] !== rec.redirectUri) {
    res.status(400).json({ error: "invalid_grant" });
    return;
  }
  if (rec.codeChallenge) {
    const verifier = body["code_verifier"] || "";
    if (!verifier || !verifyPkce(verifier, rec.codeChallenge)) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }
  }
  const user = await loadActiveUser(rec.userId);
  if (!user) {
    res.status(400).json({ error: "invalid_grant" });
    return;
  }
  try {
    const idToken = await signIdToken({
      issuer: issuerFor(req),
      clientId: creds.id,
      claims: claimsFor(user),
      nonce: rec.nonce,
    });
    const accessToken = createAccessToken(user.id);
    res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      id_token: idToken,
      scope: "openid profile email",
    });
  } catch (err) {
    logger.error({ err }, "Failed to issue OIDC token");
    res.status(500).json({ error: "server_error" });
  }
});

// --- UserInfo endpoint -----------------------------------------------------

router.get("/oidc/userinfo", async (req: Request, res: Response): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }
  const userId = getAccessTokenUser(auth.slice("Bearer ".length).trim());
  if (!userId) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }
  const user = await loadActiveUser(userId);
  if (!user) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }
  res.json(claimsFor(user));
});

export default router;
