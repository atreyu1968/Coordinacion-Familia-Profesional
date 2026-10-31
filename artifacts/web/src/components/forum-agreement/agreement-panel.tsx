import { useMemo, useState } from "react";
import { Link } from "wouter";
import type { ForumPost } from "@workspace/api-client-react";
import {
  collaborationHref,
  currentVersionPositions,
  historyByVersion,
  POSITION_LABELS,
  PUBLISHABLE_STATUSES,
  publishedPageHref,
  STATUS_HINTS,
  summarizePositions,
} from "@/lib/forum-agreement";
import { agreementTemplateHtml, agreementTemplateText, participantName } from "@/lib/forum-agreement";
import { openResourceUrl } from "@/lib/protected-resource-link";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { BookOpen, ClipboardCopy, Download, ChevronDown, ChevronUp, ExternalLink, FileText, History, Pencil, RefreshCw, Scale, Upload } from "lucide-react";
import {
  formatAgreementDate,
  ParticipationLine,
  PlainTextPreview,
  StatusPill,
  StatusTrack,
  useAgreementWorkspace,
} from "./shared";
import { PositionForm } from "./position-form";
import { AgreementEditorDialog } from "./editor-dialog";
import { PublishDialog } from "./publish-dialog";

const POS_TONE = {
  a_favor: "bg-emerald-500",
  con_reservas: "bg-amber-500",
  en_contra: "bg-rose-500",
} as const;

export function AgreementPanel({ threadId, posts, moduleName, threadTitle }: { threadId: number; posts: ForumPost[]; moduleName: string; threadTitle: string }) {
  const q = useAgreementWorkspace(threadId);
  const [editing, setEditing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const ws = q.data;
  const current = useMemo(() => (ws ? currentVersionPositions(ws) : []), [ws]);
  const summary = useMemo(() => summarizePositions(current), [current]);
  const history = useMemo(() => historyByVersion(ws?.positionHistory ?? []), [ws]);

  if (q.isLoading) {
    return (
      <section className="space-y-2 rounded-lg border p-4" data-testid="panel-agreement-loading">
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        <div className="h-16 animate-pulse rounded bg-muted" />
      </section>
    );
  }
  if (q.isError || !ws) {
    return (
      <section role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 p-3 text-sm text-destructive" data-testid="panel-agreement-error">
        <span>No se pudo cargar el acuerdo intercentros de este hilo.</span>
        <Button size="sm" variant="outline" className="gap-1" onClick={() => void q.refetch()} data-testid="button-retry-agreement">
          <RefreshCw className="h-3.5 w-3.5" /> Reintentar
        </Button>
      </section>
    );
  }

  const a = ws.agreement;
  const openDoc = (url: string) =>
    void openResourceUrl(url).catch((err: unknown) =>
      toast({ title: "No se pudo abrir", description: err instanceof Error ? err.message : "Inténtalo de nuevo.", variant: "destructive" }),
    );

  const author = a ? participantName(ws, a.responsibleId) ?? [...ws.revisions].sort((x, y) => x.revision - y.revision)[0]?.actorName ?? null : null;
  const reviewer = a ? participantName(ws, a.reviewerId) : null;
  const copyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(agreementTemplateText(ws, moduleName, threadTitle));
      toast({ title: "Plantilla copiada", description: "Pégala en el borrador canónico de Nextcloud." });
    } catch {
      toast({ title: "No se pudo copiar", description: "Tu navegador bloqueó el portapapeles.", variant: "destructive" });
    }
  };
  const downloadTemplate = async () => {
    try {
      const { createHtmlDocx } = await import("@/lib/html-docx");
      const name = `acuerdo-${threadId}-v${a?.version ?? 0}.docx`;
      const blob = await createHtmlDocx(agreementTemplateHtml(ws, moduleName, threadTitle), name);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast({ title: "No se pudo generar el Word", description: err instanceof Error ? err.message : "Prueba a copiar la plantilla.", variant: "destructive" });
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border bg-card" data-testid="panel-agreement">
      <header className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
        <Scale className="h-4 w-4 text-primary" />
        <h3 className="flex-1 text-sm font-semibold">
          Acuerdo intercentros{a ? ` · versión ${a.version}` : ""}
        </h3>
        <span className="rounded border border-dashed px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">No oficial</span>
        {q.isFetching && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" aria-label="Actualizando" />}
      </header>

      {!a ? (
        <div className="space-y-3 p-4">
          <p className="text-sm text-muted-foreground" data-testid="text-agreement-empty">
            Este hilo aún no tiene síntesis. Sigue debatiendo en el foro; cuando haya base suficiente, la moderación puede resumirlo en una propuesta y abrir una consulta.
          </p>
          <ParticipationLine p={ws.participation} />
          {ws.canEdit && (
            <Button size="sm" className="gap-1.5" onClick={() => setEditing(true)} data-testid="button-start-agreement">
              <Pencil className="h-3.5 w-3.5" /> Iniciar síntesis
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4 p-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={a.status} />
              <span className="text-[11px] text-muted-foreground">Actualizado {formatAgreementDate(a.updatedAt)} · currículo {a.curriculumVersion}</span>
              {!ws.curriculumCurrent && (
                <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">El currículo del piloto ha cambiado desde esta versión</span>
              )}
            </div>
            <StatusTrack status={a.status} />
            <p className="text-xs text-muted-foreground">{STATUS_HINTS[a.status]}</p>
          </div>

          {(author || reviewer) && (
            <p className="text-[11px] text-muted-foreground" data-testid="text-agreement-responsible">
              {author ? `Responsable: ${author}` : ""}{author && reviewer ? " · " : ""}{reviewer ? `Revisión: ${reviewer}` : ""}
            </p>
          )}
          {a.summary && <p className="whitespace-pre-wrap text-sm" data-testid="text-agreement-summary">{a.summary}</p>}

          <div className="rounded-md border-l-4 border-primary/50 bg-muted/30 py-3 pl-4 pr-3">
            <PlainTextPreview text={a.proposedText} compact={!expanded} />
            {a.proposedText.trim() && (
              <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs text-primary" onClick={() => setExpanded((v) => !v)} data-testid="button-expand-agreement">
                {expanded ? <><ChevronUp className="h-3 w-3" /> Mostrar menos</> : <><ChevronDown className="h-3 w-3" /> Leer completo</>}
              </button>
            )}
          </div>

          {a.observations && (
            <p className="text-xs text-muted-foreground"><span className="font-semibold text-foreground">Observaciones: </span><span className="whitespace-pre-wrap">{a.observations}</span></p>
          )}
          {a.closureReason && (
            <p className="rounded-md bg-muted/50 p-2 text-xs"><span className="font-semibold">Motivo de cierre: </span><span className="whitespace-pre-wrap">{a.closureReason}</span></p>
          )}

          {(a.sources.length > 0 || a.documentUrl || a.publishedPageId != null) && (
            <ul className="space-y-1 text-xs">
              {a.documentUrl && (
                <li>
                  <a href={a.documentUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.preventDefault(); openDoc(a.documentUrl!); }} className="inline-flex items-center gap-1 font-medium text-primary hover:underline" data-testid="link-agreement-document">
                    <FileText className="h-3.5 w-3.5" /> Documento colaborativo (Nextcloud) <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              )}
              {a.publishedPageId != null && (
                <li>
                  <Link href={publishedPageHref(a.publishedPageId)} className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline dark:text-emerald-300" data-testid="link-agreement-published">
                    <BookOpen className="h-3.5 w-3.5" /> Versión {a.version} publicada en Documentación
                  </Link>
                </li>
              )}
              {a.sources.map((s, i) => (
                <li key={i} className="text-muted-foreground">
                  {s.url.startsWith("/") ? (
                    <Link href={s.url} className="hover:underline" data-testid={`link-agreement-source-${i}`}>{s.title}</Link>
                  ) : (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:underline" data-testid={`link-agreement-source-${i}`}>{s.title}</a>
                  )}
                </li>
              ))}
              {a.sourcePostIds.length > 0 && <li className="text-muted-foreground">{a.sourcePostIds.length} mensajes del hilo citados como base</li>}
            </ul>
          )}

          <div className="space-y-2 border-t pt-3">
            <ParticipationLine p={ws.participation} />
            {summary.total > 0 ? (
              <>
                <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                  {(["a_favor", "con_reservas", "en_contra"] as const).map((k) =>
                    summary.counts[k] > 0 ? <div key={k} className={POS_TONE[k]} style={{ flex: summary.counts[k] }} /> : null,
                  )}
                </div>
                <p className="text-xs" data-testid="text-agreement-counts">
                  {(["a_favor", "con_reservas", "en_contra"] as const).map((k) => `${POSITION_LABELS[k]}: ${summary.counts[k]}`).join(" · ")}
                  <span className="text-muted-foreground"> — {summary.total} posiciones de {summary.centers} centros. No se aplica mayoría automática.</span>
                </p>
                {summary.objections.length > 0 && (
                  <ul className="space-y-1.5">
                    {summary.objections.map((p) => (
                      <li key={p.id} className="rounded-md border p-2 text-xs" data-testid={`row-objection-${p.id}`}>
                        <p>
                          <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${POS_TONE[p.position]}`} />
                          <span className="font-semibold">{p.userName ?? "Docente"}</span>
                          <span className="text-muted-foreground"> · {p.centerName} · {POSITION_LABELS[p.position]}</span>
                        </p>
                        {p.reason && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{p.reason}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Aún no hay posiciones registradas en esta versión.</p>
            )}
          </div>

          {a.status === "consulta" && ws.canPosition && <PositionForm key={`${a.id}-${a.version}`} ws={ws} />}

          {(history.length > 0 || ws.revisions.length > 0) && (
            <div>
              <button type="button" onClick={() => setShowHistory((v) => !v)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="button-toggle-agreement-history">
                <History className="h-3.5 w-3.5" /> Historial ({ws.revisions.length} revisiones, {ws.positionHistory.length} cambios de posición)
              </button>
              {showHistory && (
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <ol className="space-y-1 text-xs">
                    {[...ws.revisions].sort((x, y) => y.revision - x.revision).map((r) => (
                      <li key={r.revision} className="border-l-2 pl-2">
                        <span className="font-medium">v{r.version} · rev. {r.revision}</span> · <StatusPill status={r.snapshot.status} />
                        {r.snapshot.publishedPageId != null && (
                          <Link href={publishedPageHref(r.snapshot.publishedPageId)} className="ml-2 text-primary underline">
                            Abrir referencia publicada v{r.version}
                          </Link>
                        )}
                        <span className="block text-muted-foreground">{r.actorName ?? "Sistema"} · {formatAgreementDate(r.createdAt)} · {r.participation.teachers} docentes / {r.participation.centers} centros / censo {r.participation.eligible}</span>
                      </li>
                    ))}
                  </ol>
                  <div className="space-y-2 text-xs">
                    {history.map((g) => (
                      <div key={g.version}>
                        <p className="font-medium">Versión {g.version}</p>
                        <ul className="space-y-0.5 text-muted-foreground">
                          {g.items.map((p) => (
                            <li key={p.id}>{p.userName ?? "Docente"} ({p.centerName}): {POSITION_LABELS[p.position]} · {formatAgreementDate(p.updatedAt)}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {a.status === "consulta" && !ws.canPosition && (
            <p className="text-xs text-muted-foreground" data-testid="text-agreement-not-in-census">No figuras en el censo fijado al abrir esta consulta. Puedes seguir debatiendo en el hilo.</p>
          )}

          {(ws.canEdit || ws.canPublish) && (
            <div className="flex flex-wrap gap-2 border-t pt-3">
              {ws.canEdit && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditing(true)} data-testid="button-edit-agreement">
                  <Pencil className="h-3.5 w-3.5" /> Gestionar síntesis
                </Button>
              )}
              {ws.canEdit && (
                <>
                  <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => void copyTemplate()} data-testid="button-copy-template">
                    <ClipboardCopy className="h-3.5 w-3.5" /> Copiar plantilla
                  </Button>
                  <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => void downloadTemplate()} data-testid="button-download-template">
                    <Download className="h-3.5 w-3.5" /> Plantilla Word
                  </Button>
                </>
              )}
              <Button asChild size="sm" variant="ghost" className="gap-1.5">
                <Link href={collaborationHref(ws.moduleId)} data-testid="link-agreement-collaboration">Espacio colaborativo</Link>
              </Button>
              {ws.canPublish && PUBLISHABLE_STATUSES.includes(a.status) && a.publishedPageId == null && (
                <Button size="sm" className="gap-1.5" onClick={() => setPublishing(true)} disabled={!a.documentUrl} title={a.documentUrl ? undefined : "Vincula antes el documento de Nextcloud"} data-testid="button-publish-agreement">
                  <Upload className="h-3.5 w-3.5" /> Publicar en Documentación
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {ws.canEdit && <AgreementEditorDialog ws={ws} posts={posts} open={editing} onOpenChange={setEditing} />}
      {ws.canPublish && <PublishDialog ws={ws} open={publishing} onOpenChange={setPublishing} />}
    </section>
  );
}
