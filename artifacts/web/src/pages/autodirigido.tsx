import { useEffect, useMemo, useRef, useState } from "react";
import { CourseMarkdown } from "@/components/course-markdown";
import { LmsCourseCoverField } from "@/components/lms-course-cover-field";
import { LmsCourseDeleteButton } from "@/components/lms-course-delete-button";
import { LmsCoursePreview } from "@/components/lms-course-preview";
import { CourseCover, CourseHero, LessonKindIcon, LmsClassroom, lessonKindLabels, useLessonSelection } from "@/components/lms-classroom";
import { getLmsCourse, waitForLmsCoursePosition } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import JSZip from "jszip";
import {
  LmsLessonInputKind,
  type LmsCourse,
  type LmsCourseDetail,
  type LmsLesson,
  type LmsLessonInput,
  type LmsProgress,
  type LmsScormSession,
  useCompleteLmsLesson,
  useCreateLmsCourse,
  useCreateLmsLesson,
  useCreateLmsLessonDownloadToken,
  useCreateLmsLessonScormSession,
  useGetLmsCourse,
  useGetLmsManagementScopes,
  useImportLmsCourseArchive,
  useListLmsCourses,
  usePublishLmsCourse,
  useRequestLmsUploadUrl,
  useRequestLmsCourseImportUploadUrl,
  useSubmitLmsQuizAttempt,
  useUpdateLmsCourse,
  useSetLmsCourseCover,
  useRemoveLmsCourseCover,
  useUpdateLmsLesson,
  useCommitLmsScormSession,
  downloadLmsCertificate,
  getListLmsCoursesQueryKey,
  getGetLmsCourseQueryKey,
  getGetLmsScormSessionQueryKey,
  useGetLmsScormSession,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { HtmlDocxDownloadButton, isHtmlDocumentName } from "@/components/html-docx-download-button";
import { PdfPreviewDialog, isPdfDocument } from "@/components/pdf-preview-dialog";
import {
  Award, BookOpen, CheckCircle2, ChevronLeft, Download, FileUp, GraduationCap,
  Eye, Pencil, Play, Plus, Search, Send, Settings2, Upload, X,
} from "lucide-react";
import { Scorm12API } from "scorm-again/scorm12";
import { Scorm2004API } from "scorm-again/scorm2004";
import CrossFrameLMS from "scorm-again/cross-frame-lms";

const MAX_FILE = 100 * 1024 * 1024;
const BASE = import.meta.env.BASE_URL;
const kindLabels: Record<string, string> = {
  text: "Texto", file: "Archivo", video: "Vídeo", quiz: "Cuestionario",
  scorm12: "SCORM 1.2", scorm2004: "SCORM 2004",
};

function apiUrl(path: string) {
  return `${BASE}${path.replace(/^\/+/, "")}`;
}

function courseImportScopeKey(moduleId: number | null) {
  return moduleId === null ? "general" : String(moduleId);
}

function ScormRunner({ session, courseId, preview = false }: { session: LmsScormSession; courseId?: number; preview?: boolean }) {
  const commit = useCommitLmsScormSession();
  const queryClient = useQueryClient();
  const apiRef = useRef<Scorm12API | Scorm2004API | null>(null);
  const [ready, setReady] = useState(false);

  const save = async () => {
    if (preview) return;
    const api = apiRef.current;
    if (!api) return;
    await commit.mutateAsync({
      params: { token: session.token },
      data: {
        cmiData: api.renderCMIToJSONObject() as Record<string, unknown>,
      },
    });
    if (courseId) {
      await queryClient.invalidateQueries({ queryKey: getGetLmsCourseQueryKey(courseId) });
    }
  };

  useEffect(() => {
    let bridge: CrossFrameLMS | undefined;
    const config = {
      autocommit: true,
      autocommitSeconds: 30,
      requestHandler: async () => {
        try {
          await save();
          return { success: true };
        } catch {
          toast({ title: "No se pudo guardar el progreso SCORM", variant: "destructive" });
          return { success: false };
        }
      },
    };
    const api = session.version === "2004"
      ? new Scorm2004API(config)
      : new Scorm12API(config);
    apiRef.current = api;
    try {
      api.loadFromJSON(session.cmiData);
    } catch {
      // A package may start with an empty or partially supported CMI state.
    }
    bridge = new CrossFrameLMS(api, "null");
    setReady(true);
    return () => {
      setReady(false);
      bridge?.destroy();
      apiRef.current = null;
    };
  }, [session.token, session.version, session.cmiData, preview]);

  const src = session.launchPath.startsWith("/") ? apiUrl(session.launchPath) : session.launchPath;
  return (
    <div className="space-y-2">
      <iframe
        title="Contenido SCORM"
        src={ready ? src : undefined}
        className="h-[560px] w-full rounded-md border bg-white"
        sandbox="allow-scripts allow-forms allow-downloads"
        referrerPolicy="origin"
      />
      <Button variant="outline" onClick={() => void save()} disabled={commit.isPending || !ready}>
        {commit.isPending ? "Guardando..." : "Guardar progreso SCORM"}
      </Button>
    </div>
  );
}

function RemoteScormSession({ token }: { token: string }) {
  const session = useGetLmsScormSession(
    { token },
    { query: { enabled: Boolean(token), queryKey: getGetLmsScormSessionQueryKey({ token }) } },
  );
  if (session.isLoading) return <p className="py-12 text-center text-muted-foreground">Preparando el contenido SCORM...</p>;
  if (session.isError || !session.data) return <p className="py-12 text-center text-destructive">El enlace SCORM ha caducado o no es válido.</p>;
  return <div className="space-y-4"><h1 className="text-xl font-semibold">Contenido SCORM</h1><ScormRunner session={session.data} /></div>;
}

export function ScormPlayerPage() {
  const token = new URLSearchParams(window.location.search).get("token");
  return (
    <main className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-5xl">
        {token
          ? <RemoteScormSession token={token} />
          : <p className="py-12 text-center text-destructive">Falta el enlace de acceso al contenido SCORM.</p>}
      </div>
    </main>
  );
}

function CertificateDownloadButton({ courseId }: { courseId: number }) {
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    setDownloading(true);
    try {
      const certificate = await downloadLmsCertificate(courseId);
      const url = URL.createObjectURL(certificate);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `certificado-${courseId}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast({
        title: "No se pudo descargar el certificado",
        description: error instanceof Error ? error.message : "Inténtalo de nuevo más tarde.",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  };

  return <div className="flex flex-wrap items-center gap-2">
    <PdfPreviewDialog
      title="Certificado del curso"
      disabled={downloading}
      loadPdf={() => downloadLmsCertificate(courseId)}
    />
    <Button variant="outline" onClick={download} disabled={downloading}>
      <Award className="mr-2 h-4 w-4" />{downloading ? "Preparando certificado..." : "Descargar certificado"}
    </Button>
  </div>;
}

export function LessonView({ course, lesson, onRefresh, onPreviewProgress }: {
  course: LmsCourseDetail; lesson: LmsLesson; onRefresh: () => void;
  onPreviewProgress?: (value: LmsProgress) => void;
}) {
  const preview = Boolean(onPreviewProgress);
  const progress = course.progress.find((p) => p.lessonId === lesson.id);
  const isScorm = lesson.kind === "scorm12" || lesson.kind === "scorm2004";
  const complete = useCompleteLmsLesson();
  const quiz = useSubmitLmsQuizAttempt();
  const download = useCreateLmsLessonDownloadToken();
  const session = useCreateLmsLessonScormSession();
  const commit = useCommitLmsScormSession();
  const [answers, setAnswers] = useState<number[]>([]);
  const [scorm, setScorm] = useState<LmsScormSession | null>(null);
  const questions = Array.isArray(lesson.content.questions) ? lesson.content.questions as Array<{ prompt?: string; text?: string; options?: string[] }> : [];

  const markComplete = async () => {
    if (onPreviewProgress) {
      onPreviewProgress({ lessonId: lesson.id, status: "completed", score: null,
        attempts: 1, completedAt: new Date().toISOString() });
      toast({ title: "Lección completada (simulación)" });
      return;
    }
    try {
      await complete.mutateAsync({ lessonId: lesson.id });
      toast({ title: "Lección completada" });
      onRefresh();
    } catch { toast({ title: "No se pudo guardar el progreso", variant: "destructive" }); }
  };
  const takeQuiz = async () => {
    if (onPreviewProgress) {
      const grading = (Array.isArray(lesson.content.questions) ? lesson.content.questions : []) as Array<{ correctIndex?: number; options?: string[] }>;
      if (!grading.length || grading.some((q, i) =>
        !Number.isInteger(q.correctIndex) || !Number.isInteger(answers[i]) ||
        !q.options || answers[i] < 0 || answers[i] >= q.options.length
      )) {
        toast({ title: "El cuestionario no tiene preguntas o las respuestas no son válidas.", variant: "destructive" });
        return;
      }
      const score = Math.round(grading.filter((q, i) => q.correctIndex === answers[i]).length * 100 / grading.length);
      const passed = score >= 70 || progress?.status === "completed";
      onPreviewProgress({ lessonId: lesson.id, status: passed ? "completed" : "failed",
        score: Math.max(score, progress?.score ?? 0), attempts: (progress?.attempts ?? 0) + 1,
        completedAt: passed ? progress?.completedAt ?? new Date().toISOString() : null });
      toast({ title: passed ? "¡Cuestionario superado!" : "Puedes volver a intentarlo",
        description: `Puntuación: ${score}% · Simulación sin guardar` });
      return;
    }
    try {
      const result = await quiz.mutateAsync({ lessonId: lesson.id, data: { selectedIndexes: answers } });
      toast({ title: result.passed ? "¡Cuestionario superado!" : "Puedes volver a intentarlo", description: `Puntuación: ${result.score ?? 0}%` });
      onRefresh();
    } catch { toast({ title: "No se pudo corregir el cuestionario", variant: "destructive" }); }
  };
  const openScorm = async () => {
    try {
      const result = await session.mutateAsync({ lessonId: lesson.id, ...(preview ? { params: { preview: true } } : {}) });
      setScorm(result);
    } catch { toast({ title: "No se pudo abrir el paquete SCORM", variant: "destructive" }); }
  };
  const downloadFile = async () => {
    try {
      const result = await download.mutateAsync({ lessonId: lesson.id });
      const response = await fetch(result.url.startsWith("/") ? apiUrl(result.url) : result.url);
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = lesson.objectName ?? "archivo";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { toast({ title: "No se pudo descargar el archivo", variant: "destructive" }); }
  };
  const htmlDownloadAvailable = lesson.kind === "file" && isHtmlDocumentName(lesson.objectName ?? "");

  const statusLabel = progress?.status === "completed" ? "Completada" : progress?.status === "failed" ? "No superada" : progress?.status === "in_progress" ? "En curso" : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <h2 className="min-w-0 flex-1 text-2xl font-extrabold leading-tight tracking-tight">{lesson.title}</h2>
        {statusLabel && <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${progress?.status === "completed" ? "bg-emerald-600/10 text-emerald-700" : progress?.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>{progress?.status === "completed" && <CheckCircle2 className="h-3.5 w-3.5" />}{statusLabel}</span>}
      </div>
      {lesson.kind === "text" && <div className="max-w-[72ch] text-[15px]"><CourseMarkdown text={String(lesson.content.text ?? lesson.content.body ?? "Esta lección aún no tiene texto.")} /></div>}
      {lesson.kind === "video" && (Boolean(lesson.content.url || lesson.content.embedUrl)
        ? <video controls className="aspect-video w-full rounded-xl bg-black" src={String(lesson.content.url ?? lesson.content.embedUrl)} />
        : <p className="text-sm text-muted-foreground">Este vídeo todavía no tiene una dirección configurada.</p>)}
      {lesson.kind === "file" && <div className="flex flex-col gap-4 rounded-xl border bg-muted/30 p-5 sm:flex-row sm:items-center">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><FileUp className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1"><p className="truncate font-semibold">{lesson.objectName ?? "Archivo de la lección"}</p>{lesson.objectSize != null && <p className="text-xs text-muted-foreground">{(lesson.objectSize / (1024 * 1024)).toFixed(1)} MB</p>}</div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void downloadFile()} disabled={download.isPending}><Download className="mr-2 h-4 w-4" />{download.isPending ? "Preparando..." : `Descargar ${lesson.objectName ?? "archivo"}`}</Button>
          {isPdfDocument(lesson.objectName) && <PdfPreviewDialog
            title={lesson.objectName ?? lesson.title}
            disabled={download.isPending}
            loadPdf={async () => {
              const result = await download.mutateAsync({ lessonId: lesson.id });
              const response = await fetch(result.url.startsWith("/") ? apiUrl(result.url) : result.url);
              if (!response.ok) throw new Error("No se pudo abrir el PDF.");
              return response.blob();
            }}
          />}
          {htmlDownloadAvailable && <HtmlDocxDownloadButton
            fileName={lesson.objectName ?? "documento.html"}
            testId={`button-download-lesson-docx-${lesson.id}`}
            disabled={download.isPending}
            loadHtml={async () => {
              const result = await download.mutateAsync({ lessonId: lesson.id });
              const response = await fetch(result.url.startsWith("/") ? apiUrl(result.url) : result.url);
              if (!response.ok) throw new Error("No se pudo descargar el archivo");
              return { blob: await response.blob(), baseUrl: response.url };
            }}
          />}
        </div>
      </div>}
      {lesson.kind === "quiz" && <div className="space-y-5">
        {questions.length === 0 && <p className="text-sm text-muted-foreground">Este cuestionario todavía no tiene preguntas.</p>}
        {questions.map((question, index) => <fieldset key={index} className="space-y-2 rounded-xl border p-4">
          <legend className="px-1 text-sm font-semibold">{index + 1}. {question.prompt ?? question.text ?? "Pregunta"}</legend>
          {(question.options ?? []).map((option, optionIndex) => <label key={optionIndex} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${answers[index] === optionIndex ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted"}`}>
            <input type="radio" className="accent-[hsl(var(--primary))]" name={`q-${lesson.id}-${index}`} checked={answers[index] === optionIndex} onChange={() => setAnswers((old) => { const next = [...old]; next[index] = optionIndex; return next; })} />{option}
          </label>)}
        </fieldset>)}
        <Button onClick={takeQuiz} disabled={quiz.isPending || answers.length !== questions.length || !answers.every(Number.isInteger)}><Send className="mr-2 h-4 w-4" />{quiz.isPending ? "Corrigiendo..." : "Enviar respuestas"}</Button>
      </div>}
      {isScorm && <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">El estado y la puntuación comunicados por SCORM son autodeclarados y no se verifican en el servidor; no acreditan la finalización académica.</p>}
      {isScorm && (!scorm ? <Button onClick={openScorm} disabled={session.isPending}><Play className="mr-2 h-4 w-4" />{session.isPending ? "Preparando..." : "Abrir contenido SCORM"}</Button> : <ScormRunner session={scorm} courseId={course.id} preview={preview} />)}
      {(lesson.kind !== "quiz" && !isScorm && progress?.status !== "completed") || progress?.score != null ? <div className="flex flex-wrap items-center gap-3 border-t pt-5">
        {lesson.kind !== "quiz" && !isScorm && progress?.status !== "completed" && <Button variant="secondary" onClick={markComplete} disabled={complete.isPending}><CheckCircle2 className="mr-2 h-4 w-4" />{complete.isPending ? "Guardando..." : "Marcar como completada"}</Button>}
        {progress?.score != null && <p className="text-xs text-muted-foreground">{isScorm ? "Puntuación SCORM autodeclarada (no verificada)" : "Mejor puntuación"}: {progress.score}% · Intentos: {progress.attempts}</p>}
      </div> : null}
    </div>
  );
}

function CourseEditor({ course, scopes, onClose, onSaved }: { course: LmsCourse | null; scopes: Array<{ moduleId: number | null; label: string }>; onClose: () => void; onSaved: () => void }) {
  const create = useCreateLmsCourse(); const update = useUpdateLmsCourse();
  const upload = useRequestLmsUploadUrl();
  const setCover = useSetLmsCourseCover();
  const removeCover = useRemoveLmsCourseCover();
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverRemoved, setCoverRemoved] = useState(false);
  const [saving, setSaving] = useState(false);
  const savedId = useRef<number | null>(course?.id ?? null);
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(course?.title ?? ""); const [description, setDescription] = useState(course?.description ?? "");
  const [moduleId, setModuleId] = useState(course?.moduleId == null ? "" : String(course.moduleId)); const [certificate, setCertificate] = useState(course?.certificateEnabled ?? true);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const data = { title: title.trim(), description, moduleId: moduleId ? Number(moduleId) : null, certificateEnabled: certificate };
      const saved = savedId.current
        ? await update.mutateAsync({ courseId: savedId.current, data })
        : await create.mutateAsync({ data });
      savedId.current = saved.id;
      if (coverFile) {
        const wanted = await upload.mutateAsync({ data: { courseId: saved.id, name: coverFile.name, size: coverFile.size, contentType: coverFile.type } });
        const response = await fetch(wanted.uploadURL, { method: "PUT", headers: { "Content-Type": coverFile.type }, body: coverFile });
        if (!response.ok) throw new Error("No se pudo subir la portada. El curso se ha guardado; puedes reintentar sin duplicarlo.");
        await setCover.mutateAsync({ courseId: saved.id, data: { objectPath: wanted.objectPath, intentToken: wanted.intentToken } });
      } else if (coverRemoved && course?.coverUrl) {
        await removeCover.mutateAsync({ courseId: saved.id });
      }
      toast({ title: course ? "Curso actualizado" : "Curso creado" }); onSaved(); onClose();
    } catch (error) {
      toast({ title: savedId.current ? "No se pudo completar el guardado" : "No se pudo guardar el curso", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
      void queryClient.invalidateQueries({ queryKey: getListLmsCoursesQueryKey() });
      if (savedId.current) void queryClient.invalidateQueries({ queryKey: getGetLmsCourseQueryKey(savedId.current) });
    }
  };
  return <Card className="border-primary/30"><CardHeader><CardTitle>{course ? "Editar curso" : "Nuevo curso"}</CardTitle></CardHeader><CardContent className="space-y-4"><div><Label>Título</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={saving} /></div><div><Label>Descripción</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={saving} /></div><LmsCourseCoverField course={course} title={title} file={coverFile} removed={coverRemoved} disabled={saving} onFile={(file) => { setCoverFile(file); setCoverRemoved(false); }} onRemove={() => { setCoverFile(null); setCoverRemoved(true); }} /><div><Label>Ámbito</Label><select disabled={saving} className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={moduleId} onChange={(e) => setModuleId(e.target.value)}>{scopes.map((scope) => <option key={scope.moduleId ?? "general"} value={scope.moduleId ?? ""}>{scope.label}</option>)}</select></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={saving} checked={certificate} onChange={(e) => setCertificate(e.target.checked)} /> Emitir certificado al completar</label><div className="flex gap-2"><Button onClick={save} disabled={!title.trim() || saving}>{saving ? "Guardando..." : "Guardar"}</Button><Button variant="ghost" disabled={saving} onClick={onClose}>Cancelar</Button></div></CardContent></Card>;
}

function LessonEditor({ courseId, lesson, onSaved }: { courseId: number; lesson?: LmsLesson; onSaved: () => void }) {
  const create = useCreateLmsLesson(); const update = useUpdateLmsLesson(); const upload = useRequestLmsUploadUrl();
  const initialQuestion = Array.isArray(lesson?.content.questions)
    ? lesson.content.questions[0] as { prompt?: string; options?: string[]; correctIndex?: number } | undefined
    : undefined;
  const [title, setTitle] = useState(lesson?.title ?? "");
  const [kind, setKind] = useState<string>(lesson?.kind ?? "text");
  const [text, setText] = useState(String(lesson?.content.text ?? lesson?.content.url ?? initialQuestion?.prompt ?? ""));
  const [quizOptions, setQuizOptions] = useState((initialQuestion?.options ?? ["Opción A", "Opción B"]).join("\n"));
  const [correctIndex, setCorrectIndex] = useState(String(initialQuestion?.correctIndex ?? 0));
  const [required, setRequired] = useState(lesson?.required ?? true);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const options = quizOptions.split(/\r?\n/).map((option) => option.trim()).filter(Boolean);
      const answer = Number(correctIndex);
      if (kind === "text" && !text.trim()) throw new Error("Escribe el contenido de la lección.");
      if (kind === "video" && !/^https?:\/\//i.test(text.trim())) throw new Error("Introduce una URL completa del vídeo.");
      if (kind === "quiz" && (!text.trim() || options.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= options.length)) {
        throw new Error("Añade una pregunta, al menos dos opciones y un índice de respuesta correcta válido.");
      }
      if (["file", "scorm12", "scorm2004"].includes(kind) && !file && !lesson?.objectName) {
        throw new Error("Selecciona un archivo para esta lección.");
      }
      const content: Record<string, unknown> = kind === "text"
        ? { text: text.trim() }
        : kind === "video"
          ? { url: text.trim() }
          : kind === "quiz"
            ? { questions: [{ prompt: text.trim(), options, correctIndex: answer }] }
            : {};
      let uploaded: { objectPath: string; intentToken: string; objectName: string; objectContentType: string; objectSize: number } | undefined;
      if (file) {
        if (file.size < 1 || file.size > MAX_FILE) throw new Error("El archivo debe pesar entre 1 byte y 100 MB.");
        const wanted = await upload.mutateAsync({ data: { courseId, name: file.name, size: file.size, contentType: file.type || "application/octet-stream" } });
        const response = await fetch(wanted.uploadURL, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file }); if (!response.ok) throw new Error("No se pudo transferir el archivo.");
        uploaded = { objectPath: wanted.objectPath, intentToken: wanted.intentToken, objectName: file.name, objectContentType: file.type || "application/octet-stream", objectSize: file.size };
      }
      const data: LmsLessonInput = { title: title.trim(), kind: kind as LmsLessonInputKind, required, content, ...(uploaded ?? {}) };
      if (lesson) await update.mutateAsync({ lessonId: lesson.id, data }); else await create.mutateAsync({ courseId, data });
      toast({ title: lesson ? "Lección actualizada" : "Lección añadida" }); onSaved(); setFile(null);
    } catch (error) { toast({ title: "No se pudo guardar la lección", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); } finally { setSaving(false); }
  };
  return <Card><CardHeader><CardTitle className="text-base">{lesson ? "Editar lección" : "Añadir lección"}</CardTitle></CardHeader><CardContent className="space-y-3"><Input placeholder="Título de la lección" value={title} onChange={(e) => setTitle(e.target.value)} /><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(kindLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>{["text", "video", "quiz"].includes(kind) && <Textarea placeholder={kind === "video" ? "URL del vídeo" : kind === "quiz" ? "Enunciado de la pregunta" : "Contenido de la lección"} value={text} onChange={(e) => setText(e.target.value)} />}{kind === "quiz" && <><Textarea placeholder="Opciones, una por línea" value={quizOptions} onChange={(e) => setQuizOptions(e.target.value)} /><Input type="number" min="0" value={correctIndex} onChange={(e) => setCorrectIndex(e.target.value)} placeholder="Índice de la respuesta correcta (empieza en 0)" /></>}{["file", "scorm12", "scorm2004"].includes(kind) && <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}{file && <p className="text-xs text-muted-foreground">{file.name}</p>}{lesson?.objectName && !file && <p className="text-xs text-muted-foreground">Archivo actual: {lesson.objectName}</p>}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Lección obligatoria</label><Button onClick={save} disabled={!title.trim() || saving}>{saving ? "Guardando..." : "Guardar lección"}</Button></CardContent></Card>;
}

function CourseZipImport({
  scopes,
  onClose,
  onImported,
}: {
  scopes: Array<{ moduleId: number | null; label: string }>;
  onClose: () => void;
  onImported: () => void;
}) {
  const requestUpload = useRequestLmsCourseImportUploadUrl();
  const importArchive = useImportLmsCourseArchive();
  const [file, setFile] = useState<File | null>(null);
  const [selectedScope, setSelectedScope] = useState(
    () => (scopes[0] ? courseImportScopeKey(scopes[0].moduleId) : ""),
  );

  useEffect(() => {
    if (scopes.length && !scopes.some((scope) => courseImportScopeKey(scope.moduleId) === selectedScope)) {
      setSelectedScope(courseImportScopeKey(scopes[0]!.moduleId));
    }
  }, [scopes, selectedScope]);

  const busy = requestUpload.isPending || importArchive.isPending;
  const startImport = async () => {
    try {
      if (!file) throw new Error("Selecciona un archivo ZIP.");
      if (!file.name.toLowerCase().endsWith(".zip")) {
        throw new Error("El archivo del curso debe tener extensión .zip.");
      }
      if (file.size < 1 || file.size > MAX_FILE) {
        throw new Error("El ZIP debe pesar entre 1 byte y 100 MB.");
      }
      const scope = scopes.find(
        (item) => courseImportScopeKey(item.moduleId) === selectedScope,
      ) ?? scopes[0];
      if (!scope) throw new Error("No hay ámbitos disponibles para importar cursos.");

      const upload = await requestUpload.mutateAsync({
        data: {
          name: file.name,
          size: file.size,
          contentType: "application/zip",
          moduleId: scope.moduleId,
        },
      });
      const response = await fetch(upload.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": "application/zip" },
        body: file,
      });
      if (!response.ok) throw new Error("No se pudo subir el ZIP.");

      const result = await importArchive.mutateAsync({
        data: {
          objectPath: upload.objectPath,
          intentToken: upload.intentToken,
          moduleId: scope.moduleId,
        },
      });
      toast({
        title: "Curso importado como borrador",
        description: result.warnings.length
          ? result.warnings.join(" ")
          : `${result.importedLessonCount} lecciones listas para revisar.`,
      });
      onImported();
      onClose();
    } catch (error) {
      toast({
        title: "No se pudo importar el curso",
        description: error instanceof Error
          ? error.message
          : "Revisa el ZIP e inténtalo de nuevo.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle>Importar curso desde ZIP</CardTitle>
        <p className="text-sm text-muted-foreground">
          El curso se creará como borrador. Revisa sus lecciones y publícalo cuando esté listo.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="course-import-file">Archivo del curso (.zip, máximo 100 MB)</Label>
          <Input
            id="course-import-file"
            type="file"
            accept=".zip,application/zip"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            disabled={busy}
          />
          {file && <p className="text-xs text-muted-foreground">{file.name}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="course-import-scope">Ámbito</Label>
          <select
            id="course-import-scope"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={selectedScope}
            onChange={(event) => setSelectedScope(event.target.value)}
            disabled={busy}
          >
            {scopes.map((scope) => (
              <option key={courseImportScopeKey(scope.moduleId)} value={courseImportScopeKey(scope.moduleId)}>
                {scope.label}
              </option>
            ))}
          </select>
        </div>
        <details className="rounded-md border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Formato y estructura del ZIP</summary>
          <div className="mt-3 space-y-2 text-muted-foreground">
            <p>
              Incluye <code>coordina-course.json</code> en la raíz y coloca los archivos
              referenciados por las lecciones dentro de <code>assets/</code>. El orden del
              array <code>lessons</code> será el orden del curso.
            </p>
            <pre className="overflow-x-auto rounded bg-muted p-3 text-xs text-foreground">{`{
  "format": "coordina-adg-course",
  "version": 1,
  "course": { "title": "Mi curso", "description": "" },
  "lessons": [
    { "title": "Introducción", "kind": "text", "content": { "text": "Contenido..." } },
    { "title": "Material", "kind": "file", "file": "assets/material.pdf" }
  ]
}`}</pre>
            <p>
              Tipos: text, file, video, quiz, scorm12 y scorm2004. Máximo 100 MB
              comprimidos, 250 MB descomprimidos y 200 lecciones. Los cursos SCORM
              no emiten certificados automáticos.
            </p>
          </div>
        </details>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void startImport()} disabled={busy || !file}>
            <Upload className="mr-2 h-4 w-4" />
            {busy ? "Subiendo y validando..." : "Subir e importar"}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AutodirigidoPage() {
  const [, navigate] = useLocation(); const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null); const [editor, setEditor] = useState<"create" | "edit" | null>(null); const [lessonEditor, setLessonEditor] = useState<number | null>(null); const [editingLesson, setEditingLesson] = useState<LmsLesson | undefined>();
  const [importingCourse, setImportingCourse] = useState(false);
  const [previewingCourse, setPreviewingCourse] = useState(false);
  const [exportingCourse, setExportingCourse] = useState(false);
  const [exportingCourses, setExportingCourses] = useState(false);
  const [selectedExportIds, setSelectedExportIds] = useState<Set<number>>(() => new Set());
  const courses = useListLmsCourses(); const detail = useGetLmsCourse(selectedId ?? 0, { query: {
    enabled: selectedId != null, queryKey: getGetLmsCourseQueryKey(selectedId ?? 0), staleTime: 0, refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      await waitForLmsCoursePosition(selectedId ?? 0);
      return getLmsCourse(selectedId ?? 0, { signal });
    },
  } }); const scopes = useGetLmsManagementScopes();
  const publish = usePublishLmsCourse(); const manager = (scopes.data?.length ?? 0) > 0;
  const [selectedLessonId, selectLesson, positionSave] = useLessonSelection(
    selectedId != null && !previewingCourse ? detail.data : undefined,
    {
      persist: true, ready: !detail.isFetching && !detail.isError,
      onSaved: (courseId, lessonId) => queryClient.setQueryData<LmsCourseDetail>(
        getGetLmsCourseQueryKey(courseId),
        (old) => old ? { ...old, lastOpenedLessonId: lessonId } : old,
      ),
    },
  );
  const [catalogFilter, setCatalogFilter] = useState<"all" | "pending" | "completed" | "draft">("all");
  const [search, setSearch] = useState("");
  const manageableCourses = (courses.data ?? []).filter((item) =>
    scopes.data?.some((scope) => scope.canManage && scope.moduleId === item.moduleId),
  );
  const canManageSelectedCourse = Boolean(scopes.data?.some(
    (scope) => scope.canManage && scope.moduleId === detail.data?.moduleId,
  ));
  const refresh = async () => { await queryClient.invalidateQueries({ queryKey: getListLmsCoursesQueryKey() }); if (selectedId) await queryClient.invalidateQueries({ queryKey: getGetLmsCourseQueryKey(selectedId) }); };
  const onCourseDeleted = (id: number) => {
    setSelectedExportIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    if (selectedId === id) {
      setSelectedId(null);
      setEditor(null);
      setLessonEditor(null);
      setEditingLesson(undefined);
      navigate("/autodirigido");
    }
  };
  const exportCourse = async (course: LmsCourseDetail) => {
    setExportingCourse(true);
    try {
      const token = localStorage.getItem("coordina_adg_token");
      const response = await fetch(apiUrl(`/api/lms/courses/${course.id}/export`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(body?.message ?? "No se pudo descargar el ZIP del curso.");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${course.title.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || `curso-${course.id}`}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      toast({ title: "Curso exportado", description: "El ZIP incluye el manifiesto y los archivos del curso." });
    } catch (error) {
      toast({
        title: "No se pudo exportar el curso",
        description: error instanceof Error ? error.message : "Inténtalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setExportingCourse(false);
    }
  };
  const exportSelectedCourses = async () => {
    const courseIds = manageableCourses
      .filter((item) => selectedExportIds.has(item.id))
      .map((item) => item.id);
    if (courseIds.length === 0) return;
    setExportingCourses(true);
    try {
      const token = localStorage.getItem("coordina_adg_token");
      const response = await fetch(apiUrl("/api/lms/courses/export"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ courseIds }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as {
          message?: string;
          excluded?: Array<{ title: string; reason: string }>;
        } | null;
        const details = body?.excluded?.map((item) => `${item.title}: ${item.reason}`).join("\n");
        throw new Error([body?.message ?? "No se pudo exportar la selección.", details].filter(Boolean).join("\n"));
      }

      const blob = await response.blob();
      let includedCount = courseIds.length;
      let excluded: Array<{ title: string; reason: string }> = [];
      try {
        const archive = await JSZip.loadAsync(blob);
        const reportFile = archive.file("informe-exportacion.json");
        if (reportFile) {
          const report = JSON.parse(await reportFile.async("string")) as {
            included?: unknown[];
            excluded?: Array<{ title: string; reason: string }>;
          };
          includedCount = report.included?.length ?? includedCount;
          excluded = report.excluded ?? [];
        }
      } catch {
        // A missing or unreadable report must not prevent downloading the archive.
      }
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = "coordina-cursos.zip";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

      if (excluded.length > 0) {
        const details = excluded.map((item) => `${item.title}: ${item.reason}`).join("\n");
        toast({
          title: `Exportación parcial: ${includedCount} curso(s) incluidos`,
          description: details,
          variant: "destructive",
        });
      } else {
        toast({
          title: `${includedCount} cursos exportados`,
          description: "El ZIP incluye una carpeta por curso y un informe de exportación.",
        });
      }
    } catch (error) {
      toast({
        title: "No se pudo exportar la selección",
        description: error instanceof Error ? error.message : "Inténtalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setExportingCourses(false);
    }
  };
  useEffect(() => { const id = new URLSearchParams(window.location.search).get("curso"); if (id) setSelectedId(Number(id)); }, []);
  const scormToken = new URLSearchParams(window.location.search).get("scorm");
  if (scormToken) return <RemoteScormSession token={scormToken} />;
  if (selectedId && (detail.isLoading || (detail.isFetching && selectedLessonId == null))) return <p className="py-12 text-center text-muted-foreground">Cargando curso...</p>;
  const course = detail.data;
  const containsScorm = course?.lessons.some((lesson) => lesson.kind === "scorm12" || lesson.kind === "scorm2004") ?? false;
  const requiredLessons = course?.lessons.filter((lesson) => lesson.required) ?? [];
  const completedRequired = requiredLessons.filter((lesson) => course?.progress.some((progress) => progress.lessonId === lesson.id && progress.status === "completed")).length;
  const courseProgress = requiredLessons.length
    ? Math.round(completedRequired * 100 / requiredLessons.length)
    : course?.lessonCount ? 100 : 0;
  if (previewingCourse && selectedId && course && canManageSelectedCourse) {
    return <LmsCoursePreview key={course.id} course={course}
      onClose={() => { void detail.refetch(); setPreviewingCourse(false); }}
      renderLesson={(previewCourse, lesson, onProgress) =>
        <LessonView course={previewCourse} lesson={lesson} onRefresh={() => {}}
          onPreviewProgress={onProgress} />}
    />;
  }
  const openCourse = (id: number) => { setSelectedId(id); setEditor(null); setLessonEditor(null); setEditingLesson(undefined); navigate(`/autodirigido?curso=${id}`); };
  const allCourses = courses.data ?? [];
  const term = search.trim().toLowerCase();
  const visibleCourses = allCourses.filter((item) => {
    if (term && !`${item.title} ${item.description}`.toLowerCase().includes(term)) return false;
    if (catalogFilter === "pending") return !item.completed && item.status === "published";
    if (catalogFilter === "completed") return item.completed;
    if (catalogFilter === "draft") return item.status === "draft";
    return true;
  });
  const filters: Array<[typeof catalogFilter, string, number]> = [
    ["all", "Todos", allCourses.length],
    ["pending", "Por completar", allCourses.filter((c) => !c.completed && c.status === "published").length],
    ["completed", "Completados", allCourses.filter((c) => c.completed).length],
    ...(manager ? [["draft", "Borradores", allCourses.filter((c) => c.status === "draft").length] as [typeof catalogFilter, string, number]] : []),
  ];
  const selectedLesson = course?.lessons.find((l) => l.id === selectedLessonId);

  if (selectedId && (!course || (detail.isError && selectedLessonId == null))) {
    return <div className="space-y-4 py-10 text-center">
      <p className="text-sm text-destructive">No se pudo cargar el curso.</p>
      <div className="flex justify-center gap-2"><Button variant="outline" onClick={() => void detail.refetch()}>Reintentar</Button><Button variant="ghost" onClick={() => { setSelectedId(null); navigate("/autodirigido"); }}>Todos los cursos</Button></div>
    </div>;
  }

  if (selectedId && course) {
    return <div className="space-y-8 pb-10">
      <Button variant="ghost" className="-ml-3" onClick={() => { setSelectedId(null); setEditor(null); setLessonEditor(null); navigate("/autodirigido"); }}><ChevronLeft className="mr-1 h-4 w-4" />Todos los cursos</Button>
      <CourseHero course={course}
        actions={<>
          {selectedLesson && <Button className="h-auto w-full min-w-0 max-w-full justify-start whitespace-normal py-3 text-left sm:w-auto" onClick={() => document.getElementById("lms-stage")?.scrollIntoView({ behavior: "smooth" })}><Play className="mr-2 h-4 w-4 shrink-0" /><span className="min-w-0 [overflow-wrap:anywhere]">{courseProgress > 0 ? "Continuar" : "Empezar"}: {selectedLesson.title}</span></Button>}
          {course.certificateAvailable && <CertificateDownloadButton courseId={course.id} />}
        </>} />
      {containsScorm && <div role="note" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-muted-foreground">Este curso incluye SCORM. Su seguimiento es autodeclarado y no se verifica en el servidor, por lo que no habilita un certificado académico automático.</div>}
      {positionSave.error && <p role="alert" className="text-sm text-destructive">No se pudo guardar la última lección abierta. <Button variant="link" onClick={positionSave.retry}>Reintentar</Button></p>}
      <LmsClassroom course={course} selectedLessonId={selectedLessonId} onSelect={selectLesson}
        renderLesson={(lesson) => <LessonView key={lesson.id} course={course} lesson={lesson} onRefresh={() => void refresh()} />} />
      {canManageSelectedCourse && <section aria-labelledby="lms-manage-title" className="rounded-3xl border-2 border-dashed border-primary/25 bg-primary/[0.03] p-5 md:p-7">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Settings2 className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1"><h2 id="lms-manage-title" className="text-lg font-bold">Área de gestión</h2><p className="text-sm text-muted-foreground">Solo visible para responsables del curso. Los cambios afectan a todo el alumnado.</p></div>
          <div className="flex flex-wrap gap-2">
            {course.status !== "published" && <Button onClick={async () => { try { await publish.mutateAsync({ courseId: course.id }); toast({ title: "Curso publicado" }); void refresh(); } catch { toast({ title: "No se pudo publicar el curso", variant: "destructive" }); } }} disabled={publish.isPending}><Send className="mr-2 h-4 w-4" />Publicar curso</Button>}
            <Button variant="outline" onClick={() => { setLessonEditor(null); setEditor("edit"); }}><Pencil className="mr-2 h-4 w-4" />Editar curso</Button>
            {canManageSelectedCourse && <>
              <Button variant="outline" disabled={editor !== null || lessonEditor !== null}
                title={editor !== null || lessonEditor !== null ? "Guarda o cancela la edición antes de abrir la vista previa." : undefined}
                onClick={() => { setEditor(null); setLessonEditor(null); setPreviewingCourse(true); }}><Eye className="mr-2 h-4 w-4" />Vista previa como alumno</Button>
              <Button variant="outline" onClick={() => void exportCourse(course)} disabled={exportingCourse}><Download className="mr-2 h-4 w-4" />{exportingCourse ? "Exportando..." : "Exportar ZIP"}</Button>
              <LmsCourseDeleteButton course={course} onDeleted={() => onCourseDeleted(course.id)} />
            </>}
          </div>
        </div>
        {editor && <div className="mt-5"><CourseEditor course={editor === "edit" ? course : null} scopes={scopes.data ?? []} onClose={() => setEditor(null)} onSaved={refresh} /></div>}
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-sm font-bold uppercase tracking-[0.12em] text-muted-foreground">Lecciones ({course.lessons.length})</h3>
            <Button size="sm" variant="outline" onClick={() => { setEditor(null); setEditingLesson(undefined); setLessonEditor(lessonEditor === -1 ? null : -1); }}><Plus className="mr-2 h-4 w-4" />Añadir lección</Button></div>
          {lessonEditor === -1 && <div className="mb-4"><LessonEditor courseId={course.id} onSaved={() => { setLessonEditor(null); void refresh(); }} /></div>}
          <ol className="divide-y overflow-hidden rounded-2xl border bg-card">
            {course.lessons.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Añade la primera lección para poder publicar el curso.</li>}
            {course.lessons.map((lesson, i) => <li key={lesson.id}>
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                <LessonKindIcon kind={lesson.kind} className="h-4 w-4 text-primary" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{lesson.title}</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">{lessonKindLabels[lesson.kind]} · {lesson.required ? "Obligatoria" : "Opcional"}</span>
                {lessonEditor === lesson.id
                  ? <Button variant="ghost" size="sm" onClick={() => setLessonEditor(null)}><X className="mr-1 h-4 w-4" />Cerrar</Button>
                  : <Button variant="ghost" size="sm" onClick={() => { setEditor(null); setEditingLesson(lesson); setLessonEditor(lesson.id); }}><Pencil className="mr-1 h-4 w-4" />Editar lección</Button>}
              </div>
              {lessonEditor === lesson.id && <div className="border-t bg-muted/30 p-4"><LessonEditor key={lesson.id} courseId={course.id} lesson={editingLesson} onSaved={() => { setLessonEditor(null); void refresh(); }} /></div>}
            </li>)}
          </ol>
        </div>
      </section>}
    </div>;
  }

  return <div className="space-y-8 pb-10">
    <header className="relative overflow-hidden rounded-3xl bg-primary px-6 py-10 text-primary-foreground md:px-10 md:py-14">
      <div aria-hidden className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10" />
      <div aria-hidden className="absolute -bottom-28 right-24 h-56 w-56 rounded-full border-[18px] border-white/10" />
      <div className="relative max-w-2xl">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] opacity-80"><GraduationCap className="h-4 w-4" />Coordina FP · Autodirigido</p>
        <h1 className="mt-3 text-3xl font-extrabold leading-[1.05] tracking-tight md:text-5xl">Formación a tu ritmo, lección a lección.</h1>
        <p className="mt-4 text-[15px] leading-7 opacity-85">Elige un curso, avanza por su temario y consigue el certificado cuando completes las lecciones obligatorias.</p>
      </div>
    </header>

    {manager && <section aria-labelledby="lms-catalog-manage" className="rounded-2xl border-2 border-dashed border-primary/25 bg-primary/[0.03] p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Settings2 className="h-5 w-5 text-primary" />
        <h2 id="lms-catalog-manage" className="mr-auto text-sm font-bold">Gestión de cursos</h2>
        <Button variant="outline" size="sm" onClick={() => { setEditor(null); setImportingCourse((value) => !value); }}><Upload className="mr-2 h-4 w-4" />Importar ZIP</Button>
        <Button size="sm" onClick={() => { setImportingCourse(false); setEditor("create"); }}><Plus className="mr-2 h-4 w-4" />Nuevo curso</Button>
      </div>
      {manageableCourses.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
        <p className="mr-auto text-sm text-muted-foreground">{selectedExportIds.size} cursos seleccionados para exportación.</p>
        <Button variant="ghost" size="sm" onClick={() => setSelectedExportIds((current) => current.size === manageableCourses.length ? new Set() : new Set(manageableCourses.map((item) => item.id)))}>{selectedExportIds.size === manageableCourses.length ? "Quitar selección" : "Seleccionar todos los que gestiono"}</Button>
        <Button variant="outline" size="sm" onClick={() => void exportSelectedCourses()} disabled={selectedExportIds.size === 0 || exportingCourses}><Download className="mr-2 h-4 w-4" />{exportingCourses ? "Preparando ZIP..." : "Exportar selección"}</Button>
      </div>}
      {importingCourse && <div className="mt-4"><CourseZipImport scopes={scopes.data ?? []} onClose={() => setImportingCourse(false)} onImported={() => { void refresh(); }} /></div>}
      {editor === "create" && <div className="mt-4"><CourseEditor course={null} scopes={scopes.data ?? []} onClose={() => setEditor(null)} onSaved={refresh} /></div>}
    </section>}

    <div className="flex flex-col gap-4 md:flex-row md:items-center">
      <div role="tablist" aria-label="Filtrar cursos" className="flex gap-1 overflow-x-auto rounded-full bg-muted p-1">
        {filters.map(([key, label, count]) => <button key={key} role="tab" aria-selected={catalogFilter === key} onClick={() => setCatalogFilter(key)}
          className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${catalogFilter === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
          {label} <span className="ml-1 tabular-nums text-xs opacity-60">{count}</span></button>)}
      </div>
      <div className="relative md:ml-auto md:w-72">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="Buscar cursos" placeholder="Buscar por título o descripción" className="rounded-full pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
    </div>

    {courses.isLoading ? <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="space-y-3"><div className="aspect-[16/9] animate-pulse rounded-2xl bg-muted" /><div className="h-4 w-3/4 animate-pulse rounded bg-muted" /><div className="h-3 w-1/2 animate-pulse rounded bg-muted" /></div>)}</div>
      : courses.isError ? <div className="rounded-2xl border p-10 text-center"><p className="text-sm text-destructive">No se pudieron cargar los cursos.</p><Button className="mt-3" variant="outline" onClick={() => void courses.refetch()}>Reintentar</Button></div>
      : visibleCourses.length === 0 ? <div className="rounded-2xl border border-dashed p-12 text-center"><BookOpen className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 font-semibold">{allCourses.length === 0 ? "Todavía no hay cursos disponibles." : "Ningún curso coincide con este filtro."}</p><p className="mt-1 text-sm text-muted-foreground">{allCourses.length === 0 ? "Cuando haya cursos asignados a tu cuenta aparecerán aquí." : "Prueba con otra búsqueda o pestaña."}</p></div>
      : <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">{visibleCourses.map((item: LmsCourse) => {
        const canManageItem = scopes.data?.some((scope) => scope.canManage && scope.moduleId === item.moduleId) ?? false;
        return <li key={item.id} className="group flex flex-col">
          <button type="button" onClick={() => openCourse(item.id)} className="overflow-hidden rounded-2xl text-left transition-transform duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:-translate-y-1" aria-label={`Abrir curso ${item.title}`}>
            <CourseCover course={item} />
          </button>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em]">
            {item.completed ? <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Completado</span> : <span className="text-primary">{item.lessonCount} {item.lessonCount === 1 ? "lección" : "lecciones"}</span>}
            {item.status === "draft" && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-800">Borrador</span>}
            {item.certificateEnabled && <span className="flex items-center gap-1 text-muted-foreground"><Award className="h-3.5 w-3.5" />Certificado</span>}
          </div>
          <h3 className="mt-1.5 text-lg font-bold leading-snug"><button type="button" className="text-left hover:underline focus-visible:underline focus-visible:outline-none" onClick={() => openCourse(item.id)}>{item.title}</button></h3>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{item.description || "Curso autodirigido"}</p>
          {canManageItem && <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={selectedExportIds.has(item.id)} onChange={(event) => setSelectedExportIds((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} aria-label={`Seleccionar ${item.title} para exportar`} />Exportar</label>
            <div className="ml-auto"><LmsCourseDeleteButton course={item} onDeleted={() => onCourseDeleted(item.id)} /></div>
          </div>}
        </li>;
      })}</ul>}
  </div>;
}
