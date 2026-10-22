/** Only expose intentional client-error messages, never server diagnostics. */
export function gmailOAuthErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== "object") return fallback;
  const { status, data } = error as { status?: unknown; data?: unknown };
  if (typeof status !== "number" || status < 400 || status >= 500 ||
      !data || typeof data !== "object") return fallback;
  const message = (data as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : fallback;
}

export function gmailOAuthCallbackErrorMessage(reason: string | null): string {
  switch (reason) {
    case "google":
      return "Google no completó la autorización. Vuelve a intentarlo y comprueba que tu cuenta figure entre los usuarios de prueba si la aplicación está en modo de prueba.";
    case "state":
      return "No se pudo validar el retorno de Google. Inicia la autorización otra vez desde esta aplicación y en el mismo navegador.";
    case "configuration":
      return "No se pudo leer la configuración de Gmail. La superadministración debe revisar el ID de cliente y la URI de retorno.";
    case "token":
      return "Google no pudo completar el intercambio de autorización. Comprueba la URI de retorno autorizada y vuelve a intentarlo.";
    case "mailbox":
      return "Google autorizó la cuenta, pero la aplicación no pudo verificar el buzón. Comprueba que Gmail API esté activada en el proyecto de Google.";
    case "refresh_token":
      return "Google no devolvió acceso sin conexión para sincronizar Gmail. Revoca el acceso anterior de esta aplicación en tu cuenta de Google y vuelve a autorizarla.";
    case "save":
      return "Google autorizó la cuenta, pero no se pudo guardar la conexión. Reintenta; si persiste, revisa el servicio de la aplicación.";
    default:
      return "No se pudo completar la conexión con Gmail. Vuelve a autorizar la cuenta; si persiste, comparte el código de error que aparece en la dirección de retorno.";
  }
}
