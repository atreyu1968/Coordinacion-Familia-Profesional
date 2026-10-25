import React, { useRef, useState } from "react";
import { AutoLinkText } from "@/components/AutoLinkText";
import { CourseMarkdown } from "@/components/CourseMarkdown";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { openBrowserLink } from "@/lib/browser-link";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetLmsCourseQueryKey,
  getLmsCourse,
  waitForLmsCoursePosition,
  getListLmsCoursesQueryKey,
  useCompleteLmsLesson,
  useCreateLmsLesson,
  useCreateLmsLessonDownloadToken,
  useCreateLmsLessonScormSession,
  useGetLmsCourse,
  useLmsLessonSelection,
  useGetLmsManagementScopes,
  usePublishLmsCourse,
  useRequestLmsUploadUrl,
  useSubmitLmsQuizAttempt,
  useUpdateLmsCourse,
  type LmsLesson,
  type LmsCourseDetail,
} from "@workspace/api-client-react";
import { getAuthToken } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
import { Button, Card, EmptyState, ErrorState, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { isPdfDocument, PdfPreviewButton } from "@/components/PdfPreviewButton";
import { lessonKindIcons, lessonKindLabels } from "@/components/LmsCourseCover";

const API_HOST = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
const kindLabels = lessonKindLabels;
type LessonKind = "text" | "file" | "video" | "quiz" | "scorm12" | "scorm2004";

export default function LmsDetailScreen() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const wideLayout = width >= 900;
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const courseId = Number(id);
  const course = useGetLmsCourse(courseId, { query: {
    queryKey: getGetLmsCourseQueryKey(courseId), staleTime: 0, refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      await waitForLmsCoursePosition(courseId);
      return getLmsCourse(courseId, { signal });
    },
  } });
  const [selectedId, selectLesson, positionSave] = useLmsLessonSelection(course.data, {
    persist: true, ready: !course.isFetching && !course.isError,
    onSaved: (id, lessonId) => queryClient.setQueryData<LmsCourseDetail>(
      getGetLmsCourseQueryKey(id),
      (old) => old ? { ...old, lastOpenedLessonId: lessonId } : old,
    ),
  });
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
  const [showManager, setShowManager] = useState(false);
  const [showCurriculum, setShowCurriculum] = useState(wideLayout);
  const [stickyCourseHeader, setStickyCourseHeader] = useState(true);
  const scrollRef = useRef<ScrollView>(null);
  const stageY = useRef(0);
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
  if (course.isLoading || (course.isFetching && selectedId == null)) return <View style={[styles.container, { backgroundColor: colors.background }]}><AppHeader title="Curso" showBack /><Loading /></View>;
  if (course.isError || !course.data) return <View style={[styles.container, { backgroundColor: colors.background }]}><AppHeader title="Curso" showBack /><ErrorState onRetry={course.refetch} /></View>;
  const data = course.data;
  const requiredLessons = data.lessons.filter((lesson) => lesson.required);
  const completedRequired = requiredLessons.filter((lesson) => data.progress.some((progress) => progress.lessonId === lesson.id && progress.status === "completed")).length;
  const requiredProgress = requiredLessons.length ? Math.round(completedRequired * 100 / requiredLessons.length) : 100;
  const index = data.lessons.findIndex((l) => l.id === selectedId);
  const lesson = index >= 0 ? data.lessons[index] : undefined;
  const prev = index > 0 ? data.lessons[index - 1] : undefined;
  const next = index >= 0 && index < data.lessons.length - 1 ? data.lessons[index + 1] : undefined;
  const go = (lessonId: number) => {
    selectLesson(lessonId);
    if (!wideLayout) setShowCurriculum(false);
    scrollRef.current?.scrollTo({ y: Math.max(stageY.current - 8, 0), animated: true });
  };
  const input = [styles.input, { color: colors.foreground, borderColor: colors.border, borderRadius: colors.radius }];
  const courseToolbar = (
    <View style={[styles.courseToolbar, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.toolbarCopy}>
        <Text style={[styles.toolbarEyebrow, { color: colors.primary }]}>
          {index >= 0 ? `LECCIÓN ${index + 1} DE ${data.lessons.length}` : "AULA DEL CURSO"}
        </Text>
        <Text style={[styles.toolbarTitle, { color: colors.foreground }]} numberOfLines={1}>{data.title}</Text>
        <View style={styles.toolbarProgressRow}>
          <View style={[styles.progressBar, styles.toolbarProgress, { backgroundColor: colors.border }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: requiredProgress }}>
            <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${requiredProgress}%` }]} />
          </View>
          <Text style={[styles.toolbarProgressText, { color: colors.mutedForeground }]}>{requiredProgress}%</Text>
        </View>
      </View>
      <View style={styles.toolbarActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showCurriculum }}
          accessibilityLabel={showCurriculum ? "Contraer temario" : "Abrir temario"}
          onPress={() => setShowCurriculum((value) => !value)}
          style={[styles.toolbarButton, { borderColor: colors.border }]}
        >
          <Feather name={showCurriculum ? "menu" : "list"} size={17} color={colors.primary} />
          <Text style={[styles.toolbarButtonText, { color: colors.foreground }]}>Temario</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: stickyCourseHeader }}
          accessibilityLabel={stickyCourseHeader ? "Desfijar encabezado compacto" : "Fijar encabezado compacto"}
          onPress={() => setStickyCourseHeader((value) => !value)}
          style={[styles.iconButton, { borderColor: colors.border }]}
        >
          <Feather name={stickyCourseHeader ? "bookmark" : "bookmark"} size={17} color={stickyCourseHeader ? colors.primary : colors.mutedForeground} />
        </Pressable>
      </View>
    </View>
  );
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Aula" showBack compact />
      {stickyCourseHeader ? courseToolbar : null}
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
        {!stickyCourseHeader ? courseToolbar : null}
        {data.description ? <Text style={[styles.description, { color: colors.mutedForeground }]}><AutoLinkText text={data.description} /></Text> : null}
        {data.certificateAvailable ? <Card style={{ ...styles.notice, backgroundColor: colors.accent }}><Feather name="award" size={20} color={colors.accentForeground} /><Text style={[styles.noticeText, { color: colors.accentForeground }]}>Has completado este curso. Tu certificado está disponible.</Text><CertificateButton courseId={courseId} /></Card> : null}

        <View style={[styles.workspace, wideLayout && styles.workspaceWide]}>
          {wideLayout || showCurriculum ? (
            <View style={[
              styles.curriculumPanel,
              { borderColor: colors.border, backgroundColor: colors.card },
              { width: wideLayout ? (showCurriculum ? 300 : 58) : undefined },
              wideLayout && !showCurriculum ? styles.curriculumPanelCollapsed : null,
            ]}>
              {wideLayout && !showCurriculum ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Expandir temario" onPress={() => setShowCurriculum(true)} style={styles.expandRail}>
                  <Feather name="menu" size={18} color={colors.primary} />
                </Pressable>
              ) : (
                <>
                  <View style={styles.curriculumHeading}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.sectionTitle, { color: colors.foreground, fontSize: 15 }]}>Contenido del curso</Text>
                      <Text style={[styles.meta, { color: colors.mutedForeground }]}>{completedRequired} de {requiredLessons.length} obligatorias completadas</Text>
                    </View>
                    {wideLayout ? (
                      <Pressable accessibilityRole="button" accessibilityLabel="Contraer temario" onPress={() => setShowCurriculum(false)} style={styles.iconButton}>
                        <Feather name="menu" size={17} color={colors.mutedForeground} />
                      </Pressable>
                    ) : null}
                  </View>
                  <View style={[styles.curriculum, { borderColor: colors.border }]}>
                    {data.lessons.map((item, i) => {
                      const status = data.progress.find((p) => p.lessonId === item.id)?.status;
                      const active = item.id === selectedId;
                      return <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={`Lección ${i + 1}: ${item.title}${status === "completed" ? ", completada" : ""}`} onPress={() => go(item.id)} style={[styles.curItem, { backgroundColor: active ? colors.accent : "transparent", borderTopColor: colors.border, borderTopWidth: i ? StyleSheet.hairlineWidth : 0 }]}>
                        {status === "completed" ? <Feather name="check-circle" size={20} color={colors.success} /> : status === "failed" ? <Feather name="x-circle" size={20} color={colors.destructive} /> : <View style={[styles.curNum, { borderColor: colors.border }]}><Text style={[styles.curNumText, { color: colors.mutedForeground }]}>{i + 1}</Text></View>}
                        <View style={{ flex: 1 }}><Text style={[styles.curTitle, { color: active ? colors.primary : colors.foreground }]} numberOfLines={2}>{item.title}</Text><View style={styles.curMeta}><Feather name={lessonKindIcons[item.kind] ?? "file"} size={11} color={colors.mutedForeground} /><Text style={[styles.meta, { color: colors.mutedForeground }]}>{kindLabels[item.kind] ?? item.kind}{item.required ? "" : " · Opcional"}</Text></View></View>
                      </Pressable>;
                    })}
                  </View>
                </>
              )}
            </View>
          ) : null}

          <View style={styles.lessonStage} onLayout={(e) => { stageY.current = e.nativeEvent.layout.y; }}>
            {!lesson ? <EmptyState icon="layers" title="Sin lecciones" message={canManage ? "Añade una lectura desde el área de gestión." : "Este curso aún no tiene contenido."} /> : <>
              {positionSave.error && <View accessibilityRole="alert"><Text style={{ color: colors.destructive }}>No se pudo guardar la última lección abierta.</Text><Button label="Reintentar" variant="secondary" onPress={positionSave.retry} /></View>}
              <View style={styles.activeLessonHeading}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.stageMeta, { color: colors.primary }]}>LECCIÓN {index + 1} DE {data.lessons.length}</Text>
                  <Text style={[styles.activeLessonTitle, { color: colors.foreground }]}>{lesson.title}</Text>
                </View>
                <Feather name={data.progress.find((item) => item.lessonId === lesson.id)?.status === "completed" ? "check-circle" : "circle"} size={22} color={data.progress.find((item) => item.lessonId === lesson.id)?.status === "completed" ? colors.success : colors.mutedForeground} />
              </View>
              <LessonCard key={lesson.id} lesson={lesson} courseId={courseId} progress={data.progress.find((item) => item.lessonId === lesson.id)} colors={colors} onRefresh={refresh} />
              <View style={styles.navRow}>
                <Pressable accessibilityRole="button" accessibilityLabel="Lección anterior" disabled={!prev} onPress={() => prev && go(prev.id)} style={[styles.navBtn, { borderColor: colors.border, opacity: prev ? 1 : 0.4 }]}>
                  <Feather name="chevron-left" size={18} color={colors.foreground} /><View style={{ flex: 1 }}><Text style={[styles.navLabel, { color: colors.mutedForeground }]}>Anterior</Text><Text numberOfLines={1} style={[styles.navTitle, { color: colors.foreground }]}>{prev?.title ?? "Inicio"}</Text></View>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Lección siguiente" disabled={!next} onPress={() => next && go(next.id)} style={[styles.navBtn, { borderColor: next ? colors.primary : colors.border, backgroundColor: next ? colors.primary : "transparent", opacity: next ? 1 : 0.4 }]}>
                  <View style={{ flex: 1, alignItems: "flex-end" }}><Text style={[styles.navLabel, { color: next ? colors.primaryForeground : colors.mutedForeground }]}>Siguiente</Text><Text numberOfLines={1} style={[styles.navTitle, { color: next ? colors.primaryForeground : colors.foreground }]}>{next?.title ?? "Fin del curso"}</Text></View><Feather name="chevron-right" size={18} color={next ? colors.primaryForeground : colors.foreground} />
                </Pressable>
              </View>
            </>}
          </View>
        </View>

        {canManage ? <View style={[styles.managerBar, { borderColor: colors.primary + "55" }]}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showManager }} onPress={() => setShowManager((v) => !v)} style={styles.managerHead}>
            <Feather name="settings" size={18} color={colors.primary} />
            <View style={{ flex: 1 }}><Text style={[styles.sectionTitle, { color: colors.foreground, fontSize: 16 }]}>Área de gestión</Text><Text style={[styles.meta, { color: colors.mutedForeground }]}>Editar, añadir lecciones y publicar</Text></View>
            <Feather name={showManager ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} />
          </Pressable>
          {showManager ? <>
            <View style={styles.actions}><Button label="Editar curso" icon="edit-2" variant="secondary" onPress={beginEdit} /><Button label="Añadir lección" icon="plus" variant="secondary" onPress={() => setShowLessonForm((value) => !value)} /></View>
            {data.status === "draft" ? <Button label="Publicar curso" icon="send" onPress={() => publish.mutate({ courseId }, { onSuccess: refresh, onError: () => Alert.alert("No se pudo publicar", "Inténtalo de nuevo.") })} loading={publish.isPending} disabled={data.lessons.length === 0} /> : null}
            {editing ? <Card style={styles.form}>
              <TextInput value={title} onChangeText={setTitle} placeholder="Título" placeholderTextColor={colors.mutedForeground} style={input} />
              <TextInput value={description} onChangeText={setDescription} multiline placeholder="Descripción" placeholderTextColor={colors.mutedForeground} style={[...input, styles.textarea]} />
              <View style={styles.actions}><Button label="Guardar" icon="check" onPress={saveCourse} loading={update.isPending} /><Button label="Cancelar" variant="secondary" onPress={() => setEditing(false)} /></View>
            </Card> : null}
            {showLessonForm ? <Card style={styles.form}>
              <TextInput value={lessonTitle} onChangeText={setLessonTitle} placeholder="Título de la lección" placeholderTextColor={colors.mutedForeground} style={input} />
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>Tipo de contenido</Text>
              <View style={styles.kindList}>
                {Object.entries(kindLabels).map(([key, label]) => (
                  <Pressable key={key} onPress={() => setLessonKind(key as LessonKind)} style={[styles.kindChip, { borderColor: lessonKind === key ? colors.primary : colors.border, backgroundColor: lessonKind === key ? colors.accent : colors.card }]}>
                    <Text style={[styles.kindText, { color: lessonKind === key ? colors.primary : colors.foreground }]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              {["text", "video", "quiz"].includes(lessonKind) ? <TextInput value={lessonText} onChangeText={setLessonText} multiline={lessonKind !== "video"} placeholder={lessonKind === "video" ? "URL del vídeo (https://…)" : lessonKind === "quiz" ? "Enunciado de la pregunta" : "Contenido de la lectura (Markdown)"} placeholderTextColor={colors.mutedForeground} style={[...input, styles.textarea]} /> : null}
              {lessonKind === "quiz" ? <>
                <TextInput value={quizOptions} onChangeText={setQuizOptions} multiline placeholder="Opciones, una por línea" placeholderTextColor={colors.mutedForeground} style={[...input, styles.textarea]} />
                <TextInput value={correctIndex} onChangeText={setCorrectIndex} keyboardType="number-pad" placeholder="Índice de respuesta correcta (empieza en 0)" placeholderTextColor={colors.mutedForeground} style={input} />
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
          </> : null}
        </View> : null}
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
  const [accessError, setAccessError] = useState("");
  const questions = Array.isArray(lesson.content.questions) ? lesson.content.questions as Array<{ prompt?: string; question?: string; options?: string[] }> : [];
  const reportAccessError = (error: unknown) => setAccessError(error instanceof Error ? error.message : "No se pudo abrir el contenido. Inténtalo de nuevo.");
  const openFile = () => {
    setAccessError("");
    void openBrowserLink(async () => {
      const result = await download.mutateAsync({ lessonId: lesson.id });
      return result.url.startsWith("http") ? result.url : `${API_HOST}${result.url}`;
    }).catch(reportAccessError);
  };
  const lessonFileName = typeof lesson.content.fileName === "string" ? lesson.content.fileName : lesson.title;
  const openPdf = () => {
    setAccessError("");
    download.mutate({ lessonId: lesson.id }, { onError: reportAccessError, onSuccess: (result) => router.push({
    pathname: "/pdf-viewer",
    params: { uri: result.url.startsWith("http") ? result.url : `${API_HOST}${result.url}`, title: lessonFileName },
    }) });
  };
  const openScorm = () => {
    setAccessError("");
    void openBrowserLink(async () => {
      const session = await scorm.mutateAsync({ lessonId: lesson.id });
      return `${API_HOST}/scorm-player?token=${encodeURIComponent(session.token)}`;
    }).catch(reportAccessError);
  };
  const text = typeof lesson.content.text === "string" ? lesson.content.text : typeof lesson.content.body === "string" ? lesson.content.body : "";
  return <Card style={styles.lesson}>
    <View style={styles.lessonHeader}><View style={{ flex: 1, gap: 3 }}><Text style={[styles.lessonTitle, { color: colors.foreground }]}>{lesson.title}</Text><Text style={[styles.meta, { color: colors.mutedForeground }]}>{kindLabels[lesson.kind] ?? lesson.kind} · {lesson.required ? "Obligatoria" : "Opcional"}</Text></View><Feather name={progress?.status === "completed" ? "check-circle" : "circle"} size={21} color={progress?.status === "completed" ? colors.primary : colors.mutedForeground} /></View>
     {lesson.kind === "text" ? <CourseMarkdown text={text} /> : null}
    {accessError ? <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{accessError}</Text> : null}
    {lesson.kind === "video" && typeof lesson.content.url === "string" ? <Button label="Ver vídeo" icon="play-circle" variant="secondary" onPress={() => {
      setAccessError("");
      void openBrowserLink(lesson.content.url as string).catch(reportAccessError);
    }} /> : null}
    {lesson.kind === "file" ? <View style={{ flexDirection: "row", gap: 8 }}>
      <Button label={download.isPending ? "Preparando…" : "Abrir archivo"} icon="download" variant="secondary" onPress={openFile} loading={download.isPending} />
      {isPdfDocument(lessonFileName, typeof lesson.content.contentType === "string" ? lesson.content.contentType : undefined)
        ? <Button label="Ver PDF" icon="eye" variant="secondary" onPress={openPdf} loading={download.isPending} />
        : null}
    </View> : null}
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
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Pressable onPress={open} accessibilityRole="button"><Text style={styles.certificateLink}>Descargar PDF</Text></Pressable>
      <PdfPreviewButton uri={`${API_HOST}/api/lms/courses/${courseId}/certificate`} title="Certificado del curso" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  title: { fontSize: 27, lineHeight: 32, letterSpacing: -0.6, fontFamily: "Inter_700Bold" },
  description: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  progressBar: { height: 7, borderRadius: 5, overflow: "hidden" },
  progressFill: { height: "100%" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  courseToolbar: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 11, marginHorizontal: 16, marginTop: 8, marginBottom: 3 },
  toolbarCopy: { flex: 1, minWidth: 0, gap: 3 },
  toolbarEyebrow: { fontSize: 10, lineHeight: 13, letterSpacing: 0.9, fontFamily: "Inter_700Bold" },
  toolbarTitle: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_700Bold" },
  toolbarProgressRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 2 },
  toolbarProgress: { flex: 1 },
  toolbarProgressText: { fontSize: 11, minWidth: 28, textAlign: "right", fontFamily: "Inter_600SemiBold" },
  toolbarActions: { flexDirection: "row", alignItems: "center", gap: 7 },
  toolbarButton: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: 11, paddingHorizontal: 10 },
  toolbarButtonText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  iconButton: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderRadius: 11 },
  workspace: { gap: 12 },
  workspaceWide: { flexDirection: "row", alignItems: "flex-start" },
  curriculumPanel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 10, gap: 8 },
  curriculumPanelCollapsed: { width: 58, padding: 8 },
  curriculumHeading: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 },
  expandRail: { minHeight: 42, alignItems: "center", justifyContent: "center" },
  lessonStage: { flex: 1, minWidth: 0, gap: 12 },
  activeLessonHeading: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 2 },
  activeLessonTitle: { fontSize: 21, lineHeight: 27, fontFamily: "Inter_700Bold" },
  lesson: { gap: 12 },
  lessonHeader: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  lessonTitle: { fontSize: 20, lineHeight: 25, fontFamily: "Inter_700Bold" },
  lessonBody: { fontSize: 15, lineHeight: 22, fontFamily: "Inter_400Regular" },
  scorm: { gap: 10 },
  quiz: { gap: 14 },
  question: { gap: 8 },
  questionText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  option: { flexDirection: "row", gap: 9, alignItems: "center", padding: 11, borderWidth: StyleSheet.hairlineWidth, borderRadius: 9 },
  optionText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  notice: { flexDirection: "row", alignItems: "center", gap: 9 },
  noticeText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  certificateLink: { color: "#1769aa", fontFamily: "Inter_600SemiBold", fontSize: 13 },
  managerBar: { gap: 12, borderWidth: 1.5, borderStyle: "dashed", borderRadius: 18, padding: 14, marginTop: 8 },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  form: { gap: 10 },
  kindList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kindChip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, paddingHorizontal: 11, paddingVertical: 7 },
  kindText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  input: { minHeight: 46, borderWidth: StyleSheet.hairlineWidth, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular" },
  textarea: { minHeight: 80, textAlignVertical: "top" },
  requiredToggle: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  eyebrow: { fontSize: 11, letterSpacing: 1.2, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  stageMeta: { fontSize: 11, letterSpacing: 1.2, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  navRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  navBtn: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 10, minHeight: 56 },
  navLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  navTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  curriculum: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, overflow: "hidden" },
  curItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 52 },
  curNum: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  curNumText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  curTitle: { fontSize: 14, fontFamily: "Inter_500Medium" },
  curMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  managerHead: { flexDirection: "row", alignItems: "center", gap: 10 },
});
