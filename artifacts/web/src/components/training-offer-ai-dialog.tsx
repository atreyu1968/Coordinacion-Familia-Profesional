import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  discoverTrainingOfferAi,
  analyzeTrainingOfferAi,
  applyTrainingOfferAi,
  type TrainingOfferAiDiscovery,
  type TrainingOfferAiImportResult,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Sparkles, XCircle } from "lucide-react";
import {
  aggregateCandidates,
  computeCanApply,
  errorText,
  isAbort,
  MAX_SOURCE_URLS,
  parseUrls,
  validateSourceUrls,
  type OkSource,
  type Phase,
  type SourceState,
} from "./training-offer-ai/logic";
import {
  CandidateList,
  PartialNotice,
  ResultPanel,
  Safeguards,
  SourceList,
  WarningList,
} from "./training-offer-ai/parts";

export function TrainingOfferAiDialog({
  centerId,
  centerName,
  triggerSize = "default",
}: {
  centerId?: number;
  centerName?: string;
  triggerSize?: "default" | "sm";
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [urlsText, setUrlsText] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<TrainingOfferAiDiscovery | null>(null);
  const [sources, setSources] = useState<SourceState[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [partialAck, setPartialAck] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [result, setResult] = useState<TrainingOfferAiImportResult | null>(null);
  const epoch = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const applyingRef = useRef(false);

  const resetAll = () => {
    epoch.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("form");
    setFormError(null);
    setDiscovery(null);
    setSources([]);
    setReviewed(false);
    setPartialAck(false);
    setApplyError(null);
    setResult(null);
  };

  const onOpenChange = (o: boolean) => {
    if (!o && phase === "applying") return;
    if (!o) resetAll();
    setOpen(o);
  };

  const parsedUrls = parseUrls(urlsText);

  const start = async () => {
    setFormError(null);
    const invalid = validateSourceUrls(parsedUrls);
    if (invalid) {
      setFormError(invalid);
      return;
    }
    const my = ++epoch.current;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase("discovering");
    let disc: TrainingOfferAiDiscovery;
    try {
      disc = await discoverTrainingOfferAi(
        {
          ...(centerId != null ? { centerId } : {}),
          ...(parsedUrls.length ? { sourceUrls: parsedUrls } : {}),
        },
        { signal: ctrl.signal },
      );
    } catch (e) {
      if (my !== epoch.current || isAbort(e)) return;
      setFormError(errorText(e));
      setPhase("form");
      return;
    }
    if (my !== epoch.current) return;
    setDiscovery(disc);
    setSources(disc.sources.map((url) => ({ url, status: "pending" })));
    if (disc.sources.length === 0) {
      setPhase("review");
      return;
    }
    setPhase("analyzing");
    for (let i = 0; i < disc.sources.length; i++) {
      if (my !== epoch.current) return;
      const url = disc.sources[i];
      setSources((s) => s.map((x, j) => (j === i ? { url, status: "running" } : x)));
      let next: SourceState;
      try {
        const r = await analyzeTrainingOfferAi(
          { contextToken: disc.contextToken, sourceUrl: url },
          { signal: ctrl.signal },
        );
        next = { url, status: "ok", result: r };
      } catch (e) {
        if (my !== epoch.current || isAbort(e)) return;
        next = { url, status: "error", error: errorText(e) };
      }
      if (my !== epoch.current) return;
      setSources((s) => s.map((x, j) => (j === i ? next : x)));
    }
    if (my !== epoch.current) return;
    setPhase("review");
  };

  const okSources = sources.filter((s): s is OkSource => s.status === "ok");
  const failedCount = sources.filter((s) => s.status === "error").length;
  const hasDiscoveryWarnings = (discovery?.warnings.length ?? 0) > 0;
  const isPartial = failedCount > 0 || hasDiscoveryWarnings;
  const rows = aggregateCandidates(okSources);
  const newCount = rows.filter((r) => !r.existing).length;
  const canApply =
    !!discovery &&
    computeCanApply({
      phase,
      okCount: okSources.length,
      candidateCount: rows.length,
      reviewed,
      partial: isPartial,
      partialAck,
    });

  const apply = async () => {
    if (!discovery || applyingRef.current || !canApply) return;
    applyingRef.current = true;
    const my = epoch.current;
    setApplyError(null);
    setPhase("applying");
    try {
      const r = await applyTrainingOfferAi({
        contextToken: discovery.contextToken,
        resultTokens: okSources.map((s) => s.result.resultToken),
      });
      await qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return typeof k === "string" && (k.startsWith("/api/centers") || k.startsWith("/api/dashboard"));
        },
      });
      if (my !== epoch.current) return;
      setResult(r);
      setPhase("done");
    } catch (e) {
      if (my !== epoch.current) return;
      setApplyError(errorText(e));
      setPhase("review");
    } finally {
      applyingRef.current = false;
    }
  };

  const busy = phase === "discovering" || phase === "analyzing";
  const applying = phase === "applying";
  const reviewing = phase === "review" || applying;
  const scopeLabel = centerId != null ? centerName ?? "este centro" : "todos los centros activos de la familia";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Button
        size={triggerSize}
        variant="outline"
        className="gap-2 border-primary/40 text-primary hover:bg-primary/5"
        onClick={() => setOpen(true)}
        data-testid="button-open-training-offer-ai"
      >
        <Sparkles className="h-4 w-4" />
        Actualizar oferta con IA
      </Button>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl"
        onEscapeKeyDown={(e) => applying && e.preventDefault()}
        onPointerDownOutside={(e) => applying && e.preventDefault()}
        onInteractOutside={(e) => applying && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Actualizar oferta con IA
          </DialogTitle>
          <DialogDescription>
            Ámbito: {scopeLabel}. La IA configurada lee fuentes oficiales de la
            Consejería de Educación y propone ciclos con evidencia citada.
          </DialogDescription>
        </DialogHeader>

        <Safeguards />

        {phase === "form" && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="ai-offer-urls">Fuentes oficiales adicionales (opcional)</Label>
              <Textarea
                id="ai-offer-urls"
                rows={4}
                value={urlsText}
                onChange={(e) => setUrlsText(e.target.value)}
                placeholder="https://www.gobiernodecanarias.org/educacion/... (una por línea)"
                className="font-mono text-xs"
                data-testid="input-training-offer-ai-urls"
              />
              <p className="text-xs text-muted-foreground">
                Si se deja vacío se consulta la página oficial de oferta educativa
                de Canarias. Esa página puede mostrar ya un curso distinto del curso
                activo; en ese caso indica aquí la página o PDF oficial del curso
                activo (o de FP Adaptada). Solo se admiten direcciones HTTPS del
                portal oficial de Educación. {parsedUrls.length}/{MAX_SOURCE_URLS}
              </p>
            </div>
            {formError && (
              <p className="flex items-start gap-2 text-sm font-medium text-destructive" data-testid="text-training-offer-ai-error">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {formError}
              </p>
            )}
          </div>
        )}

        {phase === "discovering" && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm" data-testid="status-training-offer-ai-discovering">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Localizando fuentes oficiales del curso activo...
          </div>
        )}

        {discovery && phase !== "form" && phase !== "discovering" && phase !== "done" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge>Curso activo {discovery.schoolYear}</Badge>
              <Badge variant="secondary">{discovery.family}</Badge>
              <Badge variant="outline">
                {discovery.centerCount} {discovery.centerCount === 1 ? "centro" : "centros"} en ámbito
              </Badge>
            </div>

            {hasDiscoveryWarnings && <WarningList title="Avisos de la búsqueda" items={discovery.warnings} />}

            {discovery.sources.length === 0 ? (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm" data-testid="status-training-offer-ai-no-sources">
                <p className="font-medium">No se encontraron fuentes para el curso {discovery.schoolYear}.</p>
                <p className="mt-1 text-muted-foreground">
                  Esto no significa que no exista oferta: la página oficial puede
                  estar publicando otro curso. Vuelve a empezar e indica la dirección
                  oficial (HTML o PDF) de la oferta del curso {discovery.schoolYear}.
                </p>
              </div>
            ) : (
              <SourceList sources={sources} analyzing={phase === "analyzing"} />
            )}

            {reviewing && okSources.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">Propuestas para revisar</span>
                  <span className="text-muted-foreground" data-testid="text-ai-candidate-totals">
                    {rows.length} propuestas · {newCount} nuevas · {rows.length - newCount} ya registradas
                  </span>
                </div>
                {rows.length === 0 ? (
                  <p className="rounded-md border p-3 text-sm text-muted-foreground" data-testid="status-training-offer-ai-empty">
                    Las fuentes analizadas no aportaron ciclos con evidencia para los
                    centros del ámbito. No hay nada que añadir. Si esperabas resultados,
                    prueba con la dirección oficial del curso {discovery.schoolYear}.
                  </p>
                ) : (
                  <>
                    <CandidateList rows={rows} />
                    {isPartial && (
                      <PartialNotice
                        failed={failedCount}
                        total={sources.length}
                        hasDiscoveryWarnings={hasDiscoveryWarnings}
                        checked={partialAck}
                        disabled={applying}
                        onChange={setPartialAck}
                      />
                    )}
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={reviewed}
                        onCheckedChange={(v) => setReviewed(v === true)}
                        disabled={applying}
                        data-testid="checkbox-ai-reviewed"
                      />
                      He revisado las propuestas y su evidencia
                    </label>
                  </>
                )}
              </div>
            )}

            {phase === "review" && okSources.length === 0 && sources.length > 0 && (
              <p className="text-sm text-destructive">
                Ninguna fuente pudo analizarse. Vuelve a intentarlo o indica otra
                dirección oficial del curso {discovery.schoolYear}.
              </p>
            )}

            {applyError && (
              <p className="flex items-start gap-2 text-sm font-medium text-destructive" data-testid="text-training-offer-ai-apply-error">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {applyError}
              </p>
            )}
          </div>
        )}

        {phase === "done" && result && <ResultPanel result={result} />}

        <DialogFooter className="gap-2">
          {phase === "form" && (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={start} className="gap-2" data-testid="button-training-offer-ai-start">
                <Sparkles className="h-4 w-4" />
                Buscar y analizar
              </Button>
            </>
          )}
          {busy && (
            <Button variant="ghost" onClick={resetAll} data-testid="button-training-offer-ai-abort">Detener</Button>
          )}
          {reviewing && (
            <>
              <Button variant="ghost" onClick={resetAll} disabled={applying}>Volver a empezar</Button>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>Cancelar</Button>
              {rows.length > 0 && (
                <Button onClick={apply} disabled={applying || !canApply} className="gap-2" data-testid="button-training-offer-ai-apply">
                  {applying && <Loader2 className="h-4 w-4 animate-spin" />}
                  {applying ? "Añadiendo..." : `Añadir ciclos que faltan (${newCount})`}
                </Button>
              )}
            </>
          )}
          {phase === "done" && (
            <Button onClick={() => onOpenChange(false)} data-testid="button-training-offer-ai-ack">Entendido</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
