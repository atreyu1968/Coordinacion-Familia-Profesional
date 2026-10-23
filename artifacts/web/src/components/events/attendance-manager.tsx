import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetEventAttendanceSettings,
  useUpdateEventAttendanceSettings,
  useListEventAttendance,
  useUpdateEventAttendance,
  useGenerateEventAttendanceCertificate,
  useRevokeEventAttendanceCertificate,
  usePreviewEventAttendanceCertificate,
  usePreviewEventAttendanceCsv,
  useImportEventAttendanceCsv,
  useGenerateEventAttendanceZip,
  downloadEventAttendanceCertificate,
  getGetEventAttendanceSettingsQueryKey,
  getListEventAttendanceQueryKey,
  type EventAttendance,
  type EventAttendanceSettingsInput,
  type EventAttendanceSettingsInputModality,
  type AttendanceCsvPreview,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { PdfPreviewDialog } from "@/components/pdf-preview-dialog";
import {
  Award,
  Copy,
  Download,
  FileArchive,
  FileText,
  FileUp,
  QrCode,
  Check,
  X,
  Ban,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  apiErrorMessage,
  downloadBase64File,
  formatLongDate,
  MODALITY_LABELS,
} from "./certificate-utils";

const PAGE_SIZE = 25;
const CSV_MAX_BYTES = 250 * 1024;
const ZIP_MAX = 500;

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Asistencia validada",
  rejected: "Rechazada",
};

function fail(title: string, err: unknown, fallback: string) {
  toast({ title, description: apiErrorMessage(err, fallback), variant: "destructive" });
}

// ---------------------------------------------------------------------------
// Settings + QR
// ---------------------------------------------------------------------------
function SettingsCard({ eventId }: { eventId: number }) {
  const qc = useQueryClient();
  const settingsQ = useGetEventAttendanceSettings(eventId, {
    query: { queryKey: getGetEventAttendanceSettingsQueryKey(eventId), retry: false },
  });
  const saveMut = useUpdateEventAttendanceSettings();
  const previewMut = usePreviewEventAttendanceCertificate();
  const initFor = useRef<number | null>(null);

  const [form, setForm] = useState<EventAttendanceSettingsInput>({
    signerName: "",
    signerRole: "",
    issuePlace: "",
    issueDate: null,
    modality: "presencial",
    durationMinutes: null,
    additionalText: "",
    registrationOpen: false,
  });
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    const s = settingsQ.data;
    if (s && (initFor.current !== eventId || !dirty.current)) {
      initFor.current = eventId;
      dirty.current = false;
      setForm({
        signerName: s.signerName ?? "",
        signerRole: s.signerRole ?? "",
        issuePlace: s.issuePlace ?? "",
        issueDate: s.issueDate ? s.issueDate.slice(0, 10) : null,
        modality: s.modality ?? "presencial",
        durationMinutes: s.durationMinutes ?? null,
        additionalText: s.additionalText ?? "",
        registrationOpen: Boolean(s.registrationOpen),
      });
    }
  }, [settingsQ.data, eventId]);

  const set = <K extends keyof EventAttendanceSettingsInput>(k: K, v: EventAttendanceSettingsInput[K]) => {
    dirty.current = true;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const validate = (): string | null => {
    if (form.signerName.trim().length < 2) return "Indica el nombre de quien firma.";
    if (form.signerRole.trim().length < 2) return "Indica el cargo de quien firma.";
    if (form.issuePlace.trim().length < 2) return "Indica el lugar de expedición.";
    if (!Object.hasOwn(MODALITY_LABELS, form.modality)) return "Selecciona la modalidad del evento.";
    if (form.durationMinutes != null && (form.durationMinutes < 1 || !Number.isInteger(form.durationMinutes)))
      return "La duración debe ser un número entero de minutos.";
    return null;
  };

  const payload = (): EventAttendanceSettingsInput => ({
    ...form,
    signerName: form.signerName.trim(),
    signerRole: form.signerRole.trim(),
    issuePlace: form.issuePlace.trim(),
    additionalText: form.additionalText.trim(),
    issueDate: form.issueDate || null,
  });

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    const v = validate();
    setError(v);
    if (v) return;
    try {
      const saved = await saveMut.mutateAsync({ id: eventId, data: payload() });
      dirty.current = false;
      qc.setQueryData(getGetEventAttendanceSettingsQueryKey(eventId), saved);
      toast({
        title: "Configuración guardada",
        description: saved.registrationOpen
          ? "El registro de asistencia está abierto."
          : "El registro de asistencia está cerrado.",
      });
    } catch (err) {
      setError(apiErrorMessage(err, "No se pudo guardar la configuración."));
    }
  };

  const onPreview = async () => {
    const v = validate();
    setError(v);
    if (v) return;
    try {
      const pdf = await previewMut.mutateAsync({ id: eventId, data: payload() });
      downloadBase64File(pdf);
      toast({ title: "Borrador descargado", description: "Es una vista previa sin validez." });
    } catch (err) {
      fail("No se pudo generar el borrador", err, "Revisa los datos e inténtalo de nuevo.");
    }
  };

  const s = settingsQ.data;
  const url = s?.registrationUrl ?? null;

  const copyLink = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Enlace copiado" });
    } catch {
      toast({ title: "No se pudo copiar", description: url, variant: "destructive" });
    }
  };

  const saveQr = () => {
    if (!s?.qrDataUrl) return;
    const a = document.createElement("a");
    a.href = s.qrDataUrl;
    a.download = `qr-asistencia-evento-${eventId}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (settingsQ.isLoading) return <Skeleton className="h-72 w-full" />;
  if (settingsQ.error)
    return (
      <Card>
        <CardContent className="p-4 space-y-2">
          <p className="text-sm text-destructive">
            {apiErrorMessage(settingsQ.error, "No se pudo cargar la configuración de certificados.")}
          </p>
          <Button size="sm" variant="outline" onClick={() => void settingsQ.refetch()}>
            Reintentar
          </Button>
        </CardContent>
      </Card>
    );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <Card>
        <CardContent className="p-5">
          <form onSubmit={onSave} className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold flex items-center gap-2">
                  <Award className="w-4 h-4 text-primary" /> Datos del certificado
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Aparecerán en cada PDF expedido para este evento.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm shrink-0">
                <Switch
                  checked={form.registrationOpen}
                  onCheckedChange={(v) => set("registrationOpen", v)}
                  data-testid="switch-registration-open"
                />
                Registro abierto
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="c-signer">Firma (nombre) *</Label>
                <Input id="c-signer" value={form.signerName} maxLength={200} onChange={(e) => set("signerName", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-role">Cargo *</Label>
                <Input id="c-role" value={form.signerRole} maxLength={300} onChange={(e) => set("signerRole", e.target.value)} placeholder="Coordinación provincial de la familia..." />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-place">Lugar de expedición *</Label>
                <Input id="c-place" value={form.issuePlace} maxLength={150} onChange={(e) => set("issuePlace", e.target.value)} placeholder="Las Palmas de Gran Canaria" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-date">Fecha de expedición</Label>
                <Input id="c-date" type="date" value={form.issueDate ?? ""} onChange={(e) => set("issueDate", e.target.value || null)} />
                <p className="text-[11px] text-muted-foreground">Vacía: se usa la fecha de generación.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-modality">Modalidad</Label>
                <select
                  id="c-modality"
                  className="border-input bg-background flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={form.modality}
                  onChange={(e) => set("modality", e.target.value as EventAttendanceSettingsInputModality)}
                >
                  {Object.entries(MODALITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-dur">Duración (minutos)</Label>
                <Input
                  id="c-dur"
                  type="number"
                  min={1}
                  value={form.durationMinutes ?? ""}
                  onChange={(e) => set("durationMinutes", e.target.value === "" ? null : Number(e.target.value))}
                  placeholder="Calculada por fechas si se deja vacía"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-text">Texto adicional</Label>
              <Textarea id="c-text" rows={2} maxLength={1000} value={form.additionalText} onChange={(e) => set("additionalText", e.target.value)} />
            </div>
            {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={saveMut.isPending}>
                {saveMut.isPending ? "Guardando..." : "Guardar configuración"}
              </Button>
              <Button type="button" variant="outline" className="gap-2" onClick={onPreview} disabled={previewMut.isPending}>
                <FileText className="w-4 h-4" />
                {previewMut.isPending ? "Generando..." : "Ver borrador PDF"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <div className="bg-sidebar text-sidebar-foreground px-4 py-3 flex items-center gap-2 text-sm font-semibold">
          <QrCode className="w-4 h-4" /> QR de registro
        </div>
        <CardContent className="p-4 space-y-3">
          {s?.qrDataUrl && url ? (
            <>
              <div className="rounded-lg border bg-card p-3 flex justify-center">
                <img src={s.qrDataUrl} alt="Código QR de registro de asistencia" className="w-48 h-48" />
              </div>
              <p className="text-[11px] break-all font-mono text-muted-foreground">{url}</p>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={copyLink}>
                  <Copy className="w-3.5 h-3.5" /> Copiar
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={saveQr}>
                  <Download className="w-3.5 h-3.5" /> Guardar QR
                </Button>
              </div>
              {!s.registrationOpen && (
                <p className="text-xs text-amber-700">El registro está cerrado: el QR no admitirá nuevas inscripciones.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Guarda la configuración para obtener el enlace y el QR que las personas asistentes escanearán durante el evento.
            </p>
          )}
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Registrarse con el QR deja la asistencia pendiente. La organización debe validarla antes de expedir el certificado.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attendee list
// ---------------------------------------------------------------------------
function AttendeeList({ eventId }: { eventId: number }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const params = { page, pageSize: PAGE_SIZE };
  const listQ = useListEventAttendance(eventId, params, {
    query: { queryKey: getListEventAttendanceQueryKey(eventId, params), retry: false },
  });
  const statusMut = useUpdateEventAttendance();
  const genMut = useGenerateEventAttendanceCertificate();
  const revokeMut = useRevokeEventAttendanceCertificate();
  const zipMut = useGenerateEventAttendanceZip();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [revoking, setRevoking] = useState<EventAttendance | null>(null);
  const [reason, setReason] = useState("");
  const [zipOpen, setZipOpen] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: getListEventAttendanceQueryKey(eventId) });

  const onStatus = async (a: EventAttendance, status: "confirmed" | "rejected" | "pending") => {
    setBusyId(a.id);
    try {
      await statusMut.mutateAsync({ id: eventId, attendanceId: a.id, data: { status } });
      await refresh();
      toast({ title: STATUS_LABEL[status], description: a.fullName });
    } catch (err) {
      fail("No se pudo actualizar", err, "Inténtalo de nuevo.");
    } finally {
      setBusyId(null);
    }
  };

  const onGenerate = async (a: EventAttendance) => {
    setBusyId(a.id);
    try {
      const pdf = await genMut.mutateAsync({ id: eventId, attendanceId: a.id });
      downloadBase64File(pdf);
      await refresh();
      toast({ title: "Certificado expedido", description: a.fullName });
    } catch (err) {
      fail("No se pudo generar el certificado", err, "Comprueba que la asistencia está validada y la configuración completa.");
    } finally {
      setBusyId(null);
    }
  };

  const onDownload = async (a: EventAttendance) => {
    if (!a.certificateId) return;
    setBusyId(a.id);
    try {
      downloadBase64File(await downloadEventAttendanceCertificate(eventId, a.certificateId));
    } catch (err) {
      fail("No se pudo descargar", err, "Inténtalo de nuevo.");
    } finally {
      setBusyId(null);
    }
  };

  const onRevoke = async () => {
    if (!revoking?.certificateId) return;
    if (reason.trim().length < 3) {
      toast({ title: "Indica el motivo", description: "Mínimo 3 caracteres.", variant: "destructive" });
      return;
    }
    try {
      await revokeMut.mutateAsync({ id: eventId, certificateId: revoking.certificateId, data: { reason: reason.trim() } });
      await refresh();
      toast({ title: "Certificado revocado", description: `${revoking.fullName}. La verificación pública lo mostrará como revocado.` });
      setRevoking(null);
      setReason("");
    } catch (err) {
      fail("No se pudo revocar", err, "Inténtalo de nuevo.");
    }
  };

  const onZip = async () => {
    try {
      const zip = await zipMut.mutateAsync({ id: eventId });
      downloadBase64File(zip, "application/zip");
      await refresh();
      toast({ title: "ZIP generado", description: zip.filename });
      setZipOpen(false);
    } catch (err) {
      fail("No se pudo generar el ZIP", err, "Inténtalo de nuevo.");
    }
  };

  const data = listQ.data;
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">Registro de asistencia</h3>
            <p className="text-xs text-muted-foreground">Lista privada. Solo la organización del evento puede verla.</p>
          </div>
          <Button size="sm" variant="secondary" className="gap-2" onClick={() => setZipOpen(true)} disabled={total === 0}>
            <FileArchive className="w-4 h-4" /> ZIP de certificados
          </Button>
        </div>

        {listQ.isLoading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : listQ.error ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">{apiErrorMessage(listQ.error, "No se pudo cargar el registro.")}</p>
            <Button size="sm" variant="outline" onClick={() => void listQ.refetch()}>Reintentar</Button>
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="rounded-lg border border-dashed py-10 text-center">
            <QrCode className="w-8 h-8 mx-auto text-muted-foreground/60" />
            <p className="mt-2 text-sm font-medium">Nadie se ha registrado todavía</p>
            <p className="text-xs text-muted-foreground">Proyecta el QR durante el evento o importa un CSV.</p>
          </div>
        ) : (
          <div className="divide-y rounded-lg border">
            {data.items.map((a) => {
              const busy = busyId === a.id;
              return (
                <div key={a.id} className="p-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between" data-testid={`row-attendance-${a.id}`}>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{a.fullName}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {a.email} · registro {formatLongDate(a.registeredAt)}
                      {a.certificateCode && <span className="font-mono"> · {a.certificateCode}</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <Badge
                      variant={a.status === "confirmed" ? "default" : a.status === "rejected" ? "destructive" : "secondary"}
                    >
                      {STATUS_LABEL[a.status]}
                    </Badge>
                    {a.status !== "confirmed" && (
                      <Button size="sm" variant="outline" className="h-8 gap-1" disabled={busy} onClick={() => onStatus(a, "confirmed")}>
                        <Check className="w-3.5 h-3.5" /> Validar
                      </Button>
                    )}
                    {a.status !== "rejected" && !a.certificateId && (
                      <Button size="sm" variant="ghost" className="h-8 gap-1" disabled={busy} onClick={() => onStatus(a, "rejected")}>
                        <X className="w-3.5 h-3.5" /> Rechazar
                      </Button>
                    )}
                    {a.status === "confirmed" && !a.certificateId && (
                      <Button size="sm" className="h-8 gap-1" disabled={busy} onClick={() => onGenerate(a)}>
                        <Award className="w-3.5 h-3.5" /> Generar
                      </Button>
                    )}
                    {a.certificateId && (
                      <>
                        <PdfPreviewDialog
                          title={`Certificado · ${a.fullName}`}
                          disabled={busy}
                          loadPdf={async () => {
                            const pdf = await downloadEventAttendanceCertificate(eventId, a.certificateId!);
                            const binary = atob(pdf.contentBase64);
                            const bytes = new Uint8Array(binary.length);
                            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                            return new Blob([bytes], { type: "application/pdf" });
                          }}
                        />
                        <Button size="sm" variant="outline" className="h-8 gap-1" disabled={busy} onClick={() => onDownload(a)}>
                          <Download className="w-3.5 h-3.5" /> PDF
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 gap-1 text-destructive" disabled={busy} onClick={() => { setRevoking(a); setReason(""); }}>
                          <Ban className="w-3.5 h-3.5" /> Revocar
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-end gap-2 text-sm">
            <span className="text-muted-foreground">Página {page} de {pages} · {total} personas</span>
            <Button size="icon" variant="outline" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Página anterior">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button size="icon" variant="outline" className="h-8 w-8" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Página siguiente">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={Boolean(revoking)} onOpenChange={(o) => !o && setRevoking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revocar certificado</DialogTitle>
            <DialogDescription>
              {revoking?.fullName}. El documento dejará de ser válido y la verificación pública lo indicará. Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="revoke-reason">Motivo *</Label>
            <Textarea id="revoke-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoking(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={onRevoke} disabled={revokeMut.isPending}>
              {revokeMut.isPending ? "Revocando..." : "Revocar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={zipOpen} onOpenChange={setZipOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Descargar certificados en ZIP</DialogTitle>
            <DialogDescription>
              Incluye un PDF por cada asistencia validada (máximo {ZIP_MAX} personas). Se expedirán los certificados que aún no existan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setZipOpen(false)}>Cancelar</Button>
            <Button onClick={onZip} disabled={zipMut.isPending}>
              {zipMut.isPending ? "Generando..." : "Generar ZIP"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------
function CsvImport({ eventId }: { eventId: number }) {
  const qc = useQueryClient();
  const previewMut = usePreviewEventAttendanceCsv();
  const importMut = useImportEventAttendanceCsv();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<AttendanceCsvPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastImport, setLastImport] = useState<{ imported: number; duplicates: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setCsv(null);
    setFileName("");
    setPreview(null);
    setConfirmed(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const downloadTemplate = () => {
    const blob = new Blob(["nombre,email\nNombre Apellido Apellido,persona@centro.es\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla-asistencia.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setLastImport(null);
    setPreview(null);
    setConfirmed(false);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > CSV_MAX_BYTES) {
      setError("El archivo supera 250 KB. Divídelo en varios.");
      reset();
      return;
    }
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    try {
      setPreview(await previewMut.mutateAsync({ id: eventId, data: { csv: text } }));
    } catch (err) {
      setError(apiErrorMessage(err, "No se pudo analizar el CSV."));
    }
  };

  const onImport = async () => {
    if (!csv || !confirmed) return;
    try {
      const res = await importMut.mutateAsync({ id: eventId, data: { csv, confirmAttendance: true } });
      await qc.invalidateQueries({ queryKey: getListEventAttendanceQueryKey(eventId) });
      toast({
        title: `${res.imported} asistencias importadas`,
        description: "Sin envíos automáticos. Quien no tenga cuenta necesita una invitación con ese mismo email.",
      });
      setLastImport(res);
      reset();
    } catch (err) {
      setError(apiErrorMessage(err, "No se pudo importar el CSV."));
    }
  };

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold flex items-center gap-2"><FileUp className="w-4 h-4 text-primary" /> Importar asistentes (CSV)</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">
              Columnas <span className="font-mono">nombre,email</span>, máximo 250 KB. Cada persona deberá iniciar sesión con ese mismo email y verificarlo para descargar su certificado.
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={downloadTemplate}>Descargar plantilla</Button>
        </div>
        <Input ref={inputRef} type="file" accept=".csv,text/csv" onChange={onFile} data-testid="input-csv" />
        {lastImport && (
          <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 space-y-1">
            <p className="font-semibold">
              {lastImport.imported} asistencias importadas y validadas
              {lastImport.duplicates ? ` · ${lastImport.duplicates} duplicadas omitidas` : ""}.
            </p>
            <p>
              No se ha enviado ningún PDF ni se ha creado ninguna cuenta. Cada persona emitirá y descargará su certificado desde
              {" "}<strong>Mis certificados</strong> cuando el evento haya terminado, tras iniciar sesión con exactamente el email importado y verificarlo con un código.
            </p>
            <p>
              Quien aún no tenga cuenta necesita una invitación (sección <strong>Invitaciones</strong>) para registrarse con ese mismo email.
            </p>
          </div>
        )}
        {previewMut.isPending && <Skeleton className="h-24 w-full" />}
        {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
        {preview && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="font-medium">{fileName}</span>
              <Badge>{preview.ready} listas</Badge>
              <Badge variant="secondary">{preview.duplicates} duplicadas</Badge>
              <Badge variant={preview.errors ? "destructive" : "outline"}>{preview.errors} con errores</Badge>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border text-sm">
              <table className="w-full">
                <thead className="bg-muted text-xs text-muted-foreground sticky top-0">
                  <tr><th className="p-2 text-left">Línea</th><th className="p-2 text-left">Nombre</th><th className="p-2 text-left">Email</th><th className="p-2 text-left">Estado</th></tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.line} className="border-t">
                      <td className="p-2 font-mono text-xs">{r.line}</td>
                      <td className="p-2">{r.fullName}</td>
                      <td className="p-2 text-xs">{r.email}</td>
                      <td className={`p-2 text-xs ${r.status === "error" ? "text-destructive" : r.status === "duplicate" ? "text-amber-700" : "text-emerald-700"}`}>
                        {r.status === "ready" ? "Lista" : r.status === "duplicate" ? "Duplicada" : "Error"}
                        {r.message ? ` · ${r.message}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.ready > 0 ? (
              <>
                <label className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                  <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" data-testid="checkbox-confirm-attendance" />
                  <span>
                    Confirmo como organizador/a que las {preview.ready} personas listadas <strong>asistieron realmente</strong> al evento. Su asistencia quedará validada.
                  </span>
                </label>
                <div className="flex gap-2">
                  <Button onClick={onImport} disabled={!confirmed || importMut.isPending}>
                    {importMut.isPending ? "Importando..." : `Importar ${preview.ready} asistencias`}
                  </Button>
                  <Button variant="outline" onClick={reset}>Descartar</Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No hay filas importables. Corrige el archivo y vuelve a cargarlo.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AttendanceManager({ eventId }: { eventId: number }) {
  return (
    <div className="space-y-4">
      <SettingsCard eventId={eventId} />
      <AttendeeList eventId={eventId} />
      <CsvImport eventId={eventId} />
    </div>
  );
}
