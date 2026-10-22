export type Base64File = { filename: string; contentBase64: string };

export function downloadBase64File(file: Base64File, mime?: string) {
  const bin = atob(file.contentBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const type =
    mime ?? (file.filename.toLowerCase().endsWith(".zip") ? "application/zip" : "application/pdf");
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function apiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: { message?: unknown } } | null)?.data;
  if (data && typeof data.message === "string" && data.message.trim()) return data.message;
  return fallback;
}

export function apiErrorStatus(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : undefined;
}

/** Only accept app-relative paths: "/x", never "//host", "\\", or schemes. */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  if (/[\u0000-\u001f]/.test(raw)) return null;
  if (raw.startsWith("/login") || raw.startsWith("/register")) return null;
  return raw;
}

export function formatLongDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-ES", { dateStyle: "long" });
}

export const MODALITY_LABELS: Record<string, string> = {
  presencial: "Presencial",
  videoconferencia: "Videoconferencia",
  hibrida: "Híbrida",
};
