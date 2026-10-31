import type {
  TrainingOfferAiCandidate,
  TrainingOfferAiImportResult,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { shortUrl, type SourceState } from "./logic";

export function Safeguards() {
  return (
    <div className="flex gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <p>
        Solo se <strong className="text-foreground">añaden ciclos que faltan</strong> en el
        curso activo. No se borra ninguna oferta, no se sobrescriben turnos
        introducidos a mano y no se crean ciclos nuevos en el catálogo. Nada se
        guarda hasta que confirmes.
      </p>
    </div>
  );
}

export function WarningList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm" data-testid="status-training-offer-ai-warnings">
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        {title}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-6 text-muted-foreground">
        {items.map((w, i) => <li key={i}>{w}</li>)}
      </ul>
    </div>
  );
}

export function SourceList({ sources, analyzing }: { sources: SourceState[]; analyzing: boolean }) {
  const done = sources.filter((s) => s.status === "ok" || s.status === "error").length;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">Fuentes analizadas</span>
        <span className="tabular-nums text-muted-foreground">{done}/{sources.length}</span>
      </div>
      <Progress value={(done / sources.length) * 100} />
      <ul className="space-y-1.5">
        {sources.map((s, i) => (
          <li key={s.url} className="rounded-md border p-2 text-sm" data-testid={`row-ai-source-${i}`}>
            <div className="flex items-center gap-2">
              {s.status === "running" && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
              {s.status === "pending" && <span className="h-4 w-4 shrink-0 rounded-full border" />}
              {s.status === "ok" && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
              {s.status === "error" && <XCircle className="h-4 w-4 shrink-0 text-destructive" />}
              <a href={s.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-primary underline-offset-4 hover:underline">
                {shortUrl(s.url)}
              </a>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {s.status === "ok" && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {s.result.rows.length} propuestas · {s.result.rejected} descartadas
                </span>
              )}
            </div>
            {s.status === "error" && <p className="mt-1 pl-6 text-xs text-destructive">{s.error}</p>}
            {s.status === "ok" && s.result.warnings.length > 0 && (
              <ul className="mt-1 space-y-0.5 pl-6 text-xs text-amber-700 dark:text-amber-400">
                {s.result.warnings.map((w, k) => <li key={k}>{w}</li>)}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {analyzing && (
        <p className="text-xs text-muted-foreground">
          Cada fuente se analiza de una en una y puede tardar hasta un minuto.
        </p>
      )}
    </div>
  );
}

export function CandidateList({ rows }: { rows: TrainingOfferAiCandidate[] }) {
  return (
    <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
      {rows.map((r) => (
        <li
          key={`${r.centerId}:${r.cycleId}`}
          className={`rounded-md border p-3 text-sm ${r.existing ? "opacity-70" : "border-l-4 border-l-primary"}`}
          data-testid={`row-ai-candidate-${r.centerId}-${r.cycleId}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium">{r.cycleName}</p>
              <p className="text-xs text-muted-foreground">{r.centerName} · Código {r.centerCode}</p>
            </div>
            <div className="flex gap-1.5">
              {r.level && <Badge variant="secondary">{r.level}</Badge>}
              {r.existing ? <Badge variant="outline">Ya registrado</Badge> : <Badge>Nuevo</Badge>}
            </div>
          </div>
          <blockquote className="mt-2 border-l-2 pl-2 text-xs italic text-muted-foreground">«{r.evidence}»</blockquote>
          <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
            Fuente: {shortUrl(r.sourceUrl)}
            <ExternalLink className="h-3 w-3" />
          </a>
        </li>
      ))}
    </ul>
  );
}

export function PartialNotice({
  failed,
  total,
  hasDiscoveryWarnings,
  checked,
  disabled,
  onChange,
}: {
  failed: number;
  total: number;
  hasDiscoveryWarnings: boolean;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-2 rounded-md border-2 border-destructive/60 bg-destructive/5 p-3 text-sm" data-testid="status-training-offer-ai-partial">
      <p className="flex items-center gap-2 font-semibold text-destructive">
        <AlertTriangle className="h-4 w-4" />
        Cobertura parcial de fuentes
      </p>
      <ul className="list-disc space-y-0.5 pl-6 text-muted-foreground">
        {failed > 0 && <li>{failed} de {total} fuentes no pudieron analizarse.</li>}
        {hasDiscoveryWarnings && (
          <li>La búsqueda avisó de fuentes omitidas o no disponibles (ver avisos).</li>
        )}
      </ul>
      <p className="text-muted-foreground">
        Solo se aplicarán las propuestas de las fuentes analizadas correctamente.
        Puede faltar oferta.
      </p>
      <label className="flex items-center gap-2">
        <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} disabled={disabled} data-testid="checkbox-ai-partial-ack" />
        Entiendo que la cobertura es parcial
      </label>
    </div>
  );
}

export function ResultPanel({ result }: { result: TrainingOfferAiImportResult }) {
  return (
    <div className="space-y-3 rounded-md border border-emerald-600/40 bg-emerald-600/5 p-4 text-sm" data-testid="status-training-offer-ai-done">
      <p className="flex items-center gap-2 font-semibold">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        Oferta actualizada para el curso {result.schoolYear}
      </p>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Añadidos" value={result.added} />
        <Stat label="Sin cambios" value={result.unchanged} />
        <Stat label="Centros con coincidencia" value={result.matchedCenters} />
      </div>
      {result.pendingCenters.length > 0 && (
        <div>
          <p className="font-medium">Centros pendientes de revisión manual</p>
          <ul className="mt-1 space-y-1">
            {result.pendingCenters.map((p) => (
              <li key={p.id} className="rounded border bg-background p-2 text-xs" data-testid={`row-ai-pending-${p.id}`}>
                <span className="font-medium">{p.name}</span>
                <span className="text-muted-foreground"> — {p.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border bg-background p-2">
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
