import { describe, expect, it } from "vitest";
import { gmailOAuthCallbackErrorMessage, gmailOAuthErrorMessage } from "./oauth-errors";

describe("Gmail OAuth configuration errors", () => {
  const fallback = "No se pudo guardar la configuración.";

  it("shows the exact redirect URI required by the server", () => {
    const message = "Usa exactamente esta URI de retorno: https://example.test/api/coordinator-mail/gmail/callback";
    expect(gmailOAuthErrorMessage({ status: 400, data: { message } }, fallback)).toBe(message);
  });

  it("preserves an actionable client ID or secret validation error", () => {
    const message = "Al cambiar el identificador de cliente, introduce el secreto correspondiente.";
    expect(gmailOAuthErrorMessage({ status: 409, data: { message } }, fallback)).toBe(message);
  });

  it("does not display server diagnostics or network errors", () => {
    expect(gmailOAuthErrorMessage({ status: 500, data: { message: "private diagnostic" } }, fallback)).toBe(fallback);
    expect(gmailOAuthErrorMessage(new Error("network failure"), fallback)).toBe(fallback);
    expect(gmailOAuthErrorMessage(null, fallback)).toBe(fallback);
    expect(gmailOAuthErrorMessage({ status: 400, data: { message: "" } }, fallback)).toBe(fallback);
  });

  it("explains the safe Gmail callback failure categories", () => {
    expect(gmailOAuthCallbackErrorMessage("refresh_token")).toContain("acceso sin conexión");
    expect(gmailOAuthCallbackErrorMessage("save")).toContain("no se pudo guardar");
    expect(gmailOAuthCallbackErrorMessage("unknown")).toContain("código de error");
  });
});
