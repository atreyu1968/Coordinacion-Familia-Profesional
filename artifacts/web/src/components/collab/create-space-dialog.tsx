import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateCollaborativeSpace,
  useGetCollaborativeSpaceCandidates,
  getGetCollaborativeSpaceCandidatesQueryKey,
  getListCollaborativeSpacesQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { MemberPicker, emptySelection, errorMessage, type MemberSelection } from "./member-picker";

export function CreateSpaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sel, setSel] = useState<MemberSelection>(emptySelection);
  const candidates = useGetCollaborativeSpaceCandidates({
    query: { enabled: open, queryKey: getGetCollaborativeSpaceCandidatesQueryKey(), staleTime: 0 },
  });
  const create = useCreateCollaborativeSpace();

  const reset = () => {
    setName("");
    setDescription("");
    setSel(emptySelection);
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      {
        data: {
          name: trimmed,
          description: description.trim() || undefined,
          userIds: sel.userIds.length ? sel.userIds : undefined,
          centerIds: sel.centerIds.length ? sel.centerIds : undefined,
        },
      },
      {
        onSuccess: (space) => {
          qc.invalidateQueries({ queryKey: getListCollaborativeSpacesQueryKey() });
          toast({
            title: "Espacio creado",
            description: `«${space.name}» con ${space.memberCount} miembros.`,
          });
          reset();
          onOpenChange(false);
        },
        onError: (err) =>
          toast({
            title: "No se pudo crear el espacio",
            description: errorMessage(err, "Revisa los datos e inténtalo de nuevo."),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="w-[calc(100vw-2rem)] min-w-0 max-w-3xl max-h-[90dvh] overflow-x-hidden overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo espacio independiente</DialogTitle>
          <DialogDescription>
            No depende de ningún módulo. Solo accederán las personas que añadas.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="space-name">Nombre</Label>
            <Input
              id="space-name"
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Proyecto Erasmus+ intercentros"
              data-testid="input-space-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="space-desc">Descripción (opcional)</Label>
            <Textarea
              id="space-desc"
              maxLength={2000}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="input-space-description"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Participantes iniciales (opcional)</Label>
            <MemberPicker
              candidates={candidates.data}
              isLoading={candidates.isLoading}
              isError={candidates.isError}
              onRetry={() => candidates.refetch()}
              value={sel}
              onChange={setSel}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            disabled={!name.trim() || create.isPending}
            data-testid="button-create-space-submit"
          >
            {create.isPending ? "Creando..." : "Crear espacio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
