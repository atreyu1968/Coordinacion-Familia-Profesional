import React, { useState } from "react";
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
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
type LessonKind = "text" | "file" | "video" | "quiz" | "scorm12" | "scorm2004";

export default function LmsDetailScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const courseId = Number(id);
  const course = useGetLmsCourse(courseId);
  const scopes = useGetLmsManagementScopes();
  const canManage = (scopes.data ?? []).some((scope) => scope.canManage && scope.moduleId === course.data?.moduleId);
  const update = useUpdateLmsCourse();
  const publish = usePublishLmsCourse();
  const createLesson = useCreateLmsLesson();
  const upload = useRequestLmsUploadUrl();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonText, setLessonText] = useState("");
  const [lessonKind, setLessonKind] = useState<LessonKind>("text");
  const [lessonFile, setLessonFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [lessonRequired, setLessonRequired] = useState(true);
  const [quizOptions, setQuizOptions] = useState("Opción A\nOpción B");
  const [correctIndex, setCorrectIndex] = useState("0");
  const [showLessonForm, setShowLessonForm] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: getGetLmsCourseQueryKey(courseId) });
  const beginEdit = () => { setTitle(course.data?.title ?? ""); setDescription(course.data?.description ?? ""); setEditing(true); };
  const saveCourse = () => update.mutate({ courseId, data: { title: title.trim(), description: description.trim() } }, { onSuccess: () => { setEditing(false); refresh(); } });
  const chooseLessonFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    if (!result.canceled) setLessonFile(result.assets[0] ?? null);
  };
  const addLesson = async () => {
    if (!lessonTitle.trim()) return;
    const options = quizOptions.split("\n").map((option) => option.trim()).filter(Boolean);
    const correct = Number(correctIndex);
    if (lessonKind === "text" && !lessonText.trim()) {
      Alert.alert("Falta el contenido", "Escribe el texto de la lección antes de guardarla.");
      return;
    }
    if (lessonKind === "quiz" && (!lessonText.trim() || options.length < 2 || !Number.isInteger(correct) || correct < 0 || correct >= options.length)) {
      Alert.alert("Revisa el cuestionario", "Añade una pregunta, al menos dos opciones y un índice de respuesta correcta válido.");
      return;
    }
    if (lessonKind === "video" && !/^https?:\/\//i.test(lessonText.trim())) {
      Alert.alert("Vídeo no válido", "Introduce una URL completa que empiece por https:// o http://.");
      return;
    }
    if (["file", "scorm12", "scorm2004"].includes(lessonKind) && !lessonFile) {
      Alert.alert("Falta el archivo", "Selecciona un archivo antes de guardar la lección.");
      return;
    }
    try {
      let uploaded: { objectPath: string; intentToken: string } | undefined;
      if (lessonFile) {
        const size = lessonFile.size ?? 0;
        if (size < 1 || size > 100 * 1024 * 1024) throw new Error("El archivo debe pesar entre 1 byte y 100 MB.");
        const contentType = lessonFile.mimeType || "application/octet-stream";
        const target = await upload.mutateAsync({ data: { courseId, name: lessonFile.name, size, contentType } });
        if (Platform.OS === "web") {
          const blob = await (await fetch(lessonFile.uri)).blob();
          const response = await fetch(target.uploadURL, { method: "PUT", headers: { "Content-Type": contentType }, body: blob });
          if (!response.ok) throw new Error("No se pudo transferir el archivo.");
        } else {
          const result = await FileSystem.uploadAsync(target.uploadURL, lessonFile.uri, {
            httpMethod: "PUT",
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
            headers: { "Content-Type": contentType },
          });
          if (result.status < 200 || result.status >= 300) throw new Error("No se pudo transferir el archivo.");
        }
        uploaded = { objectPath: target.objectPath, intentToken: target.intentToken };
      }
      const content = lessonKind === "text"
        ? { text: lessonText.trim() }
        : lessonKind === "video"
          ? { url: lessonText.trim() }
          : lessonKind === "quiz"
            ? { questions: [{ prompt: lessonText.trim(), options, correctIndex: correct }] }
            : {};
      await createLesson.mutateAsync({
        courseId,
        data: {
          title: lessonTitle.trim(),
          kind: lessonKind,
          position: (course.data?.lessons.length ?? 0) + 1,
          required: lessonRequired,
          content,
          ...(uploaded ?? {}),
        },
      });
      setLessonTitle("");
      setLessonText("");
      setLessonFile(null);
      setLessonRequired(true);
      setShowLessonForm(false);
      refresh();
    } catch (error) {
      Alert.alert("No se pudo guardar la lección", error instanceof Error ? error.message : "Inténtalo de nuevo.");
    }
  };
  if (course.isLoading) return <View style={[styles.container, { backgroundColor: colors.background }]}><AppHeader title="Curso" showBack /><Loading /></View>;
  if (course.isError || !course.data) return <View style={[styles.container, { backgroundColor: colors.background }]}><AppHeader title="Curso" showBack /><ErrorState onRetry={course.refetch} /></View>;
  const requiredLessons = course.data.lessons.filter((lesson) => lesson.required);
  const completedRequired = requiredLessons.filter((lesson) => course.data.progress.some((progress) => progress.lessonId === lesson.id && progress.status === "completed")).length;
  const requiredProgress = requiredLessons.length ? Math.round(completedRequired * 100 / requiredLessons.length) : 100;
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
          <View style={[styles.progressBar, { backgroundColor: colors.border }]}><View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${requiredProgress}%` }]} /></View>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>{completedRequired} de {requiredLessons.length} lecciones obligatorias completadas</Text>
        </>}
        {course.data.certificateAvailable ? <Card style={{ ...styles.notice, backgroundColor: colors.accent }}><Feather name="award" size={20} color={colors.accentForeground} /><Text style={[styles.noticeText, { color: colors.accentForeground }]}>Has completado este curso. Tu certificado está disponible.</Text><CertificateButton courseId={courseId} /></Card> : null}
        {canManage ? <View style={styles.managerBar}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Gestión del curso</Text>
          <View style={styles.actions}><Button label="Editar" icon="edit-2" variant="secondary" onPress={beginEdit} /><Button label="Añadir lección" icon="plus" variant="secondary" onPress={() => setShowLessonForm((value) => !value)} /></View>
          {course.data.status === "draft" ? <Button label="Publicar curso" icon="send" onPress={() => publish.mutate({ courseId }, { onSuccess: refresh })} loading={publish.isPending} disabled={course.data.lessons.length === 0} /> : null}
          {showLessonForm ? <Card style={styles.form}>
            <TextInput value={lessonTitle} onChangeText={setLessonTitle} placeholder="Título de la lección" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border, borderRadius: colors.radius }]} />
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>Tipo de contenido</Text>
            <View style={styles.kindList}>
              {Object.entries(kindLabels).map(([key, label]) => (
                <Pressable key={key} onPress={() => setLessonKind(key as LessonKind)} style={[styles.kindChip, { borderColor: lessonKind === key ? colors.primary : colors.border, backgroundColor: lessonKind === key ? colors.accent : colors.card }]}>
                  <Text style={[styles.kindText, { color: lessonKind === key ? colors.primary : colors.foreground }]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            {["text", "video", "quiz"].includes(lessonKind) ? <TextInput value={lessonText} onChangeText={setLessonText} multiline={lessonKind !== "video"} placeholder={lessonKind === "video" ? "URL del vídeo (https://…)" : lessonKind === "quiz" ? "Enunciado de la pregunta" : "Contenido de la lectura"} placeholderTextColor={colors.mutedForeground} style={[styles.input, styles.textarea, { color: colors.foreground, borderColor: colors.border, borderRadius: colors.radius }]} /> : null}
            {lessonKind === "quiz" ? <>
              <TextInput value={quizOptions} onChangeText={setQuizOptions} multiline placeholder="Opciones, una por línea" placeholderTextColor={colors.mutedForeground} style={[styles.input, styles.textarea, { color: colors.foreground, borderColor: colors.border, borderRadius: colors.radius }]} />
              <TextInput value={correctIndex} onChangeText={setCorrectIndex} keyboardType="number-pad" placeholder="Índice de respuesta correcta (empieza en 0)" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border, borderRadius: colors.radius }]} />
            </> : null}
            {["file", "scorm12", "scorm2004"].includes(lessonKind) ? <>
              <Button label={lessonFile?.name ?? "Seleccionar archivo"} icon="paperclip" variant="secondary" onPress={() => void chooseLessonFile()} />
              {lessonFile?.size ? <Text style={[styles.meta, { color: colors.mutedForeground }]}>{(lessonFile.size / (1024 * 1024)).toFixed(1)} MB</Text> : null}
            </> : null}
            <Pressable onPress={() => setLessonRequired((value) => !value)} style={styles.requiredToggle}>
              <Feather name={lessonRequired ? "check-square" : "square"} size={18} color={lessonRequired ? colors.primary : colors.mutedForeground} />
              <Text style={[styles.meta, { color: colors.foreground }]}>Lección obligatoria</Text>
            </Pressable>
            <Button label="Guardar lección" icon="check" onPress={() => void addLesson()} loading={createLesson.isPending || upload.isPending} disabled={!lessonTitle.trim() || createLesson.isPending || upload.isPending} />
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
    const url = `${API_HOST}/scorm-player?token=${encodeURIComponent(session.token)}`;
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
    try {
      const token = await getAuthToken();
      const url = `${API_HOST}/api/lms/courses/${courseId}/certificate`;
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      if (Platform.OS === "web") {
        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error("No se pudo descargar el certificado.");
        const objectUrl = URL.createObjectURL(await response.blob());
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = "certificado.pdf";
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        return;
      }
      const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!directory) throw new Error("No hay espacio disponible para guardar el certificado.");
      const file = await FileSystem.downloadAsync(url, `${directory}certificado-${courseId}.pdf`, { headers });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", dialogTitle: "Guardar certificado" });
      } else {
        Alert.alert("Certificado descargado", "El PDF está guardado en los archivos de la app.");
      }
    } catch (error) {
      Alert.alert("No se pudo descargar el certificado", error instanceof Error ? error.message : "Inténtalo de nuevo.");
    }
  };
  return <Pressable onPress={open} accessibilityRole="button"><Text style={styles.certificateLink}>Descargar PDF</Text></Pressable>;
}

const styles = StyleSheet.create({
  container: { flex: 1 }, content: { padding: 16, gap: 14, paddingBottom: 40 }, title: { fontSize: 25, fontFamily: "Inter_700Bold" }, description: { fontSize: 15, lineHeight: 21, fontFamily: "Inter_400Regular" }, progressBar: { height: 7, borderRadius: 5, overflow: "hidden" }, progressFill: { height: "100%" }, meta: { fontSize: 12, fontFamily: "Inter_400Regular" }, sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold" }, lesson: { gap: 12 }, lessonHeader: { flexDirection: "row", gap: 10, alignItems: "flex-start" }, lessonTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" }, lessonBody: { fontSize: 15, lineHeight: 22, fontFamily: "Inter_400Regular" }, scorm: { gap: 10 }, quiz: { gap: 14 }, question: { gap: 8 }, questionText: { fontSize: 15, fontFamily: "Inter_600SemiBold" }, option: { flexDirection: "row", gap: 9, alignItems: "center", padding: 11, borderWidth: StyleSheet.hairlineWidth, borderRadius: 9 }, optionText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" }, notice: { flexDirection: "row", alignItems: "center", gap: 9 }, noticeText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" }, certificateLink: { color: "#1769aa", fontFamily: "Inter_600SemiBold", fontSize: 13 }, managerBar: { gap: 10 }, actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" }, form: { gap: 10 }, kindList: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, kindChip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, paddingHorizontal: 11, paddingVertical: 7 }, kindText: { fontSize: 12, fontFamily: "Inter_500Medium" }, input: { minHeight: 46, borderWidth: StyleSheet.hairlineWidth, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular" }, textarea: { minHeight: 80, textAlignVertical: "top" },
  requiredToggle: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
});