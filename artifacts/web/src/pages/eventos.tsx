import { useState, useEffect, useMemo, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListEvents,
  useCreateEvent,
  useUpdateEvent,
  useGetEvent,
  useDeleteEvent,
  useListAccreditations,
  useCreateAccreditation,
  useCheckInAccreditation,
  useListEventStaff,
  useAssignEventStaff,
  useListEventSpaces,
  useCreateEventSpace,
  useRsvpEvent,
  useIssueCertificates,
  useListCalendarEvents,
  useCreateCalendarEntry,
  useListProvinces,
  useListUsers,
  getListEventsQueryKey,
  getGetEventQueryKey,
  getListAccreditationsQueryKey,
  getListEventStaffQueryKey,
  getListEventSpacesQueryKey,
  getListCalendarEventsQueryKey,
  type Event,
  type EventDetail,
  type Accreditation,
  type CalendarEntry,
  type CreateEventInputType,
  type CreateAccreditationInputRole,
  type RsvpInputStatus,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { es } from "date-fns/locale";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { toast } from "@/hooks/use-toast";
import {
  CalendarDays,
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
  MapPin,
  Users,
  Building2,
  BadgeCheck,
  QrCode,
  ScanLine,
  Download,
  Award,
  CheckCircle2,
  ExternalLink,
  LayoutGrid,
  CalendarRange,
} from "lucide-react";

const GLOBAL = "global";

const EVENT_TYPE_LABELS: Record<CreateEventInputType, string> = {
  canarias_skills: "Canarias Skills",
  jornada: "Jornada",
  other: "Otro",
};

const ROLE_LABELS: Record<CreateAccreditationInputRole, string> = {
  participant: "Participante",
  jury: "Jurado",
  authority: "Autoridad",
  staff: "Organización",
};

const CALENDAR_TYPE_LABELS: Record<string, string> = {
  event: "Evento",
  fct: "FCT",
  deadline: "Plazo",
  milestone: "Hito",
  other: "Otro",
};

function canManageEvents(role: string | undefined): boolean {
  return role === "superadmin" || role === "coordinator";
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDay(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("es-ES", { dateStyle: "long" });
}

// Convert an ISO timestamp into the `YYYY-MM-DDTHH:mm` value a
// <input type="datetime-local"> expects, in the user's local timezone.
function toDateTimeLocal(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// ICS / calendar link helpers (client-side, no third-party keys required)
// ---------------------------------------------------------------------------
function toIcsStamp(value: string): string {
  // 2026-09-15T09:00:00.000Z -> 20260915T090000Z
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function downloadIcs(filename: string, ics: string) {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildEventIcs(item: {
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  start?: string | null;
  end?: string | null;
}): string {
  const start = item.start ? toIcsStamp(item.start) : "";
  const end = item.end
    ? toIcsStamp(item.end)
    : item.start
      ? toIcsStamp(item.start)
      : "";
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Coordina ADG//Eventos//ES",
    "BEGIN:VEVENT",
    `UID:${item.uid}`,
    `DTSTAMP:${toIcsStamp(new Date().toISOString())}`,
    start ? `DTSTART:${start}` : "",
    end ? `DTEND:${end}` : "",
    `SUMMARY:${esc(item.title)}`,
    item.location ? `LOCATION:${esc(item.location)}` : "",
    item.description ? `DESCRIPTION:${esc(item.description)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

function googleCalendarUrl(item: {
  title: string;
  description?: string | null;
  location?: string | null;
  start?: string | null;
  end?: string | null;
}): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: item.title,
  });
  if (item.start) {
    const start = toIcsStamp(item.start);
    const end = item.end ? toIcsStamp(item.end) : start;
    params.set("dates", `${start}/${end}`);
  }
  if (item.location) params.set("location", item.location);
  if (item.description) params.set("details", item.description);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function outlookCalendarUrl(item: {
  title: string;
  description?: string | null;
  location?: string | null;
  start?: string | null;
  end?: string | null;
}): string {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: item.title,
  });
  if (item.start) params.set("startdt", item.start);
  if (item.end) params.set("enddt", item.end);
  if (item.location) params.set("location", item.location);
  if (item.description) params.set("body", item.description);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Create event dialog
// ---------------------------------------------------------------------------
function EventFormDialog({
  event,
  trigger,
}: {
  event?: Event;
  trigger: React.ReactNode;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { professionalFamily } = useBranding();
  const { data: provinces = [] } = useListProvinces();
  const createMut = useCreateEvent();
  const updateMut = useUpdateEvent();
  const isSuperadmin = user?.role === "superadmin";
  const isEdit = Boolean(event);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<CreateEventInputType>("canarias_skills");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [provinceId, setProvinceId] = useState<string>(GLOBAL);
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(event?.name ?? "");
      setType((event?.type as CreateEventInputType) ?? "canarias_skills");
      setDescription(event?.description ?? "");
      setLocation(event?.location ?? "");
      setProvinceId(event?.provinceId != null ? String(event.provinceId) : GLOBAL);
      setStartAt(toDateTimeLocal(event?.startAt));
      setEndAt(toDateTimeLocal(event?.endAt));
      setError(null);
    }
  }, [open, event]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    const payload = {
      name: name.trim(),
      type,
      description: description.trim() || null,
      location: location.trim() || null,
      provinceId: isSuperadmin
        ? provinceId === GLOBAL
          ? null
          : Number(provinceId)
        : null,
      startAt: startAt ? new Date(startAt).toISOString() : null,
      endAt: endAt ? new Date(endAt).toISOString() : null,
    };
    try {
      if (isEdit && event) {
        await updateMut.mutateAsync({ id: event.id, data: payload });
        await qc.invalidateQueries({ queryKey: getGetEventQueryKey(event.id) });
      } else {
        await createMut.mutateAsync({ data: payload });
      }
      await qc.invalidateQueries({ queryKey: getListEventsQueryKey() });
      await qc.invalidateQueries({ queryKey: getListCalendarEventsQueryKey() });
      toast({
        title: isEdit ? "Evento actualizado" : "Evento creado",
        description: name.trim(),
      });
      setOpen(false);
    } catch {
      setError(
        isEdit
          ? "No se pudo actualizar el evento. Inténtalo de nuevo."
          : "No se pudo crear el evento. Inténtalo de nuevo.",
      );
    }
  };

  const pending = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar evento" : "Nuevo evento"}</DialogTitle>
          <DialogDescription>
            Organiza una jornada, un evento Canarias Skills u otro acto del
            profesorado de la familia {professionalFamily}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="e-name">Nombre *</Label>
            <Input
              id="e-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as CreateEventInputType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(EVENT_TYPE_LABELS) as CreateEventInputType[]).map(
                    (t) => (
                      <SelectItem key={t} value={t}>
                        {EVENT_TYPE_LABELS[t]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            {isSuperadmin && (
              <div className="space-y-2">
                <Label>Provincia</Label>
                <Select value={provinceId} onValueChange={setProvinceId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={GLOBAL}>Todas (global)</SelectItem>
                    {provinces.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="e-loc">Lugar</Label>
            <Input
              id="e-loc"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Pabellón, centro, dirección..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="e-start">Inicio</Label>
              <Input
                id="e-start"
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="e-end">Fin</Label>
              <Input
                id="e-end"
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="e-desc">Descripción</Label>
            <Textarea
              id="e-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending
                ? "Guardando..."
                : isEdit
                  ? "Guardar cambios"
                  : "Crear evento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateEventDialog() {
  return (
    <EventFormDialog
      trigger={
        <Button className="gap-2">
          <Plus className="w-4 h-4" /> Nuevo evento
        </Button>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Accreditations tab
// ---------------------------------------------------------------------------
function AccreditationsTab({
  event,
  canManage,
}: {
  event: EventDetail;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const { data: accreditations = [] } = useListAccreditations(event.id);
  const createMut = useCreateAccreditation();
  const checkInMut = useCheckInAccreditation();

  const [holderName, setHolderName] = useState("");
  const [holderEmail, setHolderEmail] = useState("");
  const [role, setRole] = useState<CreateAccreditationInputRole>("participant");
  const [scanToken, setScanToken] = useState("");

  const refresh = async () => {
    await qc.invalidateQueries({
      queryKey: getListAccreditationsQueryKey(event.id),
    });
    await qc.invalidateQueries({ queryKey: getGetEventQueryKey(event.id) });
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!holderName.trim()) return;
    try {
      const created = await createMut.mutateAsync({
        id: event.id,
        data: {
          holderName: holderName.trim(),
          holderEmail: holderEmail.trim() || null,
          role,
        },
      });
      await refresh();
      toast({
        title: "Acreditación creada",
        description: created.sentAt
          ? "Pase enviado por email con su código QR."
          : holderEmail.trim()
            ? "Email pendiente: configura Resend en Panel de Control."
            : "Sin email: comparte el código QR manualmente.",
      });
      setHolderName("");
      setHolderEmail("");
      setRole("participant");
    } catch {
      toast({
        title: "Error",
        description: "No se pudo crear la acreditación.",
        variant: "destructive",
      });
    }
  };

  const onCheckIn = async (e: FormEvent) => {
    e.preventDefault();
    const token = scanToken.trim();
    if (!token) return;
    try {
      const result = await checkInMut.mutateAsync({ data: { qrToken: token } });
      await refresh();
      if (result.alreadyCheckedIn) {
        toast({
          title: "Ya registrado",
          description: `${result.accreditation?.holderName ?? "Asistente"} ya había accedido.`,
        });
      } else {
        toast({
          title: "Acceso confirmado",
          description: result.accreditation?.holderName ?? "Asistente",
        });
      }
      setScanToken("");
    } catch {
      toast({
        title: "Código no válido",
        description: "No existe ninguna acreditación con ese código.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      {canManage && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="font-semibold flex items-center gap-2 text-sm">
                <QrCode className="w-4 h-4" /> Nueva acreditación
              </h3>
              <form onSubmit={onCreate} className="space-y-3">
                <Input
                  placeholder="Nombre del titular"
                  value={holderName}
                  onChange={(e) => setHolderName(e.target.value)}
                />
                <Input
                  type="email"
                  placeholder="Email (para enviar el pase QR)"
                  value={holderEmail}
                  onChange={(e) => setHolderEmail(e.target.value)}
                />
                <Select
                  value={role}
                  onValueChange={(v) =>
                    setRole(v as CreateAccreditationInputRole)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.keys(ROLE_LABELS) as CreateAccreditationInputRole[]
                    ).map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="submit"
                  size="sm"
                  className="w-full"
                  disabled={createMut.isPending}
                >
                  {createMut.isPending ? "Creando..." : "Crear y enviar pase"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="font-semibold flex items-center gap-2 text-sm">
                <ScanLine className="w-4 h-4" /> Control de acceso
              </h3>
              <p className="text-xs text-muted-foreground">
                Introduce o escanea el código del pase para registrar la entrada.
              </p>
              <form onSubmit={onCheckIn} className="space-y-3">
                <Input
                  placeholder="Código QR del pase"
                  value={scanToken}
                  onChange={(e) => setScanToken(e.target.value)}
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  disabled={checkInMut.isPending}
                >
                  {checkInMut.isPending ? "Comprobando..." : "Registrar acceso"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">
            Acreditaciones ({accreditations.length})
          </h3>
          <span className="text-xs text-muted-foreground">
            {accreditations.filter((a) => a.checkedInAt).length} con acceso
            registrado
          </span>
        </div>
        {accreditations.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Aún no hay acreditaciones.
          </p>
        ) : (
          <div className="space-y-2">
            {accreditations.map((a: Accreditation) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{a.holderName}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {a.holderEmail ?? "Sin email"} · código {a.qrToken.slice(0, 8)}…
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline">{ROLE_LABELS[a.role]}</Badge>
                  {a.checkedInAt ? (
                    <Badge className="gap-1 bg-green-600 hover:bg-green-600">
                      <CheckCircle2 className="w-3 h-3" /> Acceso
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Pendiente</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Staff tab
// ---------------------------------------------------------------------------
function StaffTab({
  event,
  canManage,
}: {
  event: EventDetail;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const { data: staff = [] } = useListEventStaff(event.id);
  const { data: users = [] } = useListUsers();
  const assignMut = useAssignEventStaff();

  const [userId, setUserId] = useState<string>("");
  const [task, setTask] = useState("");
  const [staffRole, setStaffRole] = useState("");
  const [shiftStart, setShiftStart] = useState("");
  const [shiftEnd, setShiftEnd] = useState("");

  const onAssign = async (e: FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    try {
      await assignMut.mutateAsync({
        id: event.id,
        data: {
          userId: Number(userId),
          task: task.trim() || null,
          role: staffRole.trim() || null,
          shiftStart: shiftStart ? new Date(shiftStart).toISOString() : null,
          shiftEnd: shiftEnd ? new Date(shiftEnd).toISOString() : null,
        },
      });
      await qc.invalidateQueries({
        queryKey: getListEventStaffQueryKey(event.id),
      });
      toast({ title: "Persona asignada" });
      setUserId("");
      setTask("");
      setStaffRole("");
      setShiftStart("");
      setShiftEnd("");
    } catch {
      toast({
        title: "Error",
        description: "No se pudo asignar.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      {canManage && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <h3 className="font-semibold flex items-center gap-2 text-sm">
              <Users className="w-4 h-4" /> Asignar personal / voluntariado
            </h3>
            <form onSubmit={onAssign} className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Persona</Label>
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona usuario" />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Rol / función</Label>
                <Input
                  value={staffRole}
                  onChange={(e) => setStaffRole(e.target.value)}
                  placeholder="Coordinación, voluntario..."
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs">Tarea</Label>
                <Input
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  placeholder="Control de acceso, montaje..."
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Inicio turno</Label>
                <Input
                  type="datetime-local"
                  value={shiftStart}
                  onChange={(e) => setShiftStart(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fin turno</Label>
                <Input
                  type="datetime-local"
                  value={shiftEnd}
                  onChange={(e) => setShiftEnd(e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={assignMut.isPending || !userId}
                >
                  {assignMut.isPending ? "Asignando..." : "Asignar"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        <h3 className="font-semibold text-sm">Equipo ({staff.length})</h3>
        {staff.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Sin personal asignado.
          </p>
        ) : (
          <div className="space-y-2">
            {staff.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {s.userName ?? `Usuario ${s.userId}`}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {[s.role, s.task].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                {(s.shiftStart || s.shiftEnd) && (
                  <div className="text-xs text-muted-foreground text-right shrink-0">
                    {s.shiftStart ? formatDate(s.shiftStart) : "?"}
                    <br />→ {s.shiftEnd ? formatDate(s.shiftEnd) : "?"}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spaces tab
// ---------------------------------------------------------------------------
function SpacesTab({
  event,
  canManage,
}: {
  event: EventDetail;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const { data: spaces = [] } = useListEventSpaces(event.id);
  const createMut = useCreateEventSpace();

  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [resources, setResources] = useState("");

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await createMut.mutateAsync({
        id: event.id,
        data: {
          name: name.trim(),
          capacity: capacity ? Number(capacity) : null,
          resources: resources
            .split(",")
            .map((r) => r.trim())
            .filter(Boolean),
        },
      });
      await qc.invalidateQueries({
        queryKey: getListEventSpacesQueryKey(event.id),
      });
      await qc.invalidateQueries({ queryKey: getGetEventQueryKey(event.id) });
      toast({ title: "Espacio añadido" });
      setName("");
      setCapacity("");
      setResources("");
    } catch {
      toast({
        title: "Error",
        description: "No se pudo crear el espacio.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      {canManage && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <h3 className="font-semibold flex items-center gap-2 text-sm">
              <Building2 className="w-4 h-4" /> Nuevo espacio
            </h3>
            <form onSubmit={onCreate} className="grid gap-3 md:grid-cols-3">
              <Input
                placeholder="Nombre (Aula 1, Pabellón...)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="md:col-span-1"
              />
              <Input
                type="number"
                min={0}
                placeholder="Aforo"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
              <Input
                placeholder="Recursos (coma)"
                value={resources}
                onChange={(e) => setResources(e.target.value)}
              />
              <div className="md:col-span-3">
                <Button type="submit" size="sm" disabled={createMut.isPending}>
                  {createMut.isPending ? "Guardando..." : "Añadir espacio"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        <h3 className="font-semibold text-sm">Espacios ({spaces.length})</h3>
        {spaces.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Sin espacios configurados.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {spaces.map((s) => (
              <div key={s.id} className="rounded-md border p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{s.name}</span>
                  {s.capacity != null && (
                    <Badge variant="outline" className="gap-1">
                      <Users className="w-3 h-3" /> {s.capacity}
                    </Badge>
                  )}
                </div>
                {s.resources && s.resources.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {s.resources.map((r) => (
                      <Badge key={r} variant="secondary" className="text-xs">
                        {r}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attendance / certificates tab
// ---------------------------------------------------------------------------
function AttendanceTab({
  event,
  canManage,
}: {
  event: EventDetail;
  canManage: boolean;
}) {
  const rsvpMut = useRsvpEvent();
  const certMut = useIssueCertificates();

  const onRsvp = async (status: RsvpInputStatus) => {
    try {
      await rsvpMut.mutateAsync({ id: event.id, data: { status } });
      toast({
        title: "Asistencia registrada",
        description:
          status === "yes"
            ? "Has confirmado tu asistencia."
            : status === "no"
              ? "Has indicado que no asistirás."
              : "Asistencia marcada como tentativa.",
      });
    } catch {
      toast({
        title: "Error",
        description: "No se pudo registrar tu asistencia.",
        variant: "destructive",
      });
    }
  };

  const onIssue = async () => {
    try {
      await certMut.mutateAsync({ id: event.id });
      toast({
        title: "Certificados generados",
        description:
          "Se han enviado por email a quienes confirmaron asistencia. Si no llegan, revisa la configuración de Resend.",
      });
    } catch {
      toast({
        title: "Error",
        description: "No se pudieron generar los certificados.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="font-semibold flex items-center gap-2 text-sm">
            <CheckCircle2 className="w-4 h-4" /> Confirma tu asistencia
          </h3>
          <p className="text-xs text-muted-foreground">
            Tu confirmación habilita la expedición automática del certificado de
            asistencia.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => onRsvp("yes")}
              disabled={rsvpMut.isPending}
            >
              Asistiré
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onRsvp("maybe")}
              disabled={rsvpMut.isPending}
            >
              Quizás
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRsvp("no")}
              disabled={rsvpMut.isPending}
            >
              No asistiré
            </Button>
          </div>
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <h3 className="font-semibold flex items-center gap-2 text-sm">
              <Award className="w-4 h-4" /> Certificados de asistencia
            </h3>
            <p className="text-xs text-muted-foreground">
              Genera y envía por email un PDF de certificado a cada persona que
              haya confirmado su asistencia.
            </p>
            <Button size="sm" onClick={onIssue} disabled={certMut.isPending}>
              {certMut.isPending
                ? "Generando..."
                : "Generar y enviar certificados"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event detail view
// ---------------------------------------------------------------------------
function EventDetailView({
  eventId,
  onBack,
}: {
  eventId: number;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: event, isLoading } = useGetEvent(eventId);
  const deleteMut = useDeleteEvent();
  const canManage = canManageEvents(user?.role);

  if (isLoading || !event) {
    return (
      <p className="text-muted-foreground py-12 text-center">
        Cargando evento...
      </p>
    );
  }

  const onDelete = async () => {
    try {
      await deleteMut.mutateAsync({ id: event.id });
      await qc.invalidateQueries({ queryKey: getListEventsQueryKey() });
      toast({ title: "Evento eliminado" });
      onBack();
    } catch {
      toast({
        title: "Error",
        description: "No se pudo eliminar.",
        variant: "destructive",
      });
    }
  };

  const onAddToCalendar = () => {
    downloadIcs(
      `evento-${event.id}.ics`,
      buildEventIcs({
        uid: `event-${event.id}@coordinaadg`,
        title: event.name,
        description: event.description,
        location: event.location,
        start: event.startAt,
        end: event.endAt,
      }),
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" className="gap-2 -ml-2" onClick={onBack}>
            <ArrowLeft className="w-4 h-4" /> Volver
          </Button>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            {event.name}
            <Badge variant="outline">{EVENT_TYPE_LABELS[event.type]}</Badge>
          </h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <CalendarDays className="w-4 h-4" /> {formatDate(event.startAt)}
            </span>
            {event.location && (
              <span className="flex items-center gap-1">
                <MapPin className="w-4 h-4" /> {event.location}
              </span>
            )}
            <span className="flex items-center gap-1">
              <BadgeCheck className="w-4 h-4" /> {event.checkedInCount ?? 0}/
              {event.accreditationsCount ?? 0} acreditados con acceso
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={onAddToCalendar}>
            <Download className="w-4 h-4" /> .ics
          </Button>
          <Button variant="outline" size="sm" className="gap-2" asChild>
            <a
              href={googleCalendarUrl({
                title: event.name,
                description: event.description,
                location: event.location,
                start: event.startAt,
                end: event.endAt,
              })}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="w-4 h-4" /> Google
            </a>
          </Button>
          <Button variant="outline" size="sm" className="gap-2" asChild>
            <a
              href={outlookCalendarUrl({
                title: event.name,
                description: event.description,
                location: event.location,
                start: event.startAt,
                end: event.endAt,
              })}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="w-4 h-4" /> Outlook
            </a>
          </Button>
          {canManage && (
            <EventFormDialog
              event={event}
              trigger={
                <Button variant="outline" size="sm" className="gap-2">
                  <Pencil className="w-4 h-4" /> Editar
                </Button>
              }
            />
          )}
          {canManage && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="text-destructive">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Eliminar evento?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Se eliminará «{event.name}». Esta acción no se puede deshacer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete}>Eliminar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {event.description && (
        <p className="text-sm text-muted-foreground">{event.description}</p>
      )}

      <Tabs defaultValue="accreditations">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="accreditations">Acreditaciones</TabsTrigger>
          <TabsTrigger value="staff">Personal</TabsTrigger>
          <TabsTrigger value="spaces">Espacios</TabsTrigger>
          <TabsTrigger value="attendance">Asistencia</TabsTrigger>
        </TabsList>
        <TabsContent value="accreditations" className="pt-4">
          <AccreditationsTab event={event} canManage={canManage} />
        </TabsContent>
        <TabsContent value="staff" className="pt-4">
          <StaffTab event={event} canManage={canManage} />
        </TabsContent>
        <TabsContent value="spaces" className="pt-4">
          <SpacesTab event={event} canManage={canManage} />
        </TabsContent>
        <TabsContent value="attendance" className="pt-4">
          <AttendanceTab event={event} canManage={canManage} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendar section
// ---------------------------------------------------------------------------
function CreateCalendarEntryDialog() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: provinces = [] } = useListProvinces();
  const createMut = useCreateCalendarEntry();
  const isSuperadmin = user?.role === "superadmin";

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("milestone");
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [provinceId, setProvinceId] = useState<string>(GLOBAL);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setType("milestone");
      setDate("");
      setEndDate("");
      setProvinceId(GLOBAL);
      setDescription("");
      setError(null);
    }
  }, [open]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim() || !date) {
      setError("Título y fecha son obligatorios.");
      return;
    }
    try {
      await createMut.mutateAsync({
        data: {
          title: title.trim(),
          type,
          date,
          endDate: endDate || null,
          provinceId: isSuperadmin
            ? provinceId === GLOBAL
              ? null
              : Number(provinceId)
            : null,
          description: description.trim() || null,
        },
      });
      await qc.invalidateQueries({ queryKey: getListCalendarEventsQueryKey() });
      toast({ title: "Hito añadido al calendario" });
      setOpen(false);
    } catch {
      setError("No se pudo crear la entrada.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Plus className="w-4 h-4" /> Hito
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo hito de calendario</DialogTitle>
          <DialogDescription>
            Plazos de programaciones, ventanas FCT, hitos provinciales...
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="c-title">Título *</Label>
            <Input
              id="c-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(CALENDAR_TYPE_LABELS)
                    .filter((t) => t !== "event")
                    .map((t) => (
                      <SelectItem key={t} value={t}>
                        {CALENDAR_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            {isSuperadmin && (
              <div className="space-y-2">
                <Label>Provincia</Label>
                <Select value={provinceId} onValueChange={setProvinceId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={GLOBAL}>Todas (global)</SelectItem>
                    {provinces.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="c-date">Fecha *</Label>
              <Input
                id="c-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-end">Fecha fin</Label>
              <Input
                id="c-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-desc">Descripción</Label>
            <Textarea
              id="c-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? "Guardando..." : "Añadir"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CalendarSection({ canManage }: { canManage: boolean }) {
  const { data: entries = [] } = useListCalendarEvents();

  const sorted = useMemo(
    () =>
      [...entries].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      ),
    [entries],
  );

  const exportAll = () => {
    const esc = (s: string) =>
      s.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;");
    const vevents = sorted.map((e) => {
      const start = toIcsStamp(e.date);
      const end = e.endDate ? toIcsStamp(e.endDate) : start;
      return [
        "BEGIN:VEVENT",
        `UID:calendar-${e.id}@coordinaadg`,
        `DTSTAMP:${toIcsStamp(new Date().toISOString())}`,
        `DTSTART:${start}`,
        `DTEND:${end}`,
        `SUMMARY:${esc(e.title)}`,
        e.description ? `DESCRIPTION:${esc(e.description)}` : "",
        "END:VEVENT",
      ]
        .filter(Boolean)
        .join("\r\n");
    });
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Coordina ADG//Calendario//ES",
      ...vevents,
      "END:VCALENDAR",
    ].join("\r\n");
    downloadIcs("calendario-coordina-adg.ics", ics);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Calendario provincial</h2>
          <p className="text-sm text-muted-foreground">
            Eventos, plazos y ventanas FCT en un único calendario sincronizable.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={exportAll}
            disabled={sorted.length === 0}
          >
            <Download className="w-4 h-4" /> Exportar .ics
          </Button>
          {canManage && <CreateCalendarEntryDialog />}
        </div>
      </div>

      {sorted.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No hay entradas en el calendario todavía.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {sorted.map((e: CalendarEntry) => (
            <div
              key={e.id}
              className="flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0">
                <div className="font-medium truncate flex items-center gap-2">
                  {e.title}
                  {e.type && (
                    <Badge variant="secondary" className="text-xs">
                      {CALENDAR_TYPE_LABELS[e.type] ?? e.type}
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDay(e.date)}
                  {e.endDate ? ` → ${formatDay(e.endDate)}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" className="gap-1" asChild>
                  <a
                    href={googleCalendarUrl({
                      title: e.title,
                      description: e.description,
                      start: new Date(e.date).toISOString(),
                      end: e.endDate
                        ? new Date(e.endDate).toISOString()
                        : new Date(e.date).toISOString(),
                    })}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Google
                  </a>
                </Button>
                <Button variant="ghost" size="sm" className="gap-1" asChild>
                  <a
                    href={outlookCalendarUrl({
                      title: e.title,
                      description: e.description,
                      start: new Date(e.date).toISOString(),
                      end: e.endDate
                        ? new Date(e.endDate).toISOString()
                        : new Date(e.date).toISOString(),
                    })}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Outlook
                  </a>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Events calendar (date grid) view
// ---------------------------------------------------------------------------
function startOfDay(value: Date): Date {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayKey(value: Date): string {
  const d = startOfDay(value);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function EventsCalendarView({
  events,
  onSelect,
}: {
  events: Event[];
  onSelect: (id: number) => void;
}) {
  const eventsByDay = useMemo(() => {
    const map = new Map<string, Event[]>();
    for (const e of events) {
      if (!e.startAt) continue;
      const key = dayKey(new Date(e.startAt));
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return map;
  }, [events]);

  const eventDays = useMemo(
    () =>
      Array.from(eventsByDay.values())
        .map((arr) => arr[0].startAt)
        .filter((v): v is string => Boolean(v))
        .map((v) => startOfDay(new Date(v))),
    [eventsByDay],
  );

  const [selectedDay, setSelectedDay] = useState<Date | undefined>(
    () => eventDays[0] ?? new Date(),
  );

  const dayEvents = selectedDay
    ? (eventsByDay.get(dayKey(selectedDay)) ?? [])
    : [];

  return (
    <div className="grid gap-6 md:grid-cols-[auto_1fr]">
      <Card>
        <CardContent className="p-3 flex justify-center">
          <Calendar
            mode="single"
            locale={es}
            selected={selectedDay}
            onSelect={setSelectedDay}
            defaultMonth={selectedDay}
            modifiers={{ hasEvents: eventDays }}
            modifiersClassNames={{
              hasEvents:
                "font-semibold text-primary after:absolute after:bottom-1 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-primary",
            }}
          />
        </CardContent>
      </Card>
      <div className="space-y-2">
        <h3 className="font-semibold">
          {selectedDay ? formatDay(selectedDay.toISOString()) : "Selecciona un día"}
        </h3>
        {dayEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6">
            No hay eventos este día.
          </p>
        ) : (
          <div className="space-y-2">
            {dayEvents.map((e: Event) => (
              <Card
                key={e.id}
                className="cursor-pointer transition-colors hover:border-primary"
                onClick={() => onSelect(e.id)}
              >
                <CardContent className="p-3 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-medium leading-tight">{e.name}</h4>
                    <Badge variant="outline" className="shrink-0">
                      {EVENT_TYPE_LABELS[e.type]}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <CalendarDays className="w-3.5 h-3.5" />
                    {formatDate(e.startAt)}
                  </div>
                  {e.location && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" /> {e.location}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function EventosPage() {
  const { user } = useAuth();
  const { professionalFamily } = useBranding();
  const { data: events = [], isLoading } = useListEvents();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [view, setView] = useState<"cards" | "calendar">("cards");
  const canManage = canManageEvents(user?.role);

  if (selectedId != null) {
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto">
        <EventDetailView eventId={selectedId} onBack={() => setSelectedId(null)} />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarDays className="w-6 h-6" /> Eventos y Protocolo
          </h1>
          <p className="text-sm text-muted-foreground">
            Canarias Skills, jornadas y actos del profesorado de la familia {professionalFamily}.
          </p>
        </div>
        {canManage && <CreateEventDialog />}
      </div>

      <div className="inline-flex rounded-md border p-0.5 w-fit">
        <Button
          type="button"
          size="sm"
          variant={view === "cards" ? "default" : "ghost"}
          className="gap-2"
          onClick={() => setView("cards")}
        >
          <LayoutGrid className="w-4 h-4" /> Tarjetas
        </Button>
        <Button
          type="button"
          size="sm"
          variant={view === "calendar" ? "default" : "ghost"}
          className="gap-2"
          onClick={() => setView("calendar")}
        >
          <CalendarRange className="w-4 h-4" /> Calendario
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground py-12 text-center">
          Cargando eventos...
        </p>
      ) : events.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No hay eventos todavía.
            {canManage && " Crea el primero con el botón «Nuevo evento»."}
          </CardContent>
        </Card>
      ) : view === "calendar" ? (
        <EventsCalendarView events={events} onSelect={setSelectedId} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {events.map((e: Event) => (
            <Card
              key={e.id}
              className="cursor-pointer transition-colors hover:border-primary"
              onClick={() => setSelectedId(e.id)}
            >
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold leading-tight">{e.name}</h3>
                  <Badge variant="outline" className="shrink-0">
                    {EVENT_TYPE_LABELS[e.type]}
                  </Badge>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <CalendarDays className="w-3.5 h-3.5" />
                    {formatDate(e.startAt)}
                  </div>
                  {e.location && (
                    <div className="flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" /> {e.location}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CalendarSection canManage={canManage} />
    </div>
  );
}
