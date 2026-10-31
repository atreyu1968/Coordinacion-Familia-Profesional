import { isWikiAttachmentUrl } from "@/lib/curriculum-resources";

// Same token key and Bearer mechanism used by the wiki attachment download in documentacion.tsx.
const TOKEN_KEY = "coordina_adg_token";

/**
 * Opens a resource link. Protected wiki attachments are fetched with the
 * user's session (Bearer) and opened as a blob; never as a raw unauthenticated link.
 */
export async function openResourceUrl(url: string): Promise<void> {
  if (!isWikiAttachmentUrl(url)) {
    window.open(safeExternalUrl(url), "_blank", "noopener,noreferrer");
    return;
  }
  const tab = window.open("", "_blank");
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const response = await fetch(`${import.meta.env.BASE_URL}${url.trim().replace(/^\//, "")}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "include",
    });
    if (!response.ok) throw new Error(response.status === 403 || response.status === 401 ? "No tienes acceso a este adjunto." : "No se pudo abrir el adjunto.");
    const objectUrl = URL.createObjectURL(await response.blob());
    if (tab) tab.location.href = objectUrl;
    else window.location.assign(objectUrl);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
}

/** Only http(s) absolute URLs or same-origin paths; rejects javascript:, data:, file:, etc. */
export function safeExternalUrl(raw: string): string {
  const value = raw.trim();
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("El enlace no es válido.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Tipo de enlace no permitido.");
  return url.href;
}
