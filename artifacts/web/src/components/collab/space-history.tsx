import { useState } from "react";
import { AutoLinkText } from "@/components/auto-link-text";
import {
  useGetCollaborativeSpaceHistory, getGetCollaborativeSpaceHistoryQueryKey,
  type CollaborativeSpaceAuditReference,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

function Names({ label, people }: { label: string; people: CollaborativeSpaceAuditReference[] }) {
  if (!people.length) return null;
  return <p><span className="font-medium">{label}: </span>
    {people.map((person) => `${person.name} (#${person.id})`).join(", ")}</p>;
}

const revocations = {
  not_applicable: "",
  not_required: "No fue necesaria: el espacio aún no tenía acceso remoto.",
  completed: "Revocación en Nextcloud completada.",
  failed: "Revocación en Nextcloud no confirmada. El participante se conserva.",
  configuration_missing: "Nextcloud no configurado. El participante se conserva.",
};

// Mounted only while the history tab is open; switching spaces resets pagination.
export function SpaceHistory({ spaceId }: { spaceId: number }) {
  const [page, setPage] = useState(1);
  const params = { page, pageSize: 20 };
  const history = useGetCollaborativeSpaceHistory(spaceId, params, {
    query: {
      queryKey: getGetCollaborativeSpaceHistoryQueryKey(spaceId, params),
      staleTime: 0, refetchOnMount: "always", refetchInterval: 30_000,
    },
  });
  const data = history.data;
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / params.pageSize));
  return <section className="space-y-3 min-w-0" aria-label="Historial del espacio" data-testid="space-history">
    <p className="text-xs text-muted-foreground">
      Registros desde la activación del historial. Los nombres se conservan tal como eran al realizar el cambio.
      No se guardan documentos, credenciales ni enlaces de acceso.
    </p>
    {history.isLoading ? <Skeleton className="h-32" /> : history.isError ? (
      <div role="alert" className="rounded-md border p-4 space-y-2 text-sm">
        <p>No se pudo cargar el historial.</p>
        <Button variant="outline" size="sm" onClick={() => history.refetch()}>Reintentar</Button>
      </div>
    ) : !data?.items.length ? (
      <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        {page === 1 ? "Todavía no hay cambios registrados." : "No hay registros en esta página."}
      </p>
    ) : <ol className="space-y-3">
      {data.items.map((event) => <li key={event.id} className="rounded-md border p-3 text-sm space-y-1 break-words"
        data-testid={`space-history-event-${event.id}`}>
        <div className="text-xs text-muted-foreground">
          <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString("es-ES")}</time>
          {" · "}{event.actorName} (#{event.actorId}, {event.actorRole})
        </div>
        <p className={event.action === "member_removal_failed" ? "font-medium text-destructive" : "font-medium"}>
          <AutoLinkText text={event.summary} />
        </p>
        <p className="text-xs text-muted-foreground">Espacio: {event.spaceName} (#{event.spaceId})</p>
        <details>
          <summary className="cursor-pointer text-primary">Ver detalle del cambio</summary>
          <div className="pt-2 space-y-1 text-xs">
            {event.details.previousName !== undefined && <p>Nombre: {event.details.previousName} → {event.details.newName}</p>}
            {event.details.changedFields.includes("description") && <p>Se modificó la descripción (su contenido no se guarda en el historial).</p>}
            <Names label="Selección individual" people={event.details.selectedUsers} />
            <Names label="Centros seleccionados" people={event.details.selectedCenters} />
            <Names label={event.action === "member_removal_failed" ? "Participantes cuya retirada falló" : "Participantes afectados"}
              people={event.details.affectedUsers} />
            {revocations[event.details.revocation] && <p>{revocations[event.details.revocation]}</p>}
          </div>
        </details>
      </li>)}
    </ol>}
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs" aria-live="polite">
      <span>Página {page} de {pages}{data ? ` · ${data.total} registros` : ""}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1 || history.isFetching}
          onClick={() => setPage((p) => p - 1)} data-testid="space-history-previous">Anterior</Button>
        <Button size="sm" variant="outline" disabled={!data || page >= pages || history.isFetching || history.isError}
          onClick={() => setPage((p) => p + 1)} data-testid="space-history-next">Siguiente</Button>
      </div>
    </div>
  </section>;
}
