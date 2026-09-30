import React, { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
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

export default function LmsScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const [managing, setManaging] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const courses = useListLmsCourses();
  const scopes = useGetLmsManagementScopes({ query: { enabled: managing, queryKey: ["lms-management-scopes"] } });
  const create = useCreateLmsCourse();
  const canManage = (scopes.data?.length ?? 0) > 0;
  const submit = () => {
    if (!title.trim()) return;
    create.mutate({ data: { title: title.trim(), description: description.trim(), moduleId: scopes.data?.[0]?.moduleId ?? null } }, {
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
      {courses.isLoading ? <Loading /> : courses.isError ? <ErrorState onRetry={courses.refetch} /> : (
        <FlatList
          data={courses.data ?? []}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          onRefresh={courses.refetch}
          refreshing={courses.isRefetching}
          ListHeaderComponent={
            <View style={styles.intro}>
              <Text style={[styles.heading, { color: colors.foreground }]}>Tu aprendizaje</Text>
              <Text style={[styles.copy, { color: colors.mutedForeground }]}>Consulta lecciones, completa evaluaciones y descarga tus certificados.</Text>
              {canManage ? <Pressable accessibilityRole="button" onPress={() => setManaging((value) => !value)} style={[styles.manageToggle, { borderColor: colors.border }]}>
                <Feather name={managing ? "x" : "edit-3"} size={16} color={colors.primary} />
                <Text style={[styles.manageText, { color: colors.primary }]}>{managing ? "Cancelar" : "Gestionar cursos"}</Text>
              </Pressable> : null}
              {managing ? <Card style={styles.form}>
                <Text style={[styles.formTitle, { color: colors.foreground }]}>Nuevo curso</Text>
                <TextInput value={title} onChangeText={setTitle} placeholder="Título del curso" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border, borderRadius: colors.radius }]} />
                <TextInput value={description} onChangeText={setDescription} placeholder="Descripción (opcional)" placeholderTextColor={colors.mutedForeground} multiline style={[styles.input, styles.textarea, { color: colors.foreground, borderColor: colors.border, borderRadius: colors.radius }]} />
                <Button label="Crear curso" icon="plus" onPress={submit} loading={create.isPending} disabled={!title.trim()} />
              </Card> : null}
            </View>
          }
          ListEmptyComponent={<EmptyState icon="book-open" title="Sin cursos disponibles" message="Cuando haya cursos asignados a tu cuenta aparecerán aquí." />}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/lms/${item.id}`)} accessibilityRole="button" accessibilityLabel={`Abrir curso ${item.title}`} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
              <Card style={styles.course}>
                <View style={[styles.icon, { backgroundColor: colors.accent }]}><Feather name="book-open" size={20} color={colors.accentForeground} /></View>
                <View style={styles.courseCopy}>
                  <Text style={[styles.courseTitle, { color: colors.foreground }]} numberOfLines={2}>{item.title}</Text>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>{item.lessonCount} {item.lessonCount === 1 ? "lección" : "lecciones"} · {item.status === "published" ? "Publicado" : "Borrador"}</Text>
                  <Text style={[styles.meta, { color: item.completed ? colors.primary : colors.mutedForeground }]}>{item.completed ? "Completado" : "En progreso"}</Text>
                </View>
                <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
              </Card>
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
  textarea: { minHeight: 72, textAlignVertical: "top" }, course: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" }, courseCopy: { flex: 1, gap: 4 },
  courseTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" }, meta: { fontSize: 12, fontFamily: "Inter_400Regular" },
});