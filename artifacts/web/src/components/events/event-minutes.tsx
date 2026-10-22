import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetEventMinutes,
  useSaveEventMinutes,
  useAddEventMinutesSource,
  useDeleteEventMinutesSource,
  useRetryEventMinutesSource,
  useGenerateEventMinutes,
  usePublishEventMinutes,
  useRequestUploadUrl,
  getGetEventMinutesQueryKey,
  type EventMinutes,
  type MinutesSource,
  type MinutesSourceInputPurpose,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  BookOpenCheck,
  Copy,
  FileText,
  Lock,
  Mic,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Undo2,
  X,
} from "lucide-react";
import { apiErrorMessage, apiErrorStatus } from "./certificate-utils";

const MAX_SOURCES = 20;
const MAX_BYTES = 100 * 1024 * 1024;
const MAX_REC_SECONDS = 120;
const ACCEPT_EXT = [
  ".txt", ".md", ".csv", ".docx", ".pptx", ".xlsx", ".pdf", ".jpg", ".jpeg", ".png", ".webp",
  ".mp3", ".wav", ".m4a", ".ogg", ".webm", ".mp4", ".mov", ".mkv",
];
const MIME_FALLBACK: Record<string, string> = {
  ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
  ".ogg": "audio/ogg", ".webm": "video/webm", ".mp4": "video/mp4", ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
};
const REC_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

const STATUS_LABEL: Record<string, string> = {
  queued: "En cola",
  processing: "Procesando",
  ready: "Lista",
  error: "Error",
};

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(v?: string | null): string {
  if (!v) return "";
  return new Date(v).toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" });
}

function isBusy(m?: EventMinutes): boolean {
  if (!m) return false;
  return (
    m.generationStatus === "queued" ||
    m.generationStatus === "processing" ||
    m.sources.some((s) => s.status === "queued" || s.status === "processing")
  );
}

export function minutesLink(eventId: number): string {
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  return `${window.location.origin}${base}/eventos?evento=${eventId}&seccion=acta`;
}

// ---------------------------------------------------------------------------
// Plain text / markdown-safe renderer. Builds React text nodes only; never HTML.
// ---------------------------------------------------------------------------
function inline(text: string, key: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") && p.length > 4 ? (
      <strong key={`${key}-${i}`}>{p.slice(2, -2)}</strong>
    ) : (
      <span key={`${key}-${i}`}>{p}</span>
    ),
  );
}

export function SafeMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = (k: number) => {
    if (list.length) {
      out.push(
        <ul key={`ul-${k}`} className="list-disc pl-6 space-y-1 my-2">
          {list.map((l, i) => <li key={i}>{inline(l, `li-${k}-${i}`)}</li>)}
        </ul>,
      );
      list = [];
    }
  };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (bullet) {
      list.push(bullet[1]);
      return;
    }
    flush(i);
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      out.push(
        <p
          key={i}
          className={
            lvl === 1
              ? "font-serif text-xl font-semibold mt-5 mb-2 tracking-tight"
              : lvl === 2
                ? "font-semibold text-base mt-4 mb-1.5"
                : "font-semibold text-sm uppercase tracking-wider text-muted-foreground mt-3 mb-1"
          }
        >
          {h[2]}
        </p>,
      );
    } else if (!line.trim()) {
      out.push(<div key={i} className="h-2" />);
    } else {
      out.push(<p key={i} className="leading-relaxed">{inline(line, `p-${i}`)}</p>);
    }
  });
  flush(lines.length);
  return <div className="text-sm text-foreground break-words">{out}</div>;
}

// ---------------------------------------------------------------------------
// Published (reader) view
// ---------------------------------------------------------------------------
function PublishedActa({ minutes, eventId }: { minutes: EventMinutes; eventId: number }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(minutesLink(eventId));
      toast({ title: "Enlace copiado", description: "Solo lo abrirán personas con acceso al evento." });
    } catch {
      toast({ title: "No se pudo copiar", description: minutesLink(eventId), variant: "destructive" });
    }
  };
  return (
    <article
      id="acta"
      className="relative rounded-xl border bg-card shadow-sm overflow-hidden"
      data-testid="section-published-minutes"
    >
      <div className="h-1 bg-primary" />
      <header className="flex flex-wrap items-start justify-between gap-3 px-6 pt-5 pb-3 border-b border-dashed">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Acta final</p>
          <p className="text-xs text-muted-foreground mt-1">
            Publicada el {formatDateTime(minutes.publishedAt)}
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={copy} data-testid="button-copy-minutes-link">
          <Copy className="w-3.5 h-3.5" /> Copiar enlace
        </Button>
      </header>
      <div className="px-6 py-5">
        <SafeMarkdown text={minutes.publishedText ?? ""} />
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Microphone recorder
// ---------------------------------------------------------------------------
function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return REC_MIME_CANDIDATES.find((m) => {
    try {
      return MediaRecorder.isTypeSupported(m);
    } catch {
      return false;
    }
  });
}

function Recorder({
  disabled,
  onRecorded,
}: {
  disabled: boolean;
  onRecorded: (file: File) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const chunks = useRef<Blob[]>([]);
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;
  const alive = useRef(true);
  const requesting = useRef(false);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const release = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  useEffect(
    () => {
      alive.current = true;
      return () => {
      alive.current = false;
      const r = recRef.current;
      if (r && r.state !== "inactive") {
        r.ondataavailable = null;
        r.onstop = null;
        r.stop();
      }
      release();
      };
    },
    [],
  );

  const stop = () => {
    const r = recRef.current;
    if (r && r.state !== "inactive") r.stop();
    else release();
    setRecording(false);
  };

  const start = async () => {
    if (requesting.current || disabledRef.current) return;
    setError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Este navegador no permite grabar audio. Sube un archivo de audio en su lugar.");
      return;
    }
    requesting.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current || disabledRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mime = pickMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        const type = (rec.mimeType || mime || "audio/webm").split(";")[0];
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const blob = new Blob(chunks.current, { type });
        release();
        if (blob.size > 0) {
          const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
          onRecordedRef.current(new File([blob], `instrucciones-${stamp}.${ext}`, { type }));
        }
      };
      recRef.current = rec;
      rec.start(1000);
      setSeconds(0);
      setRecording(true);
      timerRef.current = window.setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_REC_SECONDS) {
            if (rec.state !== "inactive") rec.stop();
            setRecording(false);
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      release();
      if (alive.current) setError("No se pudo acceder al micrófono. Revisa los permisos del navegador.");
    } finally {
      requesting.current = false;
    }
  };

  const mm = String(Math.floor(seconds / 60)).padStart(1, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className="space-y-1.5">
      {recording ? (
        <Button type="button" variant="destructive" size="sm" className="gap-2" onClick={stop} data-testid="button-stop-recording">
          <Square className="w-3.5 h-3.5 fill-current" />
          Detener · {mm}:{ss} / 2:00
        </Button>
      ) : (
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => void start()} disabled={disabled} data-testid="button-start-recording">
          <Mic className="w-3.5 h-3.5" /> Dictar instrucciones
        </Button>
      )}
      {recording && (
        <p role="status" className="text-xs text-destructive flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-destructive animate-pulse" /> Grabando. Máximo 2 minutos.
        </p>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coordinator workspace
// ---------------------------------------------------------------------------
type Upload = { id: string; name: string; abort: AbortController };

function Banner({ tone, children }: { tone: "warn" | "info" | "error"; children: ReactNode }) {
  const cls =
    tone === "error"
      ? "border-destructive/40 bg-destructive/5 text-destructive"
      : tone === "warn"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : "border-primary/25 bg-primary/5 text-foreground";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${cls}`}>
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

function Workspace({ eventId, minutes }: { eventId: number; minutes: EventMinutes }) {
  const qc = useQueryClient();
  const key = getGetEventMinutesQueryKey(eventId);
  const saveMut = useSaveEventMinutes();
  const addMut = useAddEventMinutesSource();
  const delMut = useDeleteEventMinutesSource();
  const retryMut = useRetryEventMinutesSource();
  const genMut = useGenerateEventMinutes();
  const pubMut = usePublishEventMinutes();
  const uploadUrlMut = useRequestUploadUrl();

  const [draft, setDraft] = useState(minutes.draftText ?? "");
  const [baseline, setBaseline] = useState(minutes.draftText ?? "");
  const [baseRevision, setBaseRevision] = useState(minutes.revision);
  const [conflict, setConflict] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [consent, setConsent] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [purpose, setPurpose] = useState<MinutesSourceInputPurpose>("evidence");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [openSource, setOpenSource] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingInstr = useRef<Set<number>>(new Set());
  const usedInstr = useRef<Set<number>>(new Set());

  const dirty = draft !== baseline;
  const serverDraft = minutes.draftText ?? "";

  // Sync from server only when the user has no unsaved edits.
  useEffect(() => {
    if (minutes.revision === baseRevision && serverDraft === baseline) return;
    if (!dirty) {
      setDraft(serverDraft);
      setBaseline(serverDraft);
      setBaseRevision(minutes.revision);
      setConflict(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minutes.revision, serverDraft]);

  const serverChangedUnderUs = dirty && minutes.revision !== baseRevision;

  // When a dictated instruction finishes processing, drop its transcript into
  // the instructions box for the coordinator to edit and send.
  useEffect(() => {
    for (const s of minutes.sources) {
      if (s.purpose !== "instruction" || !pendingInstr.current.has(s.id)) continue;
      if (s.status === "ready" && !usedInstr.current.has(s.id)) {
        usedInstr.current.add(s.id);
        pendingInstr.current.delete(s.id);
        const t = s.extractedText.trim();
        if (t) {
          setInstructions((cur) => (cur.trim() ? `${cur.trim()}\n\n${t}` : t));
          toast({ title: "Transcripción lista", description: "Revisa las instrucciones antes de enviarlas." });
        }
      } else if (s.status === "error") {
        pendingInstr.current.delete(s.id);
      }
    }
  }, [minutes.sources]);

  const put = (m: EventMinutes) => qc.setQueryData(key, m);

  // A 409 can mean busy/disabled as well as a stale revision. Only flag a
  // revision conflict when a fresh fetch shows the revision actually moved.
  const handleErr = async (err: unknown, fallback: string, sentRevision?: number) => {
    const message = apiErrorMessage(err, fallback);
    if (apiErrorStatus(err) === 409) {
      let fresh: EventMinutes | undefined;
      try {
        await qc.refetchQueries({ queryKey: key, exact: true });
        fresh = qc.getQueryData<EventMinutes>(key);
      } catch {
        fresh = undefined;
      }
      if (sentRevision != null && fresh && fresh.revision !== sentRevision) {
        setConflict(true);
        toast({
          title: "El acta ha cambiado",
          description: "Otra sesión guardó cambios. Tus ediciones se conservan en pantalla.",
          variant: "destructive",
        });
        return;
      }
    }
    toast({ title: "No se pudo completar", description: message, variant: "destructive" });
  };

  const onToggle = async (enabled: boolean) => {
    try {
      put(await saveMut.mutateAsync({ id: eventId, data: { revision: minutes.revision, enabled } }));
      toast({
        title: enabled ? "Acta activada" : "Acta desactivada",
        description: enabled ? undefined : "El contenido privado se conserva y la versión publicada deja de mostrarse.",
      });
    } catch (err) {
      void handleErr(err, "No se pudo cambiar el estado del acta.", minutes.revision);
    }
  };

  const onSave = async (overwrite = false) => {
    const revision = overwrite ? minutes.revision : baseRevision;
    try {
      const saved = await saveMut.mutateAsync({ id: eventId, data: { revision, draftText: draft } });
      setBaseline(saved.draftText ?? "");
      setDraft(saved.draftText ?? "");
      setBaseRevision(saved.revision);
      setConflict(false);
      setReviewed(false);
      put(saved);
      toast({ title: "Borrador guardado", description: "La versión publicada no cambia hasta que la vuelvas a publicar." });
    } catch (err) {
      void handleErr(err, "No se pudo guardar el borrador.", revision);
    }
  };

  const discardMine = () => {
    setDraft(serverDraft);
    setBaseline(serverDraft);
    setBaseRevision(minutes.revision);
    setConflict(false);
  };

  const onPublish = async (publish: boolean) => {
    try {
      put(await pubMut.mutateAsync({ id: eventId, data: { revision: minutes.revision, publish, reviewed: publish ? reviewed : false } }));
      setReviewed(false);
      toast({ title: publish ? "Acta publicada" : "Publicación retirada" });
    } catch (err) {
      void handleErr(err, publish ? "No se pudo publicar." : "No se pudo retirar la publicación.", minutes.revision);
    }
  };

  const onGenerate = async () => {
    try {
      put(await genMut.mutateAsync({ id: eventId, data: { revision: minutes.revision, instructions: instructions.trim(), consent: true } }));
      setInstructions("");
      toast({ title: "Generación en marcha", description: "Se actualizará el borrador al terminar. No se publica nada automáticamente." });
    } catch (err) {
      void handleErr(err, "No se pudo iniciar la generación.", minutes.revision);
    }
  };

  const uploadFile = async (file: File, p: MinutesSourceInputPurpose) => {
    const ext = extOf(file.name);
    if (!ACCEPT_EXT.includes(ext)) {
      toast({ title: "Formato no admitido", description: file.name, variant: "destructive" });
      return;
    }
    if (file.size <= 0 || file.size > MAX_BYTES) {
      toast({ title: "Archivo demasiado grande", description: `${file.name}: máximo 100 MB.`, variant: "destructive" });
      return;
    }
    const contentType = file.type || MIME_FALLBACK[ext] || "application/octet-stream";
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const abort = new AbortController();
    setUploads((u) => [...u, { id, name: file.name, abort }]);
    try {
      const { uploadURL, objectPath } = await uploadUrlMut.mutateAsync({
        data: { name: file.name, size: file.size, contentType },
      });
      const res = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": contentType },
        signal: abort.signal,
      });
      if (!res.ok) throw new Error("upload");
      const updated = await addMut.mutateAsync({
        id: eventId,
        data: { objectPath, fileName: file.name.slice(0, 200), contentType, size: file.size, purpose: p, consent: true },
      });
      if (p === "instruction") pendingInstr.current.add(updated.id);
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      if (abort.signal.aborted) {
        toast({ title: "Subida cancelada", description: file.name });
      } else {
        toast({
          title: "No se pudo subir",
          description: `${file.name}: ${apiErrorMessage(err, "error de red o almacenamiento.")}`,
          variant: "destructive",
        });
      }
    } finally {
      setUploads((u) => u.filter((x) => x.id !== id));
    }
  };

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    const room = MAX_SOURCES - minutes.sources.length - uploads.length;
    if (files.length > room) {
      toast({ title: "Límite de fuentes", description: `Puedes añadir ${Math.max(0, room)} más (máximo ${MAX_SOURCES}).`, variant: "destructive" });
    }
    for (const f of files.slice(0, Math.max(0, room))) await uploadFile(f, purpose);
  };

  const onDelete = async (s: MinutesSource) => {
    if (!window.confirm(`¿Eliminar la fuente «${s.fileName}»? Se borrarán el archivo y su texto procesado. No se modificarán las actas ya generadas o publicadas.`)) return;
    try {
      await delMut.mutateAsync({ id: eventId, sourceId: s.id });
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      void handleErr(err, "No se pudo eliminar la fuente.");
    }
  };

  const onRetry = async (s: MinutesSource) => {
    try {
      await retryMut.mutateAsync({ id: eventId, sourceId: s.id });
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      void handleErr(err, "No se pudo reintentar.");
    }
  };

  const generating = minutes.generationStatus === "queued" || minutes.generationStatus === "processing";
  const sourcesBusy = minutes.sources.some((s) => s.status === "queued" || s.status === "processing");
  const canUpload = consent && minutes.processingAvailable && minutes.sources.length + uploads.length < MAX_SOURCES;
  const publishedDiffers = minutes.publishedText != null && minutes.publishedText !== serverDraft;

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <CardContent className="p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary"><BookOpenCheck className="w-5 h-5" /></div>
            <div>
              <h3 className="font-semibold">Acta de la reunión</h3>
              <p className="text-xs text-muted-foreground max-w-md">
                Espacio privado de coordinación. Solo el acta final publicada es visible para quienes pueden ver este evento.
              </p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <Switch
              checked={minutes.enabled}
              onCheckedChange={(v) => void onToggle(v)}
              disabled={saveMut.isPending}
              data-testid="switch-minutes-enabled"
            />
            {minutes.enabled ? "Activada" : "Desactivada"}
          </label>
        </CardContent>
      </Card>

      {!minutes.enabled ? (
        <div className="rounded-xl border border-dashed py-12 text-center px-6">
          <Lock className="w-8 h-8 mx-auto text-muted-foreground/60" />
          <p className="mt-3 font-medium">El acta está desactivada</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mt-1">
            Actívala para redactar, añadir fuentes y publicar. Si ya había contenido, se conserva intacto.
          </p>
        </div>
      ) : (
        <>
          {!minutes.writingConfigured && (
            <Banner tone="warn">
                    La redacción con IA no está configurada. Puedes escribir el acta a mano; la superadministración puede configurar DeepSeek u OpenAI en Panel de Control.
            </Banner>
          )}
          {!minutes.processingAvailable && (
            <Banner tone="warn">
              El procesamiento de documentos no está disponible en este servidor. No se pueden añadir fuentes por ahora.
            </Banner>
          )}
          {minutes.processingAvailable && !minutes.multimediaConfigured && (
            <Banner tone="info">
              Sin proveedor multimedia (OpenAI): el audio, el vídeo y las imágenes no se podrán transcribir ni analizar. Los documentos de texto sí.
            </Banner>
          )}
          {minutes.generationStatus === "error" && minutes.generationError && (
            <Banner tone="error">La última generación falló: {minutes.generationError}</Banner>
          )}

          <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
            {/* Draft */}
            <div className="space-y-4">
              <Card>
                <CardContent className="p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-semibold flex items-center gap-2"><FileText className="w-4 h-4 text-primary" /> Borrador</h4>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-muted-foreground">rev. {minutes.revision}</span>
                      {dirty ? <Badge variant="secondary">Sin guardar</Badge> : <Badge variant="outline">Guardado</Badge>}
                      {generating && <Badge className="animate-pulse">Generando</Badge>}
                    </div>
                  </div>
                  {(conflict || serverChangedUnderUs) && minutes.revision !== baseRevision && (
                    <Banner tone="error">
                      <p>El acta se modificó en otra sesión o por la IA mientras editabas. Tu texto sigue aquí.</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Button size="sm" variant="outline" onClick={() => void onSave(true)} disabled={saveMut.isPending} data-testid="button-overwrite-draft">
                          Guardar mi versión encima
                        </Button>
                        <Button size="sm" variant="ghost" onClick={discardMine} data-testid="button-load-server-draft">
                          Descartar y cargar la del servidor
                        </Button>
                      </div>
                    </Banner>
                  )}
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={18}
                    disabled={generating}
                    className="font-mono text-[13px] leading-relaxed"
                    placeholder={"# Acta de la reunión\n\n## Asistentes\n- ...\n\n## Acuerdos\n- ..."}
                    aria-label="Borrador del acta"
                    data-testid="input-minutes-draft"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void onSave()} disabled={!dirty || saveMut.isPending || generating} data-testid="button-save-draft">
                      {saveMut.isPending ? "Guardando..." : "Guardar borrador"}
                    </Button>
                    {dirty && (
                      <Button variant="ghost" onClick={() => setDraft(baseline)} className="gap-1.5">
                        <Undo2 className="w-4 h-4" /> Deshacer cambios
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Publication */}
              <Card>
                <CardContent className="p-5 space-y-3">
                  <h4 className="font-semibold">Publicación</h4>
                  {minutes.publishedText != null ? (
                    <p className="text-sm text-muted-foreground">
                      Publicada el {formatDateTime(minutes.publishedAt)}.
                      {publishedDiffers && " El borrador guardado tiene cambios que aún no se han publicado."}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Aún no hay una versión publicada.</p>
                  )}
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox checked={reviewed} onCheckedChange={(v) => setReviewed(v === true)} data-testid="checkbox-reviewed" className="mt-0.5" />
                    He revisado el borrador guardado y confirmo que es el acta final.
                  </label>
                  {dirty && <p className="text-xs text-amber-700">Guarda el borrador antes de publicar: se publica la versión guardada.</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => void onPublish(true)}
                      disabled={!reviewed || dirty || !serverDraft.trim() || pubMut.isPending || generating}
                      data-testid="button-publish-minutes"
                    >
                      {minutes.publishedText != null ? "Publicar nueva versión" : "Publicar acta"}
                    </Button>
                    {minutes.publishedText != null && (
                      <Button variant="outline" onClick={() => void onPublish(false)} disabled={pubMut.isPending} data-testid="button-withdraw-minutes">
                        Retirar publicación
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              {minutes.publishedText != null && <PublishedActa minutes={minutes} eventId={eventId} />}
            </div>

            {/* AI side */}
            <div className="space-y-4">
              <Card>
                <CardContent className="p-5 space-y-3">
                  <h4 className="font-semibold flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> Asistente de redacción</h4>
                  <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                    <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" data-testid="checkbox-ai-consent" />
                    <span>
                      Autorizo enviar los documentos, grabaciones e instrucciones a proveedores externos de IA (DeepSeek y OpenAI) para generar el acta. Los archivos permanecen privados en la plataforma.
                    </span>
                  </label>

                  {minutes.messages.length > 0 && (
                    <div className="max-h-64 overflow-y-auto space-y-2 rounded-md bg-muted/40 p-2" data-testid="list-minutes-messages">
                      {minutes.messages.map((m) => (
                        <div key={m.id} className={`rounded-md px-3 py-2 text-xs whitespace-pre-wrap break-words ${m.role === "user" ? "bg-primary/10 ml-6" : "bg-card border mr-6"}`}>
                          <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                            {m.role === "user" ? "Instrucción" : "IA"}
                          </span>
                          {m.content}
                        </div>
                      ))}
                    </div>
                  )}

                  <Textarea
                    rows={4}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="Ej.: Redacta el acta con los acuerdos numerados y destaca los plazos."
                    aria-label="Instrucciones para la IA"
                    data-testid="input-minutes-instructions"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Las instrucciones, incluidas las dictadas, orientan la redacción; no se consideran evidencia de lo ocurrido en la reunión.
                  </p>
                  <div className="flex flex-wrap items-start gap-2">
                    <Button
                      size="sm"
                      className="gap-1.5"
                      onClick={() => void onGenerate()}
                      disabled={!consent || !minutes.writingConfigured || generating || dirty || genMut.isPending || sourcesBusy || !instructions.trim()}
                      data-testid="button-generate-minutes"
                    >
                      <Send className="w-3.5 h-3.5" /> {minutes.draftText ? "Revisar con IA" : "Generar acta"}
                    </Button>
                    <Recorder
                      disabled={!consent || !minutes.processingAvailable || !minutes.multimediaConfigured || minutes.sources.length + uploads.length >= MAX_SOURCES}
                      onRecorded={(f) => void uploadFile(f, "instruction")}
                    />
                  </div>
                  {dirty && <p className="text-xs text-amber-700">Guarda o deshaz tus cambios antes de pedir una revisión a la IA.</p>}
                  {sourcesBusy && <p className="text-xs text-muted-foreground">Esperando a que terminen de procesarse las fuentes.</p>}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold">Fuentes</h4>
                    <span className="text-xs font-mono text-muted-foreground">{minutes.sources.length}/{MAX_SOURCES}</span>
                  </div>
                  <div className="flex rounded-md border p-0.5 text-xs" role="radiogroup" aria-label="Tipo de fuente">
                    {(["evidence", "instruction"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        role="radio"
                        aria-checked={purpose === p}
                        onClick={() => setPurpose(p)}
                        className={`flex-1 rounded px-2 py-1.5 transition-colors ${purpose === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        data-testid={`toggle-purpose-${p}`}
                      >
                        {p === "evidence" ? "Evidencia" : "Instrucción"}
                      </button>
                    ))}
                  </div>
                  <input ref={fileRef} type="file" multiple accept={ACCEPT_EXT.join(",")} className="hidden" onChange={(e) => void onFiles(e)} data-testid="input-minutes-files" />
                  <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => fileRef.current?.click()} disabled={!canUpload} data-testid="button-add-source">
                    <Upload className="w-3.5 h-3.5" /> Añadir archivos
                  </Button>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Documentos, imágenes, audio o vídeo. Máximo {MAX_SOURCES} fuentes y 100 MB por archivo; audio y vídeo hasta 120 minutos. Del vídeo se analizan hasta 40 fotogramas de muestra (no es exhaustivo) y de los PDF escaneados, hasta 40 páginas.
                  </p>

                  {uploads.map((u) => (
                    <div key={u.id} className="flex items-center justify-between gap-2 rounded-md border border-dashed p-2 text-xs">
                      <span className="truncate">Subiendo {u.name}...</span>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => u.abort.abort()} aria-label={`Cancelar subida de ${u.name}`}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}

                  {minutes.sources.length === 0 && uploads.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">Sin fuentes todavía.</p>
                  ) : (
                    <ul className="space-y-2">
                      {minutes.sources.map((s) => (
                        <li key={s.id} className="rounded-md border p-2.5 text-xs space-y-1.5" data-testid={`row-source-${s.id}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-medium truncate">{s.fileName}</p>
                              <p className="text-muted-foreground">
                                {s.purpose === "evidence" ? "Evidencia" : "Instrucción"} · {formatSize(s.size)}
                              </p>
                            </div>
                            <Badge
                              variant={s.status === "error" ? "destructive" : s.status === "ready" ? "outline" : "secondary"}
                              className={s.status === "processing" || s.status === "queued" ? "animate-pulse" : undefined}
                            >
                              {STATUS_LABEL[s.status] ?? s.status}
                            </Badge>
                          </div>
                          {s.error && <p className="text-destructive">{s.error}</p>}
                          <div className="flex flex-wrap gap-1">
                            {s.extractedText && (
                              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setOpenSource(openSource === s.id ? null : s.id)}>
                                {openSource === s.id ? "Ocultar texto" : "Ver texto extraído"}
                              </Button>
                            )}
                            {s.purpose === "instruction" && s.status === "ready" && s.extractedText && (
                              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setInstructions((c) => (c.trim() ? `${c.trim()}\n\n${s.extractedText}` : s.extractedText))}>
                                Usar como instrucciones
                              </Button>
                            )}
                            {s.status === "error" && (
                              <Button size="sm" variant="ghost" className="h-7 px-2 gap-1" onClick={() => void onRetry(s)} disabled={retryMut.isPending}>
                                <RotateCcw className="w-3 h-3" /> Reintentar
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 px-2 gap-1 text-destructive ml-auto" onClick={() => void onDelete(s)} disabled={delMut.isPending} aria-label={`Eliminar ${s.fileName}`}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                          {openSource === s.id && (
                            <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 font-mono text-[11px]">
                              {s.extractedText}
                            </pre>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------
export function EventMinutesSection({ eventId }: { eventId: number }) {
  const q = useGetEventMinutes(eventId, {
    query: {
      queryKey: getGetEventMinutesQueryKey(eventId),
      retry: false,
      refetchInterval: (query) => (isBusy(query.state.data as EventMinutes | undefined) ? 3000 : false),
    },
  });
  const content = q.data;

  if (q.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (q.error || !content) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">{apiErrorMessage(q.error, "No se pudo cargar el acta.")}</p>
        <Button size="sm" variant="outline" onClick={() => void q.refetch()}>Reintentar</Button>
      </div>
    );
  }
  if (content.canManage) return <Workspace eventId={eventId} minutes={content} />;
  if (content.enabled && content.publishedText) return <PublishedActa minutes={content} eventId={eventId} />;
  return (
    <div className="rounded-xl border border-dashed py-12 text-center px-6" data-testid="status-no-minutes">
      <FileText className="w-8 h-8 mx-auto text-muted-foreground/60" />
      <p className="mt-3 font-medium">No hay acta publicada</p>
      <p className="text-sm text-muted-foreground mt-1">Cuando la coordinación publique el acta final aparecerá aquí.</p>
    </div>
  );
}
