import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListChatContacts, getListChatContactsQueryKey, useCreateChatGroup,
  useLeaveChatGroup, getListChatGroupsQueryKey, type ChatGroup,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";

export function CreateChatGroupDialog({ open, onOpenChange, onCreated }: {
  open: boolean; onOpenChange: (open: boolean) => void; onCreated: (group: ChatGroup) => void;
}) {
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const contacts = useListChatContacts(undefined, {
    query: { queryKey: getListChatContactsQueryKey(), enabled: open, staleTime: 0 },
  });
  const create = useCreateChatGroup();
  useEffect(() => {
    if (open) { setName(""); setSearch(""); setSelected(new Set()); }
  }, [open]);
  const choices = (contacts.data ?? []).filter((contact) =>
    `${contact.name} ${contact.centerName ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const submit = () => {
    if (!name.trim() || !selected.size || create.isPending) return;
    create.mutate({ data: { name: name.trim(), type: "group", memberIds: [...selected] } }, {
      onSuccess: (group) => { onCreated(group); onOpenChange(false); },
      onError: () => toast({ title: "No se pudo crear el grupo", description: "Revisa los participantes y vuelve a intentarlo.", variant: "destructive" }),
    });
  };
  return (
    <Dialog open={open} onOpenChange={(value) => { if (!create.isPending) onOpenChange(value); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuevo grupo</DialogTitle>
          <DialogDescription>Elige el nombre y las personas que participarán. Se les enviará un aviso.</DialogDescription>
        </DialogHeader>
        <Input aria-label="Nombre del grupo" placeholder="Nombre del grupo" maxLength={200} value={name} onChange={(event) => setName(event.target.value)} disabled={create.isPending} />
        <Input aria-label="Buscar participantes" placeholder="Buscar por nombre o centro" maxLength={100} value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="max-h-[min(45vh,20rem)] overflow-y-auto overscroll-contain rounded-md border">
          {contacts.isLoading ? <p className="p-3 text-sm">Cargando personas…</p> : contacts.isError ? (
            <Button variant="ghost" onClick={() => void contacts.refetch()}>No se pudieron cargar. Reintentar</Button>
          ) : !choices.length ? <p className="p-3 text-sm text-muted-foreground">No hay personas disponibles con esa búsqueda.</p> : choices.map((contact) => (
            <label key={contact.id} className="flex cursor-pointer items-center gap-3 border-b p-3 last:border-0 hover:bg-accent">
              <Checkbox disabled={create.isPending} checked={selected.has(contact.id)} onCheckedChange={() => setSelected((previous) => {
                const next = new Set(previous);
                if (next.has(contact.id)) next.delete(contact.id); else next.add(contact.id);
                return next;
              })} />
              <span className="min-w-0"><span className="block truncate text-sm">{contact.name}</span><span className="block truncate text-xs text-muted-foreground">{contact.centerName ?? "Sin centro indicado"}</span></span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={create.isPending} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!name.trim() || !selected.size || create.isPending} onClick={submit}>
            {create.isPending ? "Creando…" : `Crear grupo (${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LeaveChatGroupButton({ group, onLeft }: { group: ChatGroup; onLeft: () => void }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const leave = useLeaveChatGroup();
  if (group.type === "direct" || group.moduleId != null) return null;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>Salir del grupo</Button>
      <Dialog open={open} onOpenChange={(value) => { if (!leave.isPending) setOpen(value); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Salir de {group.name}</DialogTitle>
            <DialogDescription>
              Dejarás de recibir mensajes y perderás el acceso a esta conversación.
              Si no quedan miembros, el grupo y su historial se eliminarán.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={leave.isPending} onClick={() => setOpen(false)}>Cancelar</Button>
            <Button variant="destructive" disabled={leave.isPending} onClick={() => leave.mutate({ id: group.id }, {
              onSuccess: () => {
                queryClient.setQueryData<ChatGroup[]>(getListChatGroupsQueryKey(), (previous = []) => previous.filter((chat) => chat.id !== group.id));
                void queryClient.invalidateQueries({ queryKey: getListChatGroupsQueryKey() });
                setOpen(false);
                onLeft();
              },
              onError: () => toast({ title: "No se pudo salir del grupo", description: "Reinténtalo. Los grupos de módulos se gestionan desde tus asignaciones.", variant: "destructive" }),
            })}>{leave.isPending ? "Saliendo…" : "Salir del grupo"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
