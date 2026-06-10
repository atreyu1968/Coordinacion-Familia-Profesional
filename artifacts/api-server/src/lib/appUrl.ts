import type { Request } from "express";

/**
 * Public base URL of this app (scheme + host, no trailing slash). Prefers the
 * explicit PUBLIC_APP_URL env (set during install behind the reverse proxy),
 * otherwise reconstructs it from the forwarded headers nginx sends.
 */
export function getAppBaseUrl(req: Request): string {
  const explicit = (process.env["PUBLIC_APP_URL"] || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const proto =
    req.headers["x-forwarded-proto"]?.toString().split(",")[0]?.trim() ||
    req.protocol ||
    "http";
  const host =
    req.headers["x-forwarded-host"]?.toString() ||
    req.headers.host ||
    "localhost";
  return `${proto}://${host}`;
}

/** Read a single cookie value from the raw Cookie header. */
export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}
