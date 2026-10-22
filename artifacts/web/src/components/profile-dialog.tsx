import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSocket } from "@/lib/socket";
import {
  useUpdateProfile,
  useGetMyTeachingProfile,
  useUpdateMyTeachingProfile,
  useListCenters,
  getGetCurrentUserQueryKey,
  getGetMyTeachingProfileQueryKey,
  getListCentersQueryKey,
  type User,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

export function ProfileDialog({
  user,
  children,
  forceOpen = false,
}: {
  user: User;
  children: ReactNode;
  forceOpen?: boolean;
}) {
  const qc = useQueryClient();
  const { logout } = useAuth();
  const updateMut = useUpdateProfile();
  const teachingProfileMut = useUpdateMyTeachingProfile();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const personalCenterId = user.role === "teacher" ? user.centerId : user.teachingCenterId ?? user.centerId;
  const [teachingCenterId, setTeachingCenterId] = useState<number | null>(
    personalCenterId ?? null,
  );
  const [teachingModuleIds, setTeachingModuleIds] = useState<number[] | null>(
    null,
  );
  const [teachingNoTeaching, setTeachingNoTeaching] = useState<boolean | null>(
    null,
  );
  const [teachingError, setTeachingError] = useState<string | null>(null);
  const [centerSearch, setCenterSearch] = useState("");
  const centerPickerRef = useRef<HTMLDetailsElement>(null);
  const isTeacher = ["teacher", "department_head", "coordinator", "superadmin"].includes(user.role);
  const centersQuery = useListCenters(
    {},
    {
      query: {
        queryKey: getListCentersQueryKey({}),
         enabled: (open || forceOpen) && isTeacher,
      },
    },
  );
  const search = centerSearch.trim().toLocaleLowerCase();
  const selectableCenters = (centersQuery.data ?? []).filter((center) =>
    center.name.toLocaleLowerCase().includes(search) ||
    (center.code ?? "").toLocaleLowerCase().includes(search),
  );
  const teachingProfileQuery = useGetMyTeachingProfile(
    { targetCenterId: teachingCenterId ?? undefined },
    {
      query: {
        queryKey: getGetMyTeachingProfileQueryKey({
          targetCenterId: teachingCenterId ?? undefined,
        }),
         enabled: (open || forceOpen) && isTeacher,
      },
    },
  );
  const profileMatchesSelection =
    teachingProfileQuery.data?.targetCenterId === teachingCenterId;
  const availableModules = profileMatchesSelection
    ? teachingProfileQuery.data?.modules ?? []
    : [];
  const selectedModuleIds =
    teachingModuleIds ??
    (profileMatchesSelection && teachingCenterId === personalCenterId
      ? teachingProfileQuery.data?.moduleIds ?? []
      : []);
  const selectedNoTeaching =
    teachingNoTeaching ??
    (profileMatchesSelection && teachingCenterId === personalCenterId
      ? teachingProfileQuery.data?.doesNotTeach ?? false
      : false);
  const modulesByCycle = availableModules.reduce<
    Record<string, typeof availableModules>
  >((groups, module) => {
    const cycle = module.cycleName?.trim() || "Otros módulos";
    (groups[cycle] ??= []).push(module);
    return groups;
  }, {});

  const reset = () => {
    setName(user.name);
    setEmail(user.email);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
    setTeachingCenterId(personalCenterId ?? null);
    setTeachingModuleIds(null);
    setTeachingNoTeaching(null);
    setTeachingError(null);
    setCenterSearch("");
  };

  const onOpenChange = (next: boolean) => {
    if (forceOpen && !next) return;
    if (next) reset();
    setOpen(next);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    if (!email.trim()) {
      setError("El correo es obligatorio.");
      return;
    }

    const wantsPasswordChange =
      currentPassword.length > 0 ||
      newPassword.length > 0 ||
      confirmPassword.length > 0;

    if (wantsPasswordChange) {
      if (newPassword.length < 8) {
        setError("La nueva contraseña debe tener al menos 8 caracteres.");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("Las contraseñas no coinciden.");
        return;
      }
      if (!currentPassword) {
        setError("Introduce tu contraseña actual.");
        return;
      }
    }

    try {
      await updateMut.mutateAsync({
        data: {
          name: name.trim(),
          email: email.trim(),
          ...(wantsPasswordChange ? { currentPassword, newPassword } : {}),
        },
      });
      if (wantsPasswordChange) {
        toast({
          title: "Contraseña actualizada",
          description: "Inicia sesión de nuevo con tu nueva contraseña.",
        });
        setOpen(false);
        logout();
        return;
      }
      await qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
      toast({ title: "Perfil actualizado" });
      setOpen(false);
    } catch {
      setError(
        "No se pudo guardar. Revisa los datos (correo o contraseña actual).",
      );
    }
  };

  const onTeachingCenterChange = (value: string) => {
    const nextCenterId = Number(value);
    setTeachingCenterId(nextCenterId);
    setTeachingModuleIds(nextCenterId === personalCenterId ? null : []);
    setTeachingNoTeaching(false);
    setTeachingError(null);
  };

  const toggleTeachingModule = (moduleId: number) => {
    if (selectedNoTeaching) setTeachingNoTeaching(false);
    setTeachingModuleIds((current) => {
      const selected = current ?? selectedModuleIds;
      return selected.includes(moduleId)
        ? selected.filter((id) => id !== moduleId)
        : [...selected, moduleId];
    });
  };

  const onTeachingSubmit = async () => {
    setTeachingError(null);
    if (teachingCenterId == null) {
      setTeachingError("Selecciona tu centro.");
      return;
    }
    if (!teachingProfileQuery.data || teachingProfileQuery.isError) {
      setTeachingError("No se han podido cargar los datos de docencia.");
      return;
    }
    const moduleIds = teachingProfileQuery.data.activeYear && !selectedNoTeaching
      ? selectedModuleIds
      : [];
    if (
      teachingProfileQuery.data.activeYear &&
      !selectedNoTeaching &&
      moduleIds.length === 0
    ) {
      setTeachingError("Selecciona un módulo o declara que no impartes clase.");
      return;
    }

    try {
      const updated = await teachingProfileMut.mutateAsync({
        data: {
          centerId: teachingCenterId,
          moduleIds,
          doesNotTeach: teachingProfileQuery.data.activeYear
            ? selectedNoTeaching
            : false,
        },
      });
      // Socket.io does not automatically retry a server-denied handshake.
      getSocket()?.connect();
      qc.setQueryData(getGetCurrentUserQueryKey(), updated.user);
      // Do not keep the mandatory dialog stuck in "Guardando" while unrelated
      // queries (including previously blocked dashboard reads) retry.
      void qc.invalidateQueries();
      setTeachingCenterId(updated.user.role === "teacher"
        ? updated.user.centerId ?? null
        : updated.user.teachingCenterId ?? updated.user.centerId ?? null);
      setTeachingModuleIds(updated.moduleIds);
      setTeachingNoTeaching(updated.doesNotTeach);
      toast({
        title: "Datos docentes actualizados",
        description: updated.doesNotTeach
          ? "Se ha registrado que no impartes clase este curso."
          : "Tu centro docente y tus módulos ya están actualizados.",
      });
    } catch {
      setTeachingError("No se pudo guardar el centro y los módulos.");
    }
  };

  return (
    <Dialog open={forceOpen || open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className={`max-h-[90vh] overflow-y-auto sm:max-w-2xl ${
          forceOpen ? "[&>button]:hidden" : ""
        }`}
      >
        <DialogHeader>
          <DialogTitle>
            {forceOpen ? "Completa tu perfil docente" : "Editar perfil"}
          </DialogTitle>
          <DialogDescription>
            {forceOpen
              ? "Para continuar, completa los datos docentes pendientes. La provincia se calcula automáticamente a partir del centro."
              : "Actualiza tus datos de cuenta. El rol y los permisos los gestiona la administración."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="profile-name">Nombre completo</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tu nombre y apellidos"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-email">Correo electrónico</Label>
            <Input
              id="profile-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@centro.es"
            />
          </div>

          {isTeacher && (
            <section className="space-y-4 rounded-md border p-4">
              <div>
                <h3 className="text-sm font-semibold">Centro y docencia</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  El cambio de centro se aplica de inmediato. La provincia se
                  calcula automáticamente a partir del centro seleccionado.
                  {teachingProfileQuery.data?.activeYear
                    ? ` Puedes actualizar tus módulos del curso ${teachingProfileQuery.data.activeYear} en cualquier momento.`
                    : ""}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="teaching-center">Centro</Label>
                <Input
                  id="teaching-center-search"
                  type="search"
                  placeholder="Buscar por nombre o código de centro"
                  value={centerSearch}
                  onChange={(event) => {
                    setCenterSearch(event.target.value);
                    centerPickerRef.current?.setAttribute("open", "");
                  }}
                  autoComplete="off"
                />
                <details ref={centerPickerRef} className="rounded-md border">
                  <summary
                    id="teaching-center"
                    className="cursor-pointer px-3 py-2 text-sm marker:text-muted-foreground"
                  >
                    {centersQuery.data?.find((center) => center.id === teachingCenterId)?.name ??
                      "Selecciona tu centro"}
                  </summary>
                  <div
                    role="listbox"
                    aria-label="Centros disponibles"
                    className="max-h-[min(55vh,20rem)] overflow-y-auto overscroll-contain border-t p-1"
                  >
                    {selectableCenters.length === 0 && (
                      <p className="px-2 py-3 text-sm text-muted-foreground">
                        No hay centros con ese nombre o código.
                      </p>
                    )}
                    {selectableCenters.map((center) => (
                      <button
                        key={center.id}
                        type="button"
                        role="option"
                        aria-selected={center.id === teachingCenterId}
                        className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none aria-selected:bg-accent"
                        onClick={() => {
                          onTeachingCenterChange(String(center.id));
                          centerPickerRef.current?.removeAttribute("open");
                        }}
                      >
                        {center.name} · {center.code || `Centro ${center.id}`}
                      </button>
                    ))}
                  </div>
                </details>
                <p className="text-xs text-muted-foreground">
                  Provincia:{" "}
                  {profileMatchesSelection
                    ? teachingProfileQuery.data?.targetProvinceName ??
                      "No consta para este centro"
                    : "Se asigna automáticamente según el centro."}
                </p>
              </div>

              {teachingProfileQuery.data?.activeYear ? (
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selectedNoTeaching}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setTeachingNoTeaching(checked);
                        if (checked) setTeachingModuleIds([]);
                      }}
                    />
                    <span>
                      No imparto clase durante el curso{" "}
                      {teachingProfileQuery.data.activeYear}
                    </span>
                  </label>
                  <Label>Módulos que impartes</Label>
                  <div className="max-h-64 space-y-4 overflow-y-auto rounded-md border p-3">
                    {teachingProfileQuery.isLoading ? (
                      <p className="text-sm text-muted-foreground">
                        Cargando módulos…
                      </p>
                    ) : Object.entries(modulesByCycle).length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No hay módulos disponibles para este centro. Elige otro
                        centro con módulos del curso activo.
                      </p>
                    ) : (
                      Object.entries(modulesByCycle).map(([cycle, modules]) => (
                        <div key={cycle} className="space-y-1.5">
                          <p className="text-sm font-medium">{cycle}</p>
                          {modules.map((module) => (
                            <label
                              key={module.id}
                              className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-sm hover:bg-accent/50"
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                disabled={selectedNoTeaching}
                                checked={selectedModuleIds.includes(module.id)}
                                onChange={() => toggleTeachingModule(module.id)}
                              />
                              <span>
                                {module.code ? `${module.code} · ` : ""}
                                {module.name}
                              </span>
                            </label>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : teachingProfileQuery.data ? (
                <p className="text-sm text-muted-foreground">
                  No hay un curso académico activo. Puedes actualizar el centro;
                  los módulos estarán disponibles cuando se active un curso.
                </p>
              ) : null}

              {(teachingProfileQuery.isError || centersQuery.isError) && (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-destructive">
                    No se pudieron cargar los datos necesarios para completar el
                    perfil.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void Promise.all([
                        teachingProfileQuery.refetch(),
                        centersQuery.refetch(),
                      ]);
                    }}
                  >
                    Reintentar
                  </Button>
                </div>
              )}
              {teachingError && (
                <p className="text-sm text-destructive">{teachingError}</p>
              )}
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onTeachingSubmit}
                  disabled={
                    teachingProfileMut.isPending ||
                    teachingProfileQuery.isLoading ||
                    teachingProfileQuery.isError
                  }
                >
                  {teachingProfileMut.isPending
                    ? "Guardando…"
                    : "Guardar datos docentes"}
                </Button>
              </div>
            </section>
          )}

          <div className="rounded-md border p-3 space-y-3">
            <p className="text-sm font-medium">Cambiar contraseña</p>
            <p className="text-xs text-muted-foreground">
              Déjalo en blanco si no quieres cambiarla.
            </p>
            <div className="space-y-2">
              <Label htmlFor="profile-current">Contraseña actual</Label>
              <Input
                id="profile-current"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-new">Nueva contraseña</Label>
              <Input
                id="profile-new"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-confirm">Repite la nueva contraseña</Label>
              <Input
                id="profile-confirm"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            {!forceOpen && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancelar
              </Button>
            )}
            <Button type="submit" disabled={updateMut.isPending}>
              Guardar cambios
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
