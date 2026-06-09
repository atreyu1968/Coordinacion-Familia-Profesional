import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env["JWT_SECRET"];

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required.");
}

const SECRET: string = JWT_SECRET;
const TOKEN_TTL = "30d";

export interface TokenPayload {
  sub: number;
  role: string;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET);
    if (typeof decoded === "string") return null;
    return decoded as unknown as TokenPayload;
  } catch {
    return null;
  }
}

export function generateInvitationCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 24; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function getAppBaseUrl(): string {
  const domain = process.env["REPLIT_DEV_DOMAIN"];
  if (domain) return `https://${domain}`;
  return "";
}
