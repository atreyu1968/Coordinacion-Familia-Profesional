import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyYearConfirmation,
  useConfirmYear,
  useListCenters,
  useListModules,
  getGetMyYearConfirmationQueryKey,
  getListCentersQueryKey,
  getListModulesQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { CalendarCheck, AlertTriangle } from "lucide-react";

export function TeacherConfirmationBanner() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isTeacher = user?.role === "teacher";

  const { data: confirmation } = useGetMyYearConfirmation({
    query: {
      queryKey: getGetMyYearConfirmationQueryKey(),
      enabled: isTeacher,
    },
  });

  const [open, setOpen] = useState(false);
  const [centerId, setCenterId] = useState<number | null>(null);
  const [moduleIds, setModuleIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const confirmMut = useConfirmYear();
  const { data: centers = [] } = useListCenters(
    {},
    { query: { queryKey: getListCentersQueryKey({}), enabled: open } },
  );
  const { data: modules = [] } = useListModules(
    {},
    { query: { queryKey: getListModulesQueryKey({}), enabled: open } },
  );

  useEffect(() => {
    if (open) {
      setCenterId(confirmation?.centerId ?? user?.centerId ?? null);
      setModuleIds(confirmation?.moduleIds ?? []);
      setError(null);
    }
  }, [open, confirmation, user]);

  const deadlineLabel = useMemo(() => {
    if (!confirmation?.deadline) return null;
    return new Date(confirmation.deadline).toLocaleDateString("es-ES", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }, [confirmation]);

  if (!isTeacher) return null;
  if (!confirmation || confirmation.status !== "pending") return null;

  const toggleModule = (id: number) => {
    setModuleIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
  };

  const onConfirm = async () => {
    setError(null);
    if (centerId == null) {
      setError("Selecciona tu centro.");
      return;
    }
    if (moduleIds.length === 0) {
      setError("Selecciona al menos un módulo que impartes.");
      return;
    }
    try {
      await confirmMut.mutateAsync({ data: { centerId, moduleIds } });
      await qc.invalidateQueries({
        queryKey: getGetMyYearConfirmationQueryKey(),
      });
      toast({
        title: "Confirmación registrada",
        description: "Gracias por confirmar tu centro y módulos para el curso.",
      });
      setOpen(false);
    } catch {
      setError("No se pudo registrar la confirmación. Inténtalo de nuevo.");
    }
  };

  return (
    <>
      <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium text-amber-900 dark:text-amber-200">
                Confirma tu continuidad para el curso
                {confirmation.year ? ` ${confirmation.year}` : ""}
              </p>
              <p className="text-sm text-amber-800/90 dark:text-amber-200/80">
                Es obligatorio confirmar tu centro y los módulos que imparten.
                {deadlineLabel
                  ? ` Tienes hasta el ${deadlineLabel}; si no confirmas, tu cuenta se desactivará automáticamente.`
                  : ""}
              </p>
            </div>
          </div>
          <Button
            className="gap-2 shrink-0"
            onClick={() => setOpen(true)}
          >
            <CalendarCheck className="h-4 w-4" /> Confirmar ahora
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar curso académico</DialogTitle>
            <DialogDescription>
              Indica tu centro y los módulos que vas a impartir
              {confirmation.year ? ` en el curso ${confirmation.year}` : ""}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Centro *</Label>
              <Select
                value={centerId != null ? String(centerId) : ""}
                onValueChange={(v) => setCenterId(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona tu centro" />
                </SelectTrigger>
                <SelectContent>
                  {centers.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Módulos que impartes *</Label>
              <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-md border p-3">
                {modules.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No hay módulos disponibles.
                  </p>
                ) : (
                  modules.map((m) => (
                    <label
                      key={m.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={moduleIds.includes(m.id)}
                        onCheckedChange={() => toggleModule(m.id)}
                      />
                      <span>
                        {m.code ? `${m.code} · ` : ""}
                        {m.name}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
            {error && (
              <p className="text-sm font-medium text-destructive">{error}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={() => void onConfirm()}
              disabled={confirmMut.isPending}
            >
              {confirmMut.isPending ? "Confirmando..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
