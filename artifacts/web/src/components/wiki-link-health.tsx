import {
  useListWikiLinkReviews, getListWikiLinkReviewsQueryKey, type WikiExternalLink,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

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
  </div>;
}

export function WikiLinkReviews({ onSelect }: { onSelect: (pageId: number) => void }) {
  const query = useListWikiLinkReviews({
    query: { queryKey: getListWikiLinkReviewsQueryKey(), staleTime: 30_000, refetchInterval: 60_000 },
  });
  return <section aria-label="Revisión de enlaces de Normativa" className="rounded-lg border bg-card p-4 space-y-3">
    <h2 className="font-semibold">Enlaces de Normativa para revisar{query.data ? ` (${query.data.length})` : ""}</h2>
    <p className="text-xs text-muted-foreground">
      Comprobación semanal. Ante fallos, reintentos a las 6 y 24 horas; después, semanalmente.
      No se eliminan ni sustituyen enlaces. Accesibilidad no significa vigencia jurídica.
    </p>
    {query.isPending && <p className="text-sm">Cargando comprobaciones…</p>}
    {query.isError && <div role="alert" className="text-sm">No se pudieron cargar los avisos. <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Reintentar</Button></div>}
    {query.data?.length === 0 && <p className="text-sm text-muted-foreground">No hay incidencias detectadas. Los enlaces pendientes aún no tienen diagnóstico.</p>}
    <div className="max-h-80 overflow-y-auto space-y-3">
      {query.data?.map((link) => <article key={link.id} className="border-t pt-3">
        <Button className="h-auto whitespace-normal p-0 text-left" variant="link" onClick={() => onSelect(link.pageId)}>{link.pageTitle} · {link.title}</Button>
        <div className="break-all text-xs text-muted-foreground">{link.url}</div>
        <WikiLinkHealth link={link} />
      </article>)}
    </div>
  </section>;
}
