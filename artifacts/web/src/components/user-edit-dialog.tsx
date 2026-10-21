import { useEffect, useMemo, useState } from "react";
import {
  type Center,
  type ManagedUser,
  type Province,
  type Role,
  type UpdateUserInput,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import {
  ROLE_LABELS,
  assignableRoles,
  getApiErrorMessage,
  scopedCenters,
} from "@/lib/user-management";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { AlertCircle, Loader2, RotateCw, X } from "lucide-react";

const NONE = "none";

interface Props {
  user: ManagedUser | null;
  onOpenChange: (open: boolean) => void;
  provinces: Province[];
  centers: Center[];
  catalogsLoading: boolean;
  catalogsError: boolean;
  onRetryCatalogs: () => void;
  pending: boolean;
  onSubmit: (id: number, data: UpdateUserInput) => Promise<void>;
}

export function UserEditDialog({
  user: target,
  onOpenChange,
  provinces,
  centers,
  catalogsLoading,
  catalogsError,
  onRetryCatalogs,
  pending,
  onSubmit,
}: Props) {
  const { user: caller } = useAuth();
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("teacher" as Role);
  const [centerId, setCenterId] = useState<number | null>(null);
  const [provinceId, setProvinceId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fresh initialisation each time a (different) account is opened.
  useEffect(() => {
    if (target) {
      setName(target.name);
      setRole(target.role);
      setCenterId(target.centerId ?? null);
      setProvinceId(target.provinceId ?? null);
      setError(null);
    }
  }, [target]);

  const isSuper = caller?.role === "superadmin";
  const roleOptions = useMemo(() => {
    const opts = assignableRoles(caller?.role);
    return target && !opts.includes(target.role) ? [target.role, ...opts] : opts;
  }, [caller?.role, target]);
  const allowedRoles = useMemo(() => assignableRoles(caller?.role), [caller?.role]);

  const centerOptions = useMemo(() => scopedCenters(caller, centers), [caller, centers]);
  const centerById = useMemo(() => new Map(centers.map((c) => [c.id, c])), [centers]);
  const provinceName = useMemo(
    () => new Map(provinces.map((p) => [p.id, p.name])),
    [provinces],
  );
  const unknownCenter =
    centerId != null && !centerOptions.some((c) => c.id === centerId);

  if (!target) return <Dialog open={false} onOpenChange={onOpenChange} />;

  const trimmed = name.trim();
  const nameError =
    trimmed.length === 0
      ? "El nombre es obligatorio."
      : trimmed.length > 200
        ? "El nombre no puede superar 200 caracteres."
        : null;

  const origCenter = target.centerId ?? null;
  const origProvince = target.provinceId ?? null;
  const centerChanged = centerId !== origCenter;

  // Province: derived from selected center when known; editable by superadmin only when no center.
  const selectedCenter = centerId != null ? centerById.get(centerId) : undefined;
  let effectiveProvince: number | null = provinceId;
  if (centerChanged && selectedCenter) effectiveProvince = selectedCenter.provinceId ?? null;
  if (centerChanged && centerId == null && !isSuper) {
    effectiveProvince = caller?.role === "coordinator" ? caller.provinceId ?? null : origProvince;
  }

  const payload: UpdateUserInput = {};
  if (trimmed !== target.name) payload.name = trimmed;
  if (role !== target.role) payload.role = role;
  if (centerChanged) payload.centerId = centerId;
  if (effectiveProvince !== origProvince) payload.provinceId = effectiveProvince;
  const dirty = Object.keys(payload).length > 0;

  const roleInvalid = role !== target.role && !allowedRoles.includes(role);
  const catalogsBlocked = catalogsLoading || catalogsError;
  const canSave = dirty && !nameError && !roleInvalid && !catalogsBlocked && !pending;
  const canClearCenter = caller?.role !== "department_head";

  const submit = async () => {
    if (!canSave) return;
    setError(null);
    try {
      await onSubmit(target.id, payload);
    } catch (err) {
      setError(getApiErrorMessage(err) ?? "No se pudieron guardar los cambios. Inténtalo de nuevo.");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar cuenta</DialogTitle>
          <DialogDescription>
            Cambia el nombre, el rol o el ámbito de {target.name}. El acceso se
            gestiona aparte con Desactivar/Reactivar.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="edit-user-name">Nombre</Label>
            <Input
              id="edit-user-name"
              data-testid="input-edit-name"
              value={name}
              maxLength={220}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!nameError}
              aria-describedby={nameError ? "edit-user-name-error" : undefined}
              disabled={pending}
            />
            {nameError && (
              <p id="edit-user-name-error" className="text-xs text-destructive">
                {nameError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-user-email">Correo</Label>
            <Input id="edit-user-email" value={target.email} readOnly disabled />
            <p className="text-xs text-muted-foreground">
              El correo solo lo puede cambiar la propia persona desde su perfil.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-user-role">Rol</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)} disabled={pending}>
              <SelectTrigger id="edit-user-role" data-testid="select-edit-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((r) => (
                  <SelectItem key={r} value={r} disabled={r !== target.role && !allowedRoles.includes(r)}>
                    {ROLE_LABELS[r] ?? r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {catalogsError ? (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="flex-1 space-y-2">
                <p>No se pudieron cargar centros y provincias. No es posible guardar sin ellos para no alterar la asignación actual.</p>
                <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={onRetryCatalogs}>
                  <RotateCw className="h-3.5 w-3.5" /> Reintentar
                </Button>
              </div>
            </div>
          ) : catalogsLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando centros…
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="edit-user-center">Centro</Label>
                  {canClearCenter && centerId != null && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => setCenterId(null)}
                      disabled={pending}
                      data-testid="button-clear-center"
                    >
                      <X className="h-3 w-3" /> Quitar centro
                    </Button>
                  )}
                </div>
                <Select
                  value={centerId != null ? String(centerId) : NONE}
                  onValueChange={(v) => setCenterId(v === NONE ? null : Number(v))}
                  disabled={pending}
                >
                  <SelectTrigger id="edit-user-center" data-testid="select-edit-center">
                    <SelectValue placeholder="Sin centro asignado" />
                  </SelectTrigger>
                  <SelectContent>
                    {(canClearCenter || centerId == null) && (
                      <SelectItem value={NONE}>Sin centro asignado</SelectItem>
                    )}
                    {unknownCenter && centerId != null && (
                      <SelectItem value={String(centerId)}>
                        {centerById.get(centerId)?.name ?? `Centro actual (#${centerId})`} · fuera de tu catálogo
                      </SelectItem>
                    )}
                    {centerOptions.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {unknownCenter && !centerChanged && (
                  <p className="text-xs text-muted-foreground">
                    Se conserva el centro actual aunque no figure en tu catálogo.
                  </p>
                )}
                {centerChanged && centerId == null && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Al guardar se eliminará la asignación de centro.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-user-province">Provincia</Label>
                {isSuper && centerId == null ? (
                  <Select
                    value={provinceId != null ? String(provinceId) : NONE}
                    onValueChange={(v) => setProvinceId(v === NONE ? null : Number(v))}
                    disabled={pending}
                  >
                    <SelectTrigger id="edit-user-province" data-testid="select-edit-province">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Sin provincia</SelectItem>
                      {provinceId != null && !provinceName.has(provinceId) && (
                        <SelectItem value={String(provinceId)}>Provincia actual (#{provinceId})</SelectItem>
                      )}
                      {provinces.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <>
                    <Input
                      id="edit-user-province"
                      readOnly
                      disabled
                      value={
                        effectiveProvince != null
                          ? provinceName.get(effectiveProvince) ?? `Provincia #${effectiveProvince}`
                          : "Sin provincia"
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {centerId != null ? "Se deriva del centro seleccionado." : "Determinada por tu ámbito."}
                    </p>
                  </>
                )}
              </div>
            </>
          )}

          {error && (
            <div role="alert" data-testid="text-edit-error" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSave} data-testid="button-save-user" className="gap-1.5">
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {pending ? "Guardando…" : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
