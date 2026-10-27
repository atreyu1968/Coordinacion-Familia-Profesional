import {
  useListWikiLinkReviews, getListWikiLinkReviewsQueryKey, type WikiExternalLink,
  useResolveWikiLinkReview,
} from "@workspace/api-client-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const labels = {
  unchecked: "Pendiente de comprobación", healthy: "Accesible",
  temporary: "Fallo temporal o pendiente de confirmar",
  blocked: "Acceso bloqueado (no implica que haya desaparecido)",
  redirected: "Redirección: revisar destino", missing: "Desaparición confirmada (3 respuestas 404/410)",
};

export function WikiLinkHealth({ link }: { link: WikiExternalLink }) {
  return <div className="mt-1 space-y-1 text-xs text-muted-foreground">
    <div>{labels[link.checkStatus]}{link.httpStatus ? ` · HTTP ${link.httpStatus}` : ""}</div>
    <div>Última comprobación: {link.checkedAt ? new Date(link.checkedAt).toLocaleString("es-ES") : "Todavía no comprobado"}</div>
    <div>Próxima comprobación: {new Date(link.nextCheckAt).toLocaleString("es-ES")}</div>
    {link.redirectUrl && <div className="break-all">Destino observado: {link.redirectUrl}</div>}
    {link.resolvedAt && <div>Revisado manualmente: {new Date(link.resolvedAt).toLocaleString("es-ES")}. El diagnóstico automático no cambia.</div>}
    {link.reviewHistory.length > 0 && <details>
      <summary>Historial de revisiones ({link.reviewHistory.length})</summary>
      {link.reviewHistory.map((review, index) => <div key={index} className="mt-2 border-l pl-2">
        <div>{new Date(review.reviewedAt).toLocaleString("es-ES")} · Responsable #{review.reviewedBy} · {review.checkStatus}{review.httpStatus ? ` · HTTP ${review.httpStatus}` : ""}</div>
        {review.redirectUrl && <div className="break-all">{review.redirectUrl}</div>}
        <p className="whitespace-pre-wrap break-words">{review.note}</p>
      </div>)}
    </details>}
  </div>;
}

function ResolutionForm({ link }: { link: WikiExternalLink }) {
  const [note, setNote] = useState("");
  const client = useQueryClient();
  const mutation = useResolveWikiLinkReview({
    mutation: { onSuccess: () => {
      setNote("");
      void client.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("/api/wiki/") });
    } },
  });
  return <form className="mt-2 space-y-2" onSubmit={(event) => {
    event.preventDefault();
    mutation.mutate({ externalLinkId: link.id, data: { note: note.trim(), incidentVersion: link.incidentVersion } });
  }}>
    <Textarea aria-label={`Nota de revisión de ${link.title}`} placeholder="Explica qué has revisado y tu decisión" value={note} maxLength={2000} required
      onChange={(event) => setNote(event.target.value)} disabled={mutation.isPending} />
    <Button size="sm" disabled={!note.trim() || mutation.isPending} type="submit">{mutation.isPending ? "Guardando…" : "Registrar revisión"}</Button>
    {mutation.isError && <p role="alert" className="text-xs text-destructive">
      No se pudo registrar. Si la incidencia ha cambiado o ya está revisada, actualiza la lista; tu nota se conserva.
    </p>}
  </form>;
}

export function WikiLinkReviews({ onSelect }: { onSelect: (pageId: number) => void }) {
  const [showReviewed, setShowReviewed] = useState(false);
  const query = useListWikiLinkReviews({
    query: { queryKey: getListWikiLinkReviewsQueryKey(), staleTime: 30_000, refetchInterval: 60_000 },
  });
  const pending = (link: WikiExternalLink) => !link.resolvedAt && !["healthy", "unchecked"].includes(link.checkStatus);
  const visible = query.data?.filter((link) => showReviewed ? !pending(link) : pending(link));
  return <section aria-label="Revisión de enlaces de Normativa" className="rounded-lg border bg-card p-4 space-y-3">
    <h2 className="font-semibold">Enlaces de Normativa para revisar{query.data ? ` (${query.data.filter(pending).length})` : ""}</h2>
    <Button variant="outline" size="sm" onClick={() => setShowReviewed(!showReviewed)}>{showReviewed ? "Ver pendientes" : "Ver revisados e historial"}</Button>
    <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>Actualizar lista</Button>
    <p className="text-xs text-muted-foreground">
      Comprobación semanal. Ante fallos, reintentos a las 6 y 24 horas; después, semanalmente.
      No se eliminan ni sustituyen enlaces. Accesibilidad no significa vigencia jurídica.
      Una revisión se conserva mientras persista el mismo diagnóstico; un problema distinto o una recaída tras recuperarse reabre el aviso.
    </p>
    {query.isPending && <p className="text-sm">Cargando comprobaciones…</p>}
    {query.isError && <div role="alert" className="text-sm">No se pudieron cargar los avisos. <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Reintentar</Button></div>}
    {visible?.length === 0 && <p className="text-sm text-muted-foreground">{showReviewed ? "No hay revisiones registradas." : "No hay incidencias pendientes de revisión."}</p>}
    <div className="max-h-80 overflow-y-auto space-y-3">
      {visible?.map((link) => <article key={link.id} className="border-t pt-3">
        <Button className="h-auto whitespace-normal p-0 text-left" variant="link" onClick={() => onSelect(link.pageId)}>{link.pageTitle} · {link.title}</Button>
        <div className="break-all text-xs text-muted-foreground">{link.url}</div>
        <WikiLinkHealth link={link} />
        {pending(link) && <ResolutionForm link={link} />}
      </article>)}
    </div>
  </section>;
}
