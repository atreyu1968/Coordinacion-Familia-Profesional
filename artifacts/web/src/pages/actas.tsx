import { useMemo, useState } from "react";
import { useListPublishedMinutes, type PublishedMinutes } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { BookCheck, CalendarDays, Download, ExternalLink, FileText, MapPin, Search } from "lucide-react";

const TOKEN_KEY = "coordina_adg_token";

function dateLabel(value: string | null): string {
  if (!value) return "Fecha no indicada";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Fecha no indicada"
    : new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short" }).format(date);
}

async function downloadPrivateFile(url: string, fileName: string) {
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(response.status === 404 ? "El documento ya no está disponible." : "No se pudo descargar el documento.");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function MinutesCard({ minutes }: { minutes: PublishedMinutes }) {
  const [downloading, setDownloading] = useState(false);

  const downloadActa = async () => {
    setDownloading(true);
    try {
      await downloadPrivateFile(
        `/api/events/${minutes.eventId}/minutes/documents/published`,
        minutes.actaDocument.fileName,
      );
    } catch (error) {
      toast({
        title: "No se pudo descargar el acta",
        description: error instanceof Error ? error.message : "Inténtalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  };

  const downloadShared = async (documentId: number, fileName: string) => {
    try {
      await downloadPrivateFile(
        `/api/events/${minutes.eventId}/minutes/shared-documents/${documentId}/download`,
        fileName,
      );
    } catch (error) {
      toast({
        title: "No se pudo descargar el archivo",
        description: error instanceof Error ? error.message : "Inténtalo de nuevo.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card data-testid={`published-minutes-${minutes.eventId}`}>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <FileText className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold leading-snug">{minutes.eventName}</h2>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {dateLabel(minutes.eventStartAt)}</span>
              {minutes.eventLocation && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {minutes.eventLocation}</span>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Publicada el {dateLabel(minutes.publishedAt)}</p>
          </div>
        </div>

        <Button type="button" onClick={() => void downloadActa()} disabled={downloading} className="gap-2" data-testid={`download-minutes-${minutes.eventId}`}>
          <Download className="h-4 w-4" />
          {downloading ? "Descargando…" : `Descargar acta (${minutes.actaDocument.fileName})`}
        </Button>

        {minutes.sharedDocuments.length > 0 && (
          <div className="border-t pt-3">
            <h3 className="mb-2 text-sm font-medium">Documentos compartidos</h3>
            <ul className="space-y-2">
              {minutes.sharedDocuments.map((document) => (
                <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{document.title}</span>
                  {document.kind === "link" && document.url ? (
                    <a className="inline-flex items-center gap-1 text-primary underline underline-offset-4" href={document.url} target="_blank" rel="noopener noreferrer">
                      Abrir enlace <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => void downloadShared(document.id, document.fileName ?? document.title)}
                    >
                      <Download className="h-3.5 w-3.5" /> Descargar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ActasPage() {
  const { user } = useAuth();
  const isDepartmentHead = user?.role === "department_head";
  const query = useListPublishedMinutes({ query: { enabled: isDepartmentHead } });
  const [search, setSearch] = useState("");
  const minutes = query.data ?? [];
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es");
    if (!term) return minutes;
    return minutes.filter((item) =>
      `${item.eventName} ${item.eventLocation ?? ""}`.toLocaleLowerCase("es").includes(term),
    );
  }, [minutes, search]);

  if (!isDepartmentHead) {
    return (
      <div className="p-4 md:p-8 max-w-4xl mx-auto">
        <Card><CardContent className="p-8 text-center text-muted-foreground">Esta sección está reservada para jefaturas de departamento.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold flex items-center gap-2"><BookCheck className="h-6 w-6" /> Actas publicadas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Actas oficiales subidas y publicadas por la coordinación, con los documentos complementarios que haya compartido.
          No se muestran borradores, evidencias ni datos de asistencia.
        </p>
      </header>

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por reunión o lugar"
          aria-label="Buscar actas"
          className="pl-9"
        />
      </div>

      {query.isLoading ? (
        <p className="py-12 text-center text-muted-foreground">Cargando actas publicadas…</p>
      ) : query.isError ? (
        <Card><CardContent className="p-8 text-center space-y-3">
          <p className="text-destructive">No se pudieron cargar las actas publicadas.</p>
          <Button variant="outline" onClick={() => void query.refetch()}>Reintentar</Button>
        </CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          {minutes.length === 0 ? "Todavía no hay actas oficiales publicadas." : "No hay actas que coincidan con la búsqueda."}
        </CardContent></Card>
      ) : (
        <div className="grid gap-4">{filtered.map((item) => <MinutesCard key={item.eventId} minutes={item} />)}</div>
      )}
    </div>
  );
}
