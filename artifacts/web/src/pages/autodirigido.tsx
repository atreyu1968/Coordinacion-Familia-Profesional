import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  LmsLessonInputKind,
  type LmsCourse,
  type LmsCourseDetail,
  type LmsLesson,
  type LmsLessonInput,
  type LmsScormSession,
  useCompleteLmsLesson,
  useCreateLmsCourse,
  useCreateLmsLesson,
  useCreateLmsLessonDownloadToken,
  useCreateLmsLessonScormSession,
  useGetLmsCourse,
  useGetLmsManagementScopes,
  useListLmsCourses,
  usePublishLmsCourse,
  useRequestLmsUploadUrl,
  useSubmitLmsQuizAttempt,
  useUpdateLmsCourse,
  useUpdateLmsLesson,
  useCommitLmsScormSession,
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
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import {
  Award, BookOpen, CheckCircle2, ChevronLeft, FileUp, GraduationCap,
  Pencil, Play, Plus, Send, Upload, Video, X,
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

function scormSnapshot(api: Scorm12API | Scorm2004API, version: string) {
  const cmi = api.cmi as unknown as {
    core?: { lesson_status?: unknown; score?: { raw?: unknown } };
    completion_status?: unknown;
    success_status?: unknown;
    score?: { raw?: unknown; scaled?: unknown };
  };
  const status = version === "2004"
    ? cmi.completion_status ?? cmi.success_status
    : cmi.core?.lesson_status;
  const rawScore = version === "2004"
    ? cmi.score?.raw ?? (typeof cmi.score?.scaled === "string" ? Number(cmi.score.scaled) * 100 : undefined)
    : cmi.core?.score?.raw;
  const score = Number(rawScore);
  return {
    status: typeof status === "string" ? status : undefined,
    score: rawScore !== undefined && Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : undefined,
  };
}

function ScormRunner({ session, courseId }: { session: LmsScormSession; courseId?: number }) {
  const commit = useCommitLmsScormSession();
  const queryClient = useQueryClient();
  const apiRef = useRef<Scorm12API | Scorm2004API | null>(null);
  const [ready, setReady] = useState(false);

  const save = async () => {
    const api = apiRef.current;
    if (!api) return;
    const state = scormSnapshot(api, session.version);
    await commit.mutateAsync({
      params: { token: session.token },
      data: {
        cmiData: api.renderCMIToJSONObject() as Record<string, unknown>,
        ...state,
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
  }, [session.token, session.version, session.cmiData]);

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

function ProgressMark({ value }: { value: number }) {
  return <div className="flex items-center gap-2"><Progress value={value} className="h-2" /><span className="text-xs text-muted-foreground">{value}%</span></div>;
}

function LessonView({ course, lesson, onRefresh }: { course: LmsCourseDetail; lesson: LmsLesson; onRefresh: () => void }) {
  const progress = course.progress.find((p) => p.lessonId === lesson.id);
  const complete = useCompleteLmsLesson();
  const quiz = useSubmitLmsQuizAttempt();
  const download = useCreateLmsLessonDownloadToken();
  const session = useCreateLmsLessonScormSession();
  const commit = useCommitLmsScormSession();
  const [answers, setAnswers] = useState<number[]>([]);
  const [scorm, setScorm] = useState<LmsScormSession | null>(null);
  const questions = Array.isArray(lesson.content.questions) ? lesson.content.questions as Array<{ prompt?: string; text?: string; options?: string[] }> : [];

  const markComplete = async () => {
    try {
      await complete.mutateAsync({ lessonId: lesson.id });
      toast({ title: "Lección completada" });
      onRefresh();
    } catch { toast({ title: "No se pudo guardar el progreso", variant: "destructive" }); }
  };
  const takeQuiz = async () => {
    try {
      const result = await quiz.mutateAsync({ lessonId: lesson.id, data: { selectedIndexes: answers } });
      toast({ title: result.passed ? "¡Cuestionario superado!" : "Puedes volver a intentarlo", description: `Puntuación: ${result.score ?? 0}%` });
      onRefresh();
    } catch { toast({ title: "No se pudo corregir el cuestionario", variant: "destructive" }); }
  };
  const openScorm = async () => {
    try {
      const result = await session.mutateAsync({ lessonId: lesson.id });
      setScorm(result);
    } catch { toast({ title: "No se pudo abrir el paquete SCORM", variant: "destructive" }); }
  };
  const downloadFile = async () => {
    try {
      const result = await download.mutateAsync({ lessonId: lesson.id });
      const response = await fetch(result.url.startsWith("/") ? apiUrl(result.url) : result.url);
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = lesson.objectName ?? "archivo"; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { toast({ title: "No se pudo descargar el archivo", variant: "destructive" }); }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3"><div className="flex items-center gap-2"><Badge variant="outline">{kindLabels[lesson.kind]}</Badge><CardTitle className="text-base">{lesson.title}</CardTitle>{progress?.status === "completed" && <CheckCircle2 className="ml-auto h-5 w-5 text-emerald-600" />}</div></CardHeader>
      <CardContent className="space-y-4">
        {lesson.kind === "text" && <div className="whitespace-pre-wrap text-sm leading-7">{String(lesson.content.text ?? lesson.content.body ?? "Esta lección aún no tiene texto.")}</div>}
        {lesson.kind === "video" && Boolean(lesson.content.url || lesson.content.embedUrl) && <video controls className="max-h-[420px] w-full rounded-md bg-black" src={String(lesson.content.url ?? lesson.content.embedUrl)} />}
        {lesson.kind === "file" && <Button variant="outline" onClick={downloadFile} disabled={download.isPending}><FileUp className="mr-2 h-4 w-4" />{download.isPending ? "Preparando..." : `Descargar ${lesson.objectName ?? "archivo"}`}</Button>}
        {lesson.kind === "quiz" && <div className="space-y-4">{questions.map((question, index) => <fieldset key={index} className="space-y-2"><legend className="text-sm font-medium">{index + 1}. {question.prompt ?? question.text ?? "Pregunta"}</legend>{(question.options ?? []).map((option, optionIndex) => <label key={optionIndex} className="flex cursor-pointer items-center gap-2 text-sm"><input type="radio" name={`q-${lesson.id}-${index}`} checked={answers[index] === optionIndex} onChange={() => setAnswers((old) => { const next = [...old]; next[index] = optionIndex; return next; })} />{option}</label>)}</fieldset>)}<Button onClick={takeQuiz} disabled={quiz.isPending || answers.length !== questions.length || !answers.every(Number.isInteger)}>{quiz.isPending ? "Corrigiendo..." : "Enviar respuestas"}</Button></div>}
        {(lesson.kind === "scorm12" || lesson.kind === "scorm2004") && (!scorm ? <Button onClick={openScorm} disabled={session.isPending}><Play className="mr-2 h-4 w-4" />{session.isPending ? "Preparando..." : "Abrir contenido SCORM"}</Button> : <ScormRunner session={scorm} courseId={course.id} />)}
        {lesson.kind !== "quiz" && !["scorm12", "scorm2004"].includes(lesson.kind) && progress?.status !== "completed" && <Button onClick={markComplete} disabled={complete.isPending}>{complete.isPending ? "Guardando..." : "Marcar como completada"}</Button>}
        {progress?.score != null && <p className="text-xs text-muted-foreground">Mejor puntuación: {progress.score}% · Intentos: {progress.attempts}</p>}
      </CardContent>
    </Card>
  );
}

function CourseEditor({ course, scopes, onClose, onSaved }: { course: LmsCourse | null; scopes: Array<{ moduleId: number | null; label: string }>; onClose: () => void; onSaved: () => void }) {
  const create = useCreateLmsCourse(); const update = useUpdateLmsCourse();
  const [title, setTitle] = useState(course?.title ?? ""); const [description, setDescription] = useState(course?.description ?? "");
  const [moduleId, setModuleId] = useState(course?.moduleId == null ? "" : String(course.moduleId)); const [certificate, setCertificate] = useState(course?.certificateEnabled ?? true);
  const save = async () => {
    try {
      const data = { title: title.trim(), description, moduleId: moduleId ? Number(moduleId) : null, certificateEnabled: certificate };
      if (course) await update.mutateAsync({ courseId: course.id, data }); else await create.mutateAsync({ data });
      toast({ title: course ? "Curso actualizado" : "Curso creado" }); onSaved(); onClose();
    } catch { toast({ title: "No se pudo guardar el curso", variant: "destructive" }); }
  };
  return <Card className="border-primary/30"><CardHeader><CardTitle>{course ? "Editar curso" : "Nuevo curso"}</CardTitle></CardHeader><CardContent className="space-y-4"><div><Label>Título</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div><div><Label>Descripción</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div><div><Label>Ámbito</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={moduleId} onChange={(e) => setModuleId(e.target.value)}>{scopes.map((scope) => <option key={scope.moduleId ?? "general"} value={scope.moduleId ?? ""}>{scope.label}</option>)}</select></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={certificate} onChange={(e) => setCertificate(e.target.checked)} /> Emitir certificado al completar</label><div className="flex gap-2"><Button onClick={save} disabled={!title.trim() || create.isPending || update.isPending}>Guardar</Button><Button variant="ghost" onClick={onClose}>Cancelar</Button></div></CardContent></Card>;
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

export default function AutodirigidoPage() {
  const [, navigate] = useLocation(); const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null); const [editor, setEditor] = useState<"create" | "edit" | null>(null); const [lessonEditor, setLessonEditor] = useState<number | null>(null); const [editingLesson, setEditingLesson] = useState<LmsLesson | undefined>();
  const courses = useListLmsCourses(); const detail = useGetLmsCourse(selectedId ?? 0, { query: { enabled: selectedId != null, queryKey: getGetLmsCourseQueryKey(selectedId ?? 0) } }); const scopes = useGetLmsManagementScopes();
  const publish = usePublishLmsCourse(); const manager = (scopes.data?.length ?? 0) > 0;
  const refresh = async () => { await queryClient.invalidateQueries({ queryKey: getListLmsCoursesQueryKey() }); if (selectedId) await queryClient.invalidateQueries({ queryKey: getGetLmsCourseQueryKey(selectedId) }); };
  useEffect(() => { const id = new URLSearchParams(window.location.search).get("curso"); if (id) setSelectedId(Number(id)); }, []);
  const scormToken = new URLSearchParams(window.location.search).get("scorm");
  if (scormToken) return <RemoteScormSession token={scormToken} />;
  if (selectedId && detail.isLoading) return <p className="py-12 text-center text-muted-foreground">Cargando curso...</p>;
  const course = detail.data;
  const requiredLessons = course?.lessons.filter((lesson) => lesson.required) ?? [];
  const completedRequired = requiredLessons.filter((lesson) => course?.progress.some((progress) => progress.lessonId === lesson.id && progress.status === "completed")).length;
  const courseProgress = requiredLessons.length
    ? Math.round(completedRequired * 100 / requiredLessons.length)
    : course?.lessonCount ? 100 : 0;
  return <div className="space-y-6">
    <header className="flex flex-wrap items-start gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><GraduationCap /></div><div className="flex-1"><h1 className="text-2xl font-bold">Autodirigido</h1><p className="text-sm text-muted-foreground">Aprende a tu ritmo, completa tus lecciones y consigue tus certificados.</p></div>{manager && !selectedId && <Button onClick={() => setEditor("create")}><Plus className="mr-2 h-4 w-4" />Nuevo curso</Button>}</header>
    {editor && <CourseEditor course={editor === "edit" ? (course ?? null) : null} scopes={scopes.data ?? []} onClose={() => setEditor(null)} onSaved={refresh} />}
    {selectedId && course ? <div className="space-y-5"><Button variant="ghost" onClick={() => { setSelectedId(null); navigate("/autodirigido"); }}><ChevronLeft className="mr-1 h-4 w-4" />Todos los cursos</Button><Card><CardHeader><div className="flex flex-wrap items-start gap-3"><div className="flex-1"><div className="mb-2 flex gap-2"><Badge>{course.status === "published" ? "Publicado" : "Borrador"}</Badge>{course.certificateEnabled && <Badge variant="outline"><Award className="mr-1 h-3 w-3" />Certificado</Badge>}</div><CardTitle className="text-2xl">{course.title}</CardTitle><p className="mt-2 text-sm text-muted-foreground">{course.description}</p></div>{manager && <Button variant="outline" onClick={() => setEditor("edit")}><Pencil className="mr-2 h-4 w-4" />Editar</Button>}</div></CardHeader><CardContent><ProgressMark value={courseProgress} /></CardContent></Card>{course.lessons.map((lesson) => <div key={lesson.id}>{lessonEditor === lesson.id ? <LessonEditor courseId={course.id} lesson={editingLesson} onSaved={() => { setLessonEditor(null); refresh(); }} /> : <><LessonView course={course} lesson={lesson} onRefresh={refresh} />{manager && <Button variant="ghost" size="sm" onClick={() => { setEditingLesson(lesson); setLessonEditor(lesson.id); }}><Pencil className="mr-2 h-4 w-4" />Editar lección</Button>}</>}</div>)}{manager && <><Button variant="outline" onClick={() => { setEditingLesson(undefined); setLessonEditor(-1); }}><Plus className="mr-2 h-4 w-4" />Añadir lección</Button>{lessonEditor === -1 && <LessonEditor courseId={course.id} onSaved={() => { setLessonEditor(null); refresh(); }} />}{course.status !== "published" && <Button onClick={async () => { await publish.mutateAsync({ courseId: course.id }); toast({ title: "Curso publicado" }); refresh(); }} disabled={publish.isPending}><Send className="mr-2 h-4 w-4" />Publicar curso</Button>}</>}</div> : <><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{courses.isLoading ? <p>Cargando cursos...</p> : courses.data?.map((item: LmsCourse) => <button key={item.id} className="text-left" onClick={() => { setSelectedId(item.id); navigate(`/autodirigido?curso=${item.id}`); }}><Card className="h-full transition hover:-translate-y-0.5 hover:border-primary"><CardHeader><div className="mb-2 flex items-center justify-between"><BookOpen className="h-5 w-5 text-primary" /><Badge variant={item.status === "published" ? "default" : "secondary"}>{item.status === "published" ? "Publicado" : "Borrador"}</Badge></div><CardTitle className="text-lg">{item.title}</CardTitle></CardHeader><CardContent className="space-y-3"><p className="line-clamp-2 text-sm text-muted-foreground">{item.description || "Curso autodirigido"}</p><ProgressMark value={item.lessonCount ? Math.round(item.completed ? 100 : 0) : 0} /></CardContent></Card></button>)}</div>{!courses.isLoading && courses.data?.length === 0 && <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">Todavía no hay cursos disponibles.</CardContent></Card>}</>}
  </div>;
}