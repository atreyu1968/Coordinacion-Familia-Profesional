import type { ForumCollaborationTracking } from "@workspace/api-client-react";
import { METRIC_DEFINITIONS } from "@/lib/collab-tracking";
import { Info, ShieldQuestion } from "lucide-react";

export function TrackingSummary({ data }: { data: ForumCollaborationTracking }) {
  const t = data.totals;
  const items: [string, number, string][] = [
    ["Módulos con piloto", t.modules, "activos y desactivados"],
    ["Pilotos activos", t.enabled, `${t.modules - t.enabled} desactivados`],
    ["Requieren revisión", t.reviewNeeded, "curricular"],
    ["Participantes", t.participants, "distintos, todos los pilotos"],
    ["Centros con postura", t.centers, "distintos, todos los pilotos"],
    ["Recursos", t.resources, "vinculados"],
    ["Versiones publicadas", t.publishedVersions, "histórico"],
    ["Consultas abiertas", t.openConsultations, "sin cierre"],
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 border rounded-lg overflow-hidden bg-card divide-x divide-y lg:divide-y-0">
        {items.map(([l, v, h]) => (
          <div key={l} className="p-3" data-testid={`total-${l}`}>
            <div className="font-mono text-2xl tabular-nums leading-none">{v}</div>
            <div className="text-xs font-medium mt-1.5">{l}</div>
            <div className="text-[11px] text-muted-foreground">{h}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">Totales calculados por el servidor sobre todos los pilotos visibles; no cambian con los filtros. Participantes y centros son personas y centros distintos, no la suma de cada módulo.</p>
      <details className="text-xs rounded-md border p-3" data-testid="details-definitions">
        <summary className="cursor-pointer font-medium">Definiciones de las métricas</summary>
        <ul className="mt-2 space-y-1 text-muted-foreground list-disc pl-4">
          {METRIC_DEFINITIONS.map(([k, v]) => <li key={k}><span className="text-foreground">{k}:</span> {v}</li>)}
        </ul>
      </details>
      <div className="grid gap-2 md:grid-cols-2 text-xs">
        <div className="flex gap-2 rounded-md border border-dashed p-3 text-muted-foreground" data-testid="text-legend">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <p><span className="font-medium text-foreground">Leyenda. </span>{data.legend} Ningún acuerdo se aprueba automáticamente ni se presume unanimidad.</p>
        </div>
        <div className="flex gap-2 rounded-md border border-dashed p-3 text-muted-foreground" data-testid="text-provider-check">
          <ShieldQuestion className="w-4 h-4 shrink-0 mt-0.5" />
          <p><span className="font-medium text-foreground">Sincronización con proveedores: no comprobada. </span>Este panel no ejecuta diagnóstico de sincronización; la ausencia de avisos no significa cero fallos.</p>
        </div>
      </div>
    </div>
  );
}
