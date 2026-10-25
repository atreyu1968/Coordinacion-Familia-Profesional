import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import Pdf from "react-native-pdf";
import * as FileSystem from "expo-file-system/legacy";
import { AppHeader } from "@/components/AppHeader";
import { useColors } from "@/hooks/useColors";
import { getAuthToken } from "@/contexts/AuthContext";

export default function PdfViewerScreen({ uri: uriProp, title: titleProp, embedded = false }: {
  uri?: string;
  title?: string;
  embedded?: boolean;
}) {
  const colors = useColors();
  const params = useLocalSearchParams<{ uri?: string; title?: string }>();
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [error, setError] = useState("");
  const uri = uriProp ?? (typeof params.uri === "string" ? params.uri : "");
  const title = titleProp ?? (typeof params.title === "string" ? params.title : "Documento PDF");
  const headers = useMemo(() => {
    const token = getAuthToken();
    return token ? { Authorization: `Bearer ${token}` } : undefined;
  }, [uri]);

  useEffect(() => {
    let cancelled = false;
    let temporaryUri: string | null = null;
    setLocalUri(null);
    setError("");

    async function prepare() {
      const cache = FileSystem.cacheDirectory;
      if (!uri || !cache) throw new Error("No se puede abrir este documento.");
      const safeName = title.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "_");
      let resultUri = uri;
      if (/^https:\/\//i.test(uri)) {
        const base = process.env.EXPO_PUBLIC_DOMAIN;
        if (!base || new URL(uri).origin !== new URL(`https://${base}`).origin) {
          throw new Error("La dirección del documento no es válida.");
        }
        resultUri = `${cache}coordina-pdf-${Date.now()}-${safeName.endsWith(".pdf") ? safeName : "documento.pdf"}`;
        temporaryUri = resultUri;
        const result = await FileSystem.downloadAsync(uri, resultUri, { headers });
        if (result.status < 200 || result.status >= 300) {
          await FileSystem.deleteAsync(result.uri, { idempotent: true });
          throw new Error(result.status === 401 || result.status === 403
            ? "No tienes permiso para abrir este documento."
            : "No se pudo cargar el PDF. Inténtalo de nuevo.");
        }
      } else if (!uri.startsWith(cache) && !(FileSystem.documentDirectory && uri.startsWith(FileSystem.documentDirectory))) {
        throw new Error("La dirección del documento no es válida.");
      }
      if (!cancelled) setLocalUri(resultUri);
    }

    void prepare().catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "No se pudo abrir el PDF.");
    });
    return () => {
      cancelled = true;
      if (temporaryUri) void FileSystem.deleteAsync(temporaryUri, { idempotent: true });
    };
  }, [uri, title, headers]);

  return (
    <View style={[styles.screen, embedded ? styles.embedded : null, { backgroundColor: colors.background }]}>
      {!embedded ? <AppHeader title={title} showBack /> : null}
      {error ? <View style={styles.center}><Text style={[styles.error, { color: colors.destructive }]}>{error}</Text></View> : null}
      {!error && !localUri ? <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /><Text style={{ color: colors.mutedForeground, marginTop: 12 }}>Abriendo documento…</Text></View> : null}
      {localUri ? (
        <Pdf
          source={{ uri: localUri, cache: false }}
          style={styles.pdf}
          onError={() => setError("No se pudo mostrar el PDF. Prueba a descargarlo.")}
          trustAllCerts={false}
          enablePaging={false}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  embedded: { height: 700, minHeight: 500, flex: undefined, borderRadius: 12, overflow: "hidden" },
  pdf: { flex: 1, width: "100%", backgroundColor: "transparent" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  error: { textAlign: "center", fontSize: 15 },
});
