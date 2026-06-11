import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListLearningOutcomes,
  useCreateLearningOutcome,
  useUpdateLearningOutcome,
  useDeleteLearningOutcome,
  useCreateEvaluationCriterion,
  useUpdateEvaluationCriterion,
  useDeleteEvaluationCriterion,
  useListModuleMembers,
  getListLearningOutcomesQueryKey,
  getListModuleMembersQueryKey,
  type LearningOutcome,
  type EvaluationCriterion,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { ListChecks, Pencil, Plus, Trash2 } from "lucide-react";

type OutcomeFormState = { code: string; description: string };

// Dialog to create/edit a learning outcome (RA) or an evaluation criterion (CE).
// Both share the same { code, description } shape.
function CodeDescriptionDialog({
  open,
  onOpenChange,
  title,
  description,
  codeLabel,
  initial,
  submitting,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  codeLabel: string;
  initial?: OutcomeFormState;
  submitting: boolean;
  onSubmit: (values: OutcomeFormState) => void | Promise<void>;
}) {
  const [code, setCode] = useState(initial?.code ?? "");
  const [desc, setDesc] = useState(initial?.description ?? "");

  // Reset fields whenever the dialog (re)opens.
  const handleOpenChange = (v: boolean) => {
    if (v) {
      setCode(initial?.code ?? "");
      setDesc(initial?.description ?? "");
    }
    onOpenChange(v);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedCode = code.trim();
    const trimmedDesc = desc.trim();
    if (!trimmedCode || !trimmedDesc) return;
    void onSubmit({ code: trimmedCode, description: trimmedDesc });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{codeLabel}</label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="p. ej. RA1"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Descripción</label>
              <Textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={3}
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CriterionRow({
  criterion,
  canEdit,
  onChanged,
}: {
  criterion: EvaluationCriterion;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const updateMut = useUpdateEvaluationCriterion();
  const deleteMut = useDeleteEvaluationCriterion();

  const onUpdate = async (values: OutcomeFormState) => {
    try {
      await updateMut.mutateAsync({ id: criterion.id, data: values });
      setEditing(false);
      onChanged();
    } catch {
      toast({
        title: "No se pudo guardar",
        description: "Comprueba tus permisos.",
        variant: "destructive",
      });
    }
  };

  const onDelete = async () => {
    try {
      await deleteMut.mutateAsync({ id: criterion.id });
      onChanged();
    } catch {
      toast({
        title: "No se pudo eliminar",
        description: "Comprueba tus permisos.",
        variant: "destructive",
      });
    }
  };

  return (
    <li className="flex items-start justify-between gap-2 py-1.5">
      <div className="flex items-start gap-2 min-w-0">
        <Badge variant="outline" className="shrink-0 mt-0.5">
          {criterion.code}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {criterion.description}
        </span>
      </div>
      {canEdit && (
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setEditing(true)}
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7">
                <Trash2 className="w-3.5 h-3.5 text-destructive" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar criterio?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se eliminará el criterio «{criterion.code}». Esta acción no se
                  puede deshacer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>
                  Eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <CodeDescriptionDialog
            open={editing}
            onOpenChange={setEditing}
            title="Editar criterio de evaluación"
            description="Modifica el código o la descripción del criterio."
            codeLabel="Código (CE)"
            initial={{
              code: criterion.code,
              description: criterion.description,
            }}
            submitting={updateMut.isPending}
            onSubmit={onUpdate}
          />
        </div>
      )}
    </li>
  );
}

function OutcomeBlock({
  outcome,
  canEdit,
  onChanged,
}: {
  outcome: LearningOutcome;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [addingCriterion, setAddingCriterion] = useState(false);
  const updateMut = useUpdateLearningOutcome();
  const deleteMut = useDeleteLearningOutcome();
  const createCriterionMut = useCreateEvaluationCriterion();

  const onUpdate = async (values: OutcomeFormState) => {
    try {
      await updateMut.mutateAsync({ id: outcome.id, data: values });
      setEditing(false);
      onChanged();
    } catch {
      toast({
        title: "No se pudo guardar",
        description: "Comprueba tus permisos.",
        variant: "destructive",
      });
    }
  };

  const onDelete = async () => {
    try {
      await deleteMut.mutateAsync({ id: outcome.id });
      onChanged();
    } catch {
      toast({
        title: "No se pudo eliminar",
        description: "Comprueba tus permisos.",
        variant: "destructive",
      });
    }
  };

  const onAddCriterion = async (values: OutcomeFormState) => {
    try {
      await createCriterionMut.mutateAsync({ id: outcome.id, data: values });
      setAddingCriterion(false);
      onChanged();
    } catch {
      toast({
        title: "No se pudo añadir",
        description: "Comprueba tus permisos.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <Badge className="shrink-0 mt-0.5">{outcome.code}</Badge>
          <span className="text-sm font-medium">{outcome.description}</span>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setEditing(true)}
            >
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7">
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    ¿Eliminar resultado de aprendizaje?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Se eliminará «{outcome.code}» y todos sus criterios de
                    evaluación. Esta acción no se puede deshacer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete}>
                    Eliminar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <CodeDescriptionDialog
              open={editing}
              onOpenChange={setEditing}
              title="Editar resultado de aprendizaje"
              description="Modifica el código o la descripción del RA."
              codeLabel="Código (RA)"
              initial={{
                code: outcome.code,
                description: outcome.description,
              }}
              submitting={updateMut.isPending}
              onSubmit={onUpdate}
            />
          </div>
        )}
      </div>

      <div className="pl-2 border-l-2 border-muted ml-1">
        {outcome.criteria.length === 0 ? (
          <p className="text-xs text-muted-foreground py-1">
            Sin criterios de evaluación.
          </p>
        ) : (
          <ul className="divide-y">
            {outcome.criteria.map((c) => (
              <CriterionRow
                key={c.id}
                criterion={c}
                canEdit={canEdit}
                onChanged={onChanged}
              />
            ))}
          </ul>
        )}
        {canEdit && (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1 mt-1 h-7 text-xs"
              onClick={() => setAddingCriterion(true)}
            >
              <Plus className="w-3.5 h-3.5" /> Añadir criterio
            </Button>
            <CodeDescriptionDialog
              open={addingCriterion}
              onOpenChange={setAddingCriterion}
              title="Nuevo criterio de evaluación"
              description="Añade un criterio de evaluación (CE) a este resultado."
              codeLabel="Código (CE)"
              submitting={createCriterionMut.isPending}
              onSubmit={onAddCriterion}
            />
          </>
        )}
      </div>
    </div>
  );
}

export function ModuleOutcomes({ moduleId }: { moduleId: number }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [addingOutcome, setAddingOutcome] = useState(false);

  const { data: outcomes = [], isLoading } = useListLearningOutcomes(moduleId);
  const createOutcomeMut = useCreateLearningOutcome();

  // The module's coordinator may edit RA/CE. We only know that from the member
  // list, which is itself readable by managers/members; on 403 we simply treat
  // the caller as a non-coordinator (edit affordances hidden, backend enforces).
  const isSuperadmin = user?.role === "superadmin";
  const { data: members = [] } = useListModuleMembers(moduleId, {
    query: {
      queryKey: getListModuleMembersQueryKey(moduleId),
      enabled: !isSuperadmin && !!user,
      retry: false,
    },
  });
  const isModuleCoordinator = members.some(
    (m) => m.userId === user?.id && m.role === "coordinator",
  );
  const canEdit = isSuperadmin || isModuleCoordinator;

  const invalidate = () =>
    qc.invalidateQueries({
      queryKey: getListLearningOutcomesQueryKey(moduleId),
    });

  const onAddOutcome = async (values: OutcomeFormState) => {
    try {
      await createOutcomeMut.mutateAsync({ moduleId, data: values });
      setAddingOutcome(false);
      await invalidate();
    } catch {
      toast({
        title: "No se pudo añadir",
        description: "Comprueba tus permisos.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-2 pt-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <ListChecks className="w-4 h-4" />
          Resultados de aprendizaje y criterios de evaluación
        </p>
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => setAddingOutcome(true)}
          >
            <Plus className="w-3.5 h-3.5" /> Añadir RA
          </Button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-1">Cargando…</p>
      ) : outcomes.length === 0 ? (
        <p className="text-sm text-muted-foreground py-1">
          Este módulo aún no tiene resultados de aprendizaje.
        </p>
      ) : (
        <div className="space-y-2">
          {outcomes.map((o) => (
            <OutcomeBlock
              key={o.id}
              outcome={o}
              canEdit={canEdit}
              onChanged={invalidate}
            />
          ))}
        </div>
      )}

      <CodeDescriptionDialog
        open={addingOutcome}
        onOpenChange={setAddingOutcome}
        title="Nuevo resultado de aprendizaje"
        description="Añade un resultado de aprendizaje (RA) al módulo."
        codeLabel="Código (RA)"
        submitting={createOutcomeMut.isPending}
        onSubmit={onAddOutcome}
      />
    </div>
  );
}
