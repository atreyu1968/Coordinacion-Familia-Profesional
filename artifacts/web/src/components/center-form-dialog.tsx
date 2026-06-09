import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateCenter,
  useUpdateCenter,
  useListProvinces,
  useListIslands,
  useListMunicipalities,
  getListCentersQueryKey,
  getGetCenterQueryKey,
  type Center,
  type CreateCenterInput,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const NONE = "none";

interface FormState {
  name: string;
  code: string;
  provinceId: number | null;
  islandId: number | null;
  municipalityId: number | null;
  address: string;
  latitude: string;
  longitude: string;
  phone: string;
  email: string;
  website: string;
}

function buildInitial(
  center: Center | undefined,
  defaultProvinceId: number | null,
): FormState {
  return {
    name: center?.name ?? "",
    code: center?.code ?? "",
    provinceId: center?.provinceId ?? defaultProvinceId,
    islandId: center?.islandId ?? null,
    municipalityId: center?.municipalityId ?? null,
    address: center?.address ?? "",
    latitude: center?.latitude != null ? String(center.latitude) : "",
    longitude: center?.longitude != null ? String(center.longitude) : "",
    phone: center?.phone ?? "",
    email: center?.email ?? "",
    website: center?.website ?? "",
  };
}

export function CenterFormDialog({
  center,
  trigger,
}: {
  center?: Center;
  trigger: ReactNode;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isEdit = !!center;
  const isSuperadmin = user?.role === "superadmin";

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() =>
    buildInitial(center, user?.provinceId ?? null),
  );
  const [error, setError] = useState<string | null>(null);

  const createMut = useCreateCenter();
  const updateMut = useUpdateCenter();
  const { data: provinces = [] } = useListProvinces();
  const { data: islands = [] } = useListIslands();
  const { data: municipalities = [] } = useListMunicipalities();

  useEffect(() => {
    if (open) {
      setForm(buildInitial(center, user?.provinceId ?? null));
      setError(null);
    }
  }, [open, center, user?.provinceId]);

  const islandOptions = islands.filter(
    (i) => form.provinceId == null || i.provinceId === form.provinceId,
  );
  const municipalityOptions = municipalities.filter(
    (m) => form.islandId == null || m.islandId === form.islandId,
  );

  const set = (patch: Partial<FormState>) =>
    setForm((f) => ({ ...f, ...patch }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) {
      setError("El nombre del centro es obligatorio.");
      return;
    }

    const payload: CreateCenterInput = {
      name: form.name.trim(),
      code: form.code.trim() || undefined,
      provinceId: form.provinceId,
      islandId: form.islandId,
      municipalityId: form.municipalityId,
      address: form.address.trim() || null,
      latitude: form.latitude.trim() ? Number(form.latitude) : null,
      longitude: form.longitude.trim() ? Number(form.longitude) : null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      website: form.website.trim() || null,
    };

    try {
      if (isEdit) {
        await updateMut.mutateAsync({ id: center!.id, data: payload });
        await qc.invalidateQueries({ queryKey: getGetCenterQueryKey(center!.id) });
      } else {
        await createMut.mutateAsync({ data: payload });
      }
      await qc.invalidateQueries({ queryKey: getListCentersQueryKey() });
      toast({
        title: isEdit ? "Centro actualizado" : "Centro creado",
        description: form.name.trim(),
      });
      setOpen(false);
    } catch {
      setError(
        "No se pudo guardar el centro. Comprueba tus permisos e inténtalo de nuevo.",
      );
    }
  };

  const pending = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar centro" : "Nuevo centro"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Actualiza la información del centro."
              : "Registra un nuevo centro en el directorio."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nombre *</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="IES ..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="code">Código</Label>
              <Input
                id="code"
                value={form.code}
                onChange={(e) => set({ code: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Provincia</Label>
              {isSuperadmin ? (
                <Select
                  value={form.provinceId ? String(form.provinceId) : NONE}
                  onValueChange={(v) =>
                    set({
                      provinceId: v === NONE ? null : Number(v),
                      islandId: null,
                      municipalityId: null,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sin asignar</SelectItem>
                    {provinces.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  disabled
                  value={
                    provinces.find((p) => p.id === form.provinceId)?.name ??
                    "Tu provincia"
                  }
                />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Isla</Label>
              <Select
                value={form.islandId ? String(form.islandId) : NONE}
                onValueChange={(v) =>
                  set({
                    islandId: v === NONE ? null : Number(v),
                    municipalityId: null,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sin asignar</SelectItem>
                  {islandOptions.map((i) => (
                    <SelectItem key={i.id} value={String(i.id)}>
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Municipio</Label>
              <Select
                value={form.municipalityId ? String(form.municipalityId) : NONE}
                onValueChange={(v) =>
                  set({ municipalityId: v === NONE ? null : Number(v) })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sin asignar</SelectItem>
                  {municipalityOptions.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">Dirección</Label>
            <Input
              id="address"
              value={form.address}
              onChange={(e) => set({ address: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="latitude">Latitud</Label>
              <Input
                id="latitude"
                inputMode="decimal"
                value={form.latitude}
                onChange={(e) => set({ latitude: e.target.value })}
                placeholder="28.4636"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="longitude">Longitud</Label>
              <Input
                id="longitude"
                inputMode="decimal"
                value={form.longitude}
                onChange={(e) => set({ longitude: e.target.value })}
                placeholder="-16.2518"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="phone">Teléfono</Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={(e) => set({ phone: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Correo</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="website">Sitio web</Label>
            <Input
              id="website"
              value={form.website}
              onChange={(e) => set({ website: e.target.value })}
              placeholder="https://..."
            />
          </div>

          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando..." : isEdit ? "Guardar cambios" : "Crear centro"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
