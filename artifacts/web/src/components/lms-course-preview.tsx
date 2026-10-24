import { useState, type ReactNode } from "react";
import type { LmsCourseDetail, LmsLesson, LmsProgress } from "@workspace/api-client-react";
import { AutoLinkText } from "@/components/auto-link-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Award, ChevronLeft } from "lucide-react";

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
  const percent = required.length ? Math.round(completed * 100 / required.length) : 0;
  const previewCourse: LmsCourseDetail = {
    ...course, status: "published", progress,
    completed: required.length > 0 && completed === required.length,
    certificateAvailable: false,
  };
  return <div className="space-y-5">
    <aside role="note" className="rounded-md border border-primary/30 bg-primary/5 p-4">
      <p className="font-medium">Vista previa como alumno</p>
      <p className="text-sm text-muted-foreground">
        Estás viendo la versión guardada. El curso no se publica y las pruebas
        no guardan progreso, intentos ni certificados. Al salir se reinicia la simulación.
      </p>
      <Button className="mt-3" variant="outline" onClick={onClose}>
        <ChevronLeft className="mr-1 h-4 w-4" />Volver a la gestión
      </Button>
    </aside>
    <Card><CardHeader>
      <div className="mb-2 flex gap-2">
        <Badge>Publicado</Badge>
        {course.certificateEnabled && <Badge variant="outline"><Award className="mr-1 h-3 w-3" />Certificado</Badge>}
      </div>
      <CardTitle className="text-2xl">{course.title}</CardTitle>
      <p className="mt-2 text-sm text-muted-foreground"><AutoLinkText text={course.description} /></p>
      {previewCourse.completed && course.certificateEnabled &&
        !course.lessons.some((lesson) => ["scorm12", "scorm2004"].includes(lesson.kind)) &&
        <Button disabled title="Los certificados no se emiten en la vista previa">Descargar certificado</Button>}
    </CardHeader><CardContent>
      <div className="flex items-center gap-2"><Progress value={percent} className="h-2" /><span className="text-xs text-muted-foreground">{percent}%</span></div>
    </CardContent></Card>
    {course.lessons.length === 0 && <p className="text-sm text-muted-foreground">Este curso todavía no tiene lecciones.</p>}
    {course.lessons.map((lesson) => <div key={lesson.id}>
      {renderLesson(previewCourse, lesson, (value) => setProgress((old) => [
        ...old.filter((item) => item.lessonId !== value.lessonId), value,
      ]))}
    </div>)}
  </div>;
}
