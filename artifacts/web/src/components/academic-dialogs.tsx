import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateModule,
  useCreateGroup,
  useCreateTeachingAssignment,
  useTransferTeachingAssignments,
  useListCenters,
  useListModules,
  useListCycles,
  useListUsers,
  useListTeachingAssignments,
  getListModulesQueryKey,
  getListGroupsQueryKey,
  getListTeachingAssignmentsQueryKey,
  type CreateModuleInput,
  type CreateGroupInput,
  type CreateTeachingAssignmentInput,
  type TransferInput,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

const GLOBAL = "global";

function useScopeCenters() {
  const { user } = useAuth();
  const { data: centers = [] } = useListCenters({});
  const isSuperadmin = user?.role === "superadmin";
  // department_head is bound to its own center; everyone else picks within scope.
  const fixedCenterId =
    user?.role === "department_head" ? user?.centerId ?? null : null;
  return { centers, isSuperadmin, fixedCenterId };
}

// --------------------------------------------------------------------------
export function ModuleDialog({ trigger }: { trigger: ReactNode }) {
  const qc = useQueryClient();
  const { centers, isSuperadmin, fixedCenterId } = useScopeCenters();
  const { data: cycles = [] } = useListCycles();
  const createMut = useCreateModule();

  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [centerId, setCenterId] = useState<number | null>(fixedCenterId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCode("");
      setName("");
      setCycleId(null);
      setCenterId(fixedCenterId);
      setError(null);
    }
  }, [open, fixedCenterId]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("El nombre del módulo es obligatorio.");
      return;
    }
    const payload: CreateModuleInput = {
      code: code.trim() || undefined,
      name: name.trim(),
      cycleId,
      centerId,
    };
    try {
      await createMut.mutateAsync({ data: payload });
      await qc.invalidateQueries({ queryKey: getListModulesQueryKey() });
      toast({ title: "Módulo creado", description: name.trim() });
      setOpen(false);
    } catch {
      setError("No se pudo crear el módulo. Comprueba tus permisos.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo módulo</DialogTitle>
          <DialogDescription>
            Registra un módulo profesional del currículo.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="m-code">Código</Label>
              <Input
                id="m-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="0650"
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label htmlFor="m-name">Nombre *</Label>
              <Input
                id="m-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Ciclo formativo</Label>
            <Select
              value={cycleId != null ? String(cycleId) : "none"}
              onValueChange={(v) => setCycleId(v === "none" ? null : Number(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un ciclo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin ciclo</SelectItem>
                {cycles.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Centro</Label>
            {fixedCenterId != null ? (
              <Input
                disabled
                value={
                  centers.find((c) => c.id === fixedCenterId)?.name ?? "Tu centro"
                }
              />
            ) : (
              <Select
                value={centerId != null ? String(centerId) : GLOBAL}
                onValueChange={(v) =>
                  setCenterId(v === GLOBAL ? null : Number(v))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {isSuperadmin && (
                    <SelectItem value={GLOBAL}>Global (compartido)</SelectItem>
                  )}
                  {centers.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? "Guardando..." : "Crear módulo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------------------
export function GroupDialog({ trigger }: { trigger: ReactNode }) {
  const qc = useQueryClient();
  const { centers, fixedCenterId } = useScopeCenters();
  const { data: cycles = [] } = useListCycles();
  const createMut = useCreateGroup();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [cycleName, setCycleName] = useState("");
  const [schoolYear, setSchoolYear] = useState("");
  const [centerId, setCenterId] = useState<number | null>(fixedCenterId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setCycleName("");
      setSchoolYear("");
      setCenterId(fixedCenterId ?? centers[0]?.id ?? null);
      setError(null);
    }
  }, [open, fixedCenterId, centers]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("El nombre del grupo es obligatorio.");
      return;
    }
    if (centerId == null) {
      setError("Selecciona un centro.");
      return;
    }
    const payload: CreateGroupInput = {
      centerId,
      name: name.trim(),
      cycleName: cycleName.trim() || null,
      schoolYear: schoolYear.trim() || null,
    };
    try {
      await createMut.mutateAsync({ data: payload });
      await qc.invalidateQueries({ queryKey: getListGroupsQueryKey() });
      toast({ title: "Grupo creado", description: name.trim() });
      setOpen(false);
    } catch {
      setError("No se pudo crear el grupo. Comprueba tus permisos.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo grupo</DialogTitle>
          <DialogDescription>Crea un grupo-clase del centro.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="g-name">Nombre *</Label>
            <Input
              id="g-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="1º AyF"
            />
          </div>
          <div className="space-y-2">
            <Label>Centro *</Label>
            {fixedCenterId != null ? (
              <Input
                disabled
                value={
                  centers.find((c) => c.id === fixedCenterId)?.name ?? "Tu centro"
                }
              />
            ) : (
              <Select
                value={centerId != null ? String(centerId) : ""}
                onValueChange={(v) => setCenterId(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona" />
                </SelectTrigger>
                <SelectContent>
                  {centers.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Ciclo</Label>
              <Select
                value={cycleName || "none"}
                onValueChange={(v) => setCycleName(v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin ciclo</SelectItem>
                  {cycles.map((c) => (
                    <SelectItem key={c.id} value={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="g-year">Curso</Label>
              <Input
                id="g-year"
                value={schoolYear}
                onChange={(e) => setSchoolYear(e.target.value)}
                placeholder="2025/2026"
              />
            </div>
          </div>
          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? "Guardando..." : "Crear grupo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------------------
export function AssignmentDialog({ trigger }: { trigger: ReactNode }) {
  const qc = useQueryClient();
  const { centers, fixedCenterId } = useScopeCenters();
  const createMut = useCreateTeachingAssignment();
  const { data: teachers = [] } = useListUsers({ role: "teacher" });
  const { data: modules = [] } = useListModules({});

  const [open, setOpen] = useState(false);
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const [moduleId, setModuleId] = useState<number | null>(null);
  const [centerId, setCenterId] = useState<number | null>(fixedCenterId);
  const [schoolYear, setSchoolYear] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTeacherId(null);
      setModuleId(null);
      setCenterId(fixedCenterId ?? centers[0]?.id ?? null);
      setSchoolYear("");
      setError(null);
    }
  }, [open, fixedCenterId, centers]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (teacherId == null || moduleId == null || centerId == null) {
      setError("Profesor, módulo y centro son obligatorios.");
      return;
    }
    const payload: CreateTeachingAssignmentInput = {
      teacherId,
      moduleId,
      centerId,
      schoolYear: schoolYear.trim() || null,
    };
    try {
      await createMut.mutateAsync({ data: payload });
      await qc.invalidateQueries({
        queryKey: getListTeachingAssignmentsQueryKey(),
      });
      toast({ title: "Asignación creada" });
      setOpen(false);
    } catch {
      setError("No se pudo crear la asignación. Comprueba tus permisos.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva asignación docente</DialogTitle>
          <DialogDescription>
            Asigna un módulo a un profesor del centro.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Profesor *</Label>
            <Select
              value={teacherId != null ? String(teacherId) : ""}
              onValueChange={(v) => setTeacherId(Number(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona" />
              </SelectTrigger>
              <SelectContent>
                {teachers.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Módulo *</Label>
            <Select
              value={moduleId != null ? String(moduleId) : ""}
              onValueChange={(v) => setModuleId(Number(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona" />
              </SelectTrigger>
              <SelectContent>
                {modules.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.code ? `${m.code} · ` : ""}
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Centro *</Label>
              {fixedCenterId != null ? (
                <Input
                  disabled
                  value={
                    centers.find((c) => c.id === fixedCenterId)?.name ??
                    "Tu centro"
                  }
                />
              ) : (
                <Select
                  value={centerId != null ? String(centerId) : ""}
                  onValueChange={(v) => setCenterId(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona" />
                  </SelectTrigger>
                  <SelectContent>
                    {centers.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="a-year">Curso</Label>
              <Input
                id="a-year"
                value={schoolYear}
                onChange={(e) => setSchoolYear(e.target.value)}
                placeholder="2025/2026"
              />
            </div>
          </div>
          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? "Guardando..." : "Asignar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------------------
export function TransferDialog({ trigger }: { trigger: ReactNode }) {
  const qc = useQueryClient();
  const transferMut = useTransferTeachingAssignments();
  const { data: teachers = [] } = useListUsers({ role: "teacher" });

  const [open, setOpen] = useState(false);
  const [fromTeacherId, setFromTeacherId] = useState<number | null>(null);
  const [toTeacherId, setToTeacherId] = useState<number | null>(null);
  const [selectedModules, setSelectedModules] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data: fromAssignments = [] } = useListTeachingAssignments(
    fromTeacherId != null ? { teacherId: fromTeacherId } : {},
    {
      query: {
        queryKey: getListTeachingAssignmentsQueryKey(
          fromTeacherId != null ? { teacherId: fromTeacherId } : {},
        ),
        enabled: open && fromTeacherId != null,
      },
    },
  );

  useEffect(() => {
    if (open) {
      setFromTeacherId(null);
      setToTeacherId(null);
      setSelectedModules([]);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    setSelectedModules([]);
  }, [fromTeacherId]);

  const toggleModule = (id: number) =>
    setSelectedModules((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (fromTeacherId == null || toTeacherId == null) {
      setError("Selecciona el profesor de origen y el de destino.");
      return;
    }
    if (fromTeacherId === toTeacherId) {
      setError("El profesor de origen y destino deben ser distintos.");
      return;
    }
    const payload: TransferInput = {
      fromTeacherId,
      toTeacherId,
      // Empty selection transfers ALL of the teacher's modules.
      moduleIds: selectedModules.length > 0 ? selectedModules : undefined,
    };
    try {
      await transferMut.mutateAsync({ data: payload });
      await qc.invalidateQueries({
        queryKey: getListTeachingAssignmentsQueryKey(),
      });
      toast({
        title: "Traslado realizado",
        description:
          "Los módulos se han traspasado. La autoría de los recursos se mantiene.",
      });
      setOpen(false);
    } catch {
      setError("No se pudo realizar el traslado. Comprueba tus permisos.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Movilidad docente</DialogTitle>
          <DialogDescription>
            Traspasa los módulos de un profesor a otro al trasladar o dar de baja.
            La autoría de los recursos subidos se conserva.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Origen *</Label>
              <Select
                value={fromTeacherId != null ? String(fromTeacherId) : ""}
                onValueChange={(v) => setFromTeacherId(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Profesor" />
                </SelectTrigger>
                <SelectContent>
                  {teachers.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Destino *</Label>
              <Select
                value={toTeacherId != null ? String(toTeacherId) : ""}
                onValueChange={(v) => setToTeacherId(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Profesor" />
                </SelectTrigger>
                <SelectContent>
                  {teachers
                    .filter((t) => t.id !== fromTeacherId)
                    .map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Módulos a traspasar</Label>
            {fromTeacherId == null ? (
              <p className="text-sm text-muted-foreground">
                Selecciona el profesor de origen.
              </p>
            ) : fromAssignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Este profesor no tiene módulos asignados.
              </p>
            ) : (
              <div className="space-y-2 rounded-md border p-3 max-h-48 overflow-y-auto">
                <p className="text-xs text-muted-foreground">
                  Sin selección se traspasan todos.
                </p>
                {fromAssignments.map((a) => (
                  <label
                    key={a.id}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedModules.includes(a.moduleId)}
                      onCheckedChange={() => toggleModule(a.moduleId)}
                    />
                    {a.moduleName ?? `Módulo #${a.moduleId}`}
                    {a.schoolYear ? (
                      <span className="text-muted-foreground">
                        · {a.schoolYear}
                      </span>
                    ) : null}
                  </label>
                ))}
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={transferMut.isPending}>
              {transferMut.isPending ? "Trasladando..." : "Traspasar módulos"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
