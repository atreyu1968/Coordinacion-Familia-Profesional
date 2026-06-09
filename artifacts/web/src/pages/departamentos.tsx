import { useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDepartments,
  useCreateDepartment,
  useListCenters,
  useListUsers,
  getListDepartmentsQueryKey,
  type ListDepartmentsParams,
  type CreateDepartmentInput,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Plus, Network } from "lucide-react";

const ALL = "all";
const NONE = "none";

interface FormState {
  centerId: number | null;
  name: string;
  headUserId: number | null;
}

function CreateDepartmentDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>({
    centerId: null,
    name: "",
    headUserId: null,
  });
  const [error, setError] = useState<string | null>(null);

  const createMut = useCreateDepartment();
  const { data: centers = [] } = useListCenters();
  const { data: users = [] } = useListUsers({ role: "department_head" });

  const set = (patch: Partial<FormState>) =>
    setForm((f) => ({ ...f, ...patch }));

  const headOptions = users.filter(
    (u) => form.centerId == null || u.centerId === form.centerId,
  );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.centerId == null) {
      setError("Selecciona un centro.");
      return;
    }
    if (!form.name.trim()) {
      setError("El nombre del departamento es obligatorio.");
      return;
    }
    const payload: CreateDepartmentInput = {
      centerId: form.centerId,
      name: form.name.trim(),
      headUserId: form.headUserId,
    };
    try {
      await createMut.mutateAsync({ data: payload });
      await qc.invalidateQueries({ queryKey: getListDepartmentsQueryKey() });
      toast({ title: "Departamento creado", description: form.name.trim() });
      setForm({ centerId: null, name: "", headUserId: null });
      setOpen(false);
    } catch {
      setError(
        "No se pudo crear el departamento. Comprueba tus permisos e inténtalo de nuevo.",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Nuevo departamento
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuevo departamento</DialogTitle>
          <DialogDescription>
            Crea un departamento dentro de un centro.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Centro *</Label>
            <Select
              value={form.centerId ? String(form.centerId) : NONE}
              onValueChange={(v) =>
                set({
                  centerId: v === NONE ? null : Number(v),
                  headUserId: null,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un centro" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Selecciona un centro</SelectItem>
                {centers.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dept-name">Nombre *</Label>
            <Input
              id="dept-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Administración y Gestión"
            />
          </div>

          <div className="space-y-2">
            <Label>Jefe/a de departamento (opcional)</Label>
            <Select
              value={form.headUserId ? String(form.headUserId) : NONE}
              onValueChange={(v) =>
                set({ headUserId: v === NONE ? null : Number(v) })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Sin asignar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sin asignar</SelectItem>
                {headOptions.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? "Creando..." : "Crear departamento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function DepartamentosPage() {
  const { user } = useAuth();
  const canManage = ["superadmin", "coordinator", "department_head"].includes(
    user?.role ?? "",
  );

  const [centerId, setCenterId] = useState<number | null>(null);

  const { data: centers = [] } = useListCenters();
  const { data: allUsers = [] } = useListUsers();

  const centerName = useMemo(
    () => new Map(centers.map((c) => [c.id, c.name])),
    [centers],
  );
  const userName = useMemo(
    () => new Map(allUsers.map((u) => [u.id, u.name])),
    [allUsers],
  );

  const params: ListDepartmentsParams = {};
  if (centerId != null) params.centerId = centerId;

  const { data: departments = [], isLoading } = useListDepartments(params);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Departamentos</h1>
          <p className="text-muted-foreground">
            Departamentos didácticos de los centros.
          </p>
        </div>
        {canManage && <CreateDepartmentDialog />}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Select
          value={centerId ? String(centerId) : ALL}
          onValueChange={(v) => setCenterId(v === ALL ? null : Number(v))}
        >
          <SelectTrigger>
            <SelectValue placeholder="Centro" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los centros</SelectItem>
            {centers.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground">
        {isLoading
          ? "Cargando departamentos..."
          : `${departments.length} ${departments.length === 1 ? "departamento" : "departamentos"}`}
      </p>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Departamento</TableHead>
                <TableHead>Centro</TableHead>
                <TableHead>Jefe/a de departamento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!isLoading && departments.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No hay departamentos con los filtros aplicados.
                  </TableCell>
                </TableRow>
              )}
              {departments.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      <Network className="h-4 w-4 text-muted-foreground" />
                      {d.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {centerName.get(d.centerId) ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {d.headUserId
                      ? (userName.get(d.headUserId) ?? "—")
                      : "Sin asignar"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
