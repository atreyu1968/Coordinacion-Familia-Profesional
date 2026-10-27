import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListNormativaQueryKey, useListNormativa, useCheckNormativa, useReviewNormativa,
  type NormativaPublication, type ListNormativaStatus,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";

const relevance = { adg: "Posible aplicación a ADG", general: "FP común", other: "Otra familia", uncertain: "Alcance por comprobar" };
const statuses = { pending: "Pendientes", reviewed: "Revisadas", dismissed: "Descartadas", catalog: "Catálogo inicial", all: "Todas" };
const date = (value: string | null) => value ? new Date(value).toLocaleString("es-ES") : "Sin comprobar";

function ReviewCard({ item, saved }: { item: NormativaPublication; saved: () => void }) {
  const [note, setNote] = useState("");
  const review = useReviewNormativa();
  const editable = item.status === "pending" || item.status === "catalog";
  async function save(status: "reviewed" | "dismissed") {
    if (!editable || !note.trim()) return;
    try {
      await review.mutateAsync({ id: item.id, data: { status, reviewNote: note.trim(), expectedStatus: item.status as "pending" | "catalog" } });
      saved();
      toast({ title: "Revisión guardada", description: "No se ha modificado ninguna página ni declarado la vigencia de la norma." });
    } catch (error) {
      toast({ title: "No se pudo guardar", description: error instanceof Error ? error.message : "Actualiza e inténtalo de nuevo.", variant: "destructive" });
    }
  }
  return <article id={`normativa-${item.id}`} className="space-y-3 rounded-lg border p-4">
    <div className="flex flex-wrap gap-2">
      <Badge variant="outline">{item.source} · {item.officialId}</Badge>
      <Badge variant={item.relevance === "other" ? "secondary" : "outline"}>{relevance[item.relevance]}</Badge>
      <Badge variant="secondary">{statuses[item.status]}</Badge>
    </div>
    <h3 className="font-semibold">{item.title}</h3>
    <p className="text-sm text-muted-foreground">{item.reason}</p>
    <p className="text-xs text-muted-foreground">Publicación: {item.publishedAt ?? "Catálogo"} · Detectada: {date(item.detectedAt)} · Comprobada: {date(item.checkedAt)}</p>
    <a className="inline-block text-sm text-primary underline" href={item.url} target="_blank" rel="noopener noreferrer">Consultar publicación oficial{item.source === "BOC" ? " (PDF)" : ""}</a>
    {item.reviewedAt && <p className="whitespace-pre-wrap text-sm">Revisión de responsable #{item.reviewedBy} · {date(item.reviewedAt)}: {item.reviewNote}</p>}
    {editable && <div className="space-y-2">
      <Label htmlFor={`note-${item.id}`}>Nota de revisión: alcance, artículos y pasos necesarios</Label>
      <Textarea id={`note-${item.id}`} value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} placeholder="Comprueba familia, título, modalidad, fechas y régimen transitorio en la fuente oficial." />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!note.trim() || review.isPending} onClick={() => void save("reviewed")}>Marcar revisada</Button>
        <Button size="sm" variant="outline" disabled={!note.trim() || review.isPending} onClick={() => void save("dismissed")}>Descartar con motivo</Button>
      </div>
      <p className="text-xs text-muted-foreground">La actualización de Documentación, si procede, se realiza manualmente con los permisos habituales de la wiki.</p>
    </div>}
  </article>;
}

export function NormativaMonitor() {
  const [status, setStatus] = useState<ListNormativaStatus>("pending");
  const [offset, setOffset] = useState(0);
  const client = useQueryClient();
  const query = useListNormativa({ status, offset }, { query: { refetchInterval: 10000, refetchOnMount: "always" } });
  const check = useCheckNormativa();
  const invalidate = () => { void client.invalidateQueries({ queryKey: getListNormativaQueryKey().slice(0, 1) }); };
  async function run() {
    try {
      await check.mutateAsync();
      invalidate();
      toast({ title: "Comprobación solicitada", description: "Las novedades aparecerán al terminar. Puedes seguir trabajando." });
    } catch (error) {
      toast({ title: "No se pudo iniciar", description: error instanceof Error ? error.message : "Inténtalo de nuevo.", variant: "destructive" });
    }
  }
  return <Card><CardContent className="space-y-4 p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Seguimiento normativo · BOE y BOC</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Comprobación diaria de publicaciones nuevas sobre FP y Administración y Gestión. Clasificación orientativa, siempre sujeta a revisión humana. No acredita vigencia ni cambia la documentación existente.</p>
      </div>
      <Button variant="outline" onClick={() => void run()} disabled={!query.data?.enabled || query.data.running || check.isPending}>
        {query.data?.running ? "Comprobando…" : "Comprobar ahora"}
      </Button>
    </div>
    {query.isLoading && <p role="status">Cargando seguimiento…</p>}
    {query.isError && <div role="alert"><p>No se pudo cargar el seguimiento.</p><Button variant="outline" onClick={() => void query.refetch()}>Reintentar</Button></div>}
    {query.data && <>
      {!query.data.enabled && <p role="alert" className="text-sm">Seguimiento detenido: el clasificador solo está preparado para Administración y Gestión. No se aplicará a otra familia configurada.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {(["BOE", "BOC"] as const).map((name) => {
          const source = query.data.sources.find((s) => s.source === name);
          return <div key={name} className="rounded-md bg-muted/50 p-3 text-xs">
            <p className="font-semibold">{name}</p>
            <p>Último intento: {date(source?.attemptedAt ?? null)}</p>
            <p>Última comprobación correcta: {date(source?.succeededAt ?? null)}</p>
            <p>Cobertura: {source?.startedFrom ?? "Comienza con los últimos 7 días"} → {source?.coveredThrough ?? "Pendiente"}</p>
            {source?.error && <p role="alert" className="mt-1 text-destructive">Comprobación incompleta: {source.error}. Se reintentará desde la última fecha cubierta.</p>}
          </div>;
        })}
      </div>
      <p className="text-xs text-muted-foreground">No es una revisión histórica completa: cada comprobación recupera hasta siete días y conserva los días pendientes tras un fallo. Las referencias ya presentes no generan avisos. Las posibles novedades ADG, FP común y las dudosas avisan a coordinadores y superadministradores; las de otra familia quedan aquí para comprobarlas.</p>
      <div className="flex flex-wrap gap-2" aria-label="Estado de revisión">
        {Object.entries(statuses).map(([value, title]) => <Button key={value} size="sm" variant={status === value ? "secondary" : "outline"} aria-pressed={status === value}
          onClick={() => { setStatus(value as ListNormativaStatus); setOffset(0); }}>{title}</Button>)}
      </div>
      <p className="text-sm text-muted-foreground">{query.data.total} publicaciones · {statuses[status]}</p>
      {query.data.items.length === 0 && <p className="text-sm">No hay publicaciones en este estado. Esto no certifica que la documentación esté actualizada.</p>}
      {query.data.items.map((item) => <ReviewCard key={item.id} item={item} saved={invalidate} />)}
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Anterior</Button>
        <span className="text-sm">Página {Math.floor(offset / 25) + 1}</span>
        <Button size="sm" variant="outline" disabled={offset + 25 >= query.data.total} onClick={() => setOffset(offset + 25)}>Siguiente</Button>
      </div>
    </>}
  </CardContent></Card>;
}
