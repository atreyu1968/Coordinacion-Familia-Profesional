import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListMeetings,
  useCreateMeeting,
  useDeleteMeeting,
  useGetMeetingToken,
  getListMeetingsQueryKey,
  type Meeting,
  type MeetingAccess,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  Video,
  Phone,
  Plus,
  Trash2,
  ExternalLink,
  X,
  CalendarClock,
  User as UserIcon,
} from "lucide-react";

// Build the room URL from the server-issued access info. With JaaS the host is
// 8x8.vc and a signed `jwt` is appended so the user joins with no login screen;
// without it we fall back to the public meet.jit.si server (no jwt).
function buildMeetingUrl(access: MeetingAccess, audioOnly = false): string {
  const cfg = [
    "config.disableDeepLinking=true",
    "config.prejoinPageEnabled=false",
  ];
  if (audioOnly) cfg.push("config.startAudioOnly=true");
  const query = access.jwt ? `?jwt=${access.jwt}` : "";
  return `https://${access.domain}/${access.room}${query}#${cfg.join("&")}`;
}

function formatDate(value?: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleString("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// ---------------------------------------------------------------------------
// Create form (coordinator / superadmin only)
// ---------------------------------------------------------------------------
function CreateForm() {
  const qc = useQueryClient();
  const createMut = useCreateMeeting();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("El título es obligatorio.");
      return;
    }
    try {
      await createMut.mutateAsync({
        data: {
          title: title.trim(),
          description: description.trim() || null,
          scheduledAt: scheduledAt
            ? new Date(scheduledAt).toISOString()
            : null,
        },
      });
      await qc.invalidateQueries({ queryKey: getListMeetingsQueryKey() });
      toast({
        title: "Sala creada",
        description: "La sala de videoconferencia está disponible.",
      });
      setTitle("");
      setDescription("");
      setScheduledAt("");
    } catch {
      setError("No se pudo crear la sala. Inténtalo de nuevo.");
    }
  };

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Plus className="w-5 h-5 text-primary" /> Nueva sala de reuniones
        </h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="m-title">Título *</Label>
            <Input
              id="m-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej. Reunión de coordinación"
              maxLength={140}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="m-desc">Descripción</Label>
            <Textarea
              id="m-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Tema o detalles de la reunión (opcional)"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="m-when">Fecha y hora (opcional)</Label>
            <Input
              id="m-when"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>
          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}
          <Button type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? "Creando..." : "Crear sala"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Single meeting row
// ---------------------------------------------------------------------------
function MeetingRow({
  item,
  canDelete,
  busy,
  onJoin,
  onOpenTab,
}: {
  item: Meeting;
  canDelete: boolean;
  busy: boolean;
  onJoin: (m: Meeting, audioOnly: boolean) => void;
  onOpenTab: (m: Meeting) => void;
}) {
  const qc = useQueryClient();
  const deleteMut = useDeleteMeeting();

  const onDelete = async () => {
    try {
      await deleteMut.mutateAsync({ id: item.id });
      await qc.invalidateQueries({ queryKey: getListMeetingsQueryKey() });
      toast({ title: "Sala eliminada" });
    } catch {
      toast({
        title: "Error",
        description: "No se pudo eliminar la sala.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="rounded-md border p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium truncate">{item.title}</div>
          {item.description && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-1">
              {item.description}
            </p>
          )}
        </div>
        {canDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-destructive hover:text-destructive"
            onClick={onDelete}
            disabled={deleteMut.isPending}
            aria-label="Eliminar sala"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {item.hostName && (
          <span className="flex items-center gap-1">
            <UserIcon className="w-3 h-3" /> {item.hostName}
          </span>
        )}
        {item.scheduledAt && (
          <span className="flex items-center gap-1">
            <CalendarClock className="w-3 h-3" /> {formatDate(item.scheduledAt)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button size="sm" onClick={() => onJoin(item, false)} disabled={busy}>
          <Video className="w-4 h-4 mr-1.5" /> Unirse
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onJoin(item, true)}
          disabled={busy}
        >
          <Phone className="w-4 h-4 mr-1.5" /> Solo audio
        </Button>
        <button
          type="button"
          onClick={() => onOpenTab(item)}
          disabled={busy}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 disabled:opacity-50"
        >
          <ExternalLink className="w-3.5 h-3.5" /> Abrir en pestaña
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fullscreen Jitsi call overlay
// ---------------------------------------------------------------------------
function CallOverlay({
  title,
  url,
  audioOnly,
  onClose,
}: {
  title: string;
  url: string;
  audioOnly: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 h-12 bg-zinc-900 text-white shrink-0">
        <span className="font-medium truncate flex items-center gap-2">
          {audioOnly ? (
            <Phone className="w-4 h-4" />
          ) : (
            <Video className="w-4 h-4" />
          )}
          {title}
          {audioOnly && (
            <span className="text-xs text-zinc-400 font-normal">
              (solo audio)
            </span>
          )}
        </span>
        <div className="flex items-center gap-3">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-zinc-300 hover:text-white inline-flex items-center gap-1"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Nueva pestaña
          </a>
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1 text-sm text-zinc-300 hover:text-white"
            aria-label="Salir de la reunión"
          >
            <X className="w-4 h-4" /> Salir
          </button>
        </div>
      </div>
      <iframe
        title={title}
        src={url}
        className="flex-1 w-full border-0"
        allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function VideoconferenciasPage() {
  const { user } = useAuth();
  const canCreate =
    user?.role === "superadmin" || user?.role === "coordinator";
  const { data: items = [], isLoading } = useListMeetings();
  const tokenMut = useGetMeetingToken();
  const [active, setActive] = useState<{
    title: string;
    url: string;
    audioOnly: boolean;
  } | null>(null);

  // Ask the server for join access (JaaS JWT or public fallback), then build the
  // room URL. Surfaces a toast if access can't be issued.
  const resolveUrl = async (
    roomName: string,
    audioOnly: boolean,
  ): Promise<string | null> => {
    try {
      const access = await tokenMut.mutateAsync({ data: { room: roomName } });
      return buildMeetingUrl(access, audioOnly);
    } catch {
      toast({
        title: "Error",
        description: "No se pudo abrir la sala. Inténtalo de nuevo.",
        variant: "destructive",
      });
      return null;
    }
  };

  const onJoin = async (meeting: Meeting, audioOnly: boolean) => {
    const url = await resolveUrl(meeting.roomName, audioOnly);
    if (url) setActive({ title: meeting.title, url, audioOnly });
  };

  const onOpenTab = async (meeting: Meeting) => {
    const url = await resolveUrl(meeting.roomName, false);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Videoconferencias</h1>
        <p className="text-muted-foreground">
          {canCreate
            ? "Crea salas de reunión por videoconferencia e invita al equipo. Cualquier usuario puede unirse desde la web o el móvil."
            : "Únete a las salas de reunión por videoconferencia disponibles."}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {canCreate && <CreateForm />}

        <Card className={canCreate ? "" : "lg:col-span-2"}>
          <CardContent className="p-5 space-y-3">
            <h2 className="font-semibold">
              Salas disponibles
              <span className="text-muted-foreground font-normal">
                {" "}
                ({items.length})
              </span>
            </h2>
            {isLoading ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Cargando...
              </p>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No hay salas disponibles por ahora.
              </p>
            ) : (
              <div className="space-y-3">
                {items.map((item) => (
                  <MeetingRow
                    key={item.id}
                    item={item}
                    busy={tokenMut.isPending}
                    canDelete={
                      user?.role === "superadmin" || item.hostId === user?.id
                    }
                    onJoin={onJoin}
                    onOpenTab={onOpenTab}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {active && (
        <CallOverlay
          title={active.title}
          url={active.url}
          audioOnly={active.audioOnly}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}
