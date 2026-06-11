import { useState, useRef, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAnnouncements,
  useCreateAnnouncement,
  useDeleteAnnouncement,
  useRequestUploadUrl,
  getListAnnouncementsQueryKey,
  type Announcement,
  type AnnouncementAttachmentInput,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import {
  AudiencePicker,
  useFormSurveyCreator,
  defaultAudienceValue,
  audienceNeedsIds,
  type AudienceValue,
} from "@/components/audience-picker";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  Megaphone,
  Plus,
  Trash2,
  Users,
  User as UserIcon,
  CalendarClock,
  Paperclip,
  Download,
  X,
} from "lucide-react";

const TOKEN_KEY = "coordina_adg_token";

function formatDate(value?: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleString("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatSize(bytes?: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Download a (private) attachment via an authenticated fetch + blob, since the
// object is owner/audience-scoped and cannot be linked directly.
async function downloadAttachment(attachmentId: number, fileName: string) {
  const token = localStorage.getItem(TOKEN_KEY);
  try {
    const res = await fetch(
      `${import.meta.env.BASE_URL}api/announcements/attachments/${attachmentId}/file`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!res.ok) {
      toast({
        title: "No se pudo descargar",
        description: "Comprueba tus permisos o inténtalo de nuevo.",
        variant: "destructive",
      });
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "documento";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    toast({
      title: "No se pudo descargar",
      description: "Error de red. Inténtalo de nuevo.",
      variant: "destructive",
    });
  }
}

// ---------------------------------------------------------------------------
// Create form (superadmin or provincial coordinator)
// ---------------------------------------------------------------------------
function CreateForm() {
  const qc = useQueryClient();
  const createMut = useCreateAnnouncement();
  const uploadMut = useRequestUploadUrl();
  const { isSuperadmin, isProvincialCoordinator, user } =
    useFormSurveyCreator();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const makeDefaultAudience = (): AudienceValue =>
    defaultAudienceValue({
      isSuperadmin,
      isProvincialCoordinator,
      provinceId: user?.provinceId ?? null,
    });
  const [audience, setAudience] = useState<AudienceValue>(makeDefaultAudience);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const removeFile = (idx: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("El título es obligatorio.");
      return;
    }
    if (!body.trim()) {
      setError("El contenido es obligatorio.");
      return;
    }
    if (
      audienceNeedsIds(audience.audienceType) &&
      audience.audienceIds.length === 0
    ) {
      setError("Selecciona al menos un destinatario.");
      return;
    }
    try {
      setUploading(true);
      // Upload each attachment to object storage, collect the resulting paths.
      const attachments: AnnouncementAttachmentInput[] = [];
      for (const file of files) {
        const res = await uploadMut.mutateAsync({
          data: { name: file.name, size: file.size, contentType: file.type },
        });
        await fetch(res.uploadURL, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        attachments.push({
          objectPath: res.objectPath,
          fileName: file.name,
          contentType: file.type || null,
          size: file.size,
        });
      }

      await createMut.mutateAsync({
        data: {
          title: title.trim(),
          body: body.trim(),
          audienceType: audience.audienceType,
          audienceIds: audience.audienceIds,
          attachments,
        },
      });
      await qc.invalidateQueries({ queryKey: getListAnnouncementsQueryKey() });
      toast({
        title: "Anuncio publicado",
        description: "Se ha notificado a los destinatarios.",
      });
      setTitle("");
      setBody("");
      setFiles([]);
      setAudience(makeDefaultAudience());
    } catch {
      setError("No se pudo publicar el anuncio. Inténtalo de nuevo.");
    } finally {
      setUploading(false);
    }
  };

  const busy = uploading || createMut.isPending;

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Plus className="w-5 h-5 text-primary" /> Nuevo anuncio
        </h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="a-title">Título *</Label>
            <Input
              id="a-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej. Calendario de evaluaciones"
              maxLength={160}
            />
          </div>
          <div className="space-y-1">
            <AudiencePicker value={audience} onChange={setAudience} />
            <p className="text-xs text-muted-foreground">
              Se notificará a los destinatarios y verán el anuncio en la web y
              en la app móvil.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="a-body">Contenido *</Label>
            <Textarea
              id="a-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder="Escribe el contenido del anuncio…"
            />
          </div>
          <div className="space-y-2">
            <Label>Documentos adjuntos (opcional)</Label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="w-4 h-4 mr-1.5" /> Añadir documentos
            </Button>
            {files.length > 0 && (
              <ul className="space-y-1">
                {files.map((f, idx) => (
                  <li
                    key={`${f.name}-${idx}`}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm"
                  >
                    <span className="truncate flex items-center gap-2 min-w-0">
                      <Paperclip className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{f.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatSize(f.size)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label="Quitar documento"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? "Publicando..." : "Publicar anuncio"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Single announcement card
// ---------------------------------------------------------------------------
function AnnouncementCard({
  item,
  canDelete,
}: {
  item: Announcement;
  canDelete: boolean;
}) {
  const qc = useQueryClient();
  const deleteMut = useDeleteAnnouncement();

  const onDelete = async () => {
    try {
      await deleteMut.mutateAsync({ id: item.id });
      await qc.invalidateQueries({ queryKey: getListAnnouncementsQueryKey() });
      toast({ title: "Anuncio eliminado" });
    } catch {
      toast({
        title: "Error",
        description: "No se pudo eliminar el anuncio.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="rounded-md border p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{item.title}</div>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-1">
            {item.body}
          </p>
        </div>
        {canDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-destructive hover:text-destructive"
            onClick={onDelete}
            disabled={deleteMut.isPending}
            aria-label="Eliminar anuncio"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>

      {item.attachments && item.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {item.attachments.map((att) => (
            <button
              key={att.id}
              type="button"
              onClick={() => downloadAttachment(att.id, att.fileName)}
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm hover:bg-accent"
            >
              <Download className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="truncate max-w-[14rem]">{att.fileName}</span>
              {att.size != null && (
                <span className="text-xs text-muted-foreground">
                  {formatSize(att.size)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
        {item.audienceLabel && (
          <span className="flex items-center gap-1">
            <Users className="w-3 h-3" /> {item.audienceLabel}
          </span>
        )}
        {item.authorName && (
          <span className="flex items-center gap-1">
            <UserIcon className="w-3 h-3" /> {item.authorName}
          </span>
        )}
        {item.createdAt && (
          <span className="flex items-center gap-1">
            <CalendarClock className="w-3 h-3" /> {formatDate(item.createdAt)}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function AnunciosPage() {
  const { user } = useAuth();
  const isManager =
    user?.role === "superadmin" || user?.role === "coordinator";
  const { data: items = [], isLoading } = useListAnnouncements();
  const canCreate = isManager;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Megaphone className="w-6 h-6 text-primary" /> Anuncios
        </h1>
        <p className="text-muted-foreground">
          {canCreate
            ? "Publica anuncios con documentos adjuntos y elige sus destinatarios. Los verán en la web y en la app móvil."
            : "Tablón de anuncios. Aquí verás los avisos dirigidos a ti."}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {canCreate && <CreateForm />}

        <Card className={canCreate ? "" : "lg:col-span-2"}>
          <CardContent className="p-5 space-y-3">
            <h2 className="font-semibold">
              Anuncios
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
                No hay anuncios por ahora.
              </p>
            ) : (
              <div className="space-y-3">
                {items.map((item) => (
                  <AnnouncementCard
                    key={item.id}
                    item={item}
                    canDelete={isManager || item.authorId === user?.id}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
