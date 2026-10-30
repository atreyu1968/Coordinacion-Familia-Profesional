import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListUsers,
  useListFamilyUserDirectory,
  useListManagedUsers,
  useGetFamilyUserFilterOptions,
  useCreateChatGroup,
  useListProvinces,
  useListCenters,
  useUpdateUser,
  useDeactivateUser,
  useReactivateUser,
  useInvalidateAdminSessions,
  getListUsersQueryKey,
  getListFamilyUserDirectoryQueryKey,
  getListManagedUsersQueryKey,
  getGetFamilyUserFilterOptionsQueryKey,
  getListChatGroupsQueryKey,
  getGetUserQueryKey,
  type ListUsersParams,
  type ListFamilyUserDirectoryParams,
  type ListManagedUsersParams,
  type ManagedUser,
  type ChatGroup,
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
  userDirectoryCenterParams,
} from "@/lib/user-management";
import { UserEditDialog } from "@/components/user-edit-dialog";
import { UserAuditDialog } from "@/components/user-audit-dialog";
import { TestTeacherCleanupDialog } from "@/components/test-teacher-cleanup-dialog";
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
import { dashboardRoleFromSearch } from "@/lib/dashboard-drilldown-filters";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  FilterX,
  Mail,
  MessageCircle,
  LogOut,
  Pencil,
  RotateCw,
  Search,
  UserCheck,
  UserX,
} from "lucide-react";

const ALL = "all";
const PAGE_SIZES = [25, 50, 100];
type StatusFilter = "all" | "active" | "inactive";
type ProfileFilter = "all" | "incomplete" | "complete";
const TEACHING_PROFILE_ROLES: readonly Role[] = [
  "teacher",
  "department_head",
  "coordinator",
  "superadmin",
];
const MISSING_PROFILE_LABELS = {
  center: "Centro no asignado o no válido para la familia activa",
  province: "Provincia sin asignar o no coincidente con un centro válido",
  modules: "Sin módulos válidos en el centro y curso activo",
};

type PendingAccess = { kind: "deactivate" | "reactivate"; user: ManagedUser } | null;

export default function UsuariosPage() {
  const searchParams = new URLSearchParams(useSearch());
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { appName } = useBranding();
  const qc = useQueryClient();
  const isManager = isManagerRole(user?.role);
  const isTeacher = user?.role === "teacher";
  const isSuperadmin = user?.role === "superadmin";
  const [invalidateSessionsOpen, setInvalidateSessionsOpen] = useState(false);
  const invalidateSessions = useInvalidateAdminSessions({
    mutation: {
      onSuccess: (result) => {
        setInvalidateSessionsOpen(false);
        toast({
          title: "Sesiones cerradas",
          description: `Se forzó el inicio de sesión de ${result.invalidatedUsers} usuario(s) activo(s). Tu sesión se mantiene.`,
        });
      },
      onError: (error) => {
        toast({
          title: "No se pudieron cerrar las sesiones",
          description: getApiErrorMessage(error) ?? "Vuelve a intentarlo.",
          variant: "destructive",
        });
      },
    },
  });

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const requestedRole = searchParams.get("role");
  const dashboardOnly = searchParams.get("dashboard") === "users";
  const [role, setRole] = useState<Role | null>(
    () => dashboardRoleFromSearch(requestedRole, ALL_ROLES),
  );
  const [provinceId, setProvinceId] = useState<number | null>(() => {
    const value = Number(searchParams.get("provinceId"));
    return Number.isInteger(value) && value > 0 ? value : null;
  });
  const [centerId, setCenterId] = useState<number | null>(null);
  const [islandId, setIslandId] = useState<number | null>(() => {
    const value = Number(searchParams.get("islandId"));
    return Number.isInteger(value) && value > 0 ? value : null;
  });
  const [moduleId, setModuleId] = useState<number | null>(() => {
    const value = Number(searchParams.get("moduleId"));
    return Number.isInteger(value) && value > 0 ? value : null;
  });
  const [status, setStatus] = useState<StatusFilter>(() => {
    const value = searchParams.get("status");
    return value === "active" || value === "inactive" ? value : "all";
  });
  const [teachingProfile, setTeachingProfile] = useState<ProfileFilter>("all");
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
  const centersQ = useListCenters(
    userDirectoryCenterParams(user?.role, dashboardOnly),
  );
  const filterOptionsQ = useGetFamilyUserFilterOptions({
    query: {
      enabled: isManager || isTeacher,
      queryKey: getGetFamilyUserFilterOptionsQueryKey(),
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: true,
    },
  });
  const familyDirectoryParams: ListFamilyUserDirectoryParams = {};
  if (role) familyDirectoryParams.role = role;
  if (search) familyDirectoryParams.search = search;
  if (provinceId != null) familyDirectoryParams.provinceId = provinceId;
  if (centerId != null) familyDirectoryParams.centerId = centerId;
  if (islandId != null) familyDirectoryParams.islandId = islandId;
  if (moduleId != null) familyDirectoryParams.moduleId = moduleId;
  const familyDirectoryQ = useListFamilyUserDirectory(familyDirectoryParams, {
    query: {
      enabled: isTeacher,
      queryKey: getListFamilyUserDirectoryQueryKey(familyDirectoryParams),
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
      refetchInterval: 60_000,
    },
  });
  const provinces = useMemo(() => provincesQ.data ?? [], [provincesQ.data]);
  const directoryProvinces = useMemo(
    () => filterOptionsQ.data?.provinces ?? [],
    [filterOptionsQ.data?.provinces],
  );
  const islandOptions = useMemo(
    () => (filterOptionsQ.data?.islands ?? []).filter(
      (island) => provinceId == null || island.provinceId === provinceId,
    ),
    [filterOptionsQ.data?.islands, provinceId],
  );
  const moduleOptions = filterOptionsQ.data?.modules ?? [];
  const centers = useMemo(() => centersQ.data ?? [], [centersQ.data]);
  const catalogsError = provincesQ.isError || centersQ.isError || filterOptionsQ.isError;
  const catalogsLoading = provincesQ.isLoading || centersQ.isLoading || filterOptionsQ.isLoading;
  const retryCatalogs = () => {
    if (provincesQ.isError) void provincesQ.refetch();
    if (centersQ.isError) void centersQ.refetch();
    if (filterOptionsQ.isError) void filterOptionsQ.refetch();
  };

  const provinceName = useMemo(
    () => new Map([...provinces, ...directoryProvinces].map((p) => [p.id, p.name])),
    [provinces, directoryProvinces],
  );
  const centerName = useMemo(() => new Map(centers.map((c) => [c.id, c.name])), [centers]);
  const centerFilterOptions = useMemo(() => {
    const scoped = isManager ? scopedCenters(user, centers) : centers;
    return provinceId != null ? scoped.filter((c) => c.provinceId === provinceId) : scoped;
  }, [isManager, user, centers, provinceId]);

  // Managed (server-paginated) query
  const managedParams: ListManagedUsersParams = { status, teachingProfile, page, pageSize };
  if (role) managedParams.role = role;
  if (isManager && provinceId != null) managedParams.provinceId = provinceId;
  if (centerId != null) managedParams.centerId = centerId;
  if (islandId != null) managedParams.islandId = islandId;
  if (moduleId != null) managedParams.moduleId = moduleId;
  if (search) managedParams.search = search;
  const managedQ = useListManagedUsers(managedParams, {
    query: {
      enabled: isManager, queryKey: getListManagedUsersQueryKey(managedParams),
      staleTime: 0, refetchOnMount: "always",
      refetchOnWindowFocus: true, refetchInterval: 60_000,
    },
  });

  // Read-only fallback for non-managers
  const readParams: ListUsersParams = {};
  if (role) readParams.role = role;
  if (search) readParams.search = search;
  const readQ = useListUsers(readParams, {
    query: { enabled: !isManager && !isTeacher, queryKey: getListUsersQueryKey(readParams) },
  });

  const activeQ = isManager ? managedQ : isTeacher ? familyDirectoryQ : readQ;
  const { rows, total } = useMemo(() => {
    if (isManager) {
      return { rows: managedQ.data?.users ?? [], total: managedQ.data?.total ?? 0 };
    }
    let list = (isTeacher ? familyDirectoryQ.data ?? [] : readQ.data ?? [])
      .map((u) => ({ ...u, canManage: false, teachingProfile: null }) as ManagedUser);
    if (isTeacher && role) list = list.filter((u) => u.role === role);
    if (status !== "all") list = list.filter((u) => u.status === status);
    if (dashboardOnly && !isTeacher) {
      const activeFamilyCenterIds = new Set(centers.map((center) => center.id));
      list = list.filter(
        (u) =>
          (u.centerId != null && activeFamilyCenterIds.has(u.centerId)) ||
          (u.teachingCenterId != null && activeFamilyCenterIds.has(u.teachingCenterId)),
      );
    }
    if (centerId != null) {
      list = list.filter((u) =>
        u.centerId === centerId || (isTeacher && u.teachingCenterId === centerId),
      );
    }
    return { rows: list.slice((page - 1) * pageSize, page * pageSize), total: list.length };
  }, [isManager, isTeacher, managedQ.data, familyDirectoryQ.data, readQ.data, role, centerId, status, dashboardOnly, centers, page, pageSize]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (!activeQ.isFetching && page > pageCount) setPage(pageCount);
  }, [page, pageCount, activeQ.isFetching]);

  const filtersActive =
    searchInput !== "" || role != null || provinceId != null || islandId != null ||
    moduleId != null || centerId != null || status !== "all" || teachingProfile !== "all";
  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setRole(null);
    setProvinceId(null);
    setIslandId(null);
    setModuleId(null);
    setCenterId(null);
    setStatus("all");
    setTeachingProfile("all");
    setPage(1);
  };

  const updateMut = useUpdateUser();
  const deactivateMut = useDeactivateUser();
  const reactivateMut = useReactivateUser();
  const createDirectMut = useCreateChatGroup();
  const anyPending = updateMut.isPending || deactivateMut.isPending || reactivateMut.isPending;

  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [auditUser, setAuditUser] = useState<ManagedUser | null>(null);
  const [access, setAccess] = useState<PendingAccess>(null);
  const [accessError, setAccessError] = useState<string | null>(null);

  const invalidateAll = async (id: number) => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["/api/users", id, "audit"] }),
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
  const colCount = showActions ? 7 : 6;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const startDirectConversation = (target: ManagedUser) => {
    if (target.id === user?.id || target.status !== "active" || createDirectMut.isPending) return;
    createDirectMut.mutate(
      { data: { name: target.name, type: "direct", memberIds: [target.id] } },
      {
        onSuccess: (group) => {
          qc.setQueryData<ChatGroup[]>(getListChatGroupsQueryKey(), (previous = []) =>
            previous.some((conversation) => conversation.id === group.id)
              ? previous
              : [group, ...previous],
          );
          void qc.invalidateQueries({ queryKey: getListChatGroupsQueryKey() });
          navigate(`/chat?grupo=${group.id}`);
        },
        onError: () => toast({
          title: "No se pudo iniciar la conversación",
          description: "La cuenta puede estar inactiva o no disponible. Vuelve a intentarlo.",
          variant: "destructive",
        }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
        <h1 className="text-2xl font-bold tracking-tight">Usuarios</h1>
        <p className="text-muted-foreground">
          Personas con acceso a la plataforma {appName}.
          {(isTeacher || user?.role === "department_head") &&
            " Se muestran usuarios de toda la familia activa; las acciones de gestión siguen limitadas a tu ámbito."}
        </p>
        </div>
        <div className="flex flex-wrap gap-2">
        {isSuperadmin && <TestTeacherCleanupDialog />}
        {isSuperadmin && (
          <AlertDialog open={invalidateSessionsOpen} onOpenChange={(open) => {
            if (!invalidateSessions.isPending) setInvalidateSessionsOpen(open);
          }}>
            <Button
              variant="outline"
              className="gap-2"
              data-testid="button-invalidate-user-sessions"
              onClick={() => setInvalidateSessionsOpen(true)}
            >
              <LogOut className="h-4 w-4" />
              Forzar nuevo inicio de sesión
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Cerrar las sesiones de los usuarios activos?</AlertDialogTitle>
                <AlertDialogDescription>
                  Todos los usuarios activos, excepto tu cuenta de superadministrador, tendrán que iniciar sesión de nuevo.
                  No se borrará ningún dato y tu sesión se conservará.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={invalidateSessions.isPending}>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  disabled={invalidateSessions.isPending}
                  onClick={(event) => {
                    event.preventDefault();
                    invalidateSessions.mutate(undefined);
                  }}
                >
                  {invalidateSessions.isPending ? "Cerrando sesiones…" : "Cerrar sesiones"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {["superadmin", "coordinator", "department_head"].includes(user?.role ?? "") && (
          <Button variant="outline" asChild>
            <Link href="/invitaciones">Gestionar invitaciones</Link>
          </Button>
        )}
        </div>
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

        {(isManager || isTeacher) && (
          <Select
            value={provinceId != null ? String(provinceId) : ALL}
            onValueChange={(v) => {
              const next = v === ALL ? null : Number(v);
              setProvinceId(next);
              const selectedIsland = islandOptions.find((island) => island.id === islandId);
              if (next != null && selectedIsland && selectedIsland.provinceId !== next) {
                setIslandId(null);
              }
              // Keep a selected center only if it belongs to the new province.
              if (next != null && centerId != null) {
                const c = centers.find((x) => x.id === centerId);
                if (c && c.provinceId !== next) setCenterId(null);
              }
              setPage(1);
            }}
            disabled={filterOptionsQ.isError}
          >
            <SelectTrigger aria-label="Filtrar por provincia" data-testid="select-filter-province">
              <SelectValue placeholder="Provincia" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las provincias</SelectItem>
              {directoryProvinces.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {(isManager || isTeacher) && (
          <Select
            value={islandId != null ? String(islandId) : ALL}
            onValueChange={(v) => {
              setIslandId(v === ALL ? null : Number(v));
              setCenterId(null);
              setPage(1);
            }}
            disabled={filterOptionsQ.isError}
          >
            <SelectTrigger aria-label="Filtrar por isla" data-testid="select-filter-island">
              <SelectValue placeholder="Isla" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las islas</SelectItem>
              {islandOptions.map((island) => (
                <SelectItem key={island.id} value={String(island.id)}>{island.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {(isManager || isTeacher) && (
          <Select
            value={moduleId != null ? String(moduleId) : ALL}
            onValueChange={(v) => { setModuleId(v === ALL ? null : Number(v)); setPage(1); }}
            disabled={filterOptionsQ.isError}
          >
            <SelectTrigger
              aria-label="Filtrar por módulo"
              title={filterOptionsQ.data?.activeYear
                ? `Asignaciones del curso ${filterOptionsQ.data.activeYear}`
                : "Asignaciones registradas en cualquier curso"}
              data-testid="select-filter-module"
            >
              <SelectValue placeholder="Módulo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los módulos</SelectItem>
              {moduleOptions.map((module) => (
                <SelectItem key={module.id} value={String(module.id)}>
                  {module.code ? `${module.code} · ` : ""}
                  {module.name}
                  {module.cycleName ? ` — ${module.cycleName}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {user?.role !== "department_head" && (
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
        )}

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
        {isManager && (
          <Select value={teachingProfile} onValueChange={(v) => { setTeachingProfile(v as ProfileFilter); setPage(1); }}>
            <SelectTrigger aria-label="Filtrar por integridad del perfil docente" data-testid="select-filter-teaching-profile">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los perfiles</SelectItem>
              <SelectItem value="incomplete">Docentes con perfil incompleto</SelectItem>
              <SelectItem value="complete">Docentes con perfil completo</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {isManager && managedQ.data && !managedQ.isError && (
        <div role="status" aria-live="polite" className="rounded-md border p-3 text-sm space-y-1" data-testid="teaching-profile-summary">
          <p className="font-medium">
            {managedQ.data.incompleteTeacherProfiles} docentes con perfil incompleto en tu ámbito y con los demás filtros aplicados.
          </p>
          <p className="text-muted-foreground">
            {managedQ.data.activeYear
              ? `Curso activo: ${managedQ.data.activeYear}. Se requieren centro, provincia coincidente y al menos un módulo válido de ese curso.`
              : "No hay curso activo: solo se comprueban centro y provincia; no se exigen módulos."}
          </p>
          <p className="text-muted-foreground">
            El estado solo se muestra para las cuentas que puedes gestionar; tu propia cuenta y los perfiles del mismo nivel o superior aparecen como ocultos.
          </p>
          <p className="text-muted-foreground">
            La confirmación anual es una obligación independiente. Este indicador no desactiva cuentas.
          </p>
          {managedQ.isFetching && <p className="text-muted-foreground">Actualizando datos…</p>}
        </div>
      )}

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
                {isManager && <TableHead>Integridad del perfil docente</TableHead>}
                <TableHead className="text-right">Acciones</TableHead>
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
                  const personalCenter = u.role === "teacher" ? u.centerId : u.teachingCenterId ?? u.centerId;
                  const personalCenterName = personalCenter
                    ? (u.role === "teacher" ? u.centerName : u.teachingCenterName) ??
                      centerName.get(personalCenter) ??
                      `Centro #${personalCenter}`
                    : "Sin asignar";
                  const scope =
                    [
                      u.centerId ? u.centerName ?? centerName.get(u.centerId) ?? `Centro #${u.centerId}` : null,
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
                      {isManager && (
                        <TableCell data-testid={`teaching-profile-user-${u.id}`}>
                          {u.teachingProfile ? (
                            u.teachingProfile.complete ? (
                              <div className="space-y-1">
                                <Badge variant="secondary">Completo</Badge>
                                <p className="text-xs text-muted-foreground">Centro docente: {personalCenterName}</p>
                              </div>
                            ) : (
                              <details>
                                <summary className="cursor-pointer text-sm font-medium" aria-label={`Ver datos pendientes de ${u.name}`}>
                                  Perfil incompleto ({u.teachingProfile.missing.length})
                                </summary>
                                <ul className="mt-2 list-disc pl-4 text-sm text-muted-foreground">
                                  {u.teachingProfile.missing.map((field) => (
                                    <li key={field}>{MISSING_PROFILE_LABELS[field]}</li>
                                  ))}
                                </ul>
                              </details>
                            )
                          ) : !TEACHING_PROFILE_ROLES.includes(u.role) ? (
                            <span className="text-muted-foreground">No requiere ficha docente</span>
                          ) : isSelf ? (
                            <span className="text-muted-foreground">Tu ficha se gestiona en Perfil</span>
                          ) : (
                            <span className="text-muted-foreground" title="No se muestra el estado de perfiles que no puedes gestionar.">
                              Oculto por permisos
                            </span>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            disabled={!isActive || isSelf || createDirectMut.isPending}
                            onClick={() => startDirectConversation(u)}
                            aria-label={`Enviar mensaje a ${u.name}`}
                            title={
                              !isActive
                                ? "No se pueden iniciar conversaciones con cuentas desactivadas"
                                : isSelf
                                  ? "No puedes iniciar una conversación contigo"
                                  : "Enviar mensaje"
                            }
                            data-testid={`button-message-user-${u.id}`}
                          >
                            <MessageCircle className="h-4 w-4" />
                          </Button>
                          <Button variant="outline" size="icon" asChild>
                            <a
                              href={`mailto:${u.email}`}
                              aria-label={`Enviar correo a ${u.name}`}
                              title={`Enviar correo a ${u.name}`}
                              data-testid={`button-email-user-${u.id}`}
                            >
                              <Mail className="h-4 w-4" />
                            </a>
                          </Button>
                          {showActions && (
                            <>
                              {(manageable || isSuperadmin) && (
                                <Button variant="ghost" size="sm" onClick={() => setAuditUser(u)} aria-label={`Historial de ${u.name}`}>
                                  Historial
                                </Button>
                              )}
                              {manageable ? (
                                <>
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
                                </>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </>
                          )}
                        </div>
                      </TableCell>
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

      {auditUser && <UserAuditDialog key={auditUser.id} user={auditUser} onClose={() => setAuditUser(null)} centers={centerName} provinces={provinceName} />}
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
