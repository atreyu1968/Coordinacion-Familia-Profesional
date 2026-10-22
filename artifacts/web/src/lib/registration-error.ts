import { getApiErrorMessage } from "./user-management";

export function isInvalidRegistrationInvitation(error: unknown): boolean {
  return getApiErrorMessage(error) === "Invitación no válida o caducada";
}

/** Only expose known registration messages, never arbitrary server diagnostics. */
export function getRegistrationErrorMessage(error: unknown): string {
  const status = error && typeof error === "object" && "status" in error
    ? (error as { status?: unknown }).status : undefined;
  if (typeof status === "number" && status >= 500) {
    return "El servicio no ha podido completar el registro. Inténtalo más tarde; si continúa, contacta con coordinación.";
  }
  if (status === 429) {
    return "Se han realizado demasiados intentos. Espera unos minutos antes de volver a intentarlo.";
  }
  switch (getApiErrorMessage(error)) {
    case "Ya existe una cuenta con este correo":
      return "Ya existe una cuenta con este correo. Inicia sesión o recupera tu contraseña; no necesitas registrarte de nuevo.";
    case "La cuenta asociada a este correo está desactivada. Contacta con coordinación para revisar su reactivación.":
      return "Tu cuenta está desactivada. Contacta con coordinación para revisar su reactivación; no puedes crear otra cuenta con este mismo correo.";
    case "Invitación no válida o caducada":
      return "La invitación ha caducado, se ha anulado o ya no tiene plazas. Solicita un nuevo enlace a coordinación.";
    case "Debes leer y aceptar la versión actual de los textos legales":
      return "Debes leer y aceptar la versión vigente de los términos y la información de privacidad. Recarga la página antes de volver a intentarlo.";
  }
  if (status === 400) {
    return "Revisa el correo electrónico, la contraseña (mínimo 8 caracteres) y las casillas de información legal.";
  }
  if (error instanceof TypeError) {
    return "No se pudo conectar con el servicio. Comprueba tu conexión y vuelve a intentarlo.";
  }
  return "No se pudo completar el registro. Inténtalo de nuevo; si continúa, contacta con coordinación.";
}
