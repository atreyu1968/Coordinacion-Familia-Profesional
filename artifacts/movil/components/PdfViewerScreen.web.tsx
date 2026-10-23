import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { WebView } from "react-native-webview";
import { AppHeader } from "@/components/AppHeader";
import { useColors } from "@/hooks/useColors";
import { getAuthToken } from "@/contexts/AuthContext";

export default function PdfViewerScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ uri?: string; title?: string }>();
  const [blobUrl, setBlobUrl] = useState("");
  const [error, setError] = useState("");
  const uri = typeof params.uri === "string" ? params.uri : "";
  const title = typeof params.title === "string" ? params.title : "Documento PDF";

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    void (async () => {
      const parsedUri = new URL(uri, window.location.href);
      if (parsedUri.protocol !== "blob:" && parsedUri.origin !== window.location.origin) {
        throw new Error("La dirección del documento no es válida.");
      }
      const token = getAuthToken();
      const response = await fetch(parsedUri.href, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403
        ? "No tienes permiso para abrir este documento."
        : "No se pudo cargar el PDF. Inténtalo de nuevo.");
      const blob = await response.blob();
      const header = await blob.slice(0, 1024).text();
      if (!header.includes("%PDF-")) throw new Error("El archivo no es un PDF válido.");
      const pdfBlob = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
      objectUrl = URL.createObjectURL(pdfBlob);
      if (!cancelled) setBlobUrl(objectUrl);
    })().catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "No se pudo abrir el PDF.");
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (uri.startsWith("blob:")) URL.revokeObjectURL(uri);
    };
  }, [uri]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <AppHeader title={title} showBack />
      {error ? <View style={styles.center}><Text style={{ color: colors.destructive, textAlign: "center" }}>{error}</Text></View> : null}
      {!error && !blobUrl ? <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /><Text style={{ color: colors.mutedForeground, marginTop: 12 }}>Abriendo documento…</Text></View> : null}
      {blobUrl ? (
        <WebView
          source={{ html: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#eee"><iframe title="${title.replace(/[<>&"]/g, "")}" src="${blobUrl}" style="position:fixed;inset:0;width:100%;height:100%;border:0" /></body></html>` }}
          style={styles.viewer}
          originWhitelist={["*"]}
          setSupportMultipleWindows={false}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  viewer: { flex: 1, backgroundColor: "#e5e7eb" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
});
