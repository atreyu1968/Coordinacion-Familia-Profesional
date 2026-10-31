import { useEffect, useState } from "react";
import {
  usePermanentlyDeleteUser,
  usePreviewUserPermanentDeletion,
  type ManagedUser,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  LoaderCircle,
  Trash2,
} from "lucide-react";
import { getApiErrorMessage } from "@/lib/user-management";
import { toast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  user: ManagedUser | null;
  open: boolean;
  onClose: () => void;
  onDeleted: (id: number) => Promise<void> | void;
};

export function UserPermanentDeletionDialog({ user, open, onClose, onDeleted }: Props) {
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const userId = user?.id ?? 0;
  const preview = usePreviewUserPermanentDeletion(userId, {
    query: {
      enabled: open && user != null,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: false,
    },
  });
  const purge = usePermanentlyDeleteUser();

  useEffect(() => {
    if (open) {
      setConfirmation("");
      setError(null);
    }
  }, [open, userId]);

  const data = preview.data;
  const blocked = (data?.blockedReasons.length ?? 1) > 0;
  const canDelete =
    !!data &&
    !preview.isFetching &&
    !preview.isError &&
    !blocked &&
    confirmation === data.target.email &&
    !purge.isPending;

  async function confirmDelete() {
    if (!data || !canDelete) return;
    setError(null);
    try {
      const result = await purge.mutateAsync({
        id: data.target.id,
        data: { fingerprint: data.fingerprint, confirmation },
      });
      toast({
        title: "Usuario eliminado definitivamente",
        description: `${result.name}: ${result.assignmentsDeleted} asignaciones y ${result.historyDeleted} registros asociados eliminados.`,
      });
      setConfirmation("");
      await onDeleted(result.userId);
    } catch (err) {
      setError(getApiErrorMessage(err) ?? "No se pudo eliminar el usuario. Actualiza la vista previa e inténtalo de nuevo.");
      void preview.refetch();
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !purge.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Eliminar definitivamente usuario
          </DialogTitle>
          <DialogDescription>
            Comprueba la cuenta y todos los registros asociados antes de confirmar. Esta acción no se puede deshacer.
          </DialogDescription>
        </DialogHeader>

        {preview.isLoading && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Revisando datos asociados…
          </div>
        )}

        {preview.isError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {getApiErrorMessage(preview.error) ?? "No se pudo cargar la vista previa. Cierra y vuelve a abrir este diálogo."}
            </AlertDescription>
          </Alert>
        )}

        {data && (
          <div className="space-y-4">
            <section className="rounded-lg border p-3 text-sm">
              <p className="font-semibold">{data.target.name}</p>
              <p className="text-muted-foreground">{data.target.email}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.target.role} · {data.target.status === "active" ? "Activa" : "Desactivada"}
              </p>
            </section>

            <section aria-label="Registros que se eliminarán" className="space-y-2">
              <h3 className="text-sm font-semibold">Registros de la aplicación que se eliminarían</h3>
              <div className="max-h-44 overflow-y-auto rounded-lg border">
                <ul className="divide-y text-sm">
                  <li className="flex justify-between gap-4 px-3 py-2">
                    <span>Asignaciones docentes</span><span className="font-medium">{data.assignments}</span>
                  </li>
                  {data.history.map((item, index) => (
                    <li key={`${item.label}-${index}`} className="flex justify-between gap-4 px-3 py-2">
                      <span>{item.label}</span><span className="font-medium">{item.count}</span>
                    </li>
                  ))}
                  {data.history.length === 0 && data.assignments === 0 && (
                    <li className="px-3 py-2 text-muted-foreground">No hay registros de actividad asociados.</li>
                  )}
                </ul>
              </div>
            </section>

            {blocked && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  No se puede borrar esta cuenta todavía:
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {data.blockedReasons.map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Si existe una cuenta de Nextcloud, se deshabilitará. Se conservan los archivos almacenados fuera de la base de datos y las copias de seguridad. Los catálogos, grupos y acuerdos compartidos se mantienen, así como el registro administrativo del borrado.
              </AlertDescription>
            </Alert>

            {!blocked && (
              <div className="space-y-2">
                <Label htmlFor="permanent-user-delete-confirm">
                  Escribe exactamente el correo <span className="font-semibold">{data.target.email}</span>
                </Label>
                <Input
                  id="permanent-user-delete-confirm"
                  autoComplete="off"
                  spellCheck={false}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  disabled={purge.isPending}
                  data-testid="input-permanent-user-delete-confirm"
                />
              </div>
            )}
          </div>
        )}

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" disabled={purge.isPending} onClick={onClose}>Cancelar</Button>
          <Button
            variant="destructive"
            disabled={!canDelete}
            onClick={() => void confirmDelete()}
            data-testid="button-confirm-permanent-user-delete"
          >
            {purge.isPending ? "Eliminando…" : "Eliminar cuenta y actividad"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
