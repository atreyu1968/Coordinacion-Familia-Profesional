import React, { useState } from "react";
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import {
  getGetEventMinutesQueryKey,
  getGetEventQueryKey,
  type MinutesSharedDocument,
  useGetEvent,
  useGetEventMinutes,
} from "@workspace/api-client-react";
import { AppHeader } from "@/components/AppHeader";
import { ErrorState } from "@/components/ui";
import { getAuthToken, useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

async function downloadPrivateFile(path: string, fileName: string) {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) throw new Error("No se pudo conectar con el servicio de actas.");
  const url = `https://${domain}${path}`;
  const token = getAuthToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  if (Platform.OS === "web") {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(response.status === 404 ? "El documento ya no está disponible." : "No se pudo descargar el archivo.");
    const objectUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName || "documento";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return;
  }
  const cache = FileSystem.cacheDirectory;
  if (!cache) throw new Error("No hay una carpeta temporal disponible.");
  const safeName = (fileName || `documento-${Date.now()}`).replace(/[^\w.\-]+/g, "_");
  const result = await FileSystem.downloadAsync(url, `${cache}${safeName}`, { headers });
  if (result.status < 200 || result.status >= 300) throw new Error("No se pudo descargar el documento.");
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(result.uri);
  else await Linking.openURL(result.uri);
}

export default function ActaScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ id: string; name?: string; startAt?: string }>();
  const { id } = params;
  const eventId = Number(id);
  const valid = Number.isInteger(eventId) && eventId > 0;
  const { user } = useAuth();
  const isDepartmentHead = user?.role === "department_head";
  const [downloading, setDownloading] = useState<string | null>(null);
  const event = useGetEvent(eventId, {
    query: { queryKey: getGetEventQueryKey(eventId), enabled: valid && !isDepartmentHead, retry: false },
  });
  const minutes = useGetEventMinutes(eventId, {
    query: {
      queryKey: getGetEventMinutesQueryKey(eventId),
      enabled: valid && (isDepartmentHead || event.data?.type === "coordination_meeting"),
      retry: false,
      staleTime: 0,
      refetchOnMount: "always",
      refetchInterval: 30_000,
    },
  });
  const notMeeting = !isDepartmentHead && !!event.data && event.data.type !== "coordination_meeting";

  const m = minutes.data;
  // This reader screen shows only the uploaded official document, never AI text.
  const publishedDocument = m?.enabled && m.publishedAt ? m.publishedDocument : null;
  const sharedDocuments = m?.sharedDocuments ?? [];
  const eventName = event.data?.name ?? (typeof params.name === "string" ? params.name : null) ?? "Reunión de coordinación";

  const onDownload = async (key: string, path: string, fileName: string) => {
    setDownloading(key);
    try {
      await downloadPrivateFile(path, fileName);
    } catch (error) {
      Alert.alert("No se pudo descargar", error instanceof Error ? error.message : "Inténtalo de nuevo.");
    } finally {
      setDownloading(null);
    }
  };

  const onOpenLink = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("No se pudo abrir el enlace", "Comprueba la conexión e inténtalo de nuevo.");
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Acta" subtitle={eventName} showBack />
      {!valid ? (
        <View style={styles.center}>
          <Text style={{ color: colors.destructive }}>Enlace de acta no válido.</Text>
        </View>
      ) : !isDepartmentHead && event.error ? (
        <ErrorState onRetry={event.refetch} />
      ) : notMeeting ? (
        <View style={styles.center}>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
            Este evento no es una reunión de coordinación y no tiene acta.
          </Text>
        </View>
      ) : (!isDepartmentHead && event.isLoading) || minutes.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : minutes.error ? (
        <ErrorState onRetry={minutes.refetch} />
      ) : !publishedDocument ? (
        <View style={styles.center}>
          <Feather name="file-text" size={28} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            {isDepartmentHead ? "No hay acta oficial publicada" : "No hay acta publicada"}
          </Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
            {isDepartmentHead
              ? "Solo aparecen aquí los documentos definitivos que la coordinación haya subido y publicado."
              : "Aparecerá aquí cuando la coordinación publique el acta final."}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.bar, { backgroundColor: colors.primary }]} />
            <Text style={[styles.kicker, { color: colors.primary }]}>ACTA OFICIAL PUBLICADA</Text>
            {m?.publishedAt ? (
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                Publicada el{" "}
                {new Date(m.publishedAt).toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" })}
              </Text>
            ) : null}
            {publishedDocument ? (
              <Pressable
                testID="button-download-published-acta"
                accessibilityRole="button"
                accessibilityLabel={`Descargar acta ${publishedDocument.fileName}`}
                disabled={downloading === "acta"}
                onPress={() => void onDownload("acta", `/api/events/${eventId}/minutes/documents/published`, publishedDocument.fileName)}
                style={({ pressed }) => [styles.fileAction, { backgroundColor: colors.primary, opacity: pressed || downloading === "acta" ? 0.75 : 1 }]}
              >
                <Feather name="download" size={17} color={colors.primaryForeground} />
                <Text style={[styles.fileActionText, { color: colors.primaryForeground }]} numberOfLines={2}>
                  {downloading === "acta" ? "Preparando descarga…" : `Descargar acta · ${publishedDocument.fileName}`}
                </Text>
              </Pressable>
            ) : null}
            {sharedDocuments.length > 0 ? (
              <View style={[styles.sharedSection, { borderTopColor: colors.border }]}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Documentos compartidos</Text>
                {sharedDocuments.map((document: MinutesSharedDocument) => (
                  <Pressable
                    key={document.id}
                    testID={`shared-acta-document-${document.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={document.kind === "link" ? `Abrir ${document.title}` : `Descargar ${document.title}`}
                    onPress={() => document.kind === "link" && document.url
                      ? void onOpenLink(document.url)
                      : void onDownload(
                        `shared-${document.id}`,
                        `/api/events/${eventId}/minutes/shared-documents/${document.id}/download`,
                        document.fileName ?? document.title,
                      )}
                    style={({ pressed }) => [styles.sharedRow, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Feather name={document.kind === "link" ? "external-link" : "file-text"} size={17} color={colors.primary} />
                    <Text style={[styles.sharedTitle, { color: colors.foreground }]} numberOfLines={2}>{document.title}</Text>
                    <Feather name={document.kind === "link" ? "arrow-up-right" : "download"} size={16} color={colors.mutedForeground} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginTop: 6 },
  emptyBody: { fontSize: 14, textAlign: "center", fontFamily: "Inter_400Regular" },
  scroll: { padding: 16, paddingBottom: 48 },
  sheet: { borderWidth: 1, borderRadius: 14, padding: 18, overflow: "hidden" },
  bar: { position: "absolute", top: 0, left: 0, right: 0, height: 4 },
  kicker: { fontSize: 11, letterSpacing: 2, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  meta: { fontSize: 12, marginTop: 4, fontFamily: "Inter_400Regular" },
  fileAction: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, marginTop: 14 },
  fileActionText: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sharedSection: { marginTop: 20, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  sharedRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  sharedTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
});
