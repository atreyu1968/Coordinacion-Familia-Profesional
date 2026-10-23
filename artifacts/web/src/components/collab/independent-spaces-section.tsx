import { useState } from "react";
import { AutoLinkText } from "@/components/auto-link-text";
import {
  useListCollaborativeSpaces,
  getListCollaborativeSpacesQueryKey,
  type CollaborativeSpace,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { FolderKanban, Plus, Settings2, Users, AlertTriangle } from "lucide-react";
import { CreateSpaceDialog } from "./create-space-dialog";
import { ManageSpaceDialog } from "./manage-space-dialog";

export function IndependentSpacesSection({
  isAdmin,
  configured,
  opening,
  onOpen,
}: {
  isAdmin: boolean;
  configured: boolean;
  opening: boolean;
  onOpen: (space: CollaborativeSpace) => void;
}) {
  const list = useListCollaborativeSpaces({
    query: { queryKey: getListCollaborativeSpacesQueryKey(), refetchInterval: 30_000, refetchOnMount: "always" },
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [managing, setManaging] = useState<number | null>(null);
  const spaces = list.data ?? [];

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Espacios independientes</h2>
            <p className="text-sm text-muted-foreground">
              Espacios de trabajo entre centros, sin vínculo con ningún módulo. Solo entran
              las personas añadidas expresamente.
            </p>
          </div>
          {isAdmin && (
            <Button onClick={() => setCreateOpen(true)} data-testid="button-create-space">
              <Plus className="w-4 h-4 mr-1.5" /> Nuevo espacio
            </Button>
          )}
        </div>

        {!configured && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm" data-testid="status-collab-unconfigured">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
            <p>
              Nextcloud/Collabora no está configurado: los espacios no se pueden abrir todavía.
              {isAdmin && " Puedes crearlos y gestionar sus miembros igualmente."}
            </p>
          </div>
        )}

        {list.isLoading ? (
          <div className="space-y-2" data-testid="status-spaces-loading">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : list.isError ? (
          <div className="rounded-md border border-destructive/40 p-4 text-sm space-y-2">
            <p>No se pudieron cargar los espacios independientes.</p>
            <Button size="sm" variant="outline" onClick={() => list.refetch()} data-testid="button-retry-spaces">
              Reintentar
            </Button>
          </div>
        ) : spaces.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="status-spaces-empty">
            {isAdmin
              ? "Aún no hay espacios independientes. Crea el primero y elige a sus participantes."
              : "No participas en ningún espacio independiente. Te aparecerán aquí cuando te añadan."}
          </div>
        ) : (
          <div className="space-y-2">
            {spaces.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                data-testid={`card-space-${s.id}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate flex items-center gap-2">
                    {s.name}
                    <Badge variant="secondary" className="font-normal">
                      <Users className="w-3 h-3 mr-1" /> {s.memberCount}
                    </Badge>
                  </div>
                  {s.description && (
                    <div className="text-xs text-muted-foreground line-clamp-2"><AutoLinkText text={s.description} /></div>
                  )}
                </div>
                <div className="flex gap-2">
                  {isAdmin && s.canManage && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setManaging(s.id)}
                      data-testid={`button-manage-space-${s.id}`}
                    >
                      <Settings2 className="w-4 h-4 mr-1.5" /> Gestionar
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => onOpen(s)}
                    disabled={!configured || opening}
                    title={configured ? undefined : "Espacio colaborativo no configurado"}
                    data-testid={`button-open-space-${s.id}`}
                  >
                    <FolderKanban className="w-4 h-4 mr-1.5" /> Abrir
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {isAdmin && (
        <>
          <CreateSpaceDialog open={createOpen} onOpenChange={setCreateOpen} />
          <ManageSpaceDialog spaceId={managing} onClose={() => setManaging(null)} />
        </>
      )}
    </Card>
  );
}
