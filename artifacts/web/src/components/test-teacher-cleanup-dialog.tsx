import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePreviewTestTeacherCleanup, usePurgeTestTeachers } from "@workspace/api-client-react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getApiErrorMessage } from "@/lib/user-management";
import { toast } from "@/hooks/use-toast";

const CONFIRMATION = "ELIMINAR DOCENTES DE PRUEBA";

export function TestTeacherCleanupDialog() {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const preview = usePreviewTestTeacherCleanup({
    query: { enabled: open, staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: false },
  });
  const purge = usePurgeTestTeachers();
  const data = preview.data;
  const blocked = !!data?.blockedReasons.length;
  const canConfirm = !!data && !preview.isFetching && !preview.isError && !blocked &&
    confirmation === CONFIRMATION && !purge.isPending;

  async function submit() {
    if (!canConfirm || !data) return;
    setError(null);
    try {
      const result = await purge.mutateAsync({ data: { fingerprint: data.fingerprint, confirmation: CONFIRMATION } });
      setOpen(false);
      setConfirmation("");
      await qc.invalidateQueries();
      toast({
        title: "Datos de prueba eliminados",
        description: `${result.accountsDeleted} cuentas, ${result.assignmentsDeleted} asignaciones y ${result.historyDeleted} registros de historial. No se recrearán en las actualizaciones.`,
      });
    } catch (cause) {
      setError(getApiErrorMessage(cause) ?? "No se pudo completar la eliminación. No se han aplicado borrados parciales en la base de datos.");
      setConfirmation("");
    }
  }

  return <>
    <Button variant="outline" className="gap-2 text-destructive" data-testid="button-test-teacher-cleanup"
      onClick={() => { setConfirmation(""); setError(null); setOpen(true); void preview.refetch(); }}>
      <Trash2 className="h-4 w-4" /> Eliminar docentes de prueba
    </Button>
    <Dialog open={open} onOpenChange={next => { if (!purge.isPending) setOpen(next); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl" onInteractOutside={event => { if (purge.isPending) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Eliminar definitivamente los datos de prueba</DialogTitle>
          <DialogDescription>
            Solo afecta a las cuatro identidades de prueba del instalador, incluso si ya están desactivadas.
            No se admite seleccionar otras cuentas ni borrar docentes reales.
          </DialogDescription>
        </DialogHeader>
        {preview.isFetching ? <p role="status">Calculando los datos afectados…</p> : null}
        {preview.isError ? <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{getApiErrorMessage(preview.error) ?? "No se pudo obtener la vista previa."}</p>
          <Button variant="outline" onClick={() => void preview.refetch()}>Reintentar vista previa</Button>
        </div> : null}
        {data && !preview.isFetching && !preview.isError ? <div className="space-y-4 text-sm" data-testid="test-teacher-cleanup-preview">
          <div>
            <p className="font-semibold">Cuentas que se borrarán: {data.accounts.length}</p>
            {data.accounts.length ? <ul className="mt-2 space-y-1">
              {data.accounts.map(account => <li key={account.id}>
                <span className="font-medium">{account.name}</span><br />
                <span className="break-all text-muted-foreground">{account.email}</span>
              </li>)}
            </ul> : <p className="text-muted-foreground">No quedan cuentas de prueba. Confirmar impedirá que el instalador vuelva a crearlas.</p>}
          </div>
          <p className="font-semibold">Asignaciones docentes: {data.assignments}</p>
          {data.history.length ? <ul className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-3">
            {data.history.map(row => <li key={row.label} className="flex justify-between gap-4">
              <span>{row.label}</span><span>{row.count}</span>
            </li>)}
          </ul> : <p>No hay más historial asociado que eliminar.</p>}
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
            Es irreversible: se borran las cuentas, sus asignaciones y su actividad, incluidos los mensajes enviados
            y las conversaciones directas con ellas. Los centros, módulos, grupos compartidos y demás cuentas se conservan.
            Las respuestas anónimas no identificables no se atribuyen a ninguna cuenta.
            No se borran archivos externos ni copias de seguridad. Si existe una cuenta Nextcloud, se deshabilita su acceso;
            si no puede confirmarse, no se borran los datos locales.
          </div>
          {blocked ? <div role="alert" className="rounded-md border p-3 text-destructive">
            <p className="font-semibold">Borrado bloqueado para proteger datos reales:</p>
            <ul className="mt-1 list-inside list-disc">{data.blockedReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
            <p className="mt-2">Revisa o transfiere ese contenido antes de continuar.</p>
          </div> : <>
            <Label htmlFor="confirm-test-teacher-cleanup">Escribe {CONFIRMATION} para confirmar</Label>
            <Input id="confirm-test-teacher-cleanup" data-testid="input-test-teacher-cleanup-confirmation"
              autoComplete="off" value={confirmation} disabled={purge.isPending}
              onChange={event => setConfirmation(event.target.value)} />
          </>}
        </div> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={purge.isPending} onClick={() => { setConfirmation(""); setError(null); void preview.refetch(); }}>
            Actualizar vista previa
          </Button>
          <Button variant="outline" disabled={purge.isPending} onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="destructive" disabled={!canConfirm} data-testid="button-confirm-test-teacher-cleanup" onClick={() => void submit()}>
            {purge.isPending ? "Eliminando…" : "Eliminar definitivamente"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
