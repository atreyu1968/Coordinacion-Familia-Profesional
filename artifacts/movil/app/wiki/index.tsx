import React, { useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { KeyboardAvoidingView as KeyboardControllerView } from "react-native-keyboard-controller";

import {
  getListWikiPagesQueryKey,
  useListWikiPages,
} from "@workspace/api-client-react";
import { AppHeader } from "@/components/AppHeader";
import { Card, EmptyState, ErrorState } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha no disponible";
  return `Actualizado el ${date.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

function WikiListSkeleton() {
  const colors = useColors();
  return (
    <View
      style={styles.skeletonList}
      accessibilityLabel="Cargando páginas de documentación"
      accessibilityLiveRegion="polite"
    >
      {[0, 1, 2, 3].map((item) => (
        <Card key={item} style={styles.skeletonCard}>
          <View style={[styles.skeletonIcon, { backgroundColor: colors.border }]} />
          <View style={styles.skeletonCopy}>
            <View style={[styles.skeletonLine, styles.skeletonLineWide, { backgroundColor: colors.border }]} />
            <View style={[styles.skeletonLine, styles.skeletonLineShort, { backgroundColor: colors.border }]} />
          </View>
        </Card>
      ))}
    </View>
  );
}

export default function WikiIndexScreen() {
  const colors = useColors();
  const [search, setSearch] = useState("");
  const params = { q: search.trim() || undefined };
  const {
    data,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useListWikiPages(params, {
    query: {
      queryKey: getListWikiPagesQueryKey(params),
      staleTime: 15_000,
    },
  });
  const pages = data?.items ?? [];
  const trimmedSearch = search.trim();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Documentación" subtitle="Consulta rápida" showBack />
      <KeyboardControllerView
        style={styles.keyboardContainer}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        <View style={styles.searchWrap}>
          <Feather
            name="search"
            size={18}
            color={colors.mutedForeground}
            style={styles.searchIcon}
          />
          <TextInput
            testID="input-wiki-search"
            accessibilityLabel="Buscar en la documentación"
            accessibilityHint="Escribe un título, módulo o palabra clave"
            placeholder="Buscar páginas y archivos"
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.searchInput,
              {
                color: colors.foreground,
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          />
          {search.length > 0 ? (
            <Pressable
              testID="button-clear-wiki-search"
              accessibilityRole="button"
              accessibilityLabel="Borrar búsqueda"
              hitSlop={10}
              onPress={() => setSearch("")}
              style={({ pressed }) => [
                styles.clearButton,
                { opacity: pressed ? 0.55 : 1 },
              ]}
            >
              <Feather name="x-circle" size={18} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>

        {isLoading && !data ? (
          <WikiListSkeleton />
        ) : isError && !data ? (
          <ErrorState onRetry={refetch} />
        ) : (
          <FlatList
            testID="list-wiki-pages"
            data={pages}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={[styles.list, { flexGrow: 1 }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onRefresh={refetch}
            refreshing={isRefetching}
            scrollEnabled={pages.length > 0}
            ListHeaderComponent={
              pages.length > 0 ? (
                <View style={styles.resultsHeader}>
                  <Text style={[styles.resultsCount, { color: colors.foreground }]}>
                    {pages.length} {pages.length === 1 ? "página" : "páginas"}
                  </Text>
                  <Text style={[styles.resultsHint, { color: colors.mutedForeground }]}>
                    {trimmedSearch
                      ? "Coincidencias en tu documentación"
                      : "Tu referencia de consulta"}
                  </Text>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <EmptyState
                icon="book-open"
                title={trimmedSearch ? "Sin resultados" : "Sin páginas"}
                message={
                  trimmedSearch
                    ? "Prueba con otro título, módulo o palabra clave."
                    : "No hay documentación disponible para tu cuenta."
                }
              />
            }
            renderItem={({ item }) => {
              const attachmentLabel =
                item.attachmentCount > 0
                  ? `${item.attachmentCount} ${
                      item.attachmentCount === 1 ? "archivo" : "archivos"
                    }`
                  : "Sin archivos";
              const moduleLabel = item.moduleName ?? "Documentación general";

              return (
                <Pressable
                  testID={`wiki-page-${item.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}. ${moduleLabel}. ${attachmentLabel}`}
                  accessibilityHint="Abre la página de documentación"
                  onPress={() => router.push(`/wiki/${item.id}`)}
                  style={({ pressed }) => [
                    styles.pagePressable,
                    { opacity: pressed ? 0.72 : 1 },
                  ]}
                >
                  <Card
                    style={{ ...styles.pageCard, borderLeftColor: colors.primary }}
                  >
                    <View
                      style={[
                        styles.pageIcon,
                        { backgroundColor: colors.accent },
                      ]}
                    >
                      <Feather
                        name="file-text"
                        size={18}
                        color={colors.accentForeground}
                      />
                    </View>
                    <View style={styles.pageText}>
                      <Text
                        style={[styles.pageTitle, { color: colors.foreground }]}
                        numberOfLines={2}
                      >
                        {item.title}
                      </Text>
                      <Text
                        style={[styles.pageMeta, { color: colors.mutedForeground }]}
                        numberOfLines={1}
                      >
                        {moduleLabel} · {attachmentLabel}
                      </Text>
                      {item.tags.length > 0 ? (
                        <View style={styles.tagRow}>
                          {item.tags.slice(0, 3).map((tag) => (
                            <View
                              key={tag}
                              style={[
                                styles.tag,
                                { backgroundColor: colors.muted },
                              ]}
                            >
                              <Text
                                style={[styles.tagText, { color: colors.mutedForeground }]}
                                numberOfLines={1}
                              >
                                {tag}
                              </Text>
                            </View>
                          ))}
                          {item.tags.length > 3 ? (
                            <Text style={[styles.moreTags, { color: colors.mutedForeground }]}>
                              +{item.tags.length - 3}
                            </Text>
                          ) : null}
                        </View>
                      ) : null}
                      <Text
                        style={[styles.updatedAt, { color: colors.mutedForeground }]}
                        numberOfLines={1}
                      >
                        {formatUpdatedAt(item.updatedAt)}
                      </Text>
                    </View>
                    <Feather
                      name="chevron-right"
                      size={20}
                      color={colors.mutedForeground}
                    />
                  </Card>
                </Pressable>
              );
            }}
          />
        )}
      </KeyboardControllerView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  keyboardContainer: { flex: 1 },
  searchWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  searchIcon: { position: "absolute", zIndex: 1, left: 29, top: 26 },
  searchInput: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 42,
    paddingRight: 42,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  clearButton: {
    position: "absolute",
    right: 28,
    top: 26,
    padding: 2,
  },
  list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 28, gap: 10 },
  resultsHeader: { paddingBottom: 4, gap: 3 },
  resultsCount: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  resultsHint: { fontSize: 12, fontFamily: "Inter_400Regular" },
  pagePressable: { borderRadius: 14 },
  pageCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderLeftWidth: 3,
    paddingLeft: 13,
  },
  pageIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  pageText: { flex: 1, gap: 5 },
  pageTitle: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  pageMeta: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular" },
  tagRow: { flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" },
  tag: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  tagText: { maxWidth: 120, fontSize: 10, fontFamily: "Inter_500Medium" },
  moreTags: { fontSize: 11, fontFamily: "Inter_500Medium" },
  updatedAt: { fontSize: 10, fontFamily: "Inter_400Regular" },
  skeletonList: { padding: 16, gap: 10 },
  skeletonCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  skeletonIcon: { width: 40, height: 40, borderRadius: 12 },
  skeletonCopy: { flex: 1, gap: 9 },
  skeletonLine: { height: 10, borderRadius: 5 },
  skeletonLineWide: { width: "82%" },
  skeletonLineShort: { width: "48%" },
});