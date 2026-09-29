import { useEffect, useMemo, useRef, useState } from "react";
import {
  getGetModuleWikiEditorsQueryKey,
  useCreateWikiPermissionGroup,
  useDeleteWikiPermissionGroup,
  useGetModuleWikiEditors,
  useUpdateModuleWikiEditors,
  useUpdateWikiPermissionGroup,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import {
  Archive,
  Check,
  CircleHelp,
  Layers3,
  LockKeyhole,
  Pencil,
  Plus,
  Save,
  Search,
  ShieldCheck,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";

type WikiPermissions = {
  canUpload: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

type PermissionDraft = {
  directPermissions: WikiPermissions;
  groupIds: number[];
};

const NO_PERMISSIONS: WikiPermissions = {
  canUpload: false,
  canEdit: false,
  canDelete: false,
};

const ACTIONS: { key: keyof WikiPermissions; label: string }[] = [
  { key: "canUpload", label: "Subir archivos y enlaces" },
  { key: "canEdit", label: "Crear y editar páginas" },
  { key: "canDelete", label: "Eliminar páginas y adjuntos" },
];

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? "")
    .join("");
}

function effectivePermissions(
  draft: PermissionDraft,
  groups: { id: number; permissions: WikiPermissions }[],
): WikiPermissions {
  const groupPermissions = groups
    .filter((group) => draft.groupIds.includes(group.id))
    .reduce(
      (current, group) => ({
        canUpload: current.canUpload || group.permissions.canUpload,
        canEdit: current.canEdit || group.permissions.canEdit,
        canDelete: current.canDelete || group.permissions.canDelete,
      }),
      NO_PERMISSIONS,
    );

  return {
    canUpload: draft.directPermissions.canUpload || groupPermissions.canUpload,
    canEdit: draft.directPermissions.canEdit || groupPermissions.canEdit,
    canDelete: draft.directPermissions.canDelete || groupPermissions.canDelete,
  };
}

export function WikiPermissionEditorDialog({
  moduleId,
  sectionName,
  open,
  onOpenChange,
}: {
  moduleId: number;
  sectionName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = getGetModuleWikiEditorsQueryKey(moduleId);
  const { data, isLoading, isError } = useGetModuleWikiEditors(moduleId, {
    query: { enabled: open, queryKey },
  });
  const updatePermissions = useUpdateModuleWikiEditors();
  const createGroup = useCreateWikiPermissionGroup();
  const updateGroup = useUpdateWikiPermissionGroup();
  const deleteGroup = useDeleteWikiPermissionGroup();
  const initialized = useRef(false);
  const [drafts, setDrafts] = useState<Record<number, PermissionDraft>>({});
  const [selectedUsers, setSelectedUsers] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState("");
  const [bulkPermissions, setBulkPermissions] =
    useState<WikiPermissions>(NO_PERMISSIONS);
  const [bulkGroupId, setBulkGroupId] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupPermissions, setGroupPermissions] =
    useState<WikiPermissions>(NO_PERMISSIONS);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] =
    useState<number | null>(null);

  const candidates = data?.candidates ?? [];
  const groups = data?.groups ?? [];
  const canManage = data?.canManage ?? false;
  const canManageGroups = data?.canManageGroups ?? false;

  useEffect(() => {
    if (!open) {
      initialized.current = false;
      setFilter("");
      setSelectedUsers(new Set());
      setEditingGroupId(null);
      setConfirmDeleteGroupId(null);
      return;
    }
    if (!data || initialized.current) return;
    setDrafts(
      Object.fromEntries(
        data.candidates.map((candidate) => [
          candidate.id,
          {
            directPermissions: { ...candidate.directPermissions },
            groupIds: [...candidate.groupIds],
          },
        ]),
      ),
    );
    setSelectedUsers(new Set());
    initialized.current = true;
  }, [open, data]);

  const filteredCandidates = useMemo(() => {
    const term = filter.trim().toLocaleLowerCase();
    if (!term) return candidates;
    return candidates.filter(
      (candidate) =>
        candidate.name.toLocaleLowerCase().includes(term) ||
        (candidate.email ?? "").toLocaleLowerCase().includes(term),
    );
  }, [candidates, filter]);

  const getDraft = (candidate: (typeof candidates)[number]): PermissionDraft =>
    drafts[candidate.id] ?? {
      directPermissions: candidate.directPermissions,
      groupIds: candidate.groupIds,
    };

  const toggleSelected = (userId: number) => {
    setSelectedUsers((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const updateDirectPermission = (
    userId: number,
    permission: keyof WikiPermissions,
    checked: boolean,
  ) => {
    const candidate = candidates.find((person) => person.id === userId);
    if (!candidate) return;
    setDrafts((current) => {
      const existing = current[userId] ?? {
        directPermissions: { ...candidate.directPermissions },
        groupIds: [...candidate.groupIds],
      };
      return {
        ...current,
        [userId]: {
          ...existing,
          directPermissions: {
            ...existing.directPermissions,
            [permission]: checked,
          },
        },
      };
    });
  };

  const toggleGroupForUser = (
    userId: number,
    groupId: number,
    checked: boolean,
  ) => {
    const candidate = candidates.find((person) => person.id === userId);
    if (!candidate) return;
    setDrafts((current) => {
      const existing = current[userId] ?? {
        directPermissions: { ...candidate.directPermissions },
        groupIds: [...candidate.groupIds],
      };
      const nextGroups = new Set(existing.groupIds);
      if (checked) nextGroups.add(groupId);
      else nextGroups.delete(groupId);
      return {
        ...current,
        [userId]: { ...existing, groupIds: [...nextGroups] },
      };
    });
  };

  const applyBulkPermissions = () => {
    if (selectedUsers.size === 0) return;
    const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    setDrafts((current) => {
      const next = { ...current };
      for (const userId of selectedUsers) {
        const candidate = candidatesById.get(userId);
        if (!candidate) continue;
        const existing = next[userId] ?? {
          directPermissions: { ...candidate.directPermissions },
          groupIds: [...candidate.groupIds],
        };
        next[userId] = {
          ...existing,
          directPermissions: { ...bulkPermissions },
        };
      }
      return next;
    });
  };

  const applyBulkGroup = (add: boolean) => {
    const groupId = Number(bulkGroupId);
    if (!Number.isSafeInteger(groupId) || groupId <= 0 || selectedUsers.size === 0) {
      return;
    }
    const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    setDrafts((current) => {
      const next = { ...current };
      for (const userId of selectedUsers) {
        const candidate = candidatesById.get(userId);
        if (!candidate) continue;
        const existing = next[userId] ?? {
          directPermissions: { ...candidate.directPermissions },
          groupIds: [...candidate.groupIds],
        };
        const nextGroups = new Set(existing.groupIds);
        if (add) nextGroups.add(groupId);
        else nextGroups.delete(groupId);
        next[userId] = { ...existing, groupIds: [...nextGroups] };
      }
      return next;
    });
  };

  const savePermissions = async () => {
    if (!data) return;
    try {
      await updatePermissions.mutateAsync({
        moduleId,
        data: {
          users: candidates.map((candidate) => {
            const draft = getDraft(candidate);
            return {
              userId: candidate.id,
              directPermissions: { ...draft.directPermissions },
              groupIds: [...new Set(draft.groupIds)],
            };
          }),
        },
      });
      await queryClient.invalidateQueries();
      toast({
        title: "Permisos actualizados",
        description: sectionName,
      });
      onOpenChange(false);
    } catch {
      toast({
        title: "No se pudieron guardar los permisos",
        description: "Comprueba que los usuarios siguen perteneciendo al módulo e inténtalo de nuevo.",
        variant: "destructive",
      });
    }
  };

  const upsertGroupInCache = (group: {
    id: number;
    name: string;
    permissions: WikiPermissions;
  }) => {
    queryClient.setQueryData<NonNullable<typeof data>>(queryKey, (current) => {
      if (!current) return current;
      const nextGroups = current.groups
        .filter((item) => item.id !== group.id)
        .concat(group)
        .sort((left, right) => left.name.localeCompare(right.name));
      return { ...current, groups: nextGroups };
    });
  };

  const saveGroup = async () => {
    const name = groupName.trim();
    if (
      name.length < 2 ||
      !(
        groupPermissions.canUpload ||
        groupPermissions.canEdit ||
        groupPermissions.canDelete
      )
    ) {
      toast({
        title: "Revisa el grupo",
        description: "Indica un nombre y selecciona al menos un permiso.",
        variant: "destructive",
      });
      return;
    }
    try {
      const input = { name, permissions: { ...groupPermissions } };
      const group = editingGroupId
        ? await updateGroup.mutateAsync({
            groupId: editingGroupId,
            data: input,
          })
        : await createGroup.mutateAsync({ data: input });
      upsertGroupInCache(group);
      await queryClient.invalidateQueries();
      setGroupName("");
      setGroupPermissions(NO_PERMISSIONS);
      setEditingGroupId(null);
      toast({
        title: editingGroupId ? "Grupo actualizado" : "Grupo creado",
        description: "El grupo se puede reutilizar en otros módulos.",
      });
    } catch {
      toast({
        title: "No se pudo guardar el grupo",
        description: "Comprueba que el nombre no esté ya utilizado.",
        variant: "destructive",
      });
    }
  };

  const beginEditGroup = (group: (typeof groups)[number]) => {
    setEditingGroupId(group.id);
    setGroupName(group.name);
    setGroupPermissions({ ...group.permissions });
    setConfirmDeleteGroupId(null);
  };

  const retireGroup = async (groupId: number) => {
    try {
      await deleteGroup.mutateAsync({ groupId });
      queryClient.setQueryData<NonNullable<typeof data>>(queryKey, (current) =>
        current
          ? {
              ...current,
              groups: current.groups.filter((group) => group.id !== groupId),
              candidates: current.candidates.map((candidate) => ({
                ...candidate,
                groupIds: candidate.groupIds.filter((id) => id !== groupId),
              })),
            }
          : current,
      );
      setDrafts((current) =>
        Object.fromEntries(
          Object.entries(current).map(([userId, draft]) => [
            userId,
            {
              ...draft,
              groupIds: draft.groupIds.filter((id) => id !== groupId),
            },
          ]),
        ),
      );
      if (editingGroupId === groupId) {
        setEditingGroupId(null);
        setGroupName("");
        setGroupPermissions(NO_PERMISSIONS);
      }
      setConfirmDeleteGroupId(null);
      await queryClient.invalidateQueries();
      toast({
        title: "Grupo retirado",
        description: "Se han retirado sus permisos en todos los módulos.",
      });
    } catch {
      toast({
        title: "No se pudo retirar el grupo",
        description: "Inténtalo de nuevo.",
        variant: "destructive",
      });
    }
  };

  const cancelGroupEdit = () => {
    setEditingGroupId(null);
    setGroupName("");
    setGroupPermissions(NO_PERMISSIONS);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="wiki-permission-dialog-description"
        className="max-h-[94vh] gap-0 overflow-hidden p-0 sm:max-w-5xl"
      >
        <div className="max-h-[94vh] overflow-y-auto">
          <DialogHeader className="border-b bg-[hsl(var(--primary)/.045)] px-5 py-5 sm:px-7">
            <div className="flex items-start gap-3">
              <div
                aria-hidden="true"
                className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm"
              >
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <DialogTitle className="text-lg sm:text-xl">
                    Permisos de la documentación
                  </DialogTitle>
                  {canManage && !isLoading && !isError && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-background/80 px-2 py-0.5 text-[11px] font-medium text-primary">
                      <LockKeyhole className="h-3 w-3" />
                      Área protegida
                    </span>
                  )}
                </div>
                <DialogDescription id="wiki-permission-dialog-description" className="max-w-3xl">
                  Gestiona quién puede trabajar en «{sectionName}». Los permisos directos y los
                  de los grupos se suman; retirar un permiso directo no revoca uno heredado.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="px-5 py-5 sm:px-7">
            {isLoading ? (
              <div
                role="status"
                aria-live="polite"
                className="space-y-4 py-2"
                data-testid="status-wiki-permissions-loading"
              >
                <span className="sr-only">Cargando permisos...</span>
                <div className="h-20 animate-pulse rounded-xl bg-muted" />
                <div className="h-11 animate-pulse rounded-lg bg-muted/70" />
                <div className="space-y-2">
                  <div className="h-24 animate-pulse rounded-xl bg-muted/70" />
                  <div className="h-24 animate-pulse rounded-xl bg-muted/70" />
                </div>
              </div>
            ) : isError ? (
              <div
                role="alert"
                data-testid="status-wiki-permissions-error"
                className="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive"
              >
                <CircleHelp className="mt-0.5 h-5 w-5 shrink-0" />
                <p>No se pudieron cargar los permisos. Cierra y vuelve a abrir esta ventana.</p>
              </div>
            ) : !canManage ? (
              <div
                role="status"
                data-testid="status-wiki-permissions-readonly"
                className="flex items-start gap-3 rounded-xl border bg-muted/35 p-4 text-sm text-muted-foreground"
              >
                <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" />
                <p>
                  Solo un administrador o el coordinador del módulo puede gestionar estos
                  permisos.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                <section
                  aria-labelledby="bulk-permissions-heading"
                  className="rounded-xl border border-primary/15 bg-primary/[.035] p-4 sm:p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <UsersRound className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 id="bulk-permissions-heading" className="text-sm font-semibold">
                          Cambios en bloque
                        </h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Selecciona personas y aplica la misma regla de una vez.
                        </p>
                      </div>
                    </div>
                    <span
                      aria-live="polite"
                      data-testid="text-wiki-selected-count"
                      className="rounded-full bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground"
                    >
                      {selectedUsers.size} seleccionada{selectedUsers.size === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
                    {ACTIONS.map((action) => (
                      <label
                        key={`bulk-${action.key}`}
                        className="flex min-h-7 cursor-pointer items-center gap-2 text-xs"
                      >
                        <Checkbox
                          data-testid={`checkbox-bulk-${action.key}`}
                          checked={bulkPermissions[action.key]}
                          onCheckedChange={(checked) =>
                            setBulkPermissions((current) => ({
                              ...current,
                              [action.key]: checked === true,
                            }))
                          }
                        />
                        {action.label}
                      </label>
                    ))}
                    <Button
                      data-testid="button-apply-bulk-permissions"
                      type="button"
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      disabled={selectedUsers.size === 0}
                      onClick={applyBulkPermissions}
                    >
                      Aplicar permisos directos
                    </Button>
                  </div>

                  {groups.length > 0 && (
                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-primary/10 pt-4">
                      <Label htmlFor="wiki-bulk-group" className="text-xs font-medium">
                        Grupo para seleccionados
                      </Label>
                      <select
                        data-testid="select-bulk-group"
                        id="wiki-bulk-group"
                        aria-label="Grupo para personas seleccionadas"
                        className="h-9 min-w-44 rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/30"
                        value={bulkGroupId}
                        onChange={(event) => setBulkGroupId(event.target.value)}
                      >
                        <option value="">Elige un grupo</option>
                        {groups.map((group) => (
                          <option key={group.id} value={String(group.id)}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        data-testid="button-add-bulk-group"
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={selectedUsers.size === 0 || !bulkGroupId}
                        onClick={() => applyBulkGroup(true)}
                      >
                        Dar grupo
                      </Button>
                      <Button
                        data-testid="button-remove-bulk-group"
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={selectedUsers.size === 0 || !bulkGroupId}
                        onClick={() => applyBulkGroup(false)}
                      >
                        Quitar grupo
                      </Button>
                    </div>
                  )}

                  <div className="mt-4 flex items-start gap-2 text-[11px] leading-5 text-muted-foreground">
                    <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>Los cambios se aplican al guardar permisos.</span>
                  </div>
                </section>

                <section aria-labelledby="people-permissions-heading" className="space-y-3">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <UserRound className="h-4 w-4 text-primary" />
                        <h3 id="people-permissions-heading" className="text-sm font-semibold">
                          Personas con acceso
                        </h3>
                        <span className="text-xs text-muted-foreground">({candidates.length})</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Elige permisos directos y grupos para cada persona.
                      </p>
                    </div>
                    <Button
                      data-testid="button-toggle-all-wiki-editors"
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8"
                      onClick={() =>
                        setSelectedUsers(
                          selectedUsers.size === candidates.length
                            ? new Set()
                            : new Set(candidates.map((candidate) => candidate.id)),
                        )
                      }
                    >
                      {selectedUsers.size === candidates.length && candidates.length > 0
                        ? "Quitar selección"
                        : "Seleccionar todos"}
                    </Button>
                  </div>

                  <div className="relative">
                    <Search
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                      data-testid="input-editor-search"
                      aria-label="Buscar persona por nombre o correo"
                      className="h-10 rounded-lg pl-9"
                      placeholder="Buscar por nombre o correo"
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                    />
                  </div>

                  <div className="max-h-[39vh] space-y-2 overflow-y-auto pr-1">
                    {filteredCandidates.length === 0 ? (
                      <div
                        data-testid="empty-wiki-editor-results"
                        className="rounded-xl border border-dashed p-8 text-center"
                      >
                        <Search className="mx-auto h-6 w-6 text-muted-foreground/50" />
                        <p className="mt-2 text-sm font-medium">No hay personas disponibles</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Prueba con otro nombre o correo.
                        </p>
                      </div>
                    ) : (
                      filteredCandidates.map((candidate) => {
                        const draft = getDraft(candidate);
                        const effective = effectivePermissions(draft, groups);
                        return (
                          <div
                            key={candidate.id}
                            data-testid={`row-wiki-editor-${candidate.id}`}
                            className="rounded-xl border bg-card p-3 transition-colors hover:border-primary/25 hover:bg-primary/[.018] sm:p-4"
                          >
                            <div className="flex items-start gap-3">
                              <Checkbox
                                data-testid={`checkbox-wiki-editor-${candidate.id}`}
                                className="mt-1"
                                checked={selectedUsers.has(candidate.id)}
                                onCheckedChange={(checked) =>
                                  checked === true
                                    ? setSelectedUsers(
                                        (current) => new Set(current).add(candidate.id),
                                      )
                                    : setSelectedUsers((current) => {
                                        const next = new Set(current);
                                        next.delete(candidate.id);
                                        return next;
                                      })
                                }
                                aria-label={`Seleccionar ${candidate.name} para cambios en bloque`}
                              />
                              <div className="flex min-w-0 flex-1 flex-col gap-3">
                                <div className="flex min-w-0 items-start justify-between gap-3">
                                  <div className="flex min-w-0 items-center gap-2.5">
                                    <span
                                      aria-hidden="true"
                                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary/70 text-xs font-semibold text-secondary-foreground"
                                    >
                                      {initials(candidate.name)}
                                    </span>
                                    <div className="min-w-0">
                                      <div
                                        data-testid={`text-wiki-editor-name-${candidate.id}`}
                                        className="truncate text-sm font-semibold"
                                      >
                                        {candidate.name}
                                      </div>
                                      {candidate.email && (
                                        <div className="truncate text-xs text-muted-foreground">
                                          {candidate.email}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <div className="hidden shrink-0 items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:flex">
                                    <Check className="h-3 w-3 text-primary" />
                                    Acceso final
                                  </div>
                                </div>

                                <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
                                  <div className="space-y-2">
                                    <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground">
                                      Permisos directos
                                    </p>
                                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                                      {ACTIONS.map((action) => (
                                        <label
                                          key={`${candidate.id}-${action.key}`}
                                          className="flex min-h-7 cursor-pointer items-center gap-2 text-xs"
                                        >
                                          <Checkbox
                                            data-testid={`checkbox-direct-${candidate.id}-${action.key}`}
                                            checked={draft.directPermissions[action.key]}
                                            onCheckedChange={(checked) =>
                                              updateDirectPermission(
                                                candidate.id,
                                                action.key,
                                                checked === true,
                                              )
                                            }
                                          />
                                          {action.label}
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                  <div
                                    data-testid={`status-effective-permissions-${candidate.id}`}
                                    className="rounded-lg border bg-muted/30 px-3 py-2 lg:min-w-40"
                                  >
                                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground">
                                      Acceso resultante
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {ACTIONS.map((action) => (
                                        <span
                                          key={`effective-${candidate.id}-${action.key}`}
                                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                            effective[action.key]
                                              ? "bg-primary/10 text-primary"
                                              : "bg-muted text-muted-foreground"
                                          }`}
                                        >
                                          {effective[action.key] ? "Puede" : "Sin"}{" "}
                                          {action.key === "canUpload"
                                            ? "subir"
                                            : action.key === "canEdit"
                                              ? "editar"
                                              : "eliminar"}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                </div>

                                {groups.length > 0 && (
                                  <div className="border-t pt-3">
                                    <div className="mb-2 flex items-center gap-1.5">
                                      <Layers3 className="h-3.5 w-3.5 text-muted-foreground" />
                                      <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground">
                                        Grupos asignados
                                      </p>
                                    </div>
                                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                                      {groups.map((group) => (
                                        <label
                                          key={`${candidate.id}-group-${group.id}`}
                                          className="flex min-h-7 cursor-pointer items-center gap-2 text-xs"
                                        >
                                          <Checkbox
                                            data-testid={`checkbox-group-${candidate.id}-${group.id}`}
                                            checked={draft.groupIds.includes(group.id)}
                                            onCheckedChange={(checked) =>
                                              toggleGroupForUser(
                                                candidate.id,
                                                group.id,
                                                checked === true,
                                              )
                                            }
                                          />
                                          {group.name}
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>

                <section
                  aria-labelledby="reusable-groups-heading"
                  className="space-y-4 border-t pt-5"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary/70 text-secondary-foreground">
                      <Layers3 className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 id="reusable-groups-heading" className="text-sm font-semibold">
                        Grupos reutilizables
                      </h3>
                      <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
                        Un grupo puede asignarse a personas de varios módulos. Cambiar o retirar un
                        grupo actualiza los permisos de todos sus miembros.
                      </p>
                    </div>
                  </div>

                  {groups.length === 0 ? (
                    <div
                      data-testid="empty-wiki-permission-groups"
                      className="rounded-xl border border-dashed p-5 text-center"
                    >
                      <p className="text-sm font-medium">Todavía no hay grupos de permisos</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Crea un grupo para reutilizar una combinación de permisos.
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {groups.map((group) => (
                        <div
                          key={group.id}
                          data-testid={`card-wiki-permission-group-${group.id}`}
                          className="flex min-w-0 items-start justify-between gap-3 rounded-xl border p-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{group.name}</p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {ACTIONS.filter((action) => group.permissions[action.key]).map(
                                (action) => (
                                  <span
                                    key={`${group.id}-${action.key}`}
                                    className="rounded-full bg-primary/8 px-2 py-0.5 text-[10px] font-medium text-primary"
                                  >
                                    {action.label}
                                  </span>
                                ),
                              )}
                            </div>
                          </div>
                          {canManageGroups && (
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                data-testid={`button-edit-wiki-group-${group.id}`}
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-8 px-2.5"
                                aria-label={`Editar grupo ${group.name}`}
                                onClick={() => beginEditGroup(group)}
                              >
                                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                Editar
                              </Button>
                              {confirmDeleteGroupId === group.id ? (
                                <>
                                  <Button
                                    data-testid={`button-confirm-retire-wiki-group-${group.id}`}
                                    type="button"
                                    size="sm"
                                    variant="destructive"
                                    className="h-8 px-2.5"
                                    disabled={deleteGroup.isPending}
                                    onClick={() => void retireGroup(group.id)}
                                  >
                                    <Archive className="mr-1.5 h-3.5 w-3.5" />
                                    Confirmar
                                  </Button>
                                  <Button
                                    data-testid={`button-cancel-retire-wiki-group-${group.id}`}
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 px-2"
                                    aria-label="Cancelar retirada"
                                    onClick={() => setConfirmDeleteGroupId(null)}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  data-testid={`button-retire-wiki-group-${group.id}`}
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 px-2.5 text-muted-foreground hover:text-destructive"
                                  onClick={() => setConfirmDeleteGroupId(group.id)}
                                >
                                  <Archive className="mr-1.5 h-3.5 w-3.5" />
                                  Retirar
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {canManageGroups && (
                    <div className="rounded-xl border border-primary/15 bg-primary/[.025] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5">
                          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            {editingGroupId ? (
                              <Pencil className="h-3.5 w-3.5" />
                            ) : (
                              <Plus className="h-4 w-4" />
                            )}
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold">
                              {editingGroupId ? "Editar grupo" : "Crear grupo"}
                            </h4>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Define un nombre y al menos un permiso.
                            </p>
                          </div>
                        </div>
                        {editingGroupId !== null && (
                          <Button
                            data-testid="button-cancel-edit-wiki-group"
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8"
                            onClick={cancelGroupEdit}
                          >
                            Cancelar edición
                          </Button>
                        )}
                      </div>
                      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(180px,1fr)_2fr]">
                        <div className="space-y-1.5">
                          <Label htmlFor="wiki-permission-group-name">Nombre</Label>
                          <Input
                            data-testid="input-wiki-permission-group-name"
                            id="wiki-permission-group-name"
                            maxLength={80}
                            placeholder="p. ej. Aportaciones"
                            value={groupName}
                            onChange={(event) => setGroupName(event.target.value)}
                          />
                        </div>
                        <fieldset className="space-y-2">
                          <legend className="text-sm font-medium">Permisos del grupo</legend>
                          <div className="flex flex-wrap gap-x-4 gap-y-2">
                            {ACTIONS.map((action) => (
                              <label
                                key={`group-form-${action.key}`}
                                className="flex min-h-7 cursor-pointer items-center gap-2 text-xs"
                              >
                                <Checkbox
                                  data-testid={`checkbox-group-form-${action.key}`}
                                  checked={groupPermissions[action.key]}
                                  onCheckedChange={(checked) =>
                                    setGroupPermissions((current) => ({
                                      ...current,
                                      [action.key]: checked === true,
                                    }))
                                  }
                                />
                                {action.label}
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      </div>
                      <Button
                        data-testid="button-save-wiki-group"
                        type="button"
                        size="sm"
                        className="mt-4"
                        onClick={() => void saveGroup()}
                        disabled={createGroup.isPending || updateGroup.isPending}
                      >
                        <Save className="mr-1.5 h-3.5 w-3.5" />
                        {createGroup.isPending || updateGroup.isPending
                          ? "Guardando..."
                          : editingGroupId
                            ? "Guardar grupo"
                            : "Crear grupo"}
                      </Button>
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>

          <DialogFooter className="sticky bottom-0 border-t bg-background/95 px-5 py-4 backdrop-blur sm:px-7">
            <Button
              data-testid="button-submit-wiki-permissions"
              type="button"
              onClick={() => void savePermissions()}
              disabled={!canManage || updatePermissions.isPending || isLoading || isError}
            >
              <Save className="mr-1.5 h-4 w-4" />
              {updatePermissions.isPending ? "Guardando..." : "Guardar permisos"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}