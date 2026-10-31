import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListUsers,
  useListFamilyUserDirectory,
  useListManagedUsers,
  useGetFamilyUserFilterOptions,
  useCreateChatGroup,
  useSendGroupMessage,
  useSendBulkUserEmail,
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
  type BulkUserEmailResult,
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
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
const MAX_BULK_RECIPIENTS = 100;
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
type BulkMessageResult = { sent: number; failedNames: string[] };

export default function UsuariosPage() {
  const searchParams = new URLSearchParams(useSearch());
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { appName } = useBranding();
  const qc = useQueryClient();
  const [headManagement, setHeadManagement] = useState(false);
  const isManager = isManagerRole(user?.role) &&
    (user?.role !== "department_head" || headManagement);
  const isFamilyDirectory = user?.role === "teacher" ||
    (user?.role === "department_head" && !headManagement);
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
      enabled: isManager || isFamilyDirectory,
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
      enabled: isFamilyDirectory,
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
    query: { enabled: !isManager && !isFamilyDirectory, queryKey: getListUsersQueryKey(readParams) },
  });

  const activeQ = isManager ? managedQ : isFamilyDirectory ? familyDirectoryQ : readQ;
  const { rows, total } = useMemo(() => {
    if (isManager) {
      return { rows: managedQ.data?.users ?? [], total: managedQ.data?.total ?? 0 };
    }
    let list = (isFamilyDirectory ? familyDirectoryQ.data ?? [] : readQ.data ?? [])
      .map((u) => ({ ...u, canManage: false, teachingProfile: null }) as ManagedUser);
    if (isFamilyDirectory && role) list = list.filter((u) => u.role === role);
    if (status !== "all") list = list.filter((u) => u.status === status);
    if (dashboardOnly && !isFamilyDirectory) {
      const activeFamilyCenterIds = new Set(centers.map((center) => center.id));
      list = list.filter(
        (u) =>
          (u.centerId != null && activeFamilyCenterIds.has(u.centerId)) ||
          (u.teachingCenterId != null && activeFamilyCenterIds.has(u.teachingCenterId)),
      );
    }
    if (centerId != null) {
      list = list.filter((u) =>
        u.centerId === centerId || (isFamilyDirectory && u.teachingCenterId === centerId),
      );
    }
    return { rows: list.slice((page - 1) * pageSize, page * pageSize), total: list.length };
  }, [isManager, isFamilyDirectory, managedQ.data, familyDirectoryQ.data, readQ.data, role, centerId, status, dashboardOnly, centers, page, pageSize]);

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

  const selectionFilterKey = JSON.stringify([
    isManager, user?.id, searchInput, search, role, provinceId, islandId, moduleId, centerId,
    status, teachingProfile, pageSize,
  ]);
  const previousSelectionFilterKey = useRef(selectionFilterKey);
  useEffect(() => {
    if (previousSelectionFilterKey.current !== selectionFilterKey) {
      previousSelectionFilterKey.current = selectionFilterKey;
      setSelectedUsers(new Map());
    }
  }, [selectionFilterKey]);

  const updateMut = useUpdateUser();
  const deactivateMut = useDeactivateUser();
  const reactivateMut = useReactivateUser();
  const createDirectMut = useCreateChatGroup();
  const sendGroupMessageMut = useSendGroupMessage();
  const sendBulkEmailMut = useSendBulkUserEmail();
  const anyPending = updateMut.isPending || deactivateMut.isPending || reactivateMut.isPending;

  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [auditUser, setAuditUser] = useState<ManagedUser | null>(null);
  const [access, setAccess] = useState<PendingAccess>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<Map<number, ManagedUser>>(new Map());
  const [bulkMode, setBulkMode] = useState<"message" | "email" | null>(null);
  const [bulkRecipients, setBulkRecipients] = useState<ManagedUser[]>([]);
  const [bulkSkippedNoEmail, setBulkSkippedNoEmail] = useState(0);
  const [bulkSubject, setBulkSubject] = useState("");
  const [bulkBody, setBulkBody] = useState("");
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkEmailResult, setBulkEmailResult] = useState<BulkUserEmailResult | null>(null);
  const [bulkMessageResult, setBulkMessageResult] = useState<BulkMessageResult | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const invalidateAll = async (id: number) => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["/api/users", id, "audit"] }),
      qc.invalidateQueries({ queryKey: getListManagedUsersQueryKey() }),
      qc.invalidateQueries({ queryKey: getListUsersQueryKey() }),
      qc.invalidateQueries({ queryKey: ["/api/users/family-directory"] }),
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
  const colCount = showActions ? 8 : 6;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const isBulkEligible = (target: ManagedUser) => {
    if (!isManager || target.status !== "active" || target.id === user?.id) {
      return false;
    }
    if (user?.role === "superadmin") return true;
    const targetCenterId = target.centerId ?? target.teachingCenterId;
    if (user?.role === "department_head") {
      return user.centerId != null && targetCenterId === user.centerId;
    }
    if (user?.role === "coordinator") {
      const targetProvinceId = target.provinceId ??
        centers.find((center) => center.id === targetCenterId)?.provinceId;
      return user.provinceId != null && targetProvinceId === user.provinceId;
    }
    return false;
  };
  const isEmailEligible = (target: ManagedUser) => isBulkEligible(target) && Boolean(target.email?.trim());
  const bulkEligibleRows = rows.filter(isBulkEligible);
  const visibleSelectedCount = bulkEligibleRows.filter((target) => selectedUsers.has(target.id)).length;
  const selectedRecipientCount = [...selectedUsers.values()].filter(isBulkEligible).length;
  const selectedEmailRecipientCount = [...selectedUsers.values()].filter(isEmailEligible).length;
  const selectPageChecked: boolean | "indeterminate" =
    bulkEligibleRows.length > 0 && visibleSelectedCount === bulkEligibleRows.length
      ? true
      : visibleSelectedCount > 0
        ? "indeterminate"
        : false;
  const togglePageSelection = (checked: boolean | "indeterminate") => {
    const newTargets = checked
      ? bulkEligibleRows.filter((target) => !selectedUsers.has(target.id))
      : [];
    const remaining = MAX_BULK_RECIPIENTS - selectedUsers.size;
    if (newTargets.length > remaining) {
      toast({
        title: "Límite de selección alcanzado",
        description: `Puedes enviar a un máximo de ${MAX_BULK_RECIPIENTS} usuarios cada vez.`,
      });
    }
    setSelectedUsers((previous) => {
      const next = new Map(previous);
      for (const target of bulkEligibleRows) {
        if (checked) {
          if (!next.has(target.id) && next.size < MAX_BULK_RECIPIENTS) {
            next.set(target.id, target);
          }
        }
        else next.delete(target.id);
      }
      return next;
    });
  };
  const toggleUserSelection = (target: ManagedUser, checked: boolean | "indeterminate") => {
    if (checked && !selectedUsers.has(target.id) && selectedUsers.size >= MAX_BULK_RECIPIENTS) {
      toast({
        title: "Límite de selección alcanzado",
        description: `Puedes enviar a un máximo de ${MAX_BULK_RECIPIENTS} usuarios cada vez.`,
      });
      return;
    }
    setSelectedUsers((previous) => {
      const next = new Map(previous);
      if (checked) next.set(target.id, target);
      else next.delete(target.id);
      return next;
    });
  };
  const openBulkComposer = (mode: "message" | "email") => {
    const eligible = [...selectedUsers.values()].filter(isBulkEligible).slice(0, MAX_BULK_RECIPIENTS);
    const recipients = mode === "email" ? eligible.filter(isEmailEligible) : eligible;
    if (recipients.length === 0) return;
    setBulkRecipients(recipients);
    setBulkSkippedNoEmail(mode === "email" ? eligible.length - recipients.length : 0);
    setBulkMode(mode);
    setBulkSubject("");
    setBulkBody("");
    setBulkEmailResult(null);
    setBulkMessageResult(null);
    setBulkError(null);
    setBulkConfirmOpen(false);
  };
  const closeBulkComposer = () => {
    if (bulkSending) return;
    if (bulkEmailResult || bulkMessageResult) setSelectedUsers(new Map());
    setBulkMode(null);
    setBulkRecipients([]);
    setBulkSkippedNoEmail(0);
    setBulkSubject("");
    setBulkBody("");
    setBulkConfirmOpen(false);
    setBulkEmailResult(null);
    setBulkMessageResult(null);
    setBulkError(null);
  };
  const confirmBulkSend = async () => {
    if (!bulkMode || bulkRecipients.length === 0 || !bulkBody.trim()) return;
    if (bulkMode === "email" && !bulkSubject.trim()) return;
    setBulkSending(true);
    setBulkError(null);
    try {
      if (bulkMode === "email") {
        const result = await sendBulkEmailMut.mutateAsync({
          data: {
            recipientIds: bulkRecipients.map((recipient) => recipient.id),
            subject: bulkSubject.trim(),
            message: bulkBody.trim(),
          },
        });
        setBulkEmailResult(result);
        setSelectedUsers(new Map());
        toast({
          title: "Envío de correos completado",
          description: `${result.sent} enviados, ${result.pending} pendientes y ${result.failed} fallidos.`,
          variant: result.failed > 0 ? "destructive" : undefined,
        });
      } else {
        let sent = 0;
        const failedNames: string[] = [];
        for (const recipient of bulkRecipients) {
          try {
            const group = await createDirectMut.mutateAsync({
              data: { name: recipient.name, type: "direct", memberIds: [recipient.id] },
            });
            await sendGroupMessageMut.mutateAsync({
              id: group.id,
              data: { content: bulkBody.trim() },
            });
            sent += 1;
          } catch {
            failedNames.push(recipient.name);
          }
        }
        await qc.invalidateQueries({ queryKey: getListChatGroupsQueryKey() });
        const result = { sent, failedNames };
        setBulkMessageResult(result);
        setSelectedUsers(new Map());
        toast({
          title: "Envío de mensajes completado",
          description: `${sent} enviados, ${failedNames.length} fallidos.`,
          variant: failedNames.length > 0 ? "destructive" : undefined,
        });
      }
    } catch (error) {
      setBulkError(
        `${getApiErrorMessage(error) ?? "No se pudo confirmar el envío."} Comprueba el resultado antes de repetirlo para evitar duplicados.`,
      );
    } finally {
      setBulkSending(false);
      setBulkConfirmOpen(false);
    }
  };
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
          {isFamilyDirectory &&
            " Se muestran usuarios de toda la familia activa; las acciones de gestión siguen limitadas a tu ámbito."}
          {user?.role === "department_head" && headManagement &&
            " Gestión de las cuentas de tu centro."}
        </p>
        </div>
        <div className="flex flex-wrap gap-2">
        {user?.role === "department_head" && (
          <Button variant="outline" onClick={() => {
            clearFilters();
            setHeadManagement((value) => !value);
          }} data-testid="button-toggle-head-management">
            {headManagement ? "Ver directorio de la familia" : "Gestionar mi centro"}
          </Button>
        )}
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

        {(isManager || isFamilyDirectory) && (
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

        {(isManager || isFamilyDirectory) && (
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

        {(isManager || isFamilyDirectory) && (
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

        {(user?.role !== "department_head" || isFamilyDirectory) && (
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

      {isManager && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-3" data-testid="bulk-user-actions">
          <span className="text-sm">Selecciona personas con las casillas de la tabla.</span>
          <span className="text-sm text-muted-foreground" aria-live="polite" data-testid="text-selected-user-count">
            {selectedRecipientCount} seleccionados
            {selectedEmailRecipientCount !== selectedRecipientCount && ` · ${selectedEmailRecipientCount} con correo`}
          </span>
          {selectedRecipientCount > 0 && (
            <div className="ml-auto flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => openBulkComposer("message")}
                disabled={bulkSending}
                data-testid="button-bulk-user-message"
              >
                <MessageCircle className="h-4 w-4" /> Mensajes privados
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => openBulkComposer("email")}
                disabled={bulkSending || selectedEmailRecipientCount === 0}
                data-testid="button-bulk-user-email"
              >
                <Mail className="h-4 w-4" /> Correo masivo
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedUsers(new Map())}
                disabled={bulkSending}
                data-testid="button-clear-user-selection"
              >
                Quitar selección
              </Button>
            </div>
          )}
          <p className="w-full text-xs text-muted-foreground">
            La selección se conserva al cambiar de página y se borra al cambiar filtros. Máximo {MAX_BULK_RECIPIENTS} destinatarios por envío.
          </p>
        </div>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {isManager && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selectPageChecked}
                      disabled={bulkEligibleRows.length === 0 || bulkSending}
                      onCheckedChange={togglePageSelection}
                      aria-label="Seleccionar usuarios activos de esta página"
                      data-testid="checkbox-select-user-table-page"
                    />
                  </TableHead>
                )}
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
                      {isManager && (
                        <TableCell>
                          <Checkbox
                            checked={selectedUsers.has(u.id)}
                            disabled={!isBulkEligible(u) || bulkSending}
                            onCheckedChange={(checked) => toggleUserSelection(u, checked)}
                            aria-label={`Seleccionar a ${u.name}`}
                            data-testid={`checkbox-select-user-${u.id}`}
                          />
                        </TableCell>
                      )}
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

      <Dialog
        open={bulkMode !== null}
        onOpenChange={(open) => {
          if (!open) closeBulkComposer();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {bulkMode === "email" ? "Enviar correo a varios usuarios" : "Enviar mensajes privados"}
            </DialogTitle>
            <DialogDescription>
              {bulkMode === "email"
                ? `Se enviará un correo independiente a ${bulkRecipients.length} destinatarios. Sus direcciones no se compartirán.${bulkSkippedNoEmail > 0 ? ` Se omiten ${bulkSkippedNoEmail} seleccionados sin correo.` : ""}`
                : `Se enviará un mensaje privado en una conversación individual a ${bulkRecipients.length} destinatarios.`}
            </DialogDescription>
          </DialogHeader>

          {bulkMode === "email" && (
            <div className="space-y-2">
              <Label htmlFor="bulk-email-subject">Asunto</Label>
              <Input
                id="bulk-email-subject"
                value={bulkSubject}
                maxLength={200}
                onChange={(event) => {
                  setBulkSubject(event.target.value);
                  setBulkError(null);
                }}
                disabled={bulkSending || bulkEmailResult !== null || bulkMessageResult !== null}
                data-testid="input-bulk-email-subject"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="bulk-message-body">Mensaje</Label>
            <Textarea
              id="bulk-message-body"
              value={bulkBody}
              maxLength={10000}
              rows={8}
              onChange={(event) => {
                setBulkBody(event.target.value);
                setBulkError(null);
              }}
              disabled={bulkSending || bulkEmailResult !== null || bulkMessageResult !== null}
              placeholder="Escribe el mensaje…"
              data-testid="textarea-bulk-user-message"
            />
            <p className="text-right text-xs text-muted-foreground">{bulkBody.length}/10000</p>
          </div>

          {bulkError && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid="text-bulk-send-error">
              {bulkError}
            </p>
          )}
          {bulkMessageResult && (
            <div role="status" className="space-y-1 rounded-md border p-3 text-sm" data-testid="text-bulk-message-result">
              <p>{bulkMessageResult.sent} mensajes enviados; {bulkMessageResult.failedNames.length} fallidos.</p>
              {bulkMessageResult.failedNames.length > 0 && (
                <p className="text-muted-foreground">No enviados: {bulkMessageResult.failedNames.join(", ")}</p>
              )}
            </div>
          )}
          {bulkEmailResult && (
            <div role="status" className="space-y-1 rounded-md border p-3 text-sm" data-testid="text-bulk-email-result">
              <p>
                {bulkEmailResult.sent} enviados; {bulkEmailResult.pending} pendientes; {bulkEmailResult.failed} fallidos.
              </p>
              {bulkEmailResult.pending > 0 && (
                <p className="text-muted-foreground">
                  El correo está pendiente de configuración. Pide al superadministrador que revise Resend en el Panel de Control.
                </p>
              )}
              {bulkEmailResult.deliveries.some((delivery) => delivery.status === "failed") && (
                <p className="text-muted-foreground">
                  Fallidos: {bulkEmailResult.deliveries
                    .filter((delivery) => delivery.status === "failed")
                    .map((delivery) => bulkRecipients.find((recipient) => recipient.id === delivery.userId)?.name ?? `Usuario #${delivery.userId}`)
                    .join(", ")}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeBulkComposer} disabled={bulkSending} data-testid="button-cancel-bulk-user-send">
              Cerrar
            </Button>
            <Button
              onClick={() => setBulkConfirmOpen(true)}
              disabled={
                bulkSending || bulkEmailResult !== null || bulkMessageResult !== null ||
                !bulkBody.trim() || (bulkMode === "email" && !bulkSubject.trim())
              }
              data-testid="button-review-bulk-user-send"
            >
              Revisar envío
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={bulkConfirmOpen} onOpenChange={(open) => { if (!bulkSending) setBulkConfirmOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Confirmas el envío a {bulkRecipients.length} usuarios?</AlertDialogTitle>
            <AlertDialogDescription>
              {bulkMode === "email"
                ? `Se enviará un correo separado con el asunto «${bulkSubject.trim()}».${bulkSkippedNoEmail > 0 ? ` Se omiten ${bulkSkippedNoEmail} seleccionados sin correo.` : ""} El envío no se puede deshacer.`
                : "Se enviará un mensaje privado separado a cada usuario. El envío no se puede deshacer."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkSending}>Volver a revisar</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkSending}
              onClick={(event) => {
                event.preventDefault();
                void confirmBulkSend();
              }}
              data-testid="button-confirm-bulk-user-send"
            >
              {bulkSending ? "Enviando…" : "Confirmar envío"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
