import React from "react";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";

import {
  useListAnnouncements,
  type Announcement,
  type AnnouncementAttachment,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { TeacherConfirmationBanner } from "@/components/TeacherConfirmationBanner";
import { Card, EmptyState, ErrorState, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { getAuthToken } from "@/contexts/AuthContext";
import { formatRelative } from "@/lib/format";

function apiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return `https://${domain}/api`;
}

function formatSize(bytes?: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Download a private attachment with the current session. Web/PWA uses a blob
// download; native devices save it to app storage and open the system share sheet.
async function downloadAttachment(att: AnnouncementAttachment) {
  const token = getAuthToken();
  try {
    if (!token) {
      Alert.alert("Sesión caducada", "Inicia sesión de nuevo para descargar el adjunto.");
      return;
    }

    const url = `${apiBase()}/announcements/attachments/${att.id}/file`;
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Comprueba tus permisos o inténtalo de nuevo.");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = att.fileName || "documento";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      return;
    }

    const directory = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
    if (!directory) throw new Error("No hay espacio disponible para guardar el archivo.");
    const safeName = (att.fileName || `documento-${att.id}`).replace(/[^\w.\-]+/g, "_");
    const destination = `${directory}tablon-${att.id}-${safeName}`;
    const download = await FileSystem.downloadAsync(url, destination, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (download.status < 200 || download.status >= 300) {
      await FileSystem.deleteAsync(download.uri, { idempotent: true });
      throw new Error("Comprueba tus permisos o inténtalo de nuevo.");
    }
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(download.uri, {
        dialogTitle: `Compartir ${att.fileName || "documento"}`,
        mimeType: att.contentType ?? "application/octet-stream",
      });
    } else {
      Alert.alert("Adjunto descargado", "El archivo se ha guardado en los documentos de la app.");
    }
  } catch {
    Alert.alert("No se pudo descargar", "Comprueba tu conexión y permisos, e inténtalo de nuevo.");
  }
}

export default function BoardScreen() {
  const colors = useColors();
  const { data, isLoading, isError, refetch, isRefetching } =
    useListAnnouncements();

  const bottomPad = Platform.OS === "web" ? 100 : 90;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Tablón" subtitle="Anuncios y comunicados" />
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item: Announcement) => String(item.id)}
          contentContainerStyle={[styles.list, { paddingBottom: bottomPad }]}
          onRefresh={refetch}
          refreshing={isRefetching}
          scrollEnabled
          ListHeaderComponent={<TeacherConfirmationBanner />}
          ListEmptyComponent={
            <EmptyState
              icon="layout"
              title="Sin anuncios"
              message="Cuando la coordinación publique comunicados aparecerán aquí."
            />
          }
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <Text style={[styles.title, { color: colors.foreground }]}>
                {item.title}
              </Text>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                {item.body}
              </Text>
              {item.attachments && item.attachments.length > 0 && (
                <View style={styles.attachments}>
                  {item.attachments.map((att) => (
                    <Pressable
                      key={att.id}
                      onPress={() => downloadAttachment(att)}
                      accessibilityRole="button"
                      accessibilityLabel={`Descargar ${att.fileName}`}
                      style={({ pressed }) => [
                        styles.attachment,
                        {
                          borderColor: colors.border,
                          backgroundColor: colors.muted,
                          opacity: pressed ? 0.6 : 1,
                        },
                      ]}
                    >
                      <Feather name="download" size={14} color={colors.primary} />
                      <Text
                        numberOfLines={1}
                        style={[styles.attachmentName, { color: colors.foreground }]}
                      >
                        {att.fileName}
                      </Text>
                      {att.size != null && (
                        <Text
                          style={[styles.attachmentSize, { color: colors.mutedForeground }]}
                        >
                          {formatSize(att.size)}
                        </Text>
                      )}
                    </Pressable>
                  ))}
                </View>
              )}
              <View style={styles.metaRow}>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {item.authorName ?? "Coordinación"}
                </Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {formatRelative(item.createdAt)}
                </Text>
              </View>
            </Card>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, gap: 12, flexGrow: 1 },
  card: { gap: 8 },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  body: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 21 },
  attachments: { gap: 6, marginTop: 2 },
  attachment: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  attachmentName: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  attachmentSize: { fontSize: 11, fontFamily: "Inter_400Regular" },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  meta: { fontSize: 12, fontFamily: "Inter_500Medium" },
});
