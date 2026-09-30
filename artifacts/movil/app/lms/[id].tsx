import React, { useState } from "react";
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as WebBrowser from "expo-web-browser";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetLmsCourseQueryKey,
  getListLmsCoursesQueryKey,
  useCompleteLmsLesson,
  useCreateLmsLesson,
  useCreateLmsLessonDownloadToken,
  useCreateLmsLessonScormSession,
  useGetLmsCourse,
  useGetLmsManagementScopes,
  usePublishLmsCourse,
  useRequestLmsUploadUrl,
  useSubmitLmsQuizAttempt,
  useUpdateLmsCourse,
  type LmsLesson,
} from "@workspace/api-client-react";
import { getAuthToken } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
import { Button, Card, EmptyState, ErrorState, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

const API_HOST = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
const kindLabels: Record<string, string> = { text: "Lectura", file: "Archivo", video: "Vídeo", quiz: "Cuestionario", scorm12: "SCORM 1.2", scorm2004: "SCORM 2004" };

export default function LmsDetailScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const courseId = Number(id);
  const course = useGetLmsCourse(courseId);
  const scopes = useGetLmsManagementScopes();
  const canManage = (scopes.data ?? []).some((scope) => scope.canManage && (scope.moduleId === null || scope.moduleId === course.data?.moduleId));
  const update = useUpdateLmsCourse();
  const publish = usePublishLmsCourse();
  const createLesson = useCreateLmsLesson();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonText, setLessonText] = useState("");
  const [showLessonForm, setShowLessonForm] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: getGetLmsCourseQueryKey(courseId) });
  const beginEdit = () => { setTitle(course.data?.title ?? ""); setDescription(course.data?.description ?? ""); setEditing(true); };
  const saveCourse = () => update.mutate({ courseId, data: { title: title.trim(), description: description.trim() } }, { onSuccess: () => { setEditing(false); refresh(); } });
  const addTextLesson = () => {
    if (!lessonTitle.trim() || !lessonText.trim()) return;
    createLesson.mutate({ courseId, data: { title: lessonTitle.trim(), kind: "text", position: (course.data?.lessons.length ?? 0) + 1, required: true, content: { text: lessonText.trim() } } }, {
      onSuccess: () => { setLessonTitle(""); setLessonText(""); setShowLessonForm(false); refresh(); },
    });
  };
  if (course.isLoading) return <View style={[styles.container, { backgroundColor: colors.background }]}><AppHeader title="Curso" showBack /><Loading /></View>;
  if (course.isError || !course.data) return <View style={[styles.container, { backgroundColor: colors.background }]}><AppHeader title="Curso" showBack /><ErrorState onRetry={course.refetch} /></View>;
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Curso" subtitle={course.data.status === "published" ? "Publicado" : "Borrador"} showBack />
      <ScrollView contentContainerStyle={styles.content}>
        {editing ? <Card style={styles.form}>
          <TextInput value={title} onChangeText={setTitle} placeholder="Título" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border, borderRadius: colors.radius }]} />
          <TextInput value={description} onChangeText={setDescription} multiline placeholder="Descripción" placeholderTextColor={colors.mutedForeground} style={[styles.input, styles.textarea, { color: colors.foreground, borderColor: colors.border, borderRadius: colors.radius }]} />
          <View style={styles.actions}><Button label="Guardar" icon="check" onPress={saveCourse} loading={update.isPending} /><Button label="Cancelar" variant="secondary" onPress={() => setEditing(false)} /></View>
        </Card> : <>
          <Text style={[styles.title, { color: colors.foreground }]}>{course.data.title}</Text>
          {course.data.description ? <Text style={[styles.description, { color: colors.mutedForeground }]}>{course.data.description}</Text> : null}
          <View style={[styles.progressBar, { backgroundColor: colors.border }]}><View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${Math.round((course.data.progress.filter((p) => p.status === "completed").length / Math.max(course.data.lessonCount, 1)) * 100)}%` }]} /></View>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>{course.data.progress.filter((p) => p.status === "completed").length} de {course.data.lessonCount} lecciones completadas</Text>
        </>}
        {course.data.certificateAvailable ? <Card style={{ ...styles.notice, backgroundColor: colors.accent }}><Feather name="award" size={20} color={colors.accentForeground} /><Text style={[styles.noticeText, { color: colors.accentForeground }]}>Has completado este curso. Tu certificado está disponible.</Text><CertificateButton courseId={courseId} /></Card> : null}
        {canManage ? <View style={styles.managerBar}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Gestión del curso</Text>
          <View style={styles.actions}><Button label="Editar" icon="edit-2" variant="secondary" onPress={beginEdit} /><Button label="Añadir lectura" icon="plus" variant="secondary" onPress={() => setShowLessonForm((value) => !value)} /></View>
          {course.data.status === "draft" ? <Button label="Publicar curso" icon="send" onPress={() => publish.mutate({ courseId }, { onSuccess: refresh })} loading={publish.isPending} disabled={course.data.lessons.length === 0} /> : null}
          {showLessonForm ? <Card style={styles.form}>
            <TextInput value={lessonTitle} onChangeText={setLessonTitle} placeholder="Título de la lectura" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border, borderRadius: colors.radius }]} />
            <TextInput value={lessonText} onChangeText={setLessonText} multiline placeholder="Contenido de la lectura" placeholderTextColor={colors.mutedForeground} style={[styles.input, styles.textarea, { color: colors.foreground, borderColor: colors.border, borderRadius: colors.radius }]} />
            <Button label="Guardar lectura" icon="check" onPress={addTextLesson} loading={createLesson.isPending} disabled={!lessonTitle.trim() || !lessonText.trim()} />
          </Card> : null}
        </View> : null}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Lecciones</Text>
        {course.data.lessons.length === 0 ? <EmptyState icon="layers" title="Sin lecciones" message={canManage ? "Añade una lectura para empezar a construir el curso." : "Este curso aún no tiene contenido."} /> : course.data.lessons.map((lesson) => <LessonCard key={lesson.id} lesson={lesson} courseId={courseId} progress={course.data.progress.find((item) => item.lessonId === lesson.id)} colors={colors} onRefresh={refresh} />)}
      </ScrollView>
    </View>
  );
}

function LessonCard({ lesson, courseId, progress, colors, onRefresh }: { lesson: LmsLesson; courseId: number; progress?: { status: string; score: number | null }; colors: ReturnType<typeof useColors>; onRefresh: () => void }) {
  const complete = useCompleteLmsLesson();
  const quiz = useSubmitLmsQuizAttempt();
  const download = useCreateLmsLessonDownloadToken();
  const scorm = useCreateLmsLessonScormSession();
  const [selected, setSelected] = useState<number[]>([]);
  const questions = Array.isArray(lesson.content.questions) ? lesson.content.questions as Array<{ prompt?: string; question?: string; options?: string[] }> : [];
  const openFile = () => download.mutate({ lessonId: lesson.id }, { onSuccess: (result) => void Linking.openURL(result.url.startsWith("http") ? result.url : `${API_HOST}${result.url}`) });
  const openScorm = () => scorm.mutate({ lessonId: lesson.id }, { onSuccess: (session) => {
    const url = session.launchPath.startsWith("http") ? session.launchPath : `${API_HOST}${session.launchPath}`;
    if (Platform.OS === "web") void Linking.openURL(url); else void WebBrowser.openBrowserAsync(url);
  }});
  const text = typeof lesson.content.text === "string" ? lesson.content.text : typeof lesson.content.body === "string" ? lesson.content.body : "";
  return <Card style={styles.lesson}>
    <View style={styles.lessonHeader}><View style={{ flex: 1 }}><Text style={[styles.lessonTitle, { color: colors.foreground }]}>{lesson.title}</Text><Text style={[styles.meta, { color: colors.mutedForeground }]}>{kindLabels[lesson.kind] ?? lesson.kind} · {lesson.required ? "Obligatoria" : "Opcional"}</Text></View><Feather name={progress?.status === "completed" ? "check-circle" : "circle"} size={21} color={progress?.status === "completed" ? colors.primary : colors.mutedForeground} /></View>
    {lesson.kind === "text" ? <Text style={[styles.lessonBody, { color: colors.foreground }]}>{text}</Text> : null}
    {lesson.kind === "video" && typeof lesson.content.url === "string" ? <Button label="Ver vídeo" icon="play-circle" variant="secondary" onPress={() => void Linking.openURL(lesson.content.url as string)} /> : null}
    {(lesson.kind === "file") ? <Button label={download.isPending ? "Preparando…" : "Abrir archivo"} icon="download" variant="secondary" onPress={openFile} loading={download.isPending} /> : null}
    {(lesson.kind === "scorm12" || lesson.kind === "scorm2004") ? <View style={styles.scorm}><Text style={[styles.meta, { color: colors.mutedForeground }]}>El reproductor SCORM se abrirá en el navegador seguro del dispositivo.</Text><Button label="Abrir SCORM" icon="external-link" onPress={openScorm} loading={scorm.isPending} /></View> : null}
    {lesson.kind === "quiz" ? <View style={styles.quiz}>{questions.map((question, index) => <View key={index} style={styles.question}><Text style={[styles.questionText, { color: colors.foreground }]}>{question.prompt ?? question.question ?? `Pregunta ${index + 1}`}</Text>{(question.options ?? []).map((option, optionIndex) => <Pressable key={optionIndex} onPress={() => setSelected((prev) => { const next = [...prev]; next[index] = optionIndex; return next; })} style={[styles.option, { borderColor: selected[index] === optionIndex ? colors.primary : colors.border, backgroundColor: selected[index] === optionIndex ? colors.accent : colors.background }]}><Feather name={selected[index] === optionIndex ? "check-circle" : "circle"} size={17} color={selected[index] === optionIndex ? colors.primary : colors.mutedForeground} /><Text style={[styles.optionText, { color: colors.foreground }]}>{option}</Text></Pressable>)}</View>)}<Button label="Enviar respuestas" icon="check" onPress={() => quiz.mutate({ lessonId: lesson.id, data: { selectedIndexes: selected } }, { onSuccess: (result) => { Alert.alert(result.passed ? "¡Superado!" : "A seguir practicando", `Puntuación: ${result.score}%`); onRefresh(); } })} loading={quiz.isPending} disabled={selected.length !== questions.length || questions.length === 0} /></View> : null}
    {lesson.kind !== "quiz" && lesson.kind !== "scorm12" && lesson.kind !== "scorm2004" && progress?.status !== "completed" ? <Button label="Marcar como completada" icon="check" variant="secondary" onPress={() => complete.mutate({ lessonId: lesson.id }, { onSuccess: onRefresh })} loading={complete.isPending} /> : null}
    {progress?.status === "completed" && progress.score != null ? <Text style={[styles.meta, { color: colors.primary }]}>Mejor puntuación: {progress.score}%</Text> : null}
  </Card>;
}

function CertificateButton({ courseId }: { courseId: number }) {
  const open = async () => {
    const token = await getAuthToken();
    const response = await fetch(`${API_HOST}/api/lms/courses/${courseId}/certificate`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) return;
    const blob = await response.blob();
    if (Platform.OS === "web") { const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "certificado.pdf"; anchor.click(); URL.revokeObjectURL(url); }
    else Alert.alert("Certificado disponible", "Ábrelo desde la versión web para descargar el PDF.");
  };
  return <Pressable onPress={open} accessibilityRole="button"><Text style={styles.certificateLink}>Descargar PDF</Text></Pressable>;
}

const styles = StyleSheet.create({
  container: { flex: 1 }, content: { padding: 16, gap: 14, paddingBottom: 40 }, title: { fontSize: 25, fontFamily: "Inter_700Bold" }, description: { fontSize: 15, lineHeight: 21, fontFamily: "Inter_400Regular" }, progressBar: { height: 7, borderRadius: 5, overflow: "hidden" }, progressFill: { height: "100%" }, meta: { fontSize: 12, fontFamily: "Inter_400Regular" }, sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold" }, lesson: { gap: 12 }, lessonHeader: { flexDirection: "row", gap: 10, alignItems: "flex-start" }, lessonTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" }, lessonBody: { fontSize: 15, lineHeight: 22, fontFamily: "Inter_400Regular" }, scorm: { gap: 10 }, quiz: { gap: 14 }, question: { gap: 8 }, questionText: { fontSize: 15, fontFamily: "Inter_600SemiBold" }, option: { flexDirection: "row", gap: 9, alignItems: "center", padding: 11, borderWidth: StyleSheet.hairlineWidth, borderRadius: 9 }, optionText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" }, notice: { flexDirection: "row", alignItems: "center", gap: 9 }, noticeText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" }, certificateLink: { color: "#1769aa", fontFamily: "Inter_600SemiBold", fontSize: 13 }, managerBar: { gap: 10 }, actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" }, form: { gap: 10 }, input: { minHeight: 46, borderWidth: StyleSheet.hairlineWidth, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular" }, textarea: { minHeight: 80, textAlignVertical: "top" },
});