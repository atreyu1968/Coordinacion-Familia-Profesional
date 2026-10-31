import { useState } from "react";
import { Link } from "wouter";
import type { ForumTrackingModule } from "@workspace/api-client-react";
import { ChevronDown, ExternalLink, FileText, MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { Pill, Ratio } from "./metric";
import { THREAD_KIND_LABELS, formatDateTime, isMissingSynthesis, missingCount, threadStatusLabel } from "@/lib/collab-tracking";

export function ModuleRow({ m }: { m: ForumTrackingModule }) {
  const [open, setOpen] = useState(false);
  const missing = missingCount(m);
  return (
    <div className="border rounded-lg bg-card" data-testid={`card-tracking-module-${m.id}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left p-4 flex flex-col md:flex-row md:items-center gap-3"
        aria-expanded={open}
        data-testid={`button-toggle-module-${m.id}`}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {m.code && <span className="font-mono text-xs text-muted-foreground">{m.code}</span>}
            <span className="font-semibold">{m.name}</span>
          </div>
          <div className="flex gap-1.5 flex-wrap mt-1.5">
            <Pill tone={m.enabled ? "ok" : "muted"}>{m.enabled ? "Piloto activo" : "Piloto desactivado"}</Pill>
            <Pill tone={m.verificationCurrent ? "ok" : "warn"}>{m.verificationCurrent ? "Revisión curricular vigente" : "Revisión curricular no vigente"}</Pill>
            {m.reviewNeeded && <Pill tone="warn">Requiere revisión</Pill>}
            {missing > 0 && <Pill tone="warn">{missing} sin síntesis</Pill>}
            {m.publishedVersions > 0 && <Pill tone="info">{m.publishedVersions} versiones publicadas</Pill>}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 md:w-80 text-center">
          <div><div className="font-mono tabular-nums">{m.createdThreads}<span className="text-muted-foreground">/{m.plannedThreads}</span></div><div className="text-[11px] text-muted-foreground">temas</div></div>
          <div><div className="font-mono tabular-nums">{m.participants}<span className="text-muted-foreground">/{m.eligibleParticipants}</span></div><div className="text-[11px] text-muted-foreground">participantes</div></div>
          <div><div className="font-mono tabular-nums">{m.centers}<span className="text-muted-foreground">/{m.eligibleCenters}</span></div><div className="text-[11px] text-muted-foreground">centros con postura</div></div>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform hidden md:block", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t p-4 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Ratio label="RA con criterios" value={m.outcomesWithCriteria} of={m.outcomes} hint={`${m.criteria} criterios definidos`} />
            <Ratio label="RA con recursos visibles" value={m.outcomesWithResources} of={m.outcomes} hint={`${m.resources} recursos vigentes`} />
            <Ratio label="Recursos a revisar" value={m.resourcesNeedingReview} of={m.resources} hint="Huella o versión del currículo no coincide" />
            <Ratio label="Temas creados / previstos" value={m.createdThreads} of={m.plannedThreads} />
            <Ratio label="Participantes reales / elegibles" value={m.participants} of={m.eligibleParticipants} hint="Elegibles: censo vivo actual, no el censo congelado de un acuerdo" />
            <Ratio label="Centros con postura / elegibles" value={m.centers} of={m.eligibleCenters} />
            <Ratio label="Versiones publicadas" value={m.publishedVersions} hint="Páginas conservadas del módulo, incluidas versiones anteriores" />
            <div className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Última actividad</span>
              <p className="text-sm">{formatDateTime(m.lastActivityAt)}</p>
            </div>
          </div>
          {m.diagnostics.length > 0 && (
            <ul className="text-xs space-y-1 rounded-md bg-amber-500/5 border border-amber-600/20 p-3" data-testid={`list-diagnostics-${m.id}`}>
              {m.diagnostics.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          )}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Temas</h4>
              <Link href={`/foros?module=${m.id}`} className="text-xs text-primary inline-flex items-center gap-1 hover:underline" data-testid={`link-module-${m.id}`}>
                Abrir foro del módulo <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
            {m.threads.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no hay temas creados en este módulo.</p>
            ) : (
              <ul className="divide-y border rounded-md">
                {m.threads.map((t) => (
                  <li key={t.id} className="p-2.5 flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
                    <Link href={`/foros?module=${m.id}&thread=${t.id}`} className="flex-1 min-w-0 inline-flex items-center gap-2 hover:text-primary" data-testid={`link-thread-${t.id}`}>
                      <MessagesSquare className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{t.title}</span>
                    </Link>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Pill tone="muted">{THREAD_KIND_LABELS[t.kind] ?? t.kind}</Pill>
                      <Pill tone={isMissingSynthesis(t) ? "warn" : "info"}>{threadStatusLabel(t)}</Pill>
                      {t.version != null && <span className="font-mono text-[11px] text-muted-foreground">v{t.version}</span>}
                      {t.publishedPageId != null && (
                        <Link href={`/documentacion?page=${t.publishedPageId}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline" data-testid={`link-doc-${t.id}`}>
                          <FileText className="w-3 h-3" /> Documento
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
