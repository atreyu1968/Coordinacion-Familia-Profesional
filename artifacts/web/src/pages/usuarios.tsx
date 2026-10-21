import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListUsers,
  useListManagedUsers,
  useListProvinces,
  useListCenters,
  useUpdateUser,
  useDeactivateUser,
  useReactivateUser,
  getListUsersQueryKey,
  getListManagedUsersQueryKey,
  getGetUserQueryKey,
  type ListUsersParams,
  type ListManagedUsersParams,
  type ManagedUser,
  type Role,
  type UpdateUserInput,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding";
import {
  ALL_ROLES,
  ROLE_LABELS,
  getApiErrorMessage,
  isManagerRole,
  scopedCenters,
} from "@/lib/user-management";
import { UserEditDialog } from "@/components/user-edit-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmailLink } from "@/components/contact-link";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  FilterX,
  Pencil,
  RotateCw,
  Search,
  UserCheck,
  UserX,
} from "lucide-react";

const ALL = "all";
const PAGE_SIZES = [25, 50, 100];
type StatusFilter = "all" | "active" | "inactive";

type PendingAccess = { kind: "deactivate" | "reactivate"; user: ManagedUser } | null;

export default function UsuariosPage() {
  const { user } = useAuth();
  const { appName } = useBranding();
  const qc = useQueryClient();
  const isManager = isManagerRole(user?.role);
  const isSuperadmin = user?.role === "superadmin";

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [provinceId, setProvinceId] = useState<number | null>(null);
  const [centerId, setCenterId] = useState<number | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const provincesQ = useListProvinces();
  const centersQ = useListCenters();
  const provinces = useMemo(() => provincesQ.data ?? [], [provincesQ.data]);
  const centers = useMemo(() => centersQ.data ?? [], [centersQ.data]);
  const catalogsError = provincesQ.isError || centersQ.isError;
  const catalogsLoading = provincesQ.isLoading || centersQ.isLoading;
  const retryCatalogs = () => {
    if (provincesQ.isError) void provincesQ.refetch();
    if (centersQ.isError) void centersQ.refetch();
  };

  const provinceName = useMemo(() => new Map(provinces.map((p) => [p.id, p.name])), [provinces]);
  const centerName = useMemo(() => new Map(centers.map((c) => [c.id, c.name])), [centers]);
  const centerFilterOptions = useMemo(() => {
    const scoped = isManager ? scopedCenters(user, centers) : centers;
    return provinceId != null ? scoped.filter((c) => c.provinceId === provinceId) : scoped;
  }, [isManager, user, centers, provinceId]);

  // Managed (server-paginated) query
  const managedParams: ListManagedUsersParams = { status, page, pageSize };
  if (role) managedParams.role = role;
  if (isSuperadmin && provinceId != null) managedParams.provinceId = provinceId;
  if (centerId != null) managedParams.centerId = centerId;
  if (search) managedParams.search = search;
  const managedQ = useListManagedUsers(managedParams, {
    query: { enabled: isManager, queryKey: getListManagedUsersQueryKey(managedParams), placeholderData: (prev) => prev },
  });

  // Read-only fallback for non-managers
  const readParams: ListUsersParams = {};
  if (role) readParams.role = role;
  if (search) readParams.search = search;
  const readQ = useListUsers(readParams, {
    query: { enabled: !isManager, queryKey: getListUsersQueryKey(readParams) },
  });

  const activeQ = isManager ? managedQ : readQ;
  const { rows, total } = useMemo(() => {
    if (isManager) {
      return { rows: managedQ.data?.users ?? [], total: managedQ.data?.total ?? 0 };
    }
    let list = (readQ.data ?? []).map((u) => ({ ...u, canManage: false }) as ManagedUser);
    if (centerId != null) list = list.filter((u) => u.centerId === centerId);
    return { rows: list.slice((page - 1) * pageSize, page * pageSize), total: list.length };
  }, [isManager, managedQ.data, readQ.data, centerId, page, pageSize]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (!activeQ.isFetching && page > pageCount) setPage(pageCount);
  }, [page, pageCount, activeQ.isFetching]);

  const filtersActive =
    searchInput !== "" || role != null || provinceId != null || centerId != null || status !== "all";
  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setRole(null);
    setProvinceId(null);
    setCenterId(null);
    setStatus("all");
    setPage(1);
  };

  const updateMut = useUpdateUser();
  const deactivateMut = useDeactivateUser();
  const reactivateMut = useReactivateUser();
  const anyPending = updateMut.isPending || deactivateMut.isPending || reactivateMut.isPending;

  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [access, setAccess] = useState<PendingAccess>(null);
  const [accessError, setAccessError] = useState<string | null>(null);

  const invalidateAll = async (id: number) => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListManagedUsersQueryKey() }),
      qc.invalidateQueries({ queryKey: getListUsersQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetUserQueryKey(id) }),
      qc.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("/api/dashboard"),
      }),
    ]);
  };

  const submitEdit = async (id: number, data: UpdateUserInput) => {
    const updated = await updateMut.mutateAsync({ id, data });
    await invalidateAll(id);
    setEditing(null);
    toast({ title: "Cuenta actualizada", description: updated?.name ?? data.name });
  };

  const confirmAccess = async () => {
    if (!access) return;
    setAccessError(null);
    const { kind, user: u } = access;
    try {
      if (kind === "deactivate") await deactivateMut.mutateAsync({ id: u.id });
      else await reactivateMut.mutateAsync({ id: u.id });
      await invalidateAll(u.id);
      setAccess(null);
      toast(
        kind === "deactivate"
          ? { title: "Acceso desactivado", description: `${u.name} ya no puede entrar. Puedes reactivarle desde esta lista.` }
          : { title: "Acceso reactivado", description: `${u.name} ya puede acceder de nuevo.` },
      );
    } catch (err) {
      setAccessError(
        getApiErrorMessage(err) ??
          (kind === "deactivate" ? "No se pudo desactivar la cuenta." : "No se pudo reactivar la cuenta."),
      );
    }
  };

  const showActions = isManager;
  const colCount = showActions ? 6 : 5;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
        <h1 className="text-2xl font-bold tracking-tight">Usuarios</h1>
        <p className="text-muted-foreground">
          Personas con acceso a la plataforma {appName}.
        </p>
        </div>
        {["superadmin", "coordinator", "department_head"].includes(user?.role ?? "") && (
          <Button variant="outline" asChild>
            <Link href="/invitaciones">Gestionar invitaciones</Link>
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Label htmlFor="users-search" className="sr-only">Buscar usuarios</Label>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="users-search"
            data-testid="input-search-users"
            placeholder="Buscar por nombre o correo..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={role ?? ALL} onValueChange={(v) => { setRole(v === ALL ? null : (v as Role)); setPage(1); }}>
          <SelectTrigger aria-label="Filtrar por rol" data-testid="select-filter-role">
            <SelectValue placeholder="Rol" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los roles</SelectItem>
            {ALL_ROLES.map((r) => (
              <SelectItem key={r} value={r}>{ROLE_LABELS[r] ?? r}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isSuperadmin && (
          <Select
            value={provinceId != null ? String(provinceId) : ALL}
            onValueChange={(v) => {
              const next = v === ALL ? null : Number(v);
              setProvinceId(next);
              // Keep a selected center only if it belongs to the new province.
              if (next != null && centerId != null) {
                const c = centers.find((x) => x.id === centerId);
                if (c && c.provinceId !== next) setCenterId(null);
              }
              setPage(1);
            }}
            disabled={provincesQ.isError}
          >
            <SelectTrigger aria-label="Filtrar por provincia" data-testid="select-filter-province">
              <SelectValue placeholder="Provincia" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las provincias</SelectItem>
              {provinces.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select
          value={centerId != null ? String(centerId) : ALL}
          onValueChange={(v) => { setCenterId(v === ALL ? null : Number(v)); setPage(1); }}
          disabled={centersQ.isError}
        >
          <SelectTrigger aria-label="Filtrar por centro" data-testid="select-filter-center">
            <SelectValue placeholder="Centro" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los centros</SelectItem>
            {centerFilterOptions.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isManager && (
          <Select value={status} onValueChange={(v) => { setStatus(v as StatusFilter); setPage(1); }}>
            <SelectTrigger aria-label="Filtrar por estado" data-testid="select-filter-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              <SelectItem value="active">Activos</SelectItem>
              <SelectItem value="inactive">Desactivados</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {catalogsError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <AlertCircle className="h-4 w-4 text-destructive" />
          <span className="flex-1">No se pudieron cargar centros o provincias. Los filtros de ámbito y la edición quedan bloqueados.</span>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={retryCatalogs} data-testid="button-retry-catalogs">
            <RotateCw className="h-3.5 w-3.5" /> Reintentar
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" data-testid="text-user-count" aria-live="polite">
          {activeQ.isLoading
            ? "Cargando usuarios..."
            : `${total} ${total === 1 ? "usuario" : "usuarios"}`}
        </p>
        {filtersActive && (
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={clearFilters} data-testid="button-clear-filters">
            <FilterX className="h-4 w-4" /> Limpiar filtros
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Correo</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Ámbito</TableHead>
                <TableHead>Estado</TableHead>
                {showActions && <TableHead className="text-right">Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeQ.isLoading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={`sk-${i}`}>
                    {Array.from({ length: colCount }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full max-w-[160px]" /></TableCell>
                    ))}
                  </TableRow>
                ))}

              {activeQ.isError && !activeQ.isLoading && (
                <TableRow>
                  <TableCell colSpan={colCount} className="py-10 text-center">
                    <div role="alert" className="flex flex-col items-center gap-3 text-sm">
                      <AlertCircle className="h-5 w-5 text-destructive" />
                      <p>{getApiErrorMessage(activeQ.error) ?? "No se pudo cargar la lista de usuarios."}</p>
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void activeQ.refetch()} data-testid="button-retry-users">
                        <RotateCw className="h-3.5 w-3.5" /> Reintentar
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {!activeQ.isLoading && !activeQ.isError && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={colCount} className="py-10 text-center text-sm text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <p>{filtersActive ? "No se encontraron usuarios con los filtros aplicados." : "Todavía no hay usuarios en tu ámbito."}</p>
                      {filtersActive && (
                        <Button size="sm" variant="outline" onClick={clearFilters}>Limpiar filtros</Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {!activeQ.isError &&
                rows.map((u) => {
                  const scope =
                    [
                      u.centerId ? centerName.get(u.centerId) ?? `Centro #${u.centerId}` : null,
                      u.provinceId ? provinceName.get(u.provinceId) ?? `Provincia #${u.provinceId}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Sin asignar";
                  const isActive = u.status === "active";
                  const isSelf = u.id === user?.id;
                  const manageable = u.canManage && !isSelf;
                  return (
                    <TableRow key={u.id} data-testid={`row-user-${u.id}`} className={isActive ? undefined : "opacity-75"}>
                      <TableCell className="font-medium">
                        {u.name}
                        {isSelf && <span className="ml-2 text-xs text-muted-foreground">(tú)</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground"><EmailLink email={u.email} /></TableCell>
                      <TableCell><Badge variant="secondary">{ROLE_LABELS[u.role] ?? u.role}</Badge></TableCell>
                      <TableCell className="text-muted-foreground">{scope}</TableCell>
                      <TableCell>
                        <Badge variant={isActive ? "default" : "outline"} data-testid={`status-user-${u.id}`}>
                          {isActive ? "Activo" : "Desactivado"}
                        </Badge>
                      </TableCell>
                      {showActions && (
                        <TableCell className="text-right">
                          {manageable ? (
                            <div className="flex flex-wrap justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1.5"
                                disabled={anyPending || catalogsError || catalogsLoading}
                                onClick={() => setEditing(u)}
                                aria-label={`Editar a ${u.name}`}
                                data-testid={`button-edit-user-${u.id}`}
                              >
                                <Pencil className="h-4 w-4" /> Editar
                              </Button>
                              {isActive ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="gap-1.5 text-destructive hover:text-destructive"
                                  disabled={anyPending}
                                  onClick={() => { setAccessError(null); setAccess({ kind: "deactivate", user: u }); }}
                                  aria-label={`Desactivar a ${u.name}`}
                                  data-testid={`button-deactivate-user-${u.id}`}
                                >
                                  <UserX className="h-4 w-4" /> Desactivar
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="gap-1.5 text-primary hover:text-primary"
                                  disabled={anyPending}
                                  onClick={() => { setAccessError(null); setAccess({ kind: "reactivate", user: u }); }}
                                  aria-label={`Reactivar a ${u.name}`}
                                  data-testid={`button-reactivate-user-${u.id}`}
                                >
                                  <UserCheck className="h-4 w-4" /> Reactivar
                                </Button>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
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

      {!activeQ.isError && total > 0 && (
        <nav aria-label="Paginación de usuarios" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Mostrando {from}–{to} de {total}</span>
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
              <SelectTrigger className="h-8 w-[110px]" aria-label="Usuarios por página" data-testid="select-page-size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((s) => (
                  <SelectItem key={s} value={String(s)}>{s} / pág.</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Página anterior" data-testid="button-prev-page">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm tabular-nums" aria-current="page">Página {page} de {pageCount}</span>
            <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))} aria-label="Página siguiente" data-testid="button-next-page">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </nav>
      )}

      <UserEditDialog
        user={editing}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        provinces={provinces}
        centers={centers}
        catalogsLoading={catalogsLoading}
        catalogsError={catalogsError}
        onRetryCatalogs={retryCatalogs}
        pending={updateMut.isPending}
        onSubmit={submitEdit}
      />

      <AlertDialog open={access != null} onOpenChange={(o) => { if (!o && !anyPending) setAccess(null); }}>
        <AlertDialogContent>
          {access && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {access.kind === "deactivate" ? `¿Desactivar el acceso de ${access.user.name}?` : `¿Reactivar el acceso de ${access.user.name}?`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {access.kind === "deactivate"
                    ? "No podrá iniciar sesión mientras esté desactivada. La cuenta, su historial y sus aportaciones se conservan, y podrás reactivarla en cualquier momento desde esta misma lista, sin enviar una nueva invitación."
                    : "Recuperará el acceso con su misma cuenta, rol y ámbito, y conservará todo su historial."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {accessError && (
                <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid="text-access-error">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {accessError}
                </p>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={anyPending}>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  disabled={anyPending}
                  data-testid="button-confirm-access"
                  className={access.kind === "deactivate" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
                  onClick={(e) => { e.preventDefault(); void confirmAccess(); }}
                >
                  {anyPending ? "Procesando…" : access.kind === "deactivate" ? "Desactivar acceso" : "Reactivar acceso"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
