import { useEffect, useState, type ReactNode } from "react";
import { useLmsCourseCover } from "@/hooks/use-lms-course-cover";
export { useLmsLessonSelection as useLessonSelection } from "@workspace/api-client-react";
import type { LmsCourse, LmsCourseDetail, LmsLesson } from "@workspace/api-client-react";
import { AutoLinkText } from "@/components/auto-link-text";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, FileDown, FileText,
  ListChecks, Package, PanelLeftClose, PanelLeftOpen, PlayCircle, Pin, PinOff, XCircle,
} from "lucide-react";

export const lessonKindLabels: Record<string, string> = {
  text: "Lectura", file: "Archivo", video: "Vídeo", quiz: "Cuestionario",
  scorm12: "SCORM 1.2", scorm2004: "SCORM 2004",
};

export function LessonKindIcon({ kind, className = "h-4 w-4" }: { kind: string; className?: string }) {
  if (kind === "video") return <PlayCircle className={className} aria-hidden />;
  if (kind === "file") return <FileDown className={className} aria-hidden />;
  if (kind === "quiz") return <ListChecks className={className} aria-hidden />;
  if (kind === "scorm12" || kind === "scorm2004") return <Package className={className} aria-hidden />;
  return <FileText className={className} aria-hidden />;
}

/** Truthful generative cover: derived only from id and title, never from invented imagery. */
const coverPalettes = [
  ["#0b3d91", "#e8eef9", "#f2b134"],
  ["#123a5c", "#eaf2f0", "#2fa58a"],
  ["#3b2a6b", "#f1edf8", "#e66b4f"],
  ["#0f4c5c", "#e9f3f4", "#f08a24"],
  ["#5a1f2e", "#f8ecee", "#3e8ed0"],
  ["#1f3b2d", "#edf4ee", "#d9a441"],
];

export function CourseCover({ course, size = "md" }: { course: Pick<LmsCourse, "id" | "title" | "coverUrl">; size?: "md" | "lg" }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const coverUrl = course.coverUrl;
  const imageSrc = useLmsCourseCover(course.id, coverUrl);
  const [deep, light, accent] = coverPalettes[course.id % coverPalettes.length]!;
  const initials = course.title.split(/\s+/).filter((w) => w.length > 2).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || course.title.slice(0, 2).toUpperCase();
  const variant = course.id % 3;
  if (imageSrc && coverUrl && coverUrl !== failedUrl) {
    return <div aria-hidden className={`relative overflow-hidden ${size === "lg" ? "aspect-[16/10] rounded-2xl" : "aspect-[16/9]"}`}>
      <img src={imageSrc} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setFailedUrl(coverUrl)} />
    </div>;
  }
  return (
    <div aria-hidden className={`relative overflow-hidden ${size === "lg" ? "aspect-[16/10] rounded-2xl" : "aspect-[16/9]"}`} style={{ background: deep }}>
      {variant === 0 && <>
        <div className="absolute -right-[12%] -top-[30%] aspect-square w-[70%] rounded-full" style={{ background: accent, opacity: 0.9 }} />
        <div className="absolute -bottom-[40%] left-[8%] aspect-square w-[55%] rounded-full border-[14px]" style={{ borderColor: light, opacity: 0.18 }} />
      </>}
      {variant === 1 && <>
        <div className="absolute inset-y-0 right-0 w-[42%]" style={{ background: accent, clipPath: "polygon(35% 0, 100% 0, 100% 100%, 0 100%)" }} />
        <div className="absolute bottom-[14%] right-[8%] h-[30%] w-[22%] rounded-sm" style={{ background: light, opacity: 0.85 }} />
      </>}
      {variant === 2 && <>
        <div className="absolute inset-0" style={{ backgroundImage: `radial-gradient(${light}33 1.5px, transparent 1.5px)`, backgroundSize: "14px 14px" }} />
        <div className="absolute -right-[6%] bottom-[-20%] h-[85%] w-[45%] rounded-t-full" style={{ background: accent }} />
      </>}
      <span className={`absolute bottom-3 left-4 font-extrabold leading-none tracking-tighter ${size === "lg" ? "text-7xl" : "text-5xl"}`} style={{ color: light }}>{initials}</span>
    </div>
  );
}

export function courseProgressStats(course: LmsCourseDetail) {
  const required = course.lessons.filter((lesson) => lesson.required);
  const done = (lesson: LmsLesson) => course.progress.some((p) => p.lessonId === lesson.id && p.status === "completed");
  const completedRequired = required.filter(done).length;
  const percent = required.length ? Math.round(completedRequired * 100 / required.length) : course.lessons.length ? 100 : 0;
  return { requiredCount: required.length, completedRequired, percent, isDone: done };
}

export function CourseHero({ course, eyebrow, actions, aside }: {
  course: LmsCourseDetail; eyebrow?: ReactNode; actions?: ReactNode; aside?: ReactNode;
}) {
  const { requiredCount, completedRequired } = courseProgressStats(course);
  const kinds = Array.from(new Set(course.lessons.map((l) => l.kind)));
  return (
    <section className="grid gap-6 rounded-3xl border bg-card p-5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] md:p-8">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
          <span>Curso autodirigido</span>
          <span className="text-muted-foreground">·</span>
          <span className={course.status === "published" ? "text-emerald-700" : "text-amber-700"}>{course.status === "published" ? "Publicado" : "Borrador"}</span>
          {eyebrow}
        </div>
        <h1 className="text-3xl font-extrabold leading-[1.08] tracking-tight md:text-4xl">{course.title}</h1>
        {course.description && <p className="max-w-prose text-[15px] leading-7 text-muted-foreground"><AutoLinkText text={course.description} /></p>}
        <dl className="mt-1 grid grid-cols-2 gap-x-6 gap-y-3 border-t pt-4 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-muted-foreground">Lecciones</dt><dd className="font-semibold">{course.lessons.length}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Obligatorias superadas</dt><dd className="font-semibold">{completedRequired} de {requiredCount}</dd></div>
        </dl>
        {kinds.length > 0 && <ul className="flex flex-wrap gap-2" aria-label="Formatos del curso">
          {kinds.map((k) => <li key={k} className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium"><LessonKindIcon kind={k} className="h-3.5 w-3.5" />{lessonKindLabels[k] ?? k}</li>)}
        </ul>}
        {actions && <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div>}
      </div>
      <div className="flex flex-col gap-4">
        <CourseCover course={course} size="lg" />
        {aside}
      </div>
    </section>
  );
}

function StatusGlyph({ status, index }: { status?: string; index: number }) {
  if (status === "completed") return <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-label="Completada" />;
  if (status === "failed") return <XCircle className="h-5 w-5 text-destructive" aria-label="No superada" />;
  if (status === "in_progress") return <CircleDashed className="h-5 w-5 text-primary" aria-label="En curso" />;
  return <span className="flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold text-muted-foreground" aria-label="Pendiente">{index + 1}</span>;
}

export function LmsClassroom({ course, selectedLessonId, onSelect, renderLesson, emptyMessage, onBack, headerActions }: {
  course: LmsCourseDetail;
  selectedLessonId: number | null;
  onSelect: (id: number) => void;
  renderLesson: (lesson: LmsLesson) => ReactNode;
  emptyMessage?: string;
  onBack?: () => void;
  headerActions?: ReactNode;
}) {
  const { percent, completedRequired, requiredCount } = courseProgressStats(course);
  const [curriculumCollapsed, setCurriculumCollapsed] = useState(false);
  const [stickyHeader, setStickyHeader] = useState(() => {
    try {
      return typeof window === "undefined" || window.localStorage.getItem("coordina-lms-sticky-header") !== "false";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("coordina-lms-sticky-header", String(stickyHeader));
    } catch {
      // The classroom remains fully usable when browser storage is unavailable.
    }
  }, [stickyHeader]);
  const index = course.lessons.findIndex((l) => l.id === selectedLessonId);
  const lesson = index >= 0 ? course.lessons[index] : undefined;
  const prev = index > 0 ? course.lessons[index - 1] : undefined;
  const next = index >= 0 && index < course.lessons.length - 1 ? course.lessons[index + 1] : undefined;
  const go = (id: number) => { onSelect(id); document.getElementById("lms-stage")?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  return (
    <section aria-label="Aula del curso" className="relative isolate space-y-5">
      <header className={`z-20 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/80 bg-card/95 px-3 py-3 shadow-[0_8px_30px_-24px_hsl(var(--foreground)/0.35)] backdrop-blur-md sm:px-5 ${stickyHeader ? "sticky top-2" : ""}`}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {onBack && <Button variant="ghost" size="icon" aria-label="Volver a los cursos" title="Volver a los cursos" onClick={onBack} className="shrink-0">
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </Button>}
          <div className="min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-primary">Coordina ADG <span className="mx-1 text-border">/</span> Aula</p>
          <h1 className="truncate text-[15px] font-bold leading-tight tracking-[-0.02em] sm:text-base">{course.title}</h1>
          </div>
        </div>
        {headerActions && <div className="flex items-center gap-2">{headerActions}</div>}
        <div className="flex items-center gap-2 border-l pl-3 sm:gap-3 sm:pl-4">
          <span className="whitespace-nowrap rounded-md bg-muted/70 px-2.5 py-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
            {lesson ? `Lección ${index + 1} de ${course.lessons.length}` : `${course.lessons.length} lecciones`}
          </span>
          <button type="button" onClick={() => setStickyHeader((value) => !value)}
            aria-pressed={stickyHeader} aria-label={stickyHeader ? "Desactivar encabezado fijo" : "Activar encabezado fijo"}
            title={stickyHeader ? "Desactivar encabezado fijo" : "Activar encabezado fijo"}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {stickyHeader ? <Pin className="h-4 w-4" aria-hidden /> : <PinOff className="h-4 w-4" aria-hidden />}
          </button>
        </div>
      </header>
      <div className={`grid min-w-0 gap-4 lg:items-start lg:gap-5 ${curriculumCollapsed ? "lg:grid-cols-[68px_minmax(0,1fr)]" : "lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[328px_minmax(0,1fr)]"}`}>
        <aside aria-label="Currículo del curso" className="order-1 min-w-0 lg:sticky lg:top-20 lg:self-start">
          <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-[0_12px_35px_-30px_hsl(var(--foreground)/0.42)]">
            <div className={`border-b bg-muted/25 ${curriculumCollapsed ? "p-2" : "p-4 sm:p-5"}`}>
              <div className={`flex items-center ${curriculumCollapsed ? "flex-col gap-3" : "justify-between gap-3"}`}>
                {!curriculumCollapsed && <div className="min-w-0">
                  <p className="text-[9px] font-bold uppercase tracking-[0.17em] text-primary">Tu recorrido</p>
                  <h2 className="mt-1 text-sm font-bold tracking-tight">Contenido del curso</h2>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{completedRequired} de {requiredCount} obligatorias completadas</p>
                </div>}
                <span className={`font-extrabold tabular-nums tracking-tight text-primary ${curriculumCollapsed ? "text-sm" : "text-2xl"}`}>{percent}%</span>
                <button type="button" onClick={() => setCurriculumCollapsed((value) => !value)}
                  aria-expanded={!curriculumCollapsed}
                  aria-label={curriculumCollapsed ? "Expandir contenido del curso" : "Contraer contenido del curso"}
                  title={curriculumCollapsed ? "Expandir contenido del curso" : "Contraer contenido del curso"}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {curriculumCollapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}
                </button>
              </div>
              {!curriculumCollapsed && <>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Progreso del curso">
                  <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${percent}%` }} />
                </div>
              </>}
            </div>
            {!curriculumCollapsed && <ol className="max-h-[58vh] overflow-y-auto p-2.5">
              {course.lessons.map((item, i) => {
                const status = course.progress.find((p) => p.lessonId === item.id)?.status;
                const active = item.id === selectedLessonId;
                return <li key={item.id}>
                  <button type="button" onClick={() => go(item.id)} aria-current={active ? "step" : undefined}
                    className={`group flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "border-primary/15 bg-primary/[0.07] shadow-sm" : "hover:bg-muted/70"}`}>
                    <span className="mt-0.5 shrink-0"><StatusGlyph status={status} index={i} /></span>
                    <span className="min-w-0 flex-1">
                      <span className={`block leading-snug ${active ? "font-semibold text-primary" : "font-medium"}`}>{item.title}</span>
                      <span className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground"><LessonKindIcon kind={item.kind} className="h-3 w-3" />{lessonKindLabels[item.kind] ?? item.kind}<span aria-hidden className="mx-0.5">·</span>{item.required ? "Obligatoria" : "Opcional"}</span>
                    </span>
                  </button>
                </li>;
              })}
            </ol>}
            {curriculumCollapsed && <div className="hidden px-2 pb-2 lg:block">
              <span className="sr-only">Currículo contraído</span>
              {lesson && <span className="flex h-8 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary" aria-label={`Lección ${index + 1} seleccionada`}>{index + 1}</span>}
            </div>}
          </div>
        </aside>
        <div id="lms-stage" className="order-2 min-w-0 scroll-mt-24">
        {!lesson ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed bg-card/70 px-6 py-12 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><FileText className="h-5 w-5" aria-hidden /></div>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{emptyMessage ?? "Este curso todavía no tiene lecciones."}</p>
          </div>
        ) : (
          <article className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-[0_16px_45px_-36px_hsl(var(--foreground)/0.48)]">
            <header className="border-b bg-muted/25 px-5 py-5 sm:px-7 md:py-6">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-muted-foreground">
                <span className="font-semibold uppercase tracking-[0.12em] text-primary">Lección {index + 1} <span className="text-muted-foreground">/ {course.lessons.length}</span></span>
                <span className="flex items-center gap-1.5"><LessonKindIcon kind={lesson.kind} className="h-3.5 w-3.5" />{lessonKindLabels[lesson.kind] ?? lesson.kind}</span>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${lesson.required ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{lesson.required ? "Obligatoria" : "Opcional"}</span>
              </div>
              <h2 className="mt-3 max-w-4xl text-xl font-extrabold leading-tight tracking-[-0.03em] sm:text-2xl">{lesson.title}</h2>
            </header>
            <div key={lesson.id} className="min-h-[360px] px-5 py-6 sm:px-7 md:py-9">{renderLesson(lesson)}</div>
            <nav aria-label="Navegación entre lecciones" className="flex items-stretch justify-between gap-3 border-t bg-muted/20 px-3 py-3 sm:px-5 md:px-7">
              <Button variant="ghost" disabled={!prev} onClick={() => prev && go(prev.id)} className="h-auto max-w-[48%] justify-start py-2 text-left">
                <ChevronLeft className="mr-2 h-4 w-4 shrink-0" />
                <span className="min-w-0"><span className="block text-[11px] font-normal text-muted-foreground">Anterior</span><span className="block truncate">{prev?.title ?? "Inicio del curso"}</span></span>
              </Button>
              <Button variant={next ? "default" : "ghost"} disabled={!next} onClick={() => next && go(next.id)} className="h-auto max-w-[48%] justify-end py-2 text-right">
                <span className="min-w-0"><span className="block text-[11px] font-normal opacity-80">Siguiente</span><span className="block truncate">{next?.title ?? "Fin del curso"}</span></span>
                <ChevronRight className="ml-2 h-4 w-4 shrink-0" />
              </Button>
            </nav>
          </article>
        )}
        </div>
      </div>
    </section>
  );
}
