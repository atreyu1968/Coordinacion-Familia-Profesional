import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetForumCollaboration,
  useConfigureForumCollaboration,
  useInitializeForumCollaboration,
  getGetForumCollaborationQueryKey,
  getListForumThreadsQueryKey,
  getListForumModulesQueryKey,
  getListLearningOutcomesQueryKey,
  type ForumCollaboration,
  type ForumCollaborationThread,
  type ProgrammingSection,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpenCheck,
  ExternalLink,
  Settings2,
  ShieldCheck,
} from "lucide-react";

import {
  categoryOf,
  classifyThreads,
  collabAnchor,
  showsStructure,
  type ForumCategory,
} from "@/lib/forum-collaboration-classify";

export { categoryOf, classifyThreads, collabAnchor, showsStructure, type ForumCategory };

export const CATEGORY_LABELS: Record<ForumCategory, string> = {
  programacion: "Programación didáctica",
  materiales: "Materiales RA/CE",
  general: "Debates generales",
};

/** Read-only collaboration preview. A 403/404 simply means "not available". */
export function useForumCollaboration(moduleId: number | null | undefined) {
  const id = moduleId ?? 0;
  return useGetForumCollaboration(id, {
    query: {
      queryKey: getGetForumCollaborationQueryKey(id),
      enabled: !!moduleId,
      retry: false,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
      refetchInterval: 60_000,
    },
  });
}

export function errorMessage(err: unknown, fallback: string): string {
  const e = err as { data?: { message?: string; error?: string } | null; message?: string };
  return e?.data?.message ?? e?.data?.error ?? e?.message ?? fallback;
}

function errorStatus(err: unknown): number | null {
  const s = (err as { status?: number })?.status;
  return typeof s === "number" ? s : null;
}

export async function invalidateCollaboration(
  qc: ReturnType<typeof useQueryClient>,
  moduleId: number,
) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: getGetForumCollaborationQueryKey(moduleId) }),
    qc.invalidateQueries({ queryKey: getListForumThreadsQueryKey({ moduleId }) }),
    qc.invalidateQueries({ queryKey: getListForumModulesQueryKey() }),
    qc.invalidateQueries({ queryKey: getListLearningOutcomesQueryKey(moduleId) }),
  ]);
}

// ---------------------------------------------------------------------------
// Identity strip
// ---------------------------------------------------------------------------
export function CollaborationIdentity({ collab }: { collab: ForumCollaboration }) {
  const cfg = collab.configuration;
  return (
    <div
      className="min-w-0 break-words rounded-lg border bg-card p-3 text-sm space-y-2"
      data-testid="panel-collaboration-identity"
    >
      <div className="flex flex-wrap items-center gap-2">
        <BookOpenCheck className="w-4 h-4 text-primary" />
        <span className="font-semibold">{collab.moduleName}</span>
        {(cfg?.officialCode || collab.moduleCode) && (
          <Badge variant="outline" data-testid="text-collab-code">
            {cfg?.officialCode || collab.moduleCode}
          </Badge>
        )}
        {collab.verificationCurrent ? (
          <Badge variant="secondary" className="gap-1" data-testid="status-collab-verified">
            <ShieldCheck className="w-3 h-3" /> Currículo verificado
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-amber-700 border-amber-300" data-testid="status-collab-verified">
            <AlertTriangle className="w-3 h-3" /> Verificación pendiente
          </Badge>
        )}
        {!collab.enabled && (
          <Badge variant="outline" data-testid="status-collab-disabled">Piloto no activo</Badge>
        )}
      </div>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2 text-xs text-muted-foreground">
        <div><dt className="inline font-medium">Ciclo: </dt><dd className="inline">{collab.cycleName ?? "Sin ciclo"}</dd></div>
        <div><dt className="inline font-medium">Curso: </dt><dd className="inline">{collab.academicYear ?? "Sin curso activo"}</dd></div>
        <div><dt className="inline font-medium">Versión curricular: </dt><dd className="inline" data-testid="text-collab-version">{cfg?.curriculumVersion ?? "Sin configurar"}</dd></div>
        <div>
          <dt className="inline font-medium">Fuente: </dt>
          <dd className="inline">
            {cfg?.sourceUrl ? (
              <a href={cfg.sourceUrl} target="_blank" rel="noreferrer" className="underline break-words" data-testid="link-collab-source">
                {cfg.sourceTitle} <ExternalLink className="w-3 h-3" />
              </a>
            ) : (
              "Sin fuente registrada"
            )}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        Propuesta intercentros de referencia. No sustituye la programación oficial de cada centro.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Configuration dialog (canConfigure only)
// ---------------------------------------------------------------------------
type FormState = {
  enabled: boolean;
  officialCode: string;
  sourceTitle: string;
  sourceUrl: string;
  curriculumVersion: string;
  territory: string;
  confirmReviewed: boolean;
  sections: ProgrammingSection[];
};

function initialForm(c: ForumCollaboration): FormState {
  const cfg = c.configuration;
  return {
    enabled: cfg?.enabled ?? false,
    officialCode: cfg?.officialCode ?? c.moduleCode ?? "",
    sourceTitle: cfg?.sourceTitle ?? "",
    sourceUrl: cfg?.sourceUrl ?? "",
    curriculumVersion: cfg?.curriculumVersion ?? "",
    territory: cfg?.territory ?? "Canarias",
    confirmReviewed: false,
    sections: [...c.sections].sort((a, b) => a.order - b.order).map((s) => ({ ...s })),
  };
}

export function CollaborationConfigDialog({ collab }: { collab: ForumCollaboration }) {
  const qc = useQueryClient();
  const configureMut = useConfigureForumCollaboration();
  const initMut = useInitializeForumCollaboration();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmInit, setConfirmInit] = useState(false);

  // Form is captured only when the dialog opens; background refetches never
  // overwrite unsaved edits.
  const onOpenChange = (v: boolean) => {
    if (v) {
      setForm(initialForm(collab));
      setError(null);
    }
    setOpen(v);
  };

  const pending = collab.threads.filter((t) => t.threadId == null && !t.archived);
  const canInitialize =
    !!collab.configuration && collab.configuration.revision > 0 && collab.verificationCurrent
    && collab.enabled && collab.diagnostics.length === 0;

  const patchSection = (key: string, patch: Partial<ProgrammingSection>) =>
    setForm((f) =>
      f ? { ...f, sections: f.sections.map((s) => (s.key === key ? { ...s, ...patch } : s)) } : f,
    );

  const move = (index: number, dir: -1 | 1) =>
    setForm((f) => {
      if (!f) return f;
      const next = [...f.sections];
      const j = index + dir;
      if (j < 0 || j >= next.length) return f;
      [next[index], next[j]] = [next[j], next[index]];
      return { ...f, sections: next.map((s, i) => ({ ...s, order: i + 1 })) };
    });

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setError(null);
    if (!form.officialCode.trim() || !form.sourceTitle.trim() || !form.curriculumVersion.trim() || !form.territory.trim()) {
      setError("Código oficial, fuente, versión curricular y territorio son obligatorios.");
      return;
    }
    if (!/^https:\/\//i.test(form.sourceUrl.trim())) {
      setError("El enlace de la fuente debe empezar por https://.");
      return;
    }
    if (form.sections.length !== 16 || form.sections.some((s) => !s.title.trim() || !s.prompt.trim())) {
      setError("Los 16 apartados necesitan título y plantilla.");
      return;
    }
    if (!form.confirmReviewed) {
      setError("Debes confirmar que has revisado la identidad del módulo y los RA/CE vigentes.");
      return;
    }
    try {
      await configureMut.mutateAsync({
        moduleId: collab.moduleId,
        data: {
          revision: collab.configuration?.revision || 0,
          fingerprint: collab.fingerprint,
          enabled: form.enabled,
          officialCode: form.officialCode.trim(),
          sourceTitle: form.sourceTitle.trim(),
          sourceUrl: form.sourceUrl.trim(),
          curriculumVersion: form.curriculumVersion.trim(),
          territory: form.territory.trim(),
          confirmReviewed: form.confirmReviewed,
          sections: form.sections.map((s) => ({
            key: s.key,
            title: s.title.trim(),
            prompt: s.prompt.trim(),
            enabled: s.enabled,
            order: s.order,
          })),
        },
      });
      await invalidateCollaboration(qc, collab.moduleId);
      toast({ title: "Configuración guardada", description: "Revisa los temas pendientes antes de inicializarlos." });
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err, "No se pudo guardar la configuración."));
      if (errorStatus(err) === 409) {
        await qc.invalidateQueries({ queryKey: getGetForumCollaborationQueryKey(collab.moduleId) });
      }
    }
  };

  const onInitialize = async () => {
    if (!collab.configuration) return;
    try {
      await initMut.mutateAsync({
        moduleId: collab.moduleId,
        data: { revision: collab.configuration.revision, fingerprint: collab.fingerprint },
      });
      await invalidateCollaboration(qc, collab.moduleId);
      toast({ title: "Temas inicializados" });
    } catch (err) {
      toast({
        title: "No se pudieron crear los temas",
        description: errorMessage(err, "Inténtalo de nuevo."),
        variant: "destructive",
      });
      await qc.invalidateQueries({ queryKey: getGetForumCollaborationQueryKey(collab.moduleId) });
    } finally {
      setConfirmInit(false);
    }
  };

  return (
    <>
      {collab.importReport && (
        <details className="rounded-lg border bg-card p-3 text-sm" data-testid="panel-curriculum-import-report">
          <summary className="cursor-pointer font-medium">Informe de herencia de la fuente curricular</summary>
          <p className="mt-2 text-xs text-muted-foreground">
            Diagnóstico actual frente a la hoja revisada, no historial de ejecuciones.
            Esta consulta no modifica contenidos, fuentes ni verificaciones.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {collab.importReport.reasons.map(reason => <li key={reason.code}>{reason.message}</li>)}
          </ul>
        </details>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" className="gap-1.5" onClick={() => onOpenChange(true)} data-testid="button-collab-configure">
          <Settings2 className="w-4 h-4" /> Configurar colaboración
        </Button>
        {pending.length > 0 && (
          <Button
            variant="secondary"
            disabled={!canInitialize || initMut.isPending}
            onClick={() => setConfirmInit(true)}
            data-testid="button-collab-initialize"
            title={canInitialize ? undefined : !collab.enabled
              ? "Activa el piloto en Configurar colaboración para crear sus temas"
              : "Resuelve los avisos y guarda una configuración verificada"}
          >
            Crear {pending.length} temas pendientes
          </Button>
        )}
      </div>

      {collab.diagnostics.length > 0 && (
        <ul className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs space-y-1" data-testid="list-collab-diagnostics">
          {collab.diagnostics.map((d, i) => (
            <li key={i} className="flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />{d}</li>
          ))}
        </ul>
      )}

      <AlertDialog open={confirmInit} onOpenChange={setConfirmInit}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Crear temas estructurados</AlertDialogTitle>
            <AlertDialogDescription>
              Se crearán estos temas a partir de la configuración y de los RA/CE registrados. No se modifican los temas existentes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-60 overflow-y-auto text-sm divide-y" data-testid="list-collab-pending">
            {pending.map((t) => (
              <li key={t.key} className="py-1.5 flex gap-2">
                <Badge variant="outline" className="shrink-0">{t.key}</Badge>
                <span>{t.title}</span>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void onInitialize(); }} disabled={initMut.isPending} data-testid="button-collab-initialize-confirm">
              {initMut.isPending ? "Creando..." : "Confirmar y crear"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configurar colaboración del módulo</DialogTitle>
            <DialogDescription>
              Guardar no crea temas. Después podrás revisar y confirmar los temas pendientes.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <form onSubmit={onSave} className="space-y-4">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">Piloto activo</p>
                  <p className="text-xs text-muted-foreground">Muestra las secciones al profesorado del módulo.</p>
                </div>
                <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} data-testid="switch-collab-enabled" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="c-code">Código oficial</Label><Input id="c-code" value={form.officialCode} onChange={(e) => setForm({ ...form, officialCode: e.target.value })} data-testid="input-collab-code" /></div>
                <div className="space-y-1.5"><Label htmlFor="c-version">Versión curricular</Label><Input id="c-version" value={form.curriculumVersion} onChange={(e) => setForm({ ...form, curriculumVersion: e.target.value })} data-testid="input-collab-version" /></div>
                <div className="space-y-1.5"><Label htmlFor="c-source">Título de la fuente</Label><Input id="c-source" value={form.sourceTitle} onChange={(e) => setForm({ ...form, sourceTitle: e.target.value })} data-testid="input-collab-source-title" /></div>
                <div className="space-y-1.5"><Label htmlFor="c-territory">Territorio</Label><Input id="c-territory" value={form.territory} onChange={(e) => setForm({ ...form, territory: e.target.value })} data-testid="input-collab-territory" /></div>
                <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="c-url">Enlace oficial (https)</Label><Input id="c-url" type="url" value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} data-testid="input-collab-source-url" /></div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Apartados de programación (16)</p>
                <ol className="space-y-2">
                  {form.sections.map((s, i) => (
                    <li key={s.key} className="rounded-md border p-2.5 space-y-2" data-testid={`row-collab-section-${s.key}`}>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="shrink-0">{s.key}</Badge>
                        <Input value={s.title} onChange={(e) => patchSection(s.key, { title: e.target.value })} className="h-8" aria-label={`Título ${s.key}`} />
                        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir"><ArrowUp className="w-3.5 h-3.5" /></Button>
                        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, 1)} disabled={i === form.sections.length - 1} aria-label="Bajar"><ArrowDown className="w-3.5 h-3.5" /></Button>
                        <Switch checked={s.enabled} onCheckedChange={(v) => patchSection(s.key, { enabled: v })} aria-label={`Activar ${s.key}`} />
                      </div>
                      <Textarea value={s.prompt} onChange={(e) => patchSection(s.key, { prompt: e.target.value })} rows={2} className="text-xs" aria-label={`Plantilla ${s.key}`} />
                    </li>
                  ))}
                </ol>
              </div>

              <label className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                <Checkbox checked={form.confirmReviewed} onCheckedChange={(v) => setForm({ ...form, confirmReviewed: v === true })} data-testid="checkbox-collab-confirm" className="mt-0.5" />
                <span>He revisado personalmente la identidad del módulo y los RA/CE vigentes registrados frente a la fuente oficial.</span>
              </label>

              {error && <p role="alert" className="text-sm font-medium text-destructive" data-testid="text-collab-error">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={configureMut.isPending} data-testid="button-collab-save">
                  {configureMut.isPending ? "Guardando..." : "Guardar configuración"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ThreadOriginLink({ moduleId, entry }: { moduleId: number; entry: ForumCollaborationThread }) {
  const href = collabAnchor(moduleId, entry);
  if (!href) return null;
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-xs text-primary underline" data-testid="link-thread-origin">
      Ver {entry.kind === "material_ce" ? "criterio" : "resultado de aprendizaje"} en la ficha del módulo
    </Link>
  );
}
