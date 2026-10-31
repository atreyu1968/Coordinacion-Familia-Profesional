import { useMemo, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCurriculumResources,
  useCreateCurriculumResource,
  useUpdateResourceCurriculum,
  useListLearningOutcomes,
  getListCurriculumResourcesQueryKey,
  getListResourcesQueryKey,
  getListLearningOutcomesQueryKey,
  getGetForumCollaborationQueryKey,
  type ForumCollaboration,
  type LearningOutcome,
  type Resource,
  type ResourceLearningTarget,
} from "@workspace/api-client-react";
import { invalidateResourceDashboardQueries } from "@/lib/resource-dashboard-cache";
import {
  classifyConflict,
  classifyCurriculum,
  criterionParents,
  filterCurriculumResources,
  isWikiAttachmentUrl,
  libraryHref,
  normalizeTargets,
  targetLabel,
  validateCanonicalUrl,
  type CurriculumFilter,
} from "@/lib/curriculum-resources";
import { useForumCollaboration, errorMessage } from "@/components/forum-collaboration";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { openResourceUrl } from "@/lib/protected-resource-link";
import { WikiSourcePicker } from "@/components/wiki-source-picker";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ExternalLink,
  FileText,
  Library,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
} from "lucide-react";

export const CURRICULUM_RESOURCE_TYPES = [
  "Material de aula",
  "Actividad",
  "Solución",
  "Examen / prueba",
  "Rúbrica",
  "Documento",
  "Enlace",
];

const AUDIENCE_LABELS = { teachers: "Uso docente", students: "Para alumnado" } as const;

export async function invalidateCurriculumResources(
  qc: ReturnType<typeof useQueryClient>,
  moduleId: number,
) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: getListCurriculumResourcesQueryKey(moduleId) }),
    qc.invalidateQueries({ queryKey: getListResourcesQueryKey() }),
    invalidateResourceDashboardQueries(qc),
  ]);
}

export function useCurriculumResources(moduleId: number | null | undefined) {
  const id = moduleId ?? 0;
  return useListCurriculumResources(id, {
    query: {
      queryKey: getListCurriculumResourcesQueryKey(id),
      enabled: !!moduleId,
      retry: false,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
    },
  });
}

export function useModuleOutcomes(moduleId: number | null | undefined) {
  const id = moduleId ?? 0;
  return useListLearningOutcomes(id, {
    query: { queryKey: getListLearningOutcomesQueryKey(id), enabled: !!moduleId },
  });
}

export function canPublishCurriculum(collab: ForumCollaboration | undefined): boolean {
  return !!collab && collab.enabled && collab.verificationCurrent && !!collab.configuration;
}

// ---------------------------------------------------------------------------
// Metadata strip shared by forum panel and library cards
// ---------------------------------------------------------------------------
export function CurriculumMeta({
  resource,
  outcomes,
  currentFingerprint,
}: {
  resource: Resource;
  outcomes: LearningOutcome[];
  currentFingerprint?: string | null;
}) {
  const c = resource.curriculum;
  if (!c) return null;
  const status = classifyCurriculum(resource, currentFingerprint);
  return (
    <div className="space-y-1.5" data-testid={`meta-curriculum-${resource.id}`}>
      <div className="flex flex-wrap gap-1">
        {c.targets.map((t) => (
          <Link
            key={`${t.outcomeId}-${t.criterionId ?? "ra"}`}
            href={libraryHref(
              c.moduleId,
              t.criterionId != null
                ? { kind: "criterion", criterionId: t.criterionId }
                : { kind: "outcome", outcomeId: t.outcomeId },
            )}
            className="rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10"
            data-testid={`link-target-${resource.id}-${t.outcomeId}-${t.criterionId ?? "ra"}`}
          >
            {targetLabel(t, outcomes)}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span data-testid={`text-origin-center-${resource.id}`}>{c.originCenterName ?? "Centro de origen no disponible"}</span>
        <span>· {AUDIENCE_LABELS[c.audience]}</span>
        <span>· {c.license}</span>
        <span>· v{c.version}</span>
        <span>· Currículo {c.curriculumVersion}</span>
        {c.restricted && (
          <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px] border-amber-400 text-amber-700">
            <Lock className="w-2.5 h-2.5" /> Solución restringida
          </Badge>
        )}
        {status === "archived" && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Archivado</Badge>}
        {status === "stale" && (
          <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px] border-amber-400 text-amber-700" title="Asociado con una revisión anterior del piloto curricular">
            <AlertTriangle className="w-2.5 h-2.5" /> Revisar currículo
          </Badge>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Target picker (RA-only or CE, never cartesian)
// ---------------------------------------------------------------------------
const keyOf = (t: ResourceLearningTarget) => `${t.outcomeId}:${t.criterionId ?? "ra"}`;

function TargetPicker({
  outcomes,
  value,
  onChange,
}: {
  outcomes: LearningOutcome[];
  value: ResourceLearningTarget[];
  onChange: (v: ResourceLearningTarget[]) => void;
}) {
  const selected = new Set(value.map(keyOf));
  const toggle = (t: ResourceLearningTarget, on: boolean) =>
    onChange(on ? normalizeTargets([...value, t]) : value.filter((x) => keyOf(x) !== keyOf(t)));
  if (outcomes.length === 0) {
    return <p className="text-xs text-muted-foreground">Este módulo no tiene RA/CE registrados.</p>;
  }
  return (
    <div className="max-h-64 overflow-y-auto overscroll-contain rounded-md border divide-y" data-testid="picker-targets">
      {outcomes.map((o) => {
        const ra = { outcomeId: o.id, criterionId: null };
        return (
          <div key={o.id} className="p-2 space-y-1">
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={selected.has(keyOf(ra))}
                onCheckedChange={(v) => toggle(ra, v === true)}
                className="mt-0.5"
                data-testid={`checkbox-target-ra-${o.id}`}
              />
              <span className="min-w-0">
                <span className="font-semibold">{o.code}</span>{" "}
                <span className="text-muted-foreground">{o.description}</span>
                <span className="block text-[11px] text-muted-foreground">RA completo</span>
              </span>
            </label>
            {o.criteria.length > 0 && (
              <div className="ml-6 space-y-1 border-l pl-2">
                {o.criteria.map((c) => {
                  const ce = { outcomeId: o.id, criterionId: c.id };
                  return (
                    <label key={c.id} className="flex items-start gap-2 text-xs cursor-pointer">
                      <Checkbox
                        checked={selected.has(keyOf(ce))}
                        onCheckedChange={(v) => toggle(ce, v === true)}
                        className="mt-0.5"
                        data-testid={`checkbox-target-ce-${c.id}`}
                      />
                      <span className="min-w-0"><span className="font-medium">{c.code}</span> {c.description}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor: create new, associate existing library resource, or edit association
// ---------------------------------------------------------------------------
type EditorForm = {
  title: string;
  description: string;
  type: string;
  fileUrl: string;
  license: string;
  version: string;
  audience: "teachers" | "students";
  restricted: boolean;
  archived: boolean;
  targets: ResourceLearningTarget[];
  rightsConfirmed: boolean;
  reviewCurrent: boolean;
};

export function CurriculumResourceDialog({
  moduleId,
  open,
  onOpenChange,
  resource,
  defaultTargets = [],
}: {
  moduleId: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Existing library resource: associate or edit its curriculum metadata. */
  resource?: Resource | null;
  defaultTargets?: ResourceLearningTarget[];
}) {
  const qc = useQueryClient();
  const { data: collab, isLoading: collabLoading } = useForumCollaboration(open ? moduleId : null);
  const { data: outcomes = [], isLoading: outcomesLoading } = useModuleOutcomes(open ? moduleId : null);
  const createMut = useCreateCurriculumResource();
  const updateMut = useUpdateResourceCurriculum();
  const [form, setForm] = useState<EditorForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [openedFor, setOpenedFor] = useState<string | null>(null);

  const isNew = !resource;
  const existing = resource?.curriculum;
  const formKey = `${resource?.id ?? "new"}:${open}`;
  // Capture form once per opening; refetches never overwrite unsaved input.
  if (open && openedFor !== formKey) {
    setOpenedFor(formKey);
    setError(null);
    setDuplicate(false);
    setForm({
      title: resource?.title ?? "",
      description: resource?.description ?? "",
      type: resource?.type ?? CURRICULUM_RESOURCE_TYPES[0],
      fileUrl: resource?.fileUrl ?? "",
      license: existing?.license ?? "CC BY-SA 4.0",
      version: existing?.version ?? "1.0",
      audience: existing?.audience ?? "teachers",
      restricted: existing?.restricted ?? false,
      archived: existing?.archived ?? false,
      targets: existing?.targets ? normalizeTargets(existing.targets) : normalizeTargets(defaultTargets),
      rightsConfirmed: false,
      reviewCurrent: false,
    });
  }
  if (!open && openedFor !== null && openedFor !== formKey) {
    setOpenedFor(null);
  }

  const stale = !!existing && !!collab && existing.fingerprint !== collab.fingerprint;
  const publishable = canPublishCurriculum(collab);
  const pending = createMut.isPending || updateMut.isPending;
  const set = (patch: Partial<EditorForm>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form || !collab) return;
    setError(null);
    setDuplicate(false);
    if (isNew && !form.title.trim()) return setError("El título es obligatorio.");
    if (!form.license.trim() || !form.version.trim()) return setError("Licencia y versión son obligatorias.");
    if (form.targets.length === 0) return setError("Selecciona al menos un RA o CE.");
    if (isNew) {
      const urlErr = validateCanonicalUrl(form.fileUrl, form.restricted);
      if (urlErr) return setError(urlErr);
    } else if (form.restricted && !isWikiAttachmentUrl(resource?.fileUrl ?? "")) {
      return setError("Solo puede marcarse como solución restringida un recurso cuyo enlace sea un adjunto protegido de la wiki.");
    }
    if (!form.rightsConfirmed) return setError("Debes confirmar los derechos y la ausencia de datos personales o secretos.");
    const retiringOnly = !!existing && !existing.archived && form.archived;
    if (stale && !form.reviewCurrent && !retiringOnly) {
      return setError("El currículo del piloto ha cambiado. Revisa los RA/CE seleccionados y confirma la revisión actual antes de guardar.");
    }
    const base = {
      revision: existing?.revision ?? 0,
      fingerprint: existing && (!form.reviewCurrent || retiringOnly) ? existing.fingerprint : collab.fingerprint,
      license: form.license.trim(),
      version: form.version.trim(),
      audience: form.audience,
      restricted: form.restricted,
      archived: isNew ? false : form.archived,
      rightsConfirmed: true as const,
      targets: retiringOnly ? existing!.targets : normalizeTargets(form.targets),
    };
    try {
      if (isNew) {
        await createMut.mutateAsync({
          moduleId,
          data: {
            ...base,
            title: form.title.trim(),
            description: form.description.trim() || null,
            type: form.type,
            fileUrl: form.fileUrl.trim(),
          },
        });
      } else {
        await updateMut.mutateAsync({ moduleId, resourceId: resource!.id, data: base });
      }
      await invalidateCurriculumResources(qc, moduleId);
      toast({ title: isNew ? "Recurso curricular publicado" : "Asociación curricular guardada" });
      onOpenChange(false);
    } catch (err) {
      const kind = classifyConflict(err);
      if (kind === "duplicate") {
        setDuplicate(true);
        setError("Ya existe un recurso con ese enlace. Asocia la entrada existente de la biblioteca en lugar de duplicarla.");
      } else if (kind === "revision") {
        setError("Otra persona ha modificado esta asociación. Hemos recargado los datos; tus cambios siguen aquí para que los revises.");
      } else if (kind === "curriculum") {
        setError("El currículo o el piloto ha cambiado. Revisa los RA/CE y confirma la revisión actual.");
      } else {
        const status = (err as { status?: number })?.status;
        setError(
          status === 403
            ? "No tienes permiso para esta acción. Puede que tus permisos hayan cambiado."
            : errorMessage(err, "No se pudo guardar. Inténtalo de nuevo."),
        );
      }
      await Promise.all([
        invalidateCurriculumResources(qc, moduleId),
        qc.invalidateQueries({ queryKey: getGetForumCollaborationQueryKey(moduleId) }),
      ]);
    }
  };

  const loading = collabLoading || outcomesLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-2xl max-h-[90dvh] overflow-y-auto overscroll-contain">
        <DialogHeader>
          <DialogTitle>
            {isNew ? "Nuevo recurso curricular" : existing ? "Editar asociación curricular" : "Asociar recurso a RA/CE"}
          </DialogTitle>
          <DialogDescription>
            Se registra en la biblioteca de recursos existente como entrada compartida del módulo. No se suben ni copian archivos.
          </DialogDescription>
        </DialogHeader>
        {loading || !form ? (
          <div className="space-y-2 py-4">
            <div className="h-9 rounded bg-muted animate-pulse" />
            <div className="h-24 rounded bg-muted animate-pulse" />
          </div>
        ) : !collab ? (
          <p role="alert" className="text-sm text-destructive py-4">No se pudo cargar el piloto curricular del módulo.</p>
        ) : !publishable && isNew ? (
          <p role="alert" className="text-sm text-amber-700 py-4" data-testid="text-curriculum-not-publishable">
            Solo se pueden publicar recursos curriculares cuando el piloto del módulo está activo y su currículo está verificado.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            {isNew ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="cr-title">Título *</Label>
                  <Input id="cr-title" value={form.title} onChange={(e) => set({ title: e.target.value })} data-testid="input-cr-title" />
                </div>
                <div className="space-y-1.5">
                  <Label>Tipo *</Label>
                  <Select value={form.type} onValueChange={(v) => set({ type: v })}>
                    <SelectTrigger data-testid="select-cr-type"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      {CURRICULUM_RESOURCE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Fuente original *</Label>
                  <WikiSourcePicker moduleId={moduleId} value={form.fileUrl} onSelect={(fileUrl) => set({ fileUrl })} />
                  <Label htmlFor="cr-url" className="text-xs text-muted-foreground">o enlace https estable (p. ej. Nextcloud /index.php/f/123)</Label>
                  <Input id="cr-url" value={form.fileUrl} onChange={(e) => set({ fileUrl: e.target.value })} placeholder="https://..." data-testid="input-cr-url" />
                  <p className="text-[11px] text-muted-foreground">Los enlaces de Nextcloud exigen que cada persona inicie sesión en el proveedor. No se aceptan enlaces compartidos públicos (/s/...).</p>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="cr-desc">Descripción</Label>
                  <Textarea id="cr-desc" rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} data-testid="input-cr-description" />
                </div>
              </div>
            ) : (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <p className="font-medium">{resource!.title}</p>
                <p className="text-xs text-muted-foreground break-all">{resource!.fileUrl ?? "Sin enlace"}</p>
                <p className="mt-1 text-xs text-muted-foreground">Se conservan el autor, el centro y el origen del recurso. No cambia cómo está compartido.</p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="cr-license">Licencia *</Label>
                <Input id="cr-license" value={form.license} onChange={(e) => set({ license: e.target.value })} data-testid="input-cr-license" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cr-version">Versión *</Label>
                <Input id="cr-version" value={form.version} onChange={(e) => set({ version: e.target.value })} data-testid="input-cr-version" />
              </div>
              <div className="space-y-1.5">
                <Label>Uso previsto</Label>
                <Select value={form.audience} onValueChange={(v) => set({ audience: v as EditorForm["audience"] })}>
                  <SelectTrigger data-testid="select-cr-audience"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="teachers">Uso docente</SelectItem>
                    <SelectItem value="students">Para alumnado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Resultados y criterios *</Label>
              <p className="text-[11px] text-muted-foreground">Marca un RA completo o criterios concretos. Cada marca es una asociación independiente.</p>
              <TargetPicker outcomes={outcomes} value={form.targets} onChange={(targets) => set({ targets })} />
            </div>

            <div className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Solución restringida</p>
                <p className="text-xs text-muted-foreground">Solo admite un adjunto protegido de la wiki. Restringir no revoca enlaces públicos compartidos antes.</p>
              </div>
              <Switch checked={form.restricted} onCheckedChange={(v) => set({ restricted: v })} data-testid="switch-cr-restricted" />
            </div>

            {!isNew && existing && (
              <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">Archivado</p>
                  <p className="text-xs text-muted-foreground">Oculta el recurso del índice conservando asociaciones y origen. No se borra ningún archivo.</p>
                </div>
                <Switch checked={form.archived} onCheckedChange={(v) => set({ archived: v })} data-testid="switch-cr-archived" />
              </div>
            )}

            <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
              <p>El documento original o el archivo de Nextcloud sigue siendo la fuente canónica y su proveedor conserva el control de acceso.</p>
              <p>Para Nextcloud usa enlaces https estables sin token, sesión ni firma en la URL: cada persona necesitará su propia autorización.</p>
            </div>

            {stale && (
              <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
                <Checkbox checked={form.reviewCurrent} onCheckedChange={(v) => set({ reviewCurrent: v === true })} className="mt-0.5" data-testid="checkbox-cr-review-current" />
                <span>El currículo del piloto ha cambiado ({collab.configuration?.curriculumVersion ?? "versión actual"}). He revisado los RA/CE seleccionados frente a la versión vigente.</span>
              </label>
            )}

            <label className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
              <Checkbox checked={form.rightsConfirmed} onCheckedChange={(v) => set({ rightsConfirmed: v === true })} className="mt-0.5" data-testid="checkbox-cr-rights" />
              <span>Confirmo que tengo derecho a compartirlo con esta licencia y que no contiene datos personales del alumnado ni secretos.</span>
            </label>

            {error && (
              <div role="alert" className="text-sm font-medium text-destructive space-y-1" data-testid="text-cr-error">
                <p>{error}</p>
                {duplicate && (
                  <Link href={`/recursos?module=${moduleId}`} className="underline text-xs" data-testid="link-cr-duplicate-library">
                    Buscar la entrada en la biblioteca
                  </Link>
                )}
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={pending} data-testid="button-cr-save">
                {pending ? "Guardando..." : isNew ? "Publicar" : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Panel inside forum RA/CE material thread
// ---------------------------------------------------------------------------
export function CurriculumResourcesPanel({
  moduleId,
  filter,
}: {
  moduleId: number;
  filter: CurriculumFilter;
}) {
  const { data: collab } = useForumCollaboration(moduleId);
  const { data: outcomes = [] } = useModuleOutcomes(moduleId);
  const query = useCurriculumResources(moduleId);
  const qc = useQueryClient();
  const updateMut = useUpdateResourceCurriculum();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Resource | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const parents = useMemo(() => criterionParents(outcomes), [outcomes]);
  const list = useMemo(
    () => filterCurriculumResources(query.data ?? [], filter, parents, { includeArchived: showArchived }),
    [query.data, filter, parents, showArchived],
  );
  const defaultTargets: ResourceLearningTarget[] =
    filter.kind === "outcome"
      ? [{ outcomeId: filter.outcomeId, criterionId: null }]
      : parents.has(filter.criterionId)
        ? [{ outcomeId: parents.get(filter.criterionId)!, criterionId: filter.criterionId }]
        : [];

  const toggleArchive = async (r: Resource) => {
    const c = r.curriculum;
    if (!c) return;
    try {
      await updateMut.mutateAsync({
        moduleId,
        resourceId: r.id,
        data: {
          revision: c.revision,
          fingerprint: c.fingerprint,
          license: c.license,
          version: c.version,
          audience: c.audience,
          restricted: c.restricted,
          archived: !c.archived,
          rightsConfirmed: true,
          targets: c.targets,
        },
      });
      toast({ title: c.archived ? "Recurso restaurado" : "Recurso archivado", description: "No se ha borrado ningún archivo." });
    } catch (err) {
      toast({
        title: "No se pudo cambiar",
        description: classifyConflict(err) ? "Los datos han cambiado. Se han recargado; revísalos." : errorMessage(err, "Comprueba tus permisos."),
        variant: "destructive",
      });
    } finally {
      await invalidateCurriculumResources(qc, moduleId);
    }
  };

  return (
    <section className="rounded-lg border bg-card p-3 space-y-3" data-testid="panel-curriculum-resources">
      <div className="flex flex-wrap items-center gap-2">
        <Library className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm flex-1 min-w-0">
          Recursos asociados {filter.kind === "outcome" ? "al RA (incluye sus CE)" : "a este CE"}
        </h3>
        <Button asChild size="sm" variant="ghost" className="h-7 gap-1 text-xs">
          <Link href={libraryHref(moduleId, filter)} data-testid="link-panel-library">
            Ver en biblioteca <ExternalLink className="w-3 h-3" />
          </Link>
        </Button>
        {canPublishCurriculum(collab) && (
          <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => setCreating(true)} data-testid="button-add-curriculum-resource">
            <Plus className="w-3.5 h-3.5" /> Añadir
          </Button>
        )}
      </div>
      {query.isLoading ? (
        <div className="space-y-2">
          <div className="h-14 rounded bg-muted animate-pulse" />
          <div className="h-14 rounded bg-muted animate-pulse" />
        </div>
      ) : query.isError ? (
        <div role="alert" className="flex items-center justify-between gap-2 text-sm text-destructive">
          <span>No se pudieron cargar los recursos. Puede que no tengas acceso a este módulo.</span>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => void query.refetch()} data-testid="button-retry-curriculum">
            <RefreshCw className="w-3.5 h-3.5" /> Reintentar
          </Button>
        </div>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2" data-testid="text-curriculum-empty">
          Aún no hay recursos asociados. Puedes añadir uno nuevo o asociar una entrada existente desde la biblioteca.
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((r) => (
            <li key={r.id} className="rounded-md border p-2.5 flex gap-2.5" data-testid={`row-curriculum-resource-${r.id}`}>
              <div className="w-8 h-8 rounded bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {r.fileUrl ? (
                    <a
                      href={r.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-sm hover:underline break-words"
                      data-testid={`link-open-resource-${r.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        void openResourceUrl(r.fileUrl!).catch((err: unknown) =>
                          toast({ title: "No se pudo abrir", description: err instanceof Error ? err.message : "Inténtalo de nuevo.", variant: "destructive" }),
                        );
                      }}
                    >
                      {r.title}
                    </a>
                  ) : (
                    <span className="font-medium text-sm">{r.title}</span>
                  )}
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{r.type}</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">{r.authorName ?? r.originalAuthorName ?? "Autor desconocido"}</p>
                <CurriculumMeta resource={r} outcomes={outcomes} currentFingerprint={collab?.fingerprint} />
              </div>
              {r.curriculum?.canEdit && (
                <div className="flex flex-col gap-1 shrink-0">
                  <Button size="icon" variant="ghost" className="h-7 w-7" title="Editar" onClick={() => setEditing(r)} data-testid={`button-edit-curriculum-${r.id}`}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" title={r.curriculum.archived ? "Restaurar" : "Archivar"} disabled={updateMut.isPending} onClick={() => void toggleArchive(r)} data-testid={`button-archive-curriculum-${r.id}`}>
                    {r.curriculum.archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox checked={showArchived} onCheckedChange={(v) => setShowArchived(v === true)} data-testid="checkbox-show-archived" />
        Mostrar archivados
      </label>
      <CurriculumResourceDialog moduleId={moduleId} open={creating} onOpenChange={setCreating} defaultTargets={defaultTargets} />
      <CurriculumResourceDialog moduleId={moduleId} open={editing != null} onOpenChange={(v) => !v && setEditing(null)} resource={editing} />
    </section>
  );
}
