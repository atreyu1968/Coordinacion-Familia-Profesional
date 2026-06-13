import { useMemo, useState, type FormEvent } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCenter,
  useAddTrainingOffer,
  useListCycles,
  useDeleteCenter,
  useListProvinces,
  useListIslands,
  useListMunicipalities,
  getGetCenterQueryKey,
  getListCentersQueryKey,
  type CreateTrainingOfferInput,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CenterMap } from "@/components/center-map";
import { CenterFormDialog } from "@/components/center-form-dialog";
import { EmailLink, PhoneLink } from "@/components/contact-link";
import { toast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Building2,
  MapPin,
  Phone,
  Mail,
  Globe,
  GraduationCap,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";

export default function CentroDetallePage() {
  const [, params] = useRoute("/centros/:id");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const id = params ? Number(params.id) : NaN;

  const { data: center, isLoading, isError } = useGetCenter(id, {
    query: {
      queryKey: getGetCenterQueryKey(id),
      enabled: Number.isFinite(id),
    },
  });

  const hasScopeOver = useMemo(() => {
    if (!user || !center) return false;
    if (user.role === "superadmin") return true;
    if (user.role === "coordinator")
      return user.provinceId != null && center.provinceId === user.provinceId;
    if (user.role === "department_head")
      return user.centerId != null && center.id === user.centerId;
    return false;
  }, [user, center]);

  const canManageCenter =
    (user?.role === "superadmin" ||
      user?.role === "coordinator" ||
      user?.role === "department_head") &&
    hasScopeOver;
  const canManageOffer = canManageCenter;
  const { data: provinces = [] } = useListProvinces();
  const { data: islands = [] } = useListIslands();
  const { data: municipalities = [] } = useListMunicipalities();

  const provinceName = useMemo(
    () => new Map(provinces.map((p) => [p.id, p.name])),
    [provinces],
  );
  const islandName = useMemo(
    () => new Map(islands.map((i) => [i.id, i.name])),
    [islands],
  );
  const municipalityName = useMemo(
    () => new Map(municipalities.map((m) => [m.id, m.name])),
    [municipalities],
  );

  const deleteMut = useDeleteCenter();

  const onDelete = async () => {
    try {
      await deleteMut.mutateAsync({ id });
      await qc.invalidateQueries({ queryKey: getListCentersQueryKey() });
      toast({ title: "Centro dado de baja", description: center?.name });
      setLocation("/centros");
    } catch {
      toast({
        title: "No se pudo dar de baja",
        description: "Comprueba tus permisos e inténtalo de nuevo.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return <p className="text-muted-foreground">Cargando centro...</p>;
  }

  if (isError || !center) {
    return (
      <div className="space-y-4">
        <Link href="/centros" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Volver al directorio
        </Link>
        <p className="text-muted-foreground">No se encontró el centro.</p>
      </div>
    );
  }

  const geoParts = [
    center.municipalityId ? municipalityName.get(center.municipalityId) : null,
    center.islandId ? islandName.get(center.islandId) : null,
    center.provinceId ? provinceName.get(center.provinceId) : null,
  ].filter(Boolean);

  const offer = center.trainingOffer ?? [];

  return (
    <div className="space-y-6">
      <Link
        href="/centros"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver al directorio
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{center.name}</h1>
            <div className="mt-1 flex items-center gap-1 text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span>{geoParts.join(" · ") || "Sin ubicación"}</span>
            </div>
            {center.code && (
              <p className="mt-1 text-sm text-muted-foreground">
                Código {center.code}
              </p>
            )}
          </div>
        </div>

        {canManageCenter && (
          <div className="flex gap-2">
            <CenterFormDialog
              center={center}
              trigger={
                <Button variant="outline" className="gap-2">
                  <Pencil className="h-4 w-4" />
                  Editar
                </Button>
              }
            />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="gap-2 text-destructive">
                  <Trash2 className="h-4 w-4" />
                  Baja
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Dar de baja el centro</AlertDialogTitle>
                  <AlertDialogDescription>
                    El centro «{center.name}» dejará de aparecer en el
                    directorio. Esta es una baja lógica y puede revertirse desde
                    la base de datos.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onDelete}
                    disabled={deleteMut.isPending}
                  >
                    {deleteMut.isPending ? "Procesando..." : "Dar de baja"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Información de contacto</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <InfoRow icon={MapPin} label="Dirección" value={center.address} />
            <InfoRow
              icon={Phone}
              label="Teléfono"
              value={center.phone}
              node={
                center.phone ? (
                  <PhoneLink phone={center.phone} className="font-medium" />
                ) : undefined
              }
            />
            <InfoRow
              icon={Mail}
              label="Correo"
              value={center.email}
              node={
                center.email ? (
                  <EmailLink email={center.email} className="font-medium" />
                ) : undefined
              }
            />
            <InfoRow
              icon={Globe}
              label="Sitio web"
              value={center.website}
              href={center.website ?? undefined}
            />
          </CardContent>
        </Card>

        {center.latitude != null && center.longitude != null ? (
          <CenterMap
            centers={[
              {
                id: center.id,
                name: center.name,
                latitude: center.latitude,
                longitude: center.longitude,
              },
            ]}
            height={300}
            withLinks={false}
            zoom={14}
          />
        ) : (
          <Card>
            <CardContent className="flex h-full min-h-[200px] items-center justify-center text-sm text-muted-foreground">
              Sin coordenadas registradas.
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Oferta formativa</CardTitle>
          </div>
          {canManageOffer && <AddTrainingOfferDialog centerId={center.id} />}
        </CardHeader>
        <CardContent>
          {offer.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Este centro aún no tiene ciclos registrados.
            </p>
          ) : (
            <div className="space-y-2">
              {offer.map((o) => (
                <div
                  key={o.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                >
                  <span className="font-medium">{o.cycleName}</span>
                  <div className="flex flex-wrap gap-2">
                    {o.level && <Badge variant="secondary">{o.level}</Badge>}
                    {o.shift && <Badge variant="outline">{o.shift}</Badge>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  href,
  node,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: string | null;
  href?: string;
  node?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div>
        <span className="text-muted-foreground">{label}: </span>
        {value ? (
          node ? (
            node
          ) : href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline"
            >
              {value}
            </a>
          ) : (
            <span className="font-medium">{value}</span>
          )
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}

function AddTrainingOfferDialog({ centerId }: { centerId: number }) {
  const qc = useQueryClient();
  const { data: cycles = [] } = useListCycles();
  const [open, setOpen] = useState(false);
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [level, setLevel] = useState<string>("");
  const [shift, setShift] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const addMut = useAddTrainingOffer();

  const reset = () => {
    setCycleId(null);
    setLevel("");
    setShift("");
    setError(null);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (cycleId == null) {
      setError("Selecciona un ciclo del catálogo.");
      return;
    }
    const selected = cycles.find((c) => c.id === cycleId);
    const data: CreateTrainingOfferInput = {
      cycleId,
      level: level || undefined,
      shift: shift || null,
    };
    try {
      await addMut.mutateAsync({ id: centerId, data });
      await qc.invalidateQueries({ queryKey: getGetCenterQueryKey(centerId) });
      toast({ title: "Ciclo añadido", description: selected?.name ?? "" });
      reset();
      setOpen(false);
    } catch {
      setError("No se pudo añadir el ciclo. Comprueba tus permisos.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Plus className="h-4 w-4" />
          Añadir ciclo
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Añadir ciclo formativo</DialogTitle>
          <DialogDescription>
            Registra un ciclo de la oferta formativa del centro.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Ciclo del catálogo *</Label>
            <Select
              value={cycleId != null ? String(cycleId) : ""}
              onValueChange={(v) => setCycleId(Number(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un ciclo" />
              </SelectTrigger>
              <SelectContent>
                {cycles.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cycles.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No hay ciclos en el catálogo. Pídele al administrador que los
                cree en Configuración → Ciclos y módulos.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Nivel</Label>
              <Select value={level || "none"} onValueChange={(v) => setLevel(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin especificar</SelectItem>
                  <SelectItem value="Grado Básico">Grado Básico</SelectItem>
                  <SelectItem value="Grado Medio">Grado Medio</SelectItem>
                  <SelectItem value="Grado Superior">Grado Superior</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Turno</Label>
              <Select value={shift || "none"} onValueChange={(v) => setShift(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin especificar</SelectItem>
                  <SelectItem value="Mañana">Mañana</SelectItem>
                  <SelectItem value="Tarde">Tarde</SelectItem>
                  <SelectItem value="Noche">Noche</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={addMut.isPending}>
              {addMut.isPending ? "Guardando..." : "Añadir"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
