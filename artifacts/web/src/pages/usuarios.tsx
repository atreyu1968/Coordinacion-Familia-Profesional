import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListUsers,
  useListProvinces,
  useListCenters,
  useDeactivateUser,
  getListUsersQueryKey,
  type ListUsersParams,
  type Role,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmailLink } from "@/components/contact-link";
import { Badge } from "@/components/ui/badge";
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
import { Search, UserX } from "lucide-react";

const ALL = "all";

const ROLE_LABELS: Record<string, string> = {
  superadmin: "Superadmin",
  coordinator: "Coordinador/a",
  prospector: "Prospector/a",
  department_head: "Jefe/a de departamento",
  teacher: "Profesor/a",
};

const ROLE_OPTIONS: Role[] = [
  "superadmin",
  "coordinator",
  "prospector",
  "department_head",
  "teacher",
] as Role[];

export default function UsuariosPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canManage = ["superadmin", "coordinator", "department_head"].includes(
    user?.role ?? "",
  );
  const isSuperadmin = user?.role === "superadmin";

  const [search, setSearch] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [provinceId, setProvinceId] = useState<number | null>(null);

  const { data: provinces = [] } = useListProvinces();
  const { data: centers = [] } = useListCenters();

  const provinceName = useMemo(
    () => new Map(provinces.map((p) => [p.id, p.name])),
    [provinces],
  );
  const centerName = useMemo(
    () => new Map(centers.map((c) => [c.id, c.name])),
    [centers],
  );

  const params: ListUsersParams = {};
  if (role != null) params.role = role;
  if (provinceId != null) params.provinceId = provinceId;
  if (search.trim()) params.search = search.trim();

  const { data: users = [], isLoading } = useListUsers(params);

  const deactivateMut = useDeactivateUser();

  const onDeactivate = async (id: number, name: string) => {
    try {
      await deactivateMut.mutateAsync({ id });
      await qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
      toast({ title: "Usuario desactivado", description: name });
    } catch {
      toast({
        title: "No se pudo desactivar",
        description: "Comprueba tus permisos e inténtalo de nuevo.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Usuarios</h1>
        <p className="text-muted-foreground">
          Personas con acceso a la plataforma Coordina ADG.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o correo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select
          value={role ?? ALL}
          onValueChange={(v) => setRole(v === ALL ? null : (v as Role))}
        >
          <SelectTrigger>
            <SelectValue placeholder="Rol" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los roles</SelectItem>
            {ROLE_OPTIONS.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r] ?? r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isSuperadmin && (
          <Select
            value={provinceId ? String(provinceId) : ALL}
            onValueChange={(v) =>
              setProvinceId(v === ALL ? null : Number(v))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Provincia" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las provincias</SelectItem>
              {provinces.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {isLoading
          ? "Cargando usuarios..."
          : `${users.length} ${users.length === 1 ? "usuario" : "usuarios"}`}
      </p>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Correo</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Ámbito</TableHead>
                <TableHead>Estado</TableHead>
                {canManage && <TableHead className="text-right">Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {!isLoading && users.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 6 : 5}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No se encontraron usuarios con los filtros aplicados.
                  </TableCell>
                </TableRow>
              )}
              {users.map((u) => {
                const scope =
                  [
                    u.centerId ? centerName.get(u.centerId) : null,
                    u.provinceId ? provinceName.get(u.provinceId) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Sin asignar";
                const isActive = u.status === "active";
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <EmailLink email={u.email} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {ROLE_LABELS[u.role] ?? u.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {scope}
                    </TableCell>
                    <TableCell>
                      <Badge variant={isActive ? "default" : "outline"}>
                        {isActive ? "Activo" : "Inactivo"}
                      </Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {isActive && u.id !== user?.id && u.role !== "superadmin" && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1.5 text-destructive hover:text-destructive"
                              >
                                <UserX className="h-4 w-4" />
                                Desactivar
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  ¿Desactivar a {u.name}?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  El usuario perderá el acceso a la plataforma.
                                  Podrás volver a invitarle más adelante.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => onDeactivate(u.id, u.name)}
                                >
                                  Desactivar
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
