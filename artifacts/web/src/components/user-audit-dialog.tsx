import { useState } from "react";
import { useListUserAudit, type ManagedUser } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/user-management";

const labels: Record<string, string> = {
  name: "Nombre", role: "Rol", centerId: "Centro", provinceId: "Provincia", status: "Estado",
};
const actions = { update: "Edición", deactivate: "Desactivación", reactivate: "Reactivación" };

export function UserAuditDialog({ user, onClose, centers, provinces }: {
  user: ManagedUser;
  onClose: () => void;
  centers: Map<number, string>;
  provinces: Map<number, string>;
}) {
  const [page, setPage] = useState(1);
  const query = useListUserAudit(user.id, { page }, {
    query: { queryKey: ["/api/users", user.id, "audit", page], staleTime: 0, refetchOnMount: "always" },
  });
  function value(field: string, raw: string | null): string {
    if (raw == null) return "Sin asignar";
    if (field === "centerId") return centers.get(Number(raw)) ?? `Centro #${raw}`;
    if (field === "provinceId") return provinces.get(Number(raw)) ?? `Provincia #${raw}`;
    if (field === "role") return ROLE_LABELS[raw as keyof typeof ROLE_LABELS] ?? raw;
    if (field === "status") return raw === "active" ? "Activo" : raw === "inactive" ? "Desactivado" : raw;
    return raw;
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Historial de {user.name}</DialogTitle>
        <DialogDescription>Cambios administrativos registrados desde la incorporación del historial. Solo se muestran los sucesos de tu ámbito autorizado.</DialogDescription>
      </DialogHeader>
      {query.isLoading && <p role="status">Cargando historial...</p>}
      {query.isError && <div role="alert">
        <p>No se pudo cargar el historial. Puede que la cuenta ya no esté en tu ámbito.</p>
        <Button variant="outline" onClick={() => void query.refetch()}>Reintentar</Button>
      </div>}
      {!query.isLoading && !query.isError && query.data?.events.length === 0 && <p>No hay cambios registrados visibles.</p>}
      {!query.isError && query.data?.events.map((event) => <section key={event.id} className="space-y-2 rounded-md border p-3">
        <h3 className="font-medium">{actions[event.action]}</h3>
        <p className="text-sm text-muted-foreground">
          {new Date(event.occurredAt).toLocaleString("es-ES")} · {event.actorName} (#{event.actorId}) · Cuenta #{event.targetId}
        </p>
        <ul className="space-y-1 text-sm">
          {event.changes.map((change) => <li key={change.field} className="break-words">
            <strong>{labels[change.field]}:</strong> {value(change.field, change.before)} → {value(change.field, change.after)}
          </li>)}
        </ul>
      </section>)}
      <nav aria-label="Paginación del historial" className="flex items-center justify-between gap-2">
        <Button variant="outline" disabled={page === 1 || query.isFetching} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
        <span>Página {page}</span>
        <Button variant="outline" disabled={!query.data?.hasMore || query.isFetching || query.isError} onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
      </nav>
    </DialogContent>
  </Dialog>;
}
