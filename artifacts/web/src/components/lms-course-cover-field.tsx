import { useEffect, useState } from "react";
import { CourseCover } from "./lms-classroom";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import type { LmsCourse } from "@workspace/api-client-react";

export function LmsCourseCoverField({ course, title, file, removed, disabled, onFile, onRemove }: {
  course: LmsCourse | null;
  title: string;
  file: File | null;
  removed: boolean;
  disabled: boolean;
  onFile: (file: File | null) => void;
  onRemove: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return <fieldset disabled={disabled} className="space-y-2">
    <Label htmlFor="course-cover">Portada del curso</Label>
    <div className="max-w-sm overflow-hidden rounded-lg border">
      {preview ? <img src={preview} alt="Vista previa de la portada seleccionada" className="aspect-video w-full object-cover" />
        : <CourseCover course={{ id: course?.id ?? 0, title, coverUrl: removed ? null : course?.coverUrl }} />}
    </div>
    <Input id="course-cover" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
      const selected = event.target.files?.[0] ?? null;
      event.target.value = "";
      if (!selected) return;
      if (!["image/jpeg", "image/png", "image/webp"].includes(selected.type) || selected.size < 1 || selected.size > 5 * 1024 * 1024) {
        setError("Selecciona una imagen JPEG, PNG o WebP de hasta 5 MB."); return;
      }
      setError("");
      onFile(selected);
    }} />
    <p className="text-xs text-muted-foreground">JPEG, PNG o WebP, hasta 5 MB y 25 megapíxeles. Se recomienda una imagen horizontal 16:9; se recorta para ajustar.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {(file || (course?.coverUrl && !removed)) && <Button type="button" variant="outline" onClick={() => { setError(""); onRemove(); }}>Usar portada alternativa</Button>}
  </fieldset>;
}
