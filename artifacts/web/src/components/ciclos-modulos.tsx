import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCycles,
  useCreateCycle,
  useUpdateCycle,
  useDeleteCycle,
  useListModules,
  useCreateModule,
  useUpdateModule,
  useDeleteModule,
  getListCyclesQueryKey,
  getListModulesQueryKey,
  type Cycle,
  type Module,
  type CreateCycleInput,
  type CreateModuleInput,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  GraduationCap,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

// --------------------------------------------------------------------------
function CycleDialog({
  trigger,
  cycle,
}: {
  trigger: ReactNode;
  cycle?: Cycle;
}) {
  const qc = useQueryClient();
  const createMut = useCreateCycle();
  const updateMut = useUpdateCycle();
  const isEdit = !!cycle;

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [level, setLevel] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(cycle?.name ?? "");
      setCode(cycle?.code ?? "");
      setLevel(cycle?.level ?? "");
      setError(null);
    }
  }, [open, cycle]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("El nombre del ciclo es obligatorio.");
      return;
    }
    const payload: CreateCycleInput = {
      name: name.trim(),
      code: code.trim() || null,
      level: level.trim() || null,
    };
    try {
      if (isEdit) {
        await updateMut.mutateAsync({ id: cycle!.id, data: payload });
      } else {
        await createMut.mutateAsync({ data: payload });
      }
      await qc.invalidateQueries({ queryKey: getListCyclesQueryKey() });
      await qc.invalidateQueries({ queryKey: getListModulesQueryKey() });
      toast({
        title: isEdit ? "Ciclo actualizado" : "Ciclo creado",
        description: name.trim(),
      });
      setOpen(false);
    } catch {
      setError("No se pudo guardar el ciclo. Comprueba tus permisos.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar ciclo" : "Nuevo ciclo"}</DialogTitle>
          <DialogDescription>
            Catálogo global de ciclos formativos.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="c-name">Nombre *</Label>
            <Input
              id="c-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Administración y Finanzas"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="c-code">Código</Label>
              <Input
                id="c-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="ADG"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-level">Nivel</Label>
              <Input
                id="c-level"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                placeholder="Grado Superior"
              />
            </div>
          </div>
          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}
          <DialogFooter>
            <Button
              type="submit"
              disabled={createMut.isPending || updateMut.isPending}
            >
              {isEdit ? "Guardar" : "Crear ciclo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------------------
function ModuleCatalogDialog({
  trigger,
  cycleId,
  module,
}: {
  trigger: ReactNode;
  cycleId: number;
  module?: Module;
}) {
  const qc = useQueryClient();
  const createMut = useCreateModule();
  const updateMut = useUpdateModule();
  const isEdit = !!module;

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(module?.name ?? "");
      setCode(module?.code ?? "");
      setError(null);
    }
  }, [open, module]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("El nombre del módulo es obligatorio.");
      return;
    }
    try {
      if (isEdit) {
        await updateMut.mutateAsync({
          moduleId: module!.id,
          data: { name: name.trim(), code: code.trim() || null, cycleId },
        });
      } else {
        const payload: CreateModuleInput = {
          name: name.trim(),
          code: code.trim() || undefined,
          cycleId,
          centerId: null,
        };
        await createMut.mutateAsync({ data: payload });
      }
      await qc.invalidateQueries({ queryKey: getListModulesQueryKey() });
      await qc.invalidateQueries({ queryKey: getListCyclesQueryKey() });
      toast({
        title: isEdit ? "Módulo actualizado" : "Módulo creado",
        description: name.trim(),
      });
      setOpen(false);
    } catch {
      setError("No se pudo guardar el módulo. Comprueba tus permisos.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar módulo" : "Nuevo módulo"}
          </DialogTitle>
          <DialogDescription>
            Módulo del catálogo asociado al ciclo.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="m-name">Nombre *</Label>
            <Input
              id="m-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Gestión de la documentación jurídica"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="m-code">Código</Label>
            <Input
              id="m-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="0647"
            />
          </div>
          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}
          <DialogFooter>
            <Button
              type="submit"
              disabled={createMut.isPending || updateMut.isPending}
            >
              {isEdit ? "Guardar" : "Crear módulo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------------------
function CycleModules({ cycleId }: { cycleId: number }) {
  const qc = useQueryClient();
  const { data: modules = [], isLoading } = useListModules({ cycleId });
  const deleteMut = useDeleteModule();

  const onDelete = async (m: Module) => {
    try {
      await deleteMut.mutateAsync({ moduleId: m.id });
      await qc.invalidateQueries({ queryKey: getListModulesQueryKey() });
      await qc.invalidateQueries({ queryKey: getListCyclesQueryKey() });
      toast({ title: "Módulo eliminado", description: m.name });
    } catch {
      toast({
        title: "No se pudo eliminar",
        description: "Comprueba tus permisos.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-2 border-l-2 border-muted pl-4 ml-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">
          Módulos del ciclo
        </p>
        <ModuleCatalogDialog
          cycleId={cycleId}
          trigger={
            <Button size="sm" variant="outline" className="gap-1">
              <Plus className="w-3.5 h-3.5" /> Añadir módulo
            </Button>
          }
        />
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground py-2">Cargando módulos…</p>
      ) : modules.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          Este ciclo aún no tiene módulos.
        </p>
      ) : (
        <ul className="divide-y">
          {modules.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between py-2 gap-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <BookOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="truncate">{m.name}</span>
                {m.code && (
                  <Badge variant="secondary" className="shrink-0">
                    {m.code}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <ModuleCatalogDialog
                  cycleId={cycleId}
                  module={m}
                  trigger={
                    <Button size="icon" variant="ghost" className="h-8 w-8">
                      <Pencil className="w-4 h-4" />
                    </Button>
                  }
                />
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-8 w-8">
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Eliminar módulo?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Se eliminará «{m.name}» del catálogo. Esta acción no se
                        puede deshacer.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => onDelete(m)}>
                        Eliminar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
function CycleRow({ cycle }: { cycle: Cycle }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const deleteMut = useDeleteCycle();

  const onDelete = async () => {
    try {
      await deleteMut.mutateAsync({ id: cycle.id });
      await qc.invalidateQueries({ queryKey: getListCyclesQueryKey() });
      toast({ title: "Ciclo eliminado", description: cycle.name });
    } catch {
      toast({
        title: "No se pudo eliminar",
        description: "Comprueba tus permisos.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between gap-2 p-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left"
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 shrink-0" />
          )}
          <GraduationCap className="w-4 h-4 text-primary shrink-0" />
          <span className="font-medium truncate">{cycle.name}</span>
          {cycle.code && (
            <Badge variant="secondary" className="shrink-0">
              {cycle.code}
            </Badge>
          )}
          {cycle.level && (
            <Badge variant="outline" className="shrink-0">
              {cycle.level}
            </Badge>
          )}
          <Badge variant="secondary" className="shrink-0">
            {cycle.moduleCount ?? 0} módulos
          </Badge>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <CycleDialog
            cycle={cycle}
            trigger={
              <Button size="icon" variant="ghost" className="h-8 w-8">
                <Pencil className="w-4 h-4" />
              </Button>
            }
          />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8">
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar ciclo?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se eliminará «{cycle.name}» del catálogo. Los módulos
                  asociados quedarán sin ciclo. Esta acción no se puede
                  deshacer.
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
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-3">
          <CycleModules cycleId={cycle.id} />
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
export default function CiclosModulos() {
  const { data: cycles = [], isLoading } = useListCycles();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Ciclos y módulos</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Catálogo global. Los centros eligen qué ciclos ofrecen desde la
            pestaña Centros.
          </p>
        </div>
        <CycleDialog
          trigger={
            <Button className="gap-2">
              <Plus className="w-4 h-4" /> Nuevo ciclo
            </Button>
          }
        />
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando ciclos…</p>
        ) : cycles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aún no hay ciclos en el catálogo. Crea el primero.
          </p>
        ) : (
          cycles.map((c) => <CycleRow key={c.id} cycle={c} />)
        )}
      </CardContent>
    </Card>
  );
}
