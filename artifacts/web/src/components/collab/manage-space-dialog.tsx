import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCollaborativeSpace,
  useGetCollaborativeSpaceCandidates,
  useUpdateCollaborativeSpace,
  useAddCollaborativeSpaceMembers,
  useRemoveCollaborativeSpaceMember,
  getGetCollaborativeSpaceQueryKey,
  getGetCollaborativeSpaceCandidatesQueryKey,
  getListCollaborativeSpacesQueryKey,
  type CollaborativeSpacePerson,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { UserMinus } from "lucide-react";
import {
  MemberPicker,
  emptySelection,
  errorMessage,
  resolveSelection,
  type MemberSelection,
} from "./member-picker";

export function ManageSpaceDialog({
  spaceId,
  onClose,
}: {
  spaceId: number | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const open = spaceId != null;
  const id = spaceId ?? 0;
  const detail = useGetCollaborativeSpace(id, {
    query: { enabled: open, queryKey: getGetCollaborativeSpaceQueryKey(id), staleTime: 0 },
  });
  const candidates = useGetCollaborativeSpaceCandidates({
    query: { enabled: open, queryKey: getGetCollaborativeSpaceCandidatesQueryKey(), staleTime: 0 },
  });
  const update = useUpdateCollaborativeSpace();
  const add = useAddCollaborativeSpaceMembers();
  const remove = useRemoveCollaborativeSpaceMember();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sel, setSel] = useState<MemberSelection>(emptySelection);
  const [toRemove, setToRemove] = useState<CollaborativeSpacePerson | null>(null);
  const [filter, setFilter] = useState("");

  const space = detail.data;
  useEffect(() => {
    if (space && space.id === spaceId) {
      setName(space.name);
      setDescription(space.description ?? "");
    }
    // init only when a different space is loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space?.id, spaceId]);
  useEffect(() => {
    setSel(emptySelection);
    setFilter("");
  }, [spaceId]);

  const memberIds = useMemo(
    () => new Set((space?.members ?? []).map((m) => m.id)),
    [space],
  );
  const members = useMemo(() => {
    const t = filter.trim().toLowerCase();
    const list = space?.members ?? [];
    return t
      ? list.filter((m) =>
          [m.name, m.email, m.centerName ?? ""].some((s) => s.toLowerCase().includes(t)),
        )
      : list;
  }, [space, filter]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListCollaborativeSpacesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCollaborativeSpaceQueryKey(id) });
  };
  const fail = (title: string) => (err: unknown) =>
    toast({ title, description: errorMessage(err, "Inténtalo de nuevo."), variant: "destructive" });

  const saveInfo = () =>
    update.mutate(
      { id, data: { name: name.trim(), description: description.trim() } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Datos del espacio guardados" });
        },
        onError: fail("No se pudieron guardar los cambios"),
      },
    );

  const newCount = resolveSelection(candidates.data, sel, memberIds).size;
  const addMembers = () =>
    add.mutate(
      {
        id,
        data: {
          userIds: sel.userIds.length ? sel.userIds : undefined,
          centerIds: sel.centerIds.length ? sel.centerIds : undefined,
        },
      },
      {
        onSuccess: (s) => {
          invalidate();
          setSel(emptySelection);
          toast({ title: "Participantes añadidos", description: `Ahora hay ${s.memberCount} miembros.` });
        },
        onError: fail("No se pudieron añadir participantes"),
      },
    );

  const confirmRemove = () => {
    if (!toRemove) return;
    const person = toRemove;
    remove.mutate(
      { id, userId: person.id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: `${person.name} ya no es miembro` });
        },
        onError: fail("No se pudo quitar al miembro"),
        onSettled: () => setToRemove(null),
      },
    );
  };

  const infoDirty =
    !!space && (name.trim() !== space.name || description.trim() !== (space.description ?? ""));

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="w-[calc(100vw-2rem)] min-w-0 max-w-3xl max-h-[90dvh] overflow-x-hidden overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{space?.name ?? "Gestionar espacio"}</DialogTitle>
            <DialogDescription>
              Edita los datos y decide quién participa. Los cambios no mueven ni borran archivos.
            </DialogDescription>
          </DialogHeader>

          {detail.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-9" />
              <Skeleton className="h-40" />
            </div>
          ) : detail.isError || !space ? (
            <div className="rounded-md border border-destructive/40 p-4 text-sm space-y-2">
              <p>No se pudo cargar el espacio.</p>
              <Button size="sm" variant="outline" onClick={() => detail.refetch()} data-testid="button-retry-space-detail">
                Reintentar
              </Button>
            </div>
          ) : (
            <Tabs defaultValue="members" className="min-w-0 w-full">
              <TabsList className="grid min-w-0 w-full grid-cols-3 [&>button]:min-w-0 [&>button]:px-2">
                <TabsTrigger value="members" data-testid="tab-members">
                  Miembros ({space.members.length})
                </TabsTrigger>
                <TabsTrigger value="add" data-testid="tab-add-members">Añadir</TabsTrigger>
                <TabsTrigger value="info" data-testid="tab-space-info">Datos</TabsTrigger>
              </TabsList>

              <TabsContent value="members" className="min-w-0 space-y-3 pt-2">
                <p className="text-xs text-muted-foreground" data-testid="text-superadmin-access-note">
                  Los superadministradores activos conservan siempre el acceso administrativo,
                  aunque no figuren en esta lista o se les quite de ella.
                </p>
                <Input
                  placeholder="Filtrar miembros"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  data-testid="input-filter-members"
                />
                {space.members.length === 0 ? (
                  <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                    Este espacio aún no tiene miembros. Añádelos desde la pestaña «Añadir».
                  </div>
                ) : (
                  <div className="min-w-0 divide-y rounded-md border max-h-80 overflow-x-hidden overflow-y-auto">
                    {members.map((m) => (
                      <div key={m.id} className="flex items-center gap-3 p-3" data-testid={`row-member-${m.id}`}>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium break-words">{m.name}</div>
                          <div className="text-xs text-muted-foreground break-all">
                            {m.email}
                            {m.centerName ? ` · ${m.centerName}` : ""}
                            {m.status !== "active" ? ` · ${m.status}` : ""}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setToRemove(m)}
                          data-testid={`button-remove-member-${m.id}`}
                        >
                          <UserMinus className="w-4 h-4 mr-1" /> Quitar
                        </Button>
                      </div>
                    ))}
                    {members.length === 0 && (
                      <p className="p-4 text-center text-sm text-muted-foreground">Sin coincidencias.</p>
                    )}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="add" className="min-w-0 space-y-3 pt-2">
                <MemberPicker
                  candidates={candidates.data}
                  isLoading={candidates.isLoading}
                  isError={candidates.isError}
                  onRetry={() => candidates.refetch()}
                  value={sel}
                  onChange={setSel}
                  excludeUserIds={memberIds}
                />
                <div className="flex justify-end">
                  <Button
                    onClick={addMembers}
                    disabled={newCount === 0 || add.isPending}
                    data-testid="button-add-members-submit"
                  >
                    {add.isPending ? "Añadiendo..." : `Añadir ${newCount} participantes`}
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="info" className="space-y-3 pt-2">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-space-name">Nombre</Label>
                  <Input
                    id="edit-space-name"
                    maxLength={160}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    data-testid="input-edit-space-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-space-desc">Descripción</Label>
                  <Textarea
                    id="edit-space-desc"
                    maxLength={2000}
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    data-testid="input-edit-space-description"
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    onClick={saveInfo}
                    disabled={!name.trim() || !infoDirty || update.isPending}
                    data-testid="button-save-space-info"
                  >
                    {update.isPending ? "Guardando..." : "Guardar cambios"}
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toRemove} onOpenChange={(o) => !o && setToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar a {toRemove?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Dejará de ver este espacio. Su cuenta y los archivos del espacio se conservan;
              puedes volver a añadirlo cuando quieras.
              {toRemove?.role === "superadmin" &&
                " Al ser superadministrador, conservará el acceso administrativo al espacio aunque deje de figurar como miembro."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmRemove();
              }}
              disabled={remove.isPending}
              data-testid="button-confirm-remove-member"
            >
              {remove.isPending ? "Quitando..." : "Quitar del espacio"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
