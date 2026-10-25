import React, { useEffect, useState } from "react";
import { FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListLmsCoursesQueryKey,
  useCreateLmsCourse,
  useGetLmsManagementScopes,
  useListLmsCourses,
} from "@workspace/api-client-react";
import { AppHeader } from "@/components/AppHeader";
import { Button, Card, EmptyState, ErrorState, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { LmsCourseCover } from "@/components/LmsCourseCover";
import { openClassroomWindow } from "@/lib/classroom-window";

export default function LmsScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const [managing, setManaging] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scopeKey, setScopeKey] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "completed" | "draft">("all");
  const [openError, setOpenError] = useState("");
  const courses = useListLmsCourses();
  const scopes = useGetLmsManagementScopes();
  const create = useCreateLmsCourse();
  const canManage = (scopes.data?.length ?? 0) > 0;
  const selectedScope = scopes.data?.find((scope) => String(scope.moduleId ?? "general") === scopeKey) ?? scopes.data?.[0];
  useEffect(() => {
    if (!scopeKey && scopes.data?.length) setScopeKey(String(scopes.data[0].moduleId ?? "general"));
  }, [scopeKey, scopes.data]);
  const all = courses.data ?? [];
  const filters: Array<[typeof filter, string, number]> = [
    ["all", "Todos", all.length],
    ["pending", "Por completar", all.filter((c) => !c.completed && c.status === "published").length],
    ["completed", "Completados", all.filter((c) => c.completed).length],
    ...(canManage ? [["draft", "Borradores", all.filter((c) => c.status === "draft").length] as [typeof filter, string, number]] : []),
  ];
  const visible = all.filter((c) => filter === "all" ? true : filter === "pending" ? !c.completed && c.status === "published" : filter === "completed" ? c.completed : c.status === "draft");
  const openCourse = (id: number) => {
    if (Platform.OS === "web") {
      setOpenError("");
      try {
        openClassroomWindow(id);
      } catch (error) {
        setOpenError(error instanceof Error ? error.message : "No se pudo abrir el aula.");
      }
      return;
    }
    router.push(`/lms/${id}`);
  };
  const submit = () => {
    if (!title.trim()) return;
    create.mutate({ data: { title: title.trim(), description: description.trim(), moduleId: selectedScope?.moduleId ?? null } }, {
      onSuccess: (course) => {
        setTitle(""); setDescription(""); setManaging(false);
        void queryClient.invalidateQueries({ queryKey: getListLmsCoursesQueryKey() });
        router.push(`/lms/${course.id}`);
      },
    });
  };
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Cursos autodirigidos" subtitle="Aprende a tu ritmo" showBack />
      {openError ? <Text accessibilityRole="alert" style={{ color: colors.destructive, padding: 16 }}>{openError}</Text> : null}
      {courses.isLoading ? <Loading /> : courses.isError ? <ErrorState onRetry={courses.refetch} /> : (
        <FlatList
          data={visible}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          onRefresh={courses.refetch}
          refreshing={courses.isRefetching}
          ListHeaderComponent={
            <View style={styles.intro}>
              <View style={[styles.hero, { backgroundColor: colors.primary }]}>
                <View style={styles.heroCircle} />
                <Text style={styles.heroEyebrow}>COORDINA FP · AUTODIRIGIDO</Text>
                <Text style={styles.heroTitle}>Formación a tu ritmo, lección a lección.</Text>
                <Text style={styles.heroCopy}>Avanza por el temario y consigue tu certificado al completar las lecciones obligatorias.</Text>
              </View>
              <View style={styles.filterRow} accessibilityRole="tablist">
                {filters.map(([key, label, count]) => {
                  const active = filter === key;
                  return <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => setFilter(key)} style={[styles.filterChip, { backgroundColor: active ? colors.foreground : colors.card, borderColor: active ? colors.foreground : colors.border }]}>
                    <Text style={[styles.filterText, { color: active ? colors.background : colors.foreground }]}>{label} {count}</Text>
                  </Pressable>;
                })}
              </View>
              {canManage ? <Pressable accessibilityRole="button" onPress={() => setManaging((value) => !value)} style={[styles.manageToggle, { borderColor: colors.border }]}>
                <Feather name={managing ? "x" : "edit-3"} size={16} color={colors.primary} />
                <Text style={[styles.manageText, { color: colors.primary }]}>{managing ? "Cancelar" : "Gestión: nuevo curso"}</Text>
              </Pressable> : null}
              {managing ? <Card style={styles.form}>
                <Text style={[styles.formTitle, { color: colors.foreground }]}>Nuevo curso</Text>
                <TextInput value={title} onChangeText={setTitle} placeholder="Título del curso" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border, borderRadius: colors.radius }]} />
                <TextInput value={description} onChangeText={setDescription} placeholder="Descripción (opcional)" placeholderTextColor={colors.mutedForeground} multiline style={[styles.input, styles.textarea, { color: colors.foreground, borderColor: colors.border, borderRadius: colors.radius }]} />
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>Ámbito del curso</Text>
                <View style={styles.scopeList}>
                  {(scopes.data ?? []).map((scope) => {
                    const key = String(scope.moduleId ?? "general");
                    const selected = key === String(selectedScope?.moduleId ?? "general");
                    return <Pressable key={key} onPress={() => setScopeKey(key)} style={[styles.scopeChip, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.accent : colors.card }]}><Text style={[styles.scopeText, { color: selected ? colors.primary : colors.foreground }]}>{scope.label}</Text></Pressable>;
                  })}
                </View>
                <Button label="Crear curso" icon="plus" onPress={submit} loading={create.isPending} disabled={!title.trim() || !selectedScope} />
              </Card> : null}
            </View>
          }
          ListEmptyComponent={all.length === 0 ? <EmptyState icon="book-open" title="Sin cursos disponibles" message="Cuando haya cursos asignados a tu cuenta aparecerán aquí." /> : <EmptyState icon="filter" title="Sin resultados" message="Ningún curso coincide con este filtro." />}
          renderItem={({ item }) => (
            <Pressable onPress={() => openCourse(item.id)} accessibilityRole="button" accessibilityLabel={`Abrir curso ${item.title} en una pestaña nueva`} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
              <View style={styles.course}>
                <LmsCourseCover id={item.id} title={item.title} coverUrl={item.coverUrl} height={168} />
                <View style={styles.metaRow}>
                  {item.completed
                    ? <View style={styles.metaInline}><Feather name="check-circle" size={13} color={colors.success} /><Text style={[styles.eyebrow, { color: colors.success }]}>COMPLETADO</Text></View>
                    : <Text style={[styles.eyebrow, { color: colors.primary }]}>{item.lessonCount} {item.lessonCount === 1 ? "LECCIÓN" : "LECCIONES"}</Text>}
                  {item.status === "draft" ? <Text style={[styles.draft]}>BORRADOR</Text> : null}
                  {item.certificateEnabled ? <View style={styles.metaInline}><Feather name="award" size={13} color={colors.mutedForeground} /><Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>CERTIFICADO</Text></View> : null}
                </View>
                <Text style={[styles.courseTitle, { color: colors.foreground }]} numberOfLines={2}>{item.title}</Text>
                {item.description ? <Text style={[styles.copy, { color: colors.mutedForeground }]} numberOfLines={2}>{item.description}</Text> : null}
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1 }, list: { padding: 16, gap: 10, paddingBottom: 35 },
  intro: { gap: 8, marginBottom: 8 }, heading: { fontSize: 24, fontFamily: "Inter_700Bold" },
  copy: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  manageToggle: { alignSelf: "flex-start", flexDirection: "row", gap: 8, alignItems: "center", paddingVertical: 9, paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 9 },
  manageText: { fontSize: 13, fontFamily: "Inter_600SemiBold" }, form: { gap: 10, marginTop: 5 },
  formTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" }, input: { minHeight: 46, borderWidth: StyleSheet.hairlineWidth, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular" },
  textarea: { minHeight: 72, textAlignVertical: "top" }, course: { gap: 6, marginBottom: 18 },
  hero: { borderRadius: 22, padding: 22, overflow: "hidden", gap: 8, marginBottom: 6 },
  heroCircle: { position: "absolute", right: -60, top: -60, width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(255,255,255,0.12)" },
  heroEyebrow: { color: "rgba(255,255,255,0.8)", fontSize: 11, letterSpacing: 1.6, fontFamily: "Inter_600SemiBold" },
  heroTitle: { color: "#fff", fontSize: 26, lineHeight: 30, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  heroCopy: { color: "rgba(255,255,255,0.88)", fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 4 },
  filterChip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 8 },
  filterText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 6 },
  metaInline: { flexDirection: "row", alignItems: "center", gap: 4 },
  eyebrow: { fontSize: 11, letterSpacing: 1, fontFamily: "Inter_600SemiBold" },
  draft: { fontSize: 10, letterSpacing: 1, fontFamily: "Inter_600SemiBold", color: "#8a5a00", backgroundColor: "rgba(245,158,11,0.18)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: "hidden" },
    courseTitle: { fontSize: 18, lineHeight: 23, fontFamily: "Inter_700Bold" }, meta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  scopeList: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, scopeChip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, paddingVertical: 7, paddingHorizontal: 11 }, scopeText: { fontSize: 12, fontFamily: "Inter_500Medium" },
});