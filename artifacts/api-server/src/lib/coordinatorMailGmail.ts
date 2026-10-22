import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db, coordinatorMailAccountsTable, coordinatorMailSettingsTable, type CoordinatorMailAccount } from "@workspace/db";
import { decryptMailSecret, encryptMailSecret, decodeHeaderWords, safeEmail, safeMailText, sanitizeHeader } from "./coordinatorMailSecurity";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"];
export const MAX_GMAIL_MESSAGE_BYTES = 40 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export class GmailRequestError extends Error {
  constructor(message: string, readonly status: number, readonly definitive: boolean) { super(message); }
}

export interface GmailConfiguration {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export async function getGmailConfiguration(): Promise<GmailConfiguration | null> {
  const [s] = await db.select().from(coordinatorMailSettingsTable).where(eq(coordinatorMailSettingsTable.id, 1)).limit(1);
  if (!s?.googleClientId || !s.googleClientSecretEncrypted || !s.googleRedirectUri) return null;
  return {
    clientId: s.googleClientId,
    clientSecret: decryptMailSecret(s.googleClientSecretEncrypted),
    redirectUri: s.googleRedirectUri,
  };
}

export function buildAuthorizationUrl(config: GmailConfiguration, state: string, verifier: string): string {
  const url = new URL(GOOGLE_AUTH_URL);
  const hash = createHash("sha256").update(verifier).digest("base64url");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: hash,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(25_000), redirect: "error" });
}

export async function exchangeGoogleCode(code: string, verifier: string, config: GmailConfiguration) {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  const response = await timedFetch(GOOGLE_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof data.access_token !== "string" || typeof data.refresh_token !== "string") {
    throw new Error("Google no autorizó la conexión. Comprueba el consentimiento de Gmail y la URI de retorno.");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000),
  };
}

export async function refreshGmailAccessToken(account: CoordinatorMailAccount): Promise<string> {
  if (!account.refreshTokenEncrypted) throw new GmailRequestError("Reconnecta tu cuenta de Gmail.", 401, true);
  const config = await getGmailConfiguration();
  if (!config) throw new GmailRequestError("La administración debe configurar Gmail.", 503, true);
  let response: Response;
  try {
    response = await timedFetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId, client_secret: config.clientSecret,
        refresh_token: decryptMailSecret(account.refreshTokenEncrypted), grant_type: "refresh_token",
      }),
    });
  } catch {
    throw new GmailRequestError("No se pudo contactar con Google; inténtalo de nuevo más tarde.", 503, false);
  }
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof data.access_token !== "string") {
    throw new GmailRequestError(
      data.error === "invalid_grant" ? "Reconecta tu cuenta de Gmail desde Asuntos y correos." : "Google rechazó la autorización; revisa la conexión Gmail.",
      response.status === 400 || response.status === 401 ? 401 : 503,
      true,
    );
  }
  const accessToken = data.access_token;
  await db.update(coordinatorMailAccountsTable).set({
    accessTokenEncrypted: encryptMailSecret(accessToken),
    accessTokenExpiresAt: new Date(Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000),
    updatedAt: new Date(),
  }).where(eq(coordinatorMailAccountsTable.id, account.id));
  return accessToken;
}

export async function getAccessToken(account: CoordinatorMailAccount): Promise<string> {
  if (!account.accessTokenEncrypted || !account.refreshTokenEncrypted) throw new GmailRequestError("Reconecta tu cuenta de Gmail.", 401, true);
  if (account.accessTokenExpiresAt && account.accessTokenExpiresAt.getTime() > Date.now() + 120_000) {
    return decryptMailSecret(account.accessTokenEncrypted);
  }
  return refreshGmailAccessToken(account);
}

export async function gmailGet(account: CoordinatorMailAccount, path: string): Promise<unknown> {
  if (!/^\/(?:profile|messages|messages\/[a-zA-Z0-9_-]+(?:\/attachments\/[a-zA-Z0-9_-]+)?|threads\/[a-zA-Z0-9_-]+)$/.test(path)) {
    throw new Error("Gmail request path is invalid.");
  }
  let token = await getAccessToken(account);
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      response = await timedFetch(`${GMAIL_API}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    } catch {
      throw new GmailRequestError("No se pudo leer Gmail; se reintentará la sincronización.", 503, false);
    }
    if (response.status === 401 && attempt === 0) {
      token = await refreshGmailAccessToken(account);
      continue;
    }
    if (!response.ok) {
      throw new GmailRequestError(
        response.status === 429 ? "Gmail ha limitado las peticiones; la sincronización se reintentará." : "Gmail rechazó la lectura; revisa su autorización.",
        response.status,
        response.status >= 400 && response.status < 500 && response.status !== 429,
      );
    }
    return response.json();
  }
  throw new GmailRequestError("Reconecta Gmail.", 401, true);
}

export async function gmailQuery(account: CoordinatorMailAccount, params: Record<string, string>): Promise<unknown> {
  if (Object.keys(params).some(k => !["maxResults", "pageToken", "q"].includes(k))) throw new Error("Invalid Gmail query.");
  const query = new URLSearchParams(params);
  let token = await getAccessToken(account);
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      response = await timedFetch(`${GMAIL_API}/messages?${query}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    } catch {
      throw new GmailRequestError("No se pudo consultar Gmail; se reintentará la sincronización.", 503, false);
    }
    if (response.status === 401 && attempt === 0) { token = await refreshGmailAccessToken(account); continue; }
    if (!response.ok) {
      throw new GmailRequestError(
        response.status === 429 ? "Gmail ha limitado las peticiones; la sincronización se reintentará." : "Gmail rechazó la consulta; revisa su autorización.",
        response.status,
        response.status >= 400 && response.status < 500 && response.status !== 429,
      );
    }
    return response.json();
  }
  throw new GmailRequestError("Reconecta Gmail.", 401, true);
}

export async function sendGmailRaw(account: CoordinatorMailAccount, raw: string, threadId: string | null): Promise<{ id: string; threadId: string }> {
  const token = await getAccessToken(account);
  const response = await timedFetch(`${GMAIL_API}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }),
  });
  if (!response.ok) {
    const code = response.status;
    throw new GmailRequestError(
      code === 429 ? "Gmail ha limitado el envío; puedes reintentarlo." : "Gmail rechazó el mensaje; revisa el borrador y la autorización.",
      code,
      code < 500 && code !== 429,
    );
  }
  const body = await response.json() as Record<string, unknown>;
  if (typeof body.id !== "string" || typeof body.threadId !== "string") {
    throw new GmailRequestError("Gmail no confirmó el resultado del envío.", 502, false);
  }
  return { id: body.id, threadId: body.threadId };
}

export function gmailHeaderMap(headers: unknown): Map<string, string> {
  const result = new Map<string, string>();
  if (!Array.isArray(headers)) return result;
  for (const item of headers) {
    if (!item || typeof item !== "object") continue;
    const h = item as Record<string, unknown>;
    if (typeof h.name === "string" && typeof h.value === "string") {
      const name = h.name.toLowerCase();
      if (!result.has(name)) result.set(name, sanitizeHeader(decodeHeaderWords(h.value), 1000));
    }
  }
  return result;
}

export function parseAddresses(header: string): Array<{ name: string; email: string }> {
  const parts: string[] = [];
  let part = ""; let quoted = false; let escaped = false; let angle = false;
  for (const char of header) {
    if (escaped) { part += char; escaped = false; continue; }
    if (quoted && char === "\\") { part += char; escaped = true; continue; }
    if (char === '"') quoted = !quoted;
    if (!quoted && char === "<") angle = true;
    if (!quoted && char === ">") angle = false;
    if (!quoted && !angle && char === ",") { if (part.trim()) parts.push(part.trim()); part = ""; }
    else part += char;
  }
  if (part.trim()) parts.push(part.trim());
  return parts.slice(0, 25).flatMap((piece) => {
    const match = piece.match(/^\s*(?:"([^"]*)"|([^<]*?))\s*<([^<>]+)>\s*$/);
    const email = (match?.[3] || piece.replace(/^mailto:/i, "").trim()).toLowerCase();
    if (!safeEmail(email)) return [];
    const name = sanitizeHeader(decodeHeaderWords(match?.[1] ?? match?.[2] ?? ""), 200);
    return [{ name, email }];
  });
}

export function parseMimeParts(payload: unknown): {
  plainText: string;
  truncated: boolean;
  attachments: Array<{ attachmentId: string; fileName: string; contentType: string; size: number }>;
} {
  let plainText = "";
  let htmlText = "";
  const attachments: Array<{ attachmentId: string; fileName: string; contentType: string; size: number }> = [];
  const walk = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object" || depth > 10) return;
    const part = value as Record<string, unknown>;
    const body = (part.body && typeof part.body === "object" ? part.body : {}) as Record<string, unknown>;
    const mime = typeof part.mimeType === "string" ? part.mimeType.toLowerCase() : "";
    const fileName = typeof part.filename === "string" ? sanitizeHeader(part.filename, 180) : "";
    const data = typeof body.data === "string" ? body.data : "";
    if (fileName || typeof body.attachmentId === "string") {
      if (fileName && typeof body.attachmentId === "string") {
        attachments.push({
          attachmentId: body.attachmentId,
          fileName: fileName.replace(/[\/\\\x00-\x1f\x7f]/g, "_") || "adjunto",
          contentType: typeof part.mimeType === "string" ? part.mimeType.slice(0, 200) : "application/octet-stream",
          size: Number.isSafeInteger(body.size) && Number(body.size) >= 0 ? Number(body.size) : 0,
        });
      }
    } else if (data && mime === "text/plain") {
      plainText += Buffer.from(data, "base64url").toString("utf8") + "\n";
    } else if (data && mime === "text/html") {
      htmlText += Buffer.from(data, "base64url").toString("utf8") + "\n";
    }
    if (Array.isArray(part.parts)) for (const child of part.parts) walk(child, depth + 1);
  };
  walk(payload, 0);
  const extracted = plainText.trim() || htmlText.replace(/<(script|style|iframe|object)[^>]*>[\s\S]*?<\/\1\s*>/gi, " ").replace(/<br\s*\/?>|<\/(?:p|div|li|tr)\s*>/gi, "\n").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/[ \t]+\n/g, "\n").trim();
  const clean = safeMailText(extracted);
  return { plainText: clean.text, truncated: clean.truncated, attachments: attachments.slice(0, 40) };
}

export async function downloadGmailAttachment(account: CoordinatorMailAccount, messageId: string, attachmentId: string): Promise<Buffer> {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(messageId) || !/^[A-Za-z0-9_-]{1,300}$/.test(attachmentId)) throw new Error("Identificador de adjunto no válido.");
  const result = await gmailGet(account, `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`) as Record<string, unknown>;
  if (typeof result.data !== "string") throw new Error("Google no devolvió el contenido del adjunto.");
  const data = Buffer.from(result.data, "base64url");
  if (!data.length || data.length > MAX_ATTACHMENT_BYTES) throw new Error("Adjunto vacío o superior a 25 MB.");
  return data;
}

export function decodeRfc822Base64(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) throw new Error("Correo Gmail codificado con formato no válido.");
  const bytes = Buffer.from(value, "base64url");
  if (!bytes.length || bytes.length > MAX_GMAIL_MESSAGE_BYTES) throw new Error("Correo vacío o superior a 40 MB.");
  return bytes;
}

export function makeReplyRaw(options: { from: string; to: string; subject: string; body: string; inReplyTo?: string }): string {
  if (!safeEmail(options.from) || !safeEmail(options.to)) throw new Error("Comprueba las direcciones de correo.");
  const subject = sanitizeHeader(options.subject);
  if (!subject) throw new Error("Escribe el asunto del correo.");
  const messageId = options.inReplyTo && /^<[^<>\r\n ]+>$/.test(options.inReplyTo) ? options.inReplyTo : null;
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
  const body = options.body.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r\n");
  const headers = [
    `From: <${options.from}>`,
    `To: <${options.to}>`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    ...(messageId ? [`In-Reply-To: ${messageId}`, `References: ${messageId}`] : []),
    "",
    Buffer.from(body, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n").trim(),
    "",
  ];
  return Buffer.from(headers.join("\r\n"), "utf8").toString("base64url");
}
