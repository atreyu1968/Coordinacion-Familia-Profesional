import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  usePreviewForumCurriculum,
  useApplyForumCurriculum,
  useGetForumCurriculumHistory,
  getGetForumCurriculumHistoryQueryKey,
  type ForumCollaboration,
  type ForumCurriculumChange,
  type ForumCurriculumHistoryEntry,
  type ForumCurriculumPreview,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { AlertTriangle, FileSpreadsheet, GitCompareArrows, History, RotateCcw, Upload } from "lucide-react";
import { errorMessage, invalidateCollaboration } from "@/components/forum-collaboration";
import {
  readCurriculumFile,
  toCurriculumInput,
  type CurriculumCandidate,
  type ParsedCurriculumFile,
} from "@/lib/forum-curriculum-parser";

type Meta = { officialCode: string; sourceTitle: string; sourceUrl: string; curriculumVersion: string; territory: string };

const norm = (s: string | null | undefined) => (s ?? "").trim().toLocaleLowerCase("es");
const statusOf = (err: unknown) => (err as { status?: number })?.status;

type KeyKind = "meta" | "ra" | "ce";
export function classifyChangeKey(key: string): { kind: KeyKind; parts: string[] } {
  try {
    const arr = JSON.parse(key) as unknown;
    if (Array.isArray(arr) && arr.every((p) => typeof p === "string")) {
      if (arr[0] === "ra") return { kind: "ra", parts: arr };
      if (arr[0] === "ce") return { kind: "ce", parts: arr };
      return { kind: "meta", parts: arr };
    }
  } catch { /* fallthrough */ }
  return { kind: "meta", parts: [key] };
}

function changeTag(c: ForumCurriculumChange) {
  if (!c.before.trim() && c.after.trim()) return { text: "Alta", cls: "border-emerald-400 text-emerald-700" };
  if (c.before.trim() && !c.after.trim()) return { text: "Baja (archivado)", cls: "border-rose-400 text-rose-700" };
  return { text: "Modificación", cls: "border-amber-400 text-amber-700" };
}

export function ForumCurriculumReview({ collab }: { collab: ForumCollaboration }) {
  const canReview = collab.canReviewCurriculum;
  const [open, setOpen] = useState(false);
  if (!canReview) return null;
  return (
    <>
      <Button variant="outline" className="gap-1.5" onClick={() => setOpen(true)} data-testid="button-curriculum-review">
        <GitCompareArrows className="w-4 h-4" /> Revisar currículo oficial
      </Button>
      {/* Separate Dialog, rendered as a sibling: never nested inside the configuration form. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[92vh] overflow-y-auto">
          {open && <ReviewBody collab={collab} open={open} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReviewBody({ collab, open, onDone }: { collab: ForumCollaboration; open: boolean; onDone: () => void }) {
  const qc = useQueryClient();
  const previewMut = usePreviewForumCurriculum();
  const applyMut = useApplyForumCurriculum();
  const fileRef = useRef<HTMLInputElement>(null);
  const firstRevision = !collab.configuration || collab.configuration.revision === 0;

  const [parsed, setParsed] = useState<ParsedCurriculumFile | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [candidateKey, setCandidateKey] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [preview, setPreview] = useState<ForumCurriculumPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const resetComparison = () => {
    setPreview(null);
    setSelected(new Set());
    setConfirmed(false);
  };

  const candidate = parsed?.candidates.find((c) => c.key === candidateKey) ?? null;
  const ordered = useMemo(() => {
    if (!parsed) return [];
    const match = (c: CurriculumCandidate) => norm(c.moduleName) === norm(collab.moduleName);
    return [...parsed.candidates].sort((a, b) => Number(match(b)) - Number(match(a)));
  }, [parsed, collab.moduleName]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(null);
    setStale(false);
    resetComparison();
    setParsed(null);
    setCandidateKey(null);
    setMeta(null);
    setLoadingFile(true);
    try {
      const p = await readCurriculumFile(f);
      setParsed(p);
      if (p.candidates.length === 1) pick(p.candidates[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el fichero.");
    } finally {
      setLoadingFile(false);
    }
  };

  const pick = (c: CurriculumCandidate) => {
    setCandidateKey(c.key);
    setMeta({
      officialCode: c.officialCode,
      sourceTitle: c.sourceTitle,
      sourceUrl: c.sourceUrl,
      curriculumVersion: c.curriculumVersion,
      territory: c.territory,
    });
    setStale(false);
    setError(null);
    resetComparison();
  };

  const patchMeta = (k: keyof Meta, v: string) => {
    setMeta((m) => (m ? { ...m, [k]: v } : m));
    resetComparison();
  };

  const onCompare = async () => {
    if (!candidate || !meta || !parsed) return;
    setError(null);
    if (!meta.officialCode.trim() || !meta.sourceTitle.trim() || !meta.curriculumVersion.trim() || !meta.territory.trim()) {
      setError("Código oficial, título de la fuente, versión curricular y territorio son obligatorios.");
      return;
    }
    if (!/^https:\/\//i.test(meta.sourceUrl.trim())) {
      setError("El enlace oficial debe empezar por https://.");
      return;
    }
    resetComparison();
    try {
      const p = await previewMut.mutateAsync({
        moduleId: collab.moduleId,
        data: toCurriculumInput(candidate, parsed.workbook, meta),
      });
      setPreview(p);
      setStale(false);
    } catch (err) {
      setError(errorMessage(err, "No se pudo comparar con el currículo registrado."));
    }
  };

  const onApply = async () => {
    if (!candidate || !meta || !parsed || !preview) return;
    setError(null);
    if (!selected.size) return setError("Selecciona al menos un cambio.");
    if (!confirmed) return setError("Confirma la revisión humana antes de aplicar.");
    try {
      await applyMut.mutateAsync({
        moduleId: collab.moduleId,
        data: {
          incoming: toCurriculumInput(candidate, parsed.workbook, meta),
          token: preview.token,
          selectedKeys: [...selected],
          confirmReviewed: true,
        },
      });
      await Promise.all([
        invalidateCollaboration(qc, collab.moduleId),
        qc.invalidateQueries({ queryKey: getGetForumCurriculumHistoryQueryKey(collab.moduleId) }),
      ]);
      toast({ title: "Currículo actualizado", description: `${selected.size} cambios aplicados.` });
      onDone();
    } catch (err) {
      setError(errorMessage(err, "No se pudieron aplicar los cambios."));
      if (statusOf(err) === 409) {
        // Never reuse the token: drop the preview, keep the file and metadata.
        resetComparison();
        setStale(true);
        await invalidateCollaboration(qc, collab.moduleId);
      }
    }
  };

  const groups = useMemo(() => {
    const g: Record<KeyKind, ForumCurriculumChange[]> = { meta: [], ra: [], ce: [] };
    for (const c of preview?.changes ?? []) g[classifyChangeKey(c.key).kind].push(c);
    return g;
  }, [preview]);

  const toggle = (key: string, v: boolean) =>
    { setConfirmed(false); setSelected((s) => {
      const n = new Set(s);
      if (v) n.add(key); else n.delete(key);
      return n;
    }); };
  const toggleGroup = (list: ForumCurriculumChange[], v: boolean) =>
    { setConfirmed(false); setSelected((s) => {
      const n = new Set(s);
      list.forEach((c) => (v ? n.add(c.key) : n.delete(c.key)));
      return n;
    }); };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Revisión del currículo oficial</DialogTitle>
        <DialogDescription>
          {collab.moduleName} · {collab.cycleName ?? "Sin ciclo"}. Compara una hoja revisada con los RA/CE registrados y decide cambio a cambio.
        </DialogDescription>
      </DialogHeader>

      <Tabs defaultValue="compare">
        <TabsList>
          <TabsTrigger value="compare" className="gap-1.5"><GitCompareArrows className="w-3.5 h-3.5" /> Comparar</TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5" data-testid="tab-curriculum-history"><History className="w-3.5 h-3.5" /> Historial</TabsTrigger>
        </TabsList>

        <TabsContent value="compare" className="space-y-5 pt-2">
          {/* 1. File */}
          <section className="space-y-2">
            <StepTitle n={1} title="Cargar fichero" />
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-4">
              <FileSpreadsheet className="w-8 h-8 text-primary/70" />
              <div className="flex-1 min-w-[12rem] text-sm">
                <p className="font-medium">{parsed ? parsed.workbook : "Libro .xlsx (hoja 'Plantilla RA-CE') o JSON normalizado"}</p>
                <p className="text-xs text-muted-foreground">Máximo 5 MB. Los códigos RA/CE se conservan tal cual; las filas incompletas se rechazan.</p>
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.json,application/json" className="hidden" onChange={onFile} data-testid="input-curriculum-file" />
              <Button type="button" variant="secondary" className="gap-1.5" onClick={() => fileRef.current?.click()} disabled={loadingFile}>
                <Upload className="w-4 h-4" /> {loadingFile ? "Leyendo..." : parsed ? "Cambiar fichero" : "Seleccionar"}
              </Button>
            </div>
            {loadingFile && <Skeleton className="h-16 w-full" />}
            {parsed?.warnings.map((w, i) => <Warn key={i}>{w}</Warn>)}
          </section>

          {/* 2. Candidate */}
          {parsed && (
            <section className="space-y-2">
              <StepTitle n={2} title="Elegir el módulo de la hoja" />
              <p className="text-xs text-muted-foreground">
                Elige explícitamente la fila de este módulo. Un mismo nombre puede existir en otros ciclos; nunca se fusionan.
              </p>
              <ul className="max-h-56 overflow-y-auto divide-y rounded-lg border" data-testid="list-curriculum-candidates">
                {ordered.map((c) => {
                  const nameMatch = norm(c.moduleName) === norm(collab.moduleName);
                  const cycleMatch = norm(c.cycleName) === norm(collab.cycleName);
                  const active = c.key === candidateKey;
                  return (
                    <li key={c.key}>
                      <button
                        type="button"
                        onClick={() => pick(c)}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-muted/60 ${active ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : ""}`}
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{c.officialCode}</Badge>
                          <span className="font-medium">{c.moduleName}</span>
                          {nameMatch && cycleMatch && <Badge variant="secondary">Coincide nombre y ciclo</Badge>}
                          {nameMatch && !cycleMatch && <Badge variant="outline" className="border-amber-300 text-amber-700">Mismo nombre, otro ciclo</Badge>}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {c.cycleName}{c.level ? ` · ${c.level}` : ""} · {c.outcomes.length} RA · {c.outcomes.reduce((n, o) => n + o.criteria.length, 0)} CE
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {candidate && norm(candidate.moduleName) !== norm(collab.moduleName) && (
                <Warn>El nombre elegido no coincide con este módulo. El servidor rechazará la comparación si no corresponde.</Warn>
              )}
              {candidate && norm(candidate.cycleName) !== norm(collab.cycleName) && (
                <Warn>El ciclo no coincide literalmente. Solo se admite si es una denominación histórica reconocida del mismo ciclo.</Warn>
              )}
              {candidate?.warnings.map((w, i) => <Warn key={i}>{w}</Warn>)}
            </section>
          )}

          {/* 3. Metadata */}
          {candidate && meta && (
            <section className="space-y-2">
              <StepTitle n={3} title="Revisar referencias" />
              {firstRevision && (
                <p className="text-xs rounded-md bg-primary/5 border border-primary/30 p-2">
                  Primera revisión: los metadatos de fuente (código, fuente, enlace, versión y territorio) son obligatorios y deberás seleccionarlos todos.
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="cr-code" label="Código oficial" value={meta.officialCode} onChange={(v) => patchMeta("officialCode", v)} />
                <Field id="cr-version" label="Versión curricular" value={meta.curriculumVersion} onChange={(v) => patchMeta("curriculumVersion", v)} />
                <Field id="cr-title" label="Título de la fuente" value={meta.sourceTitle} onChange={(v) => patchMeta("sourceTitle", v)} />
                <Field id="cr-territory" label="Territorio" value={meta.territory} onChange={(v) => patchMeta("territory", v)} />
                <div className="sm:col-span-2"><Field id="cr-url" label="Enlace oficial (https)" value={meta.sourceUrl} onChange={(v) => patchMeta("sourceUrl", v)} /></div>
              </div>
              <div className="flex justify-end">
                <Button type="button" onClick={() => void onCompare()} disabled={previewMut.isPending} className="gap-1.5" data-testid="button-curriculum-compare">
                  {stale ? <RotateCcw className="w-4 h-4" /> : <GitCompareArrows className="w-4 h-4" />}
                  {previewMut.isPending ? "Comparando..." : stale ? "Volver a comparar" : "Comparar"}
                </Button>
              </div>
            </section>
          )}

          {previewMut.isPending && <div className="space-y-2"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>}

          {/* 4. Diff */}
          {preview && (
            <section className="space-y-3">
              <StepTitle n={4} title={`Seleccionar cambios (${selected.size}/${preview.changes.length})`} />
              {preview.warnings.map((w, i) => <Warn key={i}>{w}</Warn>)}
              <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1 text-muted-foreground">
                <p>Selecciona únicamente los cambios que quieras aplicar. Los demás se conservan tal como están.</p>
                <p>El texto humano reemplazado queda guardado en el historial.</p>
                <p>Un cambio de código RA/CE aparece como baja y alta: el nuevo elemento recibe otro identificador. Las bajas se archivan, no se borran.</p>
              </div>
              {preview.changes.length === 0 ? (
                <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">Sin diferencias: el currículo registrado coincide con la hoja.</p>
              ) : (
                (["meta", "ra", "ce"] as const).map((k) =>
                  groups[k].length ? (
                    <ChangeGroup
                      key={k}
                      title={k === "meta" ? "Referencias y código" : k === "ra" ? "Resultados de aprendizaje" : "Criterios de evaluación"}
                      changes={groups[k]}
                      selected={selected}
                      onToggle={toggle}
                      onToggleAll={(v) => toggleGroup(groups[k], v)}
                    />
                  ) : null,
                )
              )}
              {preview.changes.length > 0 && (
                <label className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                  <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" data-testid="checkbox-curriculum-confirm" />
                  <span>He revisado personalmente cada cambio seleccionado frente a la fuente oficial y asumo su aplicación.</span>
                </label>
              )}
            </section>
          )}

          {error && <p role="alert" className="text-sm font-medium text-destructive" data-testid="text-curriculum-error">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onDone}>Cerrar</Button>
            {preview && preview.changes.length > 0 && (
              <Button
                type="button"
                onClick={() => void onApply()}
                disabled={applyMut.isPending || !selected.size || !confirmed}
                data-testid="button-curriculum-apply"
              >
                {applyMut.isPending ? "Aplicando..." : `Aplicar ${selected.size} cambios`}
              </Button>
            )}
          </DialogFooter>
        </TabsContent>

        <TabsContent value="history" className="pt-2">
          <HistoryPanel moduleId={collab.moduleId} open={open} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function StepTitle({ n, title }: { n: number; title: string }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold">
      <span className="grid place-items-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-[11px]">{n}</span>
      {title}
    </h3>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-1.5 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2 text-xs">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
      <span>{children}</span>
    </p>
  );
}

function Field({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} data-testid={`input-${id}`} />
    </div>
  );
}

function ChangeGroup({
  title, changes, selected, onToggle, onToggleAll,
}: {
  title: string;
  changes: ForumCurriculumChange[];
  selected: Set<string>;
  onToggle: (k: string, v: boolean) => void;
  onToggleAll: (v: boolean) => void;
}) {
  const all = changes.every((c) => selected.has(c.key));
  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
        <p className="text-sm font-medium">{title} <span className="text-muted-foreground">({changes.length})</span></p>
        <Button type="button" size="sm" variant="ghost" onClick={() => onToggleAll(!all)}>
          {all ? "Quitar todos" : "Seleccionar grupo"}
        </Button>
      </div>
      <ul className="divide-y">
        {changes.map((c) => {
          const tag = changeTag(c);
          return (
            <li key={c.key} className="p-3 space-y-2" data-testid="row-curriculum-change">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={selected.has(c.key)} onCheckedChange={(v) => onToggle(c.key, v === true)} />
                <span className="font-medium">{c.label}</span>
                <Badge variant="outline" className={tag.cls}>{tag.text}</Badge>
              </label>
              <div className="grid gap-2 sm:grid-cols-2 text-xs">
                <DiffBox label="Antes" text={c.before} tone="before" />
                <DiffBox label="Después" text={c.after} tone="after" />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DiffBox({ label, text, tone }: { label: string; text: string; tone: "before" | "after" }) {
  const cls = tone === "before" ? "border-rose-200 bg-rose-50/60 dark:bg-rose-950/20" : "border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/20";
  return (
    <div className={`rounded-md border p-2 ${cls}`}>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="whitespace-pre-wrap break-words">{text.trim() ? text : <span className="italic text-muted-foreground">(vacío)</span>}</p>
    </div>
  );
}

function HistoryPanel({ moduleId, open }: { moduleId: number; open: boolean }) {
  const q = useGetForumCurriculumHistory(moduleId, {
    query: { queryKey: getGetForumCurriculumHistoryQueryKey(moduleId), enabled: open },
  });
  if (q.isLoading) return <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>;
  if (q.isError)
    return (
      <div className="space-y-2 text-sm">
        <p className="text-destructive">{errorMessage(q.error, "No se pudo cargar el historial.")}</p>
        <Button size="sm" variant="outline" onClick={() => void q.refetch()}>Reintentar</Button>
      </div>
    );
  const entries = [...(q.data ?? [])].sort((a, b) => b.revision - a.revision);
  if (!entries.length)
    return <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">Aún no hay revisiones registradas para este módulo.</p>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Cada entrada es una instantánea de la configuración en esa revisión. Las revisiones antiguas pueden no incluir los RA/CE; no es un historial completo de todos los textos.
      </p>
      <ol className="space-y-2">{entries.map((e) => <HistoryItem key={`${e.revision}-${e.createdAt}`} entry={e} />)}</ol>
    </div>
  );
}

function HistoryItem({ entry }: { entry: ForumCurriculumHistoryEntry }) {
  const parsed = useMemo(() => {
    try { return JSON.parse(entry.configuration) as unknown; } catch { return null; }
  }, [entry.configuration]);
  const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  const review = obj?.curriculumReview;
  const audit = review && typeof review === "object" && !Array.isArray(review)
    ? review as Record<string, unknown> : obj;
  const hasDiff = !!audit && ("before" in audit || "after" in audit);
  const pretty = (v: unknown) => JSON.stringify(v, null, 2);
  const date = new Date(entry.createdAt);
  return (
    <li className="rounded-lg border">
      <details>
        <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <Badge variant="outline">Rev. {entry.revision}</Badge>
          <span className="font-medium">{entry.actorName ?? "Actor desconocido"}</span>
          <span className="text-xs text-muted-foreground">{isNaN(date.getTime()) ? entry.createdAt : date.toLocaleString("es-ES")}</span>
          {!hasDiff && <Badge variant="secondary">Solo instantánea</Badge>}
        </summary>
        <div className="border-t p-3 space-y-2 text-xs">
          {parsed == null ? (
            <pre className="whitespace-pre-wrap break-words">{entry.configuration}</pre>
          ) : hasDiff ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <JsonBox label="Antes" value={"before" in audit! ? pretty(audit!.before) : "(no registrado)"} />
                <JsonBox label="Después" value={"after" in audit! ? pretty(audit!.after) : "(no registrado)"} />
              </div>
              {Object.keys(obj!).some((k) => k !== "before" && k !== "after") && (
                <JsonBox
                  label="Otros datos"
                  value={pretty(Object.fromEntries(Object.entries(obj!).filter(([k]) => k !== "before" && k !== "after")))}
                />
              )}
            </>
          ) : (
            <JsonBox label="Instantánea" value={pretty(parsed)} />
          )}
        </div>
      </details>
    </li>
  );
}

function JsonBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-2 min-w-0">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">{value}</pre>
    </div>
  );
}
