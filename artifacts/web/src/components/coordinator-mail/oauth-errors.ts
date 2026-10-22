/** Only expose intentional client-error messages, never server diagnostics. */
export function gmailOAuthErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== "object") return fallback;
  const { status, data } = error as { status?: unknown; data?: unknown };
  if (typeof status !== "number" || status < 400 || status >= 500 ||
      !data || typeof data !== "object") return fallback;
  const message = (data as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : fallback;
}
