import { useState, type ReactNode } from "react";
import type { LmsCourseDetail, LmsLesson, LmsProgress } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { CourseHero, LmsClassroom, useLessonSelection } from "@/components/lms-classroom";
import { ChevronLeft, Eye } from "lucide-react";

export function LmsCoursePreview({ course, onClose, renderLesson }: {
  course: LmsCourseDetail;
  onClose: () => void;
  renderLesson: (course: LmsCourseDetail, lesson: LmsLesson, onProgress: (value: LmsProgress) => void) => ReactNode;
}) {
  const [progress, setProgress] = useState<LmsProgress[]>([]);
  const required = course.lessons.filter((lesson) => lesson.required);
  const completed = required.filter((lesson) =>
    progress.some((value) => value.lessonId === lesson.id && value.status === "completed"),
  ).length;
  const previewCourse: LmsCourseDetail = {
    ...course, status: "published", progress,
    completed: required.length > 0 && completed === required.length,
    certificateAvailable: false,
  };
  const [selectedLessonId, selectLesson] = useLessonSelection(previewCourse);
  const onProgress = (value: LmsProgress) => setProgress((old) => [
    ...old.filter((item) => item.lessonId !== value.lessonId), value,
  ]);
  return <div className="space-y-6">
    <aside role="note" className="flex flex-wrap items-center gap-4 rounded-2xl border border-primary/30 bg-primary/5 px-5 py-4">
      <Eye className="h-5 w-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Vista previa como alumno</p>
        <p className="text-sm text-muted-foreground">
          Estás viendo la versión guardada. El curso no se publica y las pruebas
          no guardan progreso, intentos ni certificados. Al salir se reinicia la simulación.
        </p>
      </div>
      <Button variant="outline" onClick={onClose}>
        <ChevronLeft className="mr-1 h-4 w-4" />Volver a la gestión
      </Button>
    </aside>
    <CourseHero course={previewCourse} actions={previewCourse.completed && course.certificateEnabled &&
      !course.lessons.some((lesson) => ["scorm12", "scorm2004"].includes(lesson.kind))
      ? <Button disabled title="Los certificados no se emiten en la vista previa">Descargar certificado</Button>
      : undefined} />
    <LmsClassroom course={previewCourse} selectedLessonId={selectedLessonId} onSelect={selectLesson}
      renderLesson={(lesson) => <div key={lesson.id}>{renderLesson(previewCourse, lesson, onProgress)}</div>} />
  </div>;
}
