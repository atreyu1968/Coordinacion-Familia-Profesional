import React from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { getListLmsCoursesQueryKey, useListLmsCourses } from "@workspace/api-client-react";
import { AppHeader } from "./AppHeader";
import { LmsCourseCover } from "./LmsCourseCover";
import { LmsWebOnlyMessage } from "./LmsWebOnlyNotice";
import { useColors } from "../hooks/useColors";

/** Read-only catalog: no lesson navigation, playback or progress mutations. */
export default function LmsCourseCatalog() {
  const colors = useColors();
  const query = useListLmsCourses({
    query: {
      queryKey: getListLmsCoursesQueryKey(),
      staleTime: 30_000,
      refetchOnMount: "always",
      refetchInterval: 60_000,
    },
  });
  const courses = (query.data ?? []).filter((course) => course.status === "published");

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]} testID="lms-catalog">
      <AppHeader title="Cursos autodirigidos" subtitle="Catálogo de cursos disponibles" showBack />
      <FlatList
        data={courses}
        keyExtractor={(course) => String(course.id)}
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
        contentContainerStyle={styles.list}
        ListHeaderComponent={<>
          <LmsWebOnlyMessage />
          <Text style={[styles.heading, { color: colors.foreground }]}>Cursos disponibles</Text>
          {query.isLoading && <ActivityIndicator color={colors.primary} accessibilityLabel="Cargando cursos" />}
          {query.isError && <View style={styles.error}>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              No se pudo actualizar el catálogo de cursos.
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Reintentar cargar cursos"
              onPress={() => void query.refetch()} style={styles.retry}>
              <Text style={[styles.body, { color: colors.primary }]}>Reintentar</Text>
            </Pressable>
          </View>}
        </>}
        ListEmptyComponent={!query.isLoading && !query.isError
          ? <Text style={[styles.empty, { color: colors.mutedForeground }]}>Todavía no hay cursos disponibles.</Text>
          : null}
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            testID={`lms-course-${item.id}`}>
            <LmsCourseCover id={item.id} title={item.title} coverUrl={item.coverUrl} radius={0} />
            <View style={styles.content}>
              <Text style={[styles.title, { color: colors.foreground }]}>{item.title}</Text>
              {Boolean(item.description) && <Text style={[styles.body, { color: colors.mutedForeground }]}>{item.description}</Text>}
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {item.lessonCount} {item.lessonCount === 1 ? "lección" : "lecciones"} · Solo en la web
              </Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { paddingBottom: 32 },
  heading: { marginHorizontal: 20, marginBottom: 16, fontSize: 20, fontFamily: "Inter_600SemiBold" },
  card: { marginHorizontal: 20, marginBottom: 20, borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  content: { padding: 18, gap: 10 },
  title: { fontSize: 18, lineHeight: 25, fontFamily: "Inter_600SemiBold" },
  body: { fontSize: 15, lineHeight: 23, fontFamily: "Inter_400Regular" },
  meta: { fontSize: 13, lineHeight: 20, fontFamily: "Inter_500Medium" },
  empty: { marginHorizontal: 20, fontSize: 15, lineHeight: 23, fontFamily: "Inter_400Regular" },
  error: { marginHorizontal: 20, marginBottom: 16, gap: 4 },
  retry: { alignSelf: "flex-start", paddingVertical: 10 },
});
