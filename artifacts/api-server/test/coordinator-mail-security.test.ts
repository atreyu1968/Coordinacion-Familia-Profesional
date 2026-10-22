import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptMailSecret, decodeHeaderWords, encryptMailSecret,
  htmlMailToText, safeEmail, safeMailText, sanitizeHeader, sha256,
} from "../src/lib/coordinatorMailSecurity";

const priorJwtSecret = process.env.JWT_SECRET;

beforeEach(() => { process.env.JWT_SECRET = "coordinator-mail-test-key-not-for-production-001"; });
afterEach(() => {
  if (priorJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = priorJwtSecret;
});

describe("coordinator mail private-data protection", () => {
  it("encrypts Gmail credentials with authenticated ciphertext", () => {
    const saved = encryptMailSecret("mail-client-secret");
    expect(saved).not.toContain("mail-client-secret");
    expect(decryptMailSecret(saved)).toBe("mail-client-secret");
    const pieces = saved.split(".");
    pieces[pieces.length - 1] = Buffer.from("altered").toString("base64url");
    expect(() => decryptMailSecret(pieces.join("."))).toThrow();
  });

  it("requires a strong application key and never accepts a tampered envelope", () => {
    process.env.JWT_SECRET = "short";
    expect(() => encryptMailSecret("private")).toThrow(/strong JWT_SECRET/i);
    process.env.JWT_SECRET = "coordinator-mail-test-key-not-for-production-001";
    const valid = encryptMailSecret("private");
    process.env.JWT_SECRET = "coordinator-mail-test-key-not-for-production-002";
    expect(() => decryptMailSecret(valid)).toThrow(/could not be decrypted/i);
  });

  it("validates recipient addresses and removes newline header injection", () => {
    expect(safeEmail("coordination@example.org")).toBe(true);
    expect(safeEmail("one@example.org\r\nBcc: attacker@example.org")).toBe(false);
    expect(safeEmail("user@example..org")).toBe(false);
    expect(sanitizeHeader("Update\r\nBcc: hidden@example.org", 80)).toBe("Update Bcc: hidden@example.org");
  });

  it("decodes harmless display headers without interpreting active email HTML", () => {
    expect(decodeHeaderWords("=?UTF-8?B?Q29vcmRpbmFjacOzbg==?=")).toBe("Coordinación");
    const text = htmlMailToText("<p>Hola</p><script>steal()</script><iframe>run()</iframe><p>Adiós &amp; gracias</p>");
    expect(text).toContain("Hola");
    expect(text).toContain("Adiós & gracias");
    expect(text).not.toMatch(/steal|run\(\)|<script|<iframe/i);
  });

  it("bounds imported email text and creates a deterministic state hash", () => {
    expect(safeMailText("123456", 4)).toEqual({ text: "1234", truncated: true });
    expect(sha256("one-time-state")).toBe(sha256("one-time-state"));
  });
});
