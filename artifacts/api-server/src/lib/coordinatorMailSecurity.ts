import { createHash, createCipheriv, createDecipheriv, randomBytes, createHmac } from "node:crypto";

const PREFIX = "coordina-mail-v1";

function encryptionKey(): Buffer {
  const root = process.env.JWT_SECRET;
  if (!root || Buffer.byteLength(root) < 32) {
    throw new Error("A strong JWT_SECRET is required to protect private Gmail credentials.");
  }
  return createHmac("sha256", root).update(`${PREFIX}:key`).digest();
}

export function encryptMailSecret(plain: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  cipher.setAAD(Buffer.from(PREFIX));
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [PREFIX, nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptMailSecret(envelope: string): string {
  const [prefix, nonceText, tagText, dataText, extra] = envelope.split(".");
  if (prefix !== PREFIX || !nonceText || !tagText || !dataText || extra) {
    throw new Error("Private Gmail credentials are unavailable; reconnect the mailbox.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(nonceText, "base64url"));
    decipher.setAAD(Buffer.from(PREFIX));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Private Gmail credentials could not be decrypted; reconnect the mailbox.");
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newMailNonce(): string {
  return randomBytes(32).toString("base64url");
}

export function safeEmail(value: string): boolean {
  return value.length <= 254 &&
    /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]{0,251}[A-Z0-9])?$/i.test(value) &&
    !value.includes("..") && !/[\r\n\x00-\x1f\x7f]/.test(value);
}

export function sanitizeHeader(value: string, maxLength = 998): string {
  return value.replace(/[\r\n\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function decodeHeaderWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_match, charset: string, encoding: string, content: string) => {
    try {
      let bytes: Buffer;
      if (encoding.toLowerCase() === "b") bytes = Buffer.from(content, "base64");
      else bytes = Buffer.from(content.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))), "binary");
      const normalized = charset.toLowerCase().replace(/[_-]/g, "");
      return normalized === "iso88591" || normalized === "latin1" ? bytes.toString("latin1") : bytes.toString("utf8");
    } catch {
      return "[cabecera ilegible]";
    }
  });
}

export function safeMailText(value: string, maxLength = 120_000): { text: string; truncated: boolean } {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\u0000/g, "");
  return normalized.length > maxLength
    ? { text: normalized.slice(0, maxLength), truncated: true }
    : { text: normalized, truncated: false };
}

export function htmlMailToText(html: string): string {
  const safe = html
    .replace(/<(script|style|iframe|object|svg|head)[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>|<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&(?:amp|#38);/gi, "&")
    .replace(/&(?:lt|#60);/gi, "<")
    .replace(/&(?:gt|#62);/gi, ">")
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
  return safe.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
