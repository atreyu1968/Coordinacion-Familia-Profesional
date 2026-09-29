import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import {
  getGetWikiPageQueryKey,
  useGetWikiPage,
} from "@workspace/api-client-react";
import { AppHeader } from "@/components/AppHeader";
import { Card, ErrorState } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { getAuthToken } from "@/contexts/AuthContext";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function downloadAttachment(attachmentId: number, fileName: string) {
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

function WikiPageSkeleton() {
  const colors = useColors();
  return (
    <View
      style={styles.skeleton}
      accessibilityLabel="Cargando página de documentación"
      accessibilityLiveRegion="polite"
    >
      <View style={[styles.skeletonKicker, { backgroundColor: colors.border }]} />
      <View style={[styles.skeletonTitle, { backgroundColor: colors.border }]} />
      <View style={[styles.skeletonTitleShort, { backgroundColor: colors.border }]} />
      <Card style={styles.skeletonBody}>
        <View style={[styles.skeletonBodyLine, { backgroundColor: colors.border }]} />
        <View style={[styles.skeletonBodyLine, { backgroundColor: colors.border }]} />
        <View style={[styles.skeletonBodyLineShort, { backgroundColor: colors.border }]} />
      </Card>
      <View style={[styles.skeletonSection, { backgroundColor: colors.border }]} />
    </View>
  );
}

export default function WikiPageScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ id: string }>();
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const pageId =
    typeof params.id === "string" && /^\d+$/.test(params.id)
      ? Number(params.id)
      : null;
  const query = useGetWikiPage(pageId ?? 0, {
    query: {
      enabled: pageId !== null && pageId > 0,
      queryKey: getGetWikiPageQueryKey(pageId ?? 0),
      staleTime: 15_000,
    },
  });

  const handleDownload = async (attachmentId: number, fileName: string) => {
    setDownloadingId(attachmentId);
    try {
      await downloadAttachment(attachmentId, fileName);
    } catch (error: unknown) {
      Alert.alert(
        "No se pudo descargar el archivo",
        error instanceof Error ? error.message : "Inténtalo de nuevo.",
      );
    } finally {
      setDownloadingId(null);
    }
  };

  if (pageId === null || pageId <= 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <AppHeader title="Documentación" showBack />
        <View style={styles.invalidPage}>
          <View style={[styles.invalidIcon, { backgroundColor: colors.destructive + "1a" }]}>
            <Feather name="file-minus" size={24} color={colors.destructive} />
          </View>
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            La página solicitada no es válida.
          </Text>
        </View>
      </View>
    );
  }

  const page = query.data;
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Documentación" subtitle="Página de referencia" showBack />
      {query.isLoading ? (
        <WikiPageSkeleton />
      ) : query.isError || !page ? (
        <ErrorState onRetry={query.refetch} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heading}>
            <View style={styles.kickerRow}>
              <View style={[styles.kickerMark, { backgroundColor: colors.primary }]} />
              <Text style={[styles.sectionName, { color: colors.primary }]}>
                {page.moduleName ?? "Documentación general"}
              </Text>
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {page.title}
            </Text>
            {page.tags.length > 0 ? (
              <View style={styles.tagRow}>
                {page.tags.map((tag) => (
                  <View key={tag} style={[styles.tag, { backgroundColor: colors.muted }]}>
                    <Text style={[styles.tagText, { color: colors.mutedForeground }]}>
                      {tag}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          <View style={styles.sectionBlock}>
            <View style={styles.sectionHeading}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Contenido
              </Text>
              <Feather name="align-left" size={17} color={colors.mutedForeground} />
            </View>
            {page.content ? (
              <Card style={styles.contentCard}>
                <Text
                  selectable
                  style={[styles.body, { color: colors.foreground }]}
                >
                  {page.content}
                </Text>
              </Card>
            ) : (
              <Card style={styles.emptyContentCard}>
                <Feather name="file-text" size={19} color={colors.mutedForeground} />
                <Text style={[styles.emptyContent, { color: colors.mutedForeground }]}>
                  Esta página no contiene texto.
                </Text>
              </Card>
            )}
          </View>

          <View style={styles.sectionBlock}>
            <View style={styles.sectionHeading}>
              <View style={styles.sectionHeadingCopy}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                  Archivos y enlaces
                </Text>
                <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
                  Abre un recurso para consultarlo
                </Text>
              </View>
              <View style={[styles.countBadge, { backgroundColor: colors.accent }]}>
                <Text style={[styles.countText, { color: colors.accentForeground }]}>
                  {page.externalLinks.length + page.attachments.length}
                </Text>
              </View>
            </View>
            {page.externalLinks.length === 0 && page.attachments.length === 0 ? (
              <Card style={styles.emptyContentCard}>
                <Feather name="paperclip" size={19} color={colors.mutedForeground} />
                <Text style={[styles.emptyContent, { color: colors.mutedForeground }]}>
                  No hay archivos ni enlaces adjuntos.
                </Text>
              </Card>
            ) : (
              <View style={styles.attachmentList}>
                {page.externalLinks.map((link) => (
                  <Pressable
                    key={`link-${link.id}`}
                    testID={`wiki-external-link-${link.id}`}
                    accessibilityRole="link"
                    accessibilityLabel={`Enlace: ${link.title}`}
                    accessibilityHint="Abre el enlace externo"
                    onPress={() =>
                      void Linking.openURL(link.url).catch(() =>
                        Alert.alert(
                          "No se pudo abrir el enlace",
                          "Comprueba tu conexión e inténtalo de nuevo.",
                        ),
                      )
                    }
                    style={({ pressed }) => [
                      styles.resourcePressable,
                      { opacity: pressed ? 0.65 : 1 },
                    ]}
                  >
                    <Card style={styles.attachmentCard}>
                      <View
                        style={[
                          styles.attachmentIcon,
                          { backgroundColor: colors.accent },
                        ]}
                      >
                        <Feather
                          name="external-link"
                          size={17}
                          color={colors.accentForeground}
                        />
                      </View>
                      <View style={styles.attachmentText}>
                        <Text
                          style={[styles.attachmentTitle, { color: colors.foreground }]}
                          numberOfLines={2}
                        >
                          {link.title}
                        </Text>
                        <Text
                          style={[styles.attachmentMeta, { color: colors.mutedForeground }]}
                          numberOfLines={1}
                        >
                          {link.url}
                        </Text>
                      </View>
                      <Feather
                        name="arrow-up-right"
                        size={17}
                        color={colors.mutedForeground}
                      />
                    </Card>
                  </Pressable>
                ))}
                {page.attachments.map((attachment) => {
                  const isDownloading = downloadingId === attachment.id;
                  return (
                    <Pressable
                      key={`attachment-${attachment.id}`}
                      testID={`wiki-attachment-${attachment.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Descargar ${attachment.fileName}`}
                      accessibilityHint="Descarga el archivo y abre las opciones para compartirlo"
                      accessibilityState={{ busy: isDownloading, disabled: isDownloading }}
                      disabled={isDownloading}
                      onPress={() => void handleDownload(attachment.id, attachment.fileName)}
                      style={({ pressed }) => [
                        styles.resourcePressable,
                        { opacity: pressed || isDownloading ? 0.65 : 1 },
                      ]}
                    >
                      <Card style={styles.attachmentCard}>
                        <View
                          style={[
                            styles.attachmentIcon,
                            { backgroundColor: colors.accent },
                          ]}
                        >
                          {isDownloading ? (
                            <ActivityIndicator color={colors.accentForeground} size="small" />
                          ) : (
                            <Feather
                              name="download"
                              size={17}
                              color={colors.accentForeground}
                            />
                          )}
                        </View>
                        <View style={styles.attachmentText}>
                          <Text
                            style={[styles.attachmentTitle, { color: colors.foreground }]}
                            numberOfLines={2}
                          >
                            {attachment.fileName}
                          </Text>
                          <Text
                            style={[styles.attachmentMeta, { color: colors.mutedForeground }]}
                            numberOfLines={1}
                          >
                            {formatSize(attachment.size)}
                            {attachment.contentType ? ` · ${attachment.contentType}` : ""}
                            {isDownloading ? " · Preparando descarga" : " · Toca para descargar"}
                          </Text>
                        </View>
                        <Feather
                          name="chevron-right"
                          size={18}
                          color={colors.mutedForeground}
                        />
                      </Card>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 34, gap: 24 },
  heading: { gap: 9 },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  kickerMark: { width: 7, height: 7, borderRadius: 4 },
  sectionName: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  title: { fontSize: 25, lineHeight: 32, fontFamily: "Inter_700Bold" },
  tagRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  tag: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7 },
  tagText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  sectionBlock: { gap: 11 },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionHeadingCopy: { flex: 1, gap: 2 },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  sectionSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular" },
  contentCard: { padding: 17 },
  body: { fontSize: 15, lineHeight: 24, fontFamily: "Inter_400Regular" },
  emptyContentCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 15,
  },
  emptyContent: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },
  countBadge: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  attachmentList: { gap: 10 },
  resourcePressable: { borderRadius: 14 },
  attachmentCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  attachmentIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  attachmentText: { flex: 1, gap: 4 },
  attachmentTitle: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
  attachmentMeta: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  invalidPage: { alignItems: "center", paddingHorizontal: 24, paddingTop: 44, gap: 12 },
  invalidIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: { textAlign: "center", fontSize: 14, fontFamily: "Inter_500Medium" },
  skeleton: { padding: 16, gap: 12 },
  skeletonKicker: { width: 132, height: 11, borderRadius: 6, marginTop: 4 },
  skeletonTitle: { width: "92%", height: 25, borderRadius: 8, marginTop: 3 },
  skeletonTitleShort: { width: "58%", height: 25, borderRadius: 8 },
  skeletonBody: { gap: 12, marginTop: 10 },
  skeletonBodyLine: { width: "100%", height: 11, borderRadius: 6 },
  skeletonBodyLineShort: { width: "65%", height: 11, borderRadius: 6 },
  skeletonSection: { width: "54%", height: 18, borderRadius: 7, marginTop: 8 },
});