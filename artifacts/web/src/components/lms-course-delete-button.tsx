import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetLmsCourseQueryKey,
  getListLmsCoursesQueryKey,
  useDeleteLmsCourse,
} from "@workspace/api-client-react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";

export function LmsCourseDeleteButton({
  course,
  onDeleted,
}: {
  course: { id: number; title: string };
  onDeleted?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deletion = useDeleteLmsCourse();
  const queryClient = useQueryClient();

  const remove = async () => {
    setError(null);
    try {
      await deletion.mutateAsync({ courseId: course.id });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Inténtalo de nuevo.";
      setError(message);
      toast({ title: "No se pudo eliminar el curso", description: message, variant: "destructive" });
      return;
    }
    setOpen(false);
    onDeleted?.();
    toast({ title: "Curso eliminado", description: "Ya no está disponible en el catálogo." });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListLmsCoursesQueryKey() }),
      queryClient.invalidateQueries({
        queryKey: getGetLmsCourseQueryKey(course.id),
        refetchType: "none",
      }),
    ]);
  };

  return (
    <AlertDialog open={open} onOpenChange={(value) => {
      if (!deletion.isPending) { setOpen(value); setError(null); }
    }}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" aria-label={`Eliminar curso ${course.title}`}>
          <Trash2 className="mr-2 h-4 w-4" />Eliminar curso
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar «{course.title}»?</AlertDialogTitle>
          <AlertDialogDescription>
            El curso dejará de estar disponible, tanto si es un borrador como si
            está publicado. Su historial y sus archivos no se borrarán definitivamente.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deletion.isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={deletion.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(event) => { event.preventDefault(); void remove(); }}
          >
            {deletion.isPending ? "Eliminando..." : "Confirmar eliminación"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
