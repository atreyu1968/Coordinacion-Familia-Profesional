import { describe, expect, it } from "vitest";
import { getRegistrationErrorMessage, isInvalidRegistrationInvitation } from "./registration-error";

describe("Registration error messages", () => {
  it("offers sign-in or recovery instead of suggesting another registration", () => {
    expect(getRegistrationErrorMessage({ status: 400, data: { message: "Ya existe una cuenta con este correo" } }))
      .toContain("Inicia sesión o recupera tu contraseña");
  });
  it("explains expired, revoked or exhausted invitations", () => {
    const error = { status: 400, data: { message: "Invitación no válida o caducada" } };
    expect(getRegistrationErrorMessage(error))
      .toContain("Solicita un nuevo enlace");
    expect(isInvalidRegistrationInvitation(error)).toBe(true);
    expect(isInvalidRegistrationInvitation({ data: { message: "Ya existe una cuenta con este correo" } })).toBe(false);
  });
  it("does not suggest password recovery or repeated registration for disabled accounts", () => {
    const message = getRegistrationErrorMessage({
      status: 400, data: { message: "La cuenta asociada a este correo está desactivada. Contacta con coordinación para revisar su reactivación." },
    });
    expect(message).toContain("Tu cuenta está desactivada");
    expect(message).toContain("Contacta con coordinación");
    expect(message).not.toContain("recupera tu contraseña");
  });
  it("requires current legal acceptance without referring to drafts", () => {
    const message = getRegistrationErrorMessage({
      status: 400, data: { message: "Debes leer y aceptar la versión actual de los textos legales" },
    });
    expect(message).toContain("versión vigente");
    expect(message).not.toContain("borrador");
  });
  it("does not expose validation dumps, SQL errors or unexpected server messages", () => {
    expect(getRegistrationErrorMessage({ status: 400, data: { message: '[{"path":["email"],"code":"invalid_format"}]' } }))
      .toContain("Revisa el correo");
    const message = getRegistrationErrorMessage({ status: 500, data: { message: "SQL internal diagnostic" } });
    expect(message).toContain("El servicio");
    expect(message).not.toContain("SQL");
  });
  it("distinguishes network failures and rate limiting", () => {
    expect(getRegistrationErrorMessage(new TypeError("Failed to fetch"))).toContain("Comprueba tu conexión");
    expect(getRegistrationErrorMessage({ status: 429 })).toContain("Espera unos minutos");
  });
});
