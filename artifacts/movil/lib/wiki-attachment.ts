import { Linking, Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { getAuthToken } from "@/contexts/AuthContext";

/** Authenticated (Bearer) download of a protected wiki attachment. Shared by wiki and forum resources. */
export async function downloadAttachment(attachmentId: number, fileName: string) {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) throw new Error("No se pudo conectar con el servicio de documentación.");
  const url = `https://${domain}/api/wiki/attachments/${attachmentId}/download`;
  const token = getAuthToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

  if (Platform.OS === "web") {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error("No se pudo descargar el archivo.");
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = fileName || "documento";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(blobUrl);
    return;
  }

  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) throw new Error("No hay una carpeta temporal disponible.");
  const safeName = (fileName || `documento-${Date.now()}`).replace(
    /[^\w.\-]+/g,
    "_",
  );
  const result = await FileSystem.downloadAsync(
    url,
    `${cacheDirectory}${safeName}`,
    { headers },
  );
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(result.uri);
  } else {
    await Linking.openURL(result.uri);
  }
}


const WIKI_ATTACHMENT = /^\/api\/wiki\/attachments\/(\d+)\/download$/;
export function wikiAttachmentId(url: string): number | null {
  const m = WIKI_ATTACHMENT.exec(url.trim());
  return m ? Number(m[1]) : null;
}
