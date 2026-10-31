import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { useSaveForumAgreement, type AgreementWorkspace, type ForumPost } from "@workspace/api-client-react";
import {
  allowedStatuses,
  buildAgreementPayload,
  collaborationHref,
  draftFrom,
  isTextLocked,
  startNewVersion,
  STATUS_HINTS,
  STATUS_LABELS,
  validateDocumentUrl,
  validateSourceUrl,
  type AgreementDraft,
  type AgreementStatus,
} from "@/lib/forum-agreement";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { ExternalLink, GitBranch, Lock, Plus, X } from "lucide-react";
import { notificationWarningOf } from "@/lib/forum-agreement";
import { describeAgreementError, PlainTextPreview, useInvalidateAgreement } from "./shared";

export function AgreementEditorDialog({
  ws,
  posts,
  open,
  onOpenChange,
}: {
  ws: AgreementWorkspace;
  posts: ForumPost[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const a = ws.agreement;
  const mut = useSaveForumAgreement();
  const invalidate = useInvalidateAgreement(ws.threadId);
  const [draft, setDraft] = useState<AgreementDraft>(() => draftFrom(a));
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openedRevision, setOpenedRevision] = useState(0);

  // Capture the draft once per opening; background refetches never clobber it.
  const key = `${open}`;
  if (open && openedFor !== key) {
    setOpenedFor(key);
    setDraft(draftFrom(a));
    setOpenedRevision(a?.revision ?? 0);
    setRightsConfirmed(false);
    setPreview(false);
    setError(null);
  }
  if (!open && openedFor !== null) setOpenedFor(null);

  const set = (patch: Partial<AgreementDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const locked = isTextLocked(a) && !draft.newVersion;
  const statuses = allowedStatuses(a, draft.newVersion);
  const moderators = ws.participants.filter((p) => p.isModerator);
  const closing = a?.status === "consulta" && ["consensuado", "sin_consenso", "revision_normativa"].includes(draft.status);
  const serverChanged = open && (a?.revision ?? 0) !== openedRevision;
  const docErr = draft.documentUrl.trim() ? validateDocumentUrl(draft.documentUrl) : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (draft.documentUrl.trim() && draft.documentUrl.trim() !== (a?.documentUrl ?? "") && !rightsConfirmed) {
      return setError("Confirma que el documento existe en Nextcloud y que tienes derecho a enlazarlo.");
    }
    const check = buildAgreementPayload(ws, draft);
    if (!check.ok) return setError(check.error);
    try {
      // Send the revision this draft was based on so concurrent edits surface as 409.
      const res = await mut.mutateAsync({ threadId: ws.threadId, data: { ...check.payload, revision: openedRevision } });
      const warn = notificationWarningOf(res);
      toast({ title: draft.newVersion ? "Nueva versión abierta" : "Síntesis guardada", description: warn ? `Guardado, pero: ${warn}` : undefined });
      await invalidate();
      onOpenChange(false);
    } catch (err) {
      setError(describeAgreementError(err, "No se pudo guardar la síntesis."));
      await invalidate();
    }
  };

  const togglePost = (id: number, on: boolean) =>
    set({ sourcePostIds: on ? [...draft.sourcePostIds, id] : draft.sourcePostIds.filter((x) => x !== id) });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-3xl max-h-[92dvh] overflow-y-auto overscroll-contain">
        <DialogHeader>
          <DialogTitle>{a ? `Síntesis · versión ${draft.newVersion ? a.version + 1 : a.version}` : "Iniciar síntesis del hilo"}</DialogTitle>
          <DialogDescription>
            El foro es el lugar de deliberación. Aquí se resume lo debatido; la redacción conjunta se hace en el documento de Nextcloud y la versión final se publica en Documentación.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          {locked && a && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
              <span className="flex items-start gap-2">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                El texto está congelado ({STATUS_LABELS[a.status]}). {a.status === "consulta" ? "Durante la consulta solo cambian el estado, las observaciones y el motivo de cierre." : "Versión cerrada: solo puedes archivarla o abrir una nueva versión."}
              </span>
              {a.status !== "consulta" && (
                <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setDraft((d) => startNewVersion(d))} data-testid="button-new-version">
                  <GitBranch className="h-3.5 w-3.5" /> Abrir nueva versión
                </Button>
              )}
            </div>
          )}
          {draft.newVersion && (
            <label className="flex items-start gap-2 rounded-md border border-sky-300 bg-sky-50 p-3 text-sm dark:bg-sky-950/30">
              <Checkbox checked={draft.reviewCurrent} onCheckedChange={(v) => set({ reviewCurrent: v === true })} className="mt-0.5" data-testid="checkbox-agreement-review-current" />
              <span>Nueva versión: vuelve a «{STATUS_LABELS.abierto}» y las posiciones anteriores quedan en el historial. He revisado el currículo vigente del piloto.</span>
            </label>
          )}
          {!a && !ws.curriculumCurrent && (
            <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
              <Checkbox checked={draft.reviewCurrent} onCheckedChange={(v) => set({ reviewCurrent: v === true })} className="mt-0.5" />
              <span>El currículo del piloto ha cambiado. He revisado la versión vigente.</span>
            </label>
          )}

          <div className="space-y-1.5">
            <Label>Estado</Label>
            <Select value={draft.status} onValueChange={(v) => set({ status: v as AgreementStatus })}>
              <SelectTrigger data-testid="select-agreement-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {statuses.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{STATUS_HINTS[draft.status]}</p>
            {draft.status === "consulta" && a?.status !== "consulta" && (
              <p className="text-[11px] font-medium text-amber-800 dark:text-amber-300">Al abrir la consulta se congelan el texto y el censo de participantes.</p>
            )}
            {draft.status === "archivado" && a?.status !== "archivado" && (
              <p className="text-[11px] font-medium text-muted-foreground">Archivar conserva todo el contenido; los cambios de texto no se guardan.</p>
            )}
          </div>

          {closing && (
            <div className="space-y-1.5">
              <Label htmlFor="ag-closure">Motivo de cierre *</Label>
              <Textarea id="ag-closure" rows={3} value={draft.closureReason} onChange={(e) => set({ closureReason: e.target.value })} placeholder="Cómo se valoraron las posiciones y por qué se cierra así. No hay mayorías automáticas." data-testid="input-agreement-closure" />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ag-summary">Resumen del debate</Label>
            <Textarea id="ag-summary" rows={3} disabled={locked} value={draft.summary} onChange={(e) => set({ summary: e.target.value })} data-testid="input-agreement-summary" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="ag-text">Texto propuesto</Label>
              <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPreview((v) => !v)} data-testid="button-toggle-preview">
                {preview ? "Editar" : "Vista previa"}
              </Button>
            </div>
            {preview ? (
              <div className="rounded-md border bg-muted/30 p-3"><PlainTextPreview text={draft.proposedText} /></div>
            ) : (
              <Textarea id="ag-text" rows={8} disabled={locked} value={draft.proposedText} onChange={(e) => set({ proposedText: e.target.value })} className="font-serif" data-testid="input-agreement-text" />
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ag-obs">Observaciones</Label>
            <Textarea id="ag-obs" rows={2} disabled={locked && a?.status !== "consulta"} value={draft.observations} onChange={(e) => set({ observations: e.target.value })} data-testid="input-agreement-observations" />
          </div>

          <fieldset className="space-y-2" disabled={locked}>
            <Label>Fuentes</Label>
            {draft.sources.map((s, i) => {
              const err = s.url.trim() ? validateSourceUrl(s.url) : null;
              return (
                <div key={i} className="space-y-1">
                  <div className="flex gap-2">
                    <Input value={s.title} placeholder="Título" className="flex-[1_1_40%]" onChange={(e) => set({ sources: draft.sources.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} data-testid={`input-source-title-${i}`} />
                    <Input value={s.url} placeholder="https://... o /documentacion?page=..." className="flex-[1_1_60%]" onChange={(e) => set({ sources: draft.sources.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} data-testid={`input-source-url-${i}`} />
                    <Button type="button" size="icon" variant="ghost" aria-label="Quitar fuente" onClick={() => set({ sources: draft.sources.filter((_, j) => j !== i) })} data-testid={`button-remove-source-${i}`}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  {err && <p className="text-[11px] text-destructive">{err}</p>}
                </div>
              );
            })}
            <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => set({ sources: [...draft.sources, { title: "", url: "" }] })} data-testid="button-add-source">
              <Plus className="h-3.5 w-3.5" /> Añadir fuente
            </Button>
            {posts.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Mensajes del hilo que fundamentan la síntesis</p>
                <div className="max-h-40 overflow-y-auto rounded-md border divide-y">
                  {posts.map((p) => (
                    <label key={p.id} className="flex items-start gap-2 p-2 text-xs">
                      <Checkbox checked={draft.sourcePostIds.includes(p.id)} onCheckedChange={(v) => togglePost(p.id, v === true)} className="mt-0.5" data-testid={`checkbox-source-post-${p.id}`} />
                      <span className="min-w-0"><span className="font-medium">{p.authorName ?? "Usuario"}:</span> <span className="text-muted-foreground line-clamp-2">{p.content}</span></span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </fieldset>

          <div className="space-y-1.5 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="ag-doc">Documento colaborativo (Nextcloud)</Label>
              <Link href={collaborationHref(ws.moduleId)} className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline" data-testid="link-collaboration-space">
                Abrir espacio colaborativo <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
            {!ws.nextcloudConfigured ? (
              <p className="text-xs text-muted-foreground">Nextcloud no está configurado en esta instalación; no se puede vincular documento.</p>
            ) : (
              <>
                <Input id="ag-doc" disabled={locked} value={draft.documentUrl} onChange={(e) => set({ documentUrl: e.target.value })} placeholder="https://nube.../index.php/f/12345" data-testid="input-agreement-document" />
                {docErr ? <p className="text-[11px] text-destructive">{docErr}</p> : (
                  <p className="text-[11px] text-muted-foreground">Enlace interno estable del archivo, del mismo proveedor configurado. Sin enlaces públicos ni copias.</p>
                )}
                {draft.documentUrl.trim() && draft.documentUrl.trim() !== (a?.documentUrl ?? "") && (
                  <label className="flex items-start gap-2 pt-1 text-xs">
                    <Checkbox checked={rightsConfirmed} onCheckedChange={(v) => setRightsConfirmed(v === true)} className="mt-0.5" data-testid="checkbox-agreement-rights" />
                    <span>He comprobado que el documento existe y que tenemos derecho a usarlo para este acuerdo.</span>
                  </label>
                )}
              </>
            )}
          </div>

          {ws.canDelegate && moderators.length > 0 && (
            <div className="space-y-1.5">
              <Label>Delegar la síntesis en moderadores</Label>
              <div className="flex flex-wrap gap-1.5">
                {moderators.map((m) => {
                  const on = draft.editorIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set({ editorIds: on ? draft.editorIds.filter((x) => x !== m.id) : [...draft.editorIds, m.id] })}
                      className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}
                      data-testid={`toggle-editor-${m.id}`}
                    >
                      {m.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {error && <p role="alert" className="text-sm font-medium text-destructive" data-testid="text-agreement-error">{error}</p>}
          {serverChanged && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs dark:bg-amber-950/30" data-testid="text-agreement-server-changed">
              <span>Alguien ha guardado cambios mientras editabas. Tu borrador no se ha sobrescrito.</span>
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setDraft(draftFrom(a)); setOpenedRevision(a?.revision ?? 0); setError(null); }} data-testid="button-load-latest">
                Descartar mi borrador y cargar lo último
              </Button>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={mut.isPending} data-testid="button-save-agreement">
              {mut.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
