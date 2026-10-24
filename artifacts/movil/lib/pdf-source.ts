export function resolvePdfSource(uri: string, appOrigin: string, apiDomain?: string) {
  if (!uri) throw new Error("No se ha indicado un documento.");
  const parsed = new URL(uri, appOrigin);
  if (parsed.username || parsed.password) throw new Error("La dirección del documento no es válida.");
  if (parsed.protocol === "blob:" && parsed.origin === appOrigin) return parsed;
  const allowed = new Set([appOrigin]);
  if (apiDomain) allowed.add(new URL(`https://${apiDomain}`).origin);
  if (!["http:", "https:"].includes(parsed.protocol) || !allowed.has(parsed.origin)) {
    throw new Error("La dirección del documento no es válida.");
  }
  return parsed;
}

export async function loadPdfBytes(
  uri: string,
  appOrigin: string,
  apiDomain: string | undefined,
  token: string | null,
  signal?: AbortSignal,
) {
  const parsed = resolvePdfSource(uri, appOrigin, apiDomain);
  const response = await fetch(parsed.href, {
    headers: token && parsed.protocol !== "blob:" ? { Authorization: `Bearer ${token}` } : {},
    signal,
  });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403
    ? "No tienes permiso para abrir este documento." : "No se pudo cargar el PDF. Inténtalo de nuevo.");
  const limit = 50 * 1024 * 1024;
  if (Number(response.headers.get("Content-Length")) > limit) throw new Error("Este PDF supera los 50 MB. Utiliza la descarga.");
  const blob = await response.blob();
  if (blob.size > limit) throw new Error("Este PDF supera los 50 MB. Utiliza la descarga.");
  const header = await blob.slice(0, 1024).text();
  if (!header.includes("%PDF-")) throw new Error("El archivo no es un PDF válido.");
  return blob.arrayBuffer();
}
