import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAiKnowledgeCoverageQueryKey, useGetAiKnowledgeCoverage, useRefreshAiKnowledgeIndex,
  type AiKnowledgeSourceCoverage,
} from "@workspace/api-client-react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

const SOURCE_LABEL = { platform: "Plataforma", gmail: "Gmail", nextcloud: "Nextcloud" };
const STATUS_LABEL: Record<AiKnowledgeSourceCoverage["status"], string> = {
  ready: "Al día", pending: "Pendiente de indexar", partial: "Cobertura parcial",
  importing: "Importación en curso", disconnected: "Sin conexión", error: "Requiere atención",
};

export function KnowledgeCoveragePanel() {
  const qc = useQueryClient();
  const query = useGetAiKnowledgeCoverage({ query: {
    queryKey: getGetAiKnowledgeCoverageQueryKey(),
    staleTime: 30_000, refetchInterval: 60_000, retry: false,
  } });
  const refresh = useRefreshAiKnowledgeIndex();
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState(false);
  const updateIndex = async () => {
    setError(""); setUpdated(false);
    // Cancel a preview already in flight so it cannot overwrite the new counts.
    await qc.cancelQueries({ queryKey: getGetAiKnowledgeCoverageQueryKey() });
    try {
      const result = await refresh.mutateAsync({ data: { consent: true } });
      qc.setQueryData(getGetAiKnowledgeCoverageQueryKey(), result);
      setUpdated(true);
    } catch {
      setError("No se pudo actualizar el índice. Los originales se conservan. Vuelve a intentarlo.");
      void query.refetch();
    }
  };
  return <section className="mail-knowledge" aria-label="Cobertura de materiales para la IA" data-testid="panel-ai-knowledge">
    <h3>Qué materiales puede consultar la IA</h3>
    <p>Solo tus correos importados y los materiales a los que tienes acceso. Esta vista muestra recuentos, nunca contenidos privados. Consultarla no envía materiales a la IA.</p>
    {query.isLoading && <p role="status">Comprobando cobertura…</p>}
    {query.isError && <div role="alert"><p>No se pudo comprobar la cobertura actual. No uses los recuentos anteriores como confirmación de acceso.</p><Button size="sm" variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>Reintentar consulta</Button></div>}
    {query.data && <div className="mail-knowledge__sources" aria-busy={query.isFetching || refresh.isPending}>
      {query.data.sources.map(source => <article key={source.id} data-testid={`knowledge-source-${source.id}`}>
        <header><strong>{SOURCE_LABEL[source.id]}</strong><span>{STATUS_LABEL[source.status]}</span></header>
        <dl className="mail-knowledge__counts">
          {([["indexed", "Indexados"], ["pending", "Pendientes"], ["omitted", "Omitidos"], ["errors", "Errores"]] as const).map(([key, label]) =>
            <div key={key}><dt>{label}</dt><dd data-testid={`knowledge-${source.id}-${key}`}>{source[key]}</dd></div>)}
        </dl>
        {source.omissions.length > 0 && <ul>{source.omissions.map(item => <li key={item.reason}>{item.count} material(es): {item.reason}</li>)}</ul>}
        {source.notes.length > 0 && <ul>{source.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
      </article>)}
      <p>Los pendientes son materiales detectados aún no indexados. Los omitidos no se consultan; los errores se pueden reintentar. Una fuente no disponible puede tener cero errores de archivo porque no se ha podido contar su contenido.</p>
      <p>Última actualización del índice: {query.data.lastIndexedAt ? new Date(query.data.lastIndexedAt).toLocaleString("es-ES") : "Todavía no se ha actualizado"}.</p>
    </div>}
    <p>Nextcloud utiliza la conexión administrativa de solo lectura y tus permisos actuales. No tienes que autorizar una cuenta individual de Nextcloud.</p>
    <label className="mail-consent"><Checkbox checked={consent} onCheckedChange={value => setConsent(value === true)} data-testid="checkbox-ai-index-consent" />
      Autorizo procesar los materiales accesibles con los proveedores de IA configurados, cuando sea necesario para extraer texto y actualizar el índice.
    </label>
    <Button size="sm" variant="outline" onClick={() => void updateIndex()} disabled={!consent || refresh.isPending} data-testid="button-refresh-ai-index">
      <RefreshCw className={refresh.isPending ? "mail-spin" : ""} />{refresh.isPending ? "Actualizando índice…" : "Actualizar índice y reintentar errores"}
    </Button>
    {updated && <p role="status">Índice actualizado. Los archivos pendientes se procesan en segundo plano; los recuentos se revisan automáticamente cada minuto. Para nuevos correos, sincroniza Gmail y vuelve a actualizar el índice.</p>}
    {error && <p role="alert" className="mail-safe-error">{error}</p>}
  </section>;
}
