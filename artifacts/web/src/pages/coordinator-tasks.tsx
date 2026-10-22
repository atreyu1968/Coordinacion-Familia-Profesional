import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  FileText,
  Inbox,
  LoaderCircle,
  Mail,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import {
  getListCoordinatorTasksQueryKey,
  useAnalyzeCoordinatorTaskSources,
  useCreateCoordinatorTask,
  useListCoordinatorTasks,
  useUpdateCoordinatorTask,
  type CoordinatorTask,
  type CoordinatorTaskAnalysis,
  type CoordinatorTaskStatus,
  type CoordinatorTaskUpdate,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

const statusText: Record<CoordinatorTaskStatus, string> = {
  pending: "Pendiente",
  in_progress: "En curso",
  resolved: "Resuelta",
};

const sourceText: Record<CoordinatorTask["sourceType"], string> = {
  manual: "Añadida por ti",
  minutes: "Acta publicada",
  message: "Mensaje recibido",
  email: "Correo de Gmail",
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
};

function SourceIcon({ type }: { type: CoordinatorTask["sourceType"] }) {
  const Icon =
    type === "minutes"
      ? FileText
      : type === "message"
        ? MessageSquare
        : type === "email"
          ? Mail
          : Circle;
  return <Icon className="h-4 w-4" aria-hidden="true" />;
}

function TaskCard({
  task,
  onUpdate,
  updating,
}: {
  task: CoordinatorTask;
  onUpdate: (
    task: CoordinatorTask,
    data: Omit<CoordinatorTaskUpdate, "revision">,
    onSuccess?: () => void,
  ) => void;
  updating: boolean;
}) {
  const [resolution, setResolution] = useState("");
  const [showResolution, setShowResolution] = useState(false);
  const isSuggestion = task.reviewStatus === "suggested";
  const sourceDate = formatDate(task.sourceDate);

  const changeStatus = (status: CoordinatorTaskStatus) => {
    if (status === "resolved") {
      setShowResolution(true);
      return;
    }
    onUpdate(task, {
      status,
      ...(task.status === "resolved" ? { resolution: null } : {}),
    });
  };

  const confirmResolution = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = resolution.trim();
    if (!trimmed) return;
    onUpdate(task, { status: "resolved", resolution: trimmed }, () => {
      setShowResolution(false);
      setResolution("");
    });
  };

  return (
    <Card
      className={`border-card-border bg-card shadow-sm transition-colors ${isSuggestion ? "border-l-[3px] border-l-amber-500/70" : ""}`}
      data-testid={`task-card-${task.id}`}
    >
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="gap-1.5 border-border bg-muted/50 font-medium text-muted-foreground"
                data-testid={`task-source-${task.id}`}
              >
                <SourceIcon type={task.sourceType} />
                {sourceText[task.sourceType]}
              </Badge>
              {isSuggestion ? (
                <Badge className="border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-50" data-testid={`task-review-${task.id}`}>
                  Requiere revisión
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className={
                    task.status === "resolved"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : task.status === "in_progress"
                        ? "border-sky-200 bg-sky-50 text-sky-800"
                        : "border-border bg-background text-muted-foreground"
                  }
                  data-testid={`task-status-${task.id}`}
                >
                  {statusText[task.status]}
                </Badge>
              )}
            </div>
            <h3 className="text-[15px] font-semibold leading-6 tracking-[-0.01em] text-foreground" data-testid={`task-title-${task.id}`}>
              {task.title}
            </h3>
            {task.description && (
              <p className="mt-1.5 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-muted-foreground" data-testid={`task-description-${task.id}`}>
                {task.description}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground/75" data-testid={`task-source-name-${task.id}`}>
                {task.sourceLabel || sourceText[task.sourceType]}
              </span>
              {sourceDate && (
                <>
                  <span aria-hidden="true" className="text-border">·</span>
                  <span data-testid={`task-source-date-${task.id}`}>{sourceDate}</span>
                </>
              )}
              {!sourceDate && (
                <>
                  <span aria-hidden="true" className="text-border">·</span>
                  <span>Añadida {formatDate(task.createdAt)}</span>
                </>
              )}
            </div>
            {task.resolution && (
              <div className="mt-4 rounded-md border border-emerald-200/70 bg-emerald-50/60 px-3.5 py-3" data-testid={`task-resolution-${task.id}`}>
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-800">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Resolución guardada
                </p>
                <p className="whitespace-pre-wrap text-sm leading-5 text-emerald-950">{task.resolution}</p>
                {task.resolvedAt && <p className="mt-1.5 text-xs text-emerald-800/75">{formatDate(task.resolvedAt)}</p>}
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {isSuggestion ? (
              <>
                <Button
                  size="sm"
                  onClick={() => onUpdate(task, { reviewStatus: "accepted" })}
                  disabled={updating}
                  data-testid={`button-accept-task-${task.id}`}
                  className="bg-primary text-primary-foreground"
                >
                  <Check className="mr-1.5 h-4 w-4" /> Confirmar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onUpdate(task, { reviewStatus: "dismissed" })}
                  disabled={updating}
                  data-testid={`button-dismiss-task-${task.id}`}
                  className="text-muted-foreground"
                >
                  <X className="mr-1.5 h-4 w-4" /> Descartar
                </Button>
              </>
            ) : task.status !== "resolved" ? (
              <>
                {task.status === "pending" ? (
                  <Button size="sm" variant="outline" onClick={() => changeStatus("in_progress")} disabled={updating} data-testid={`button-start-task-${task.id}`}>
                    <ArrowRight className="mr-1.5 h-4 w-4" /> Empezar
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => changeStatus("pending")} disabled={updating} data-testid={`button-pause-task-${task.id}`}>
                    <Clock3 className="mr-1.5 h-4 w-4" /> Dejar pendiente
                  </Button>
                )}
                <Button size="sm" onClick={() => changeStatus("resolved")} disabled={updating} data-testid={`button-resolve-task-${task.id}`}>
                  <CheckCircle2 className="mr-1.5 h-4 w-4" /> Resolver
                </Button>
              </>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800" data-testid={`task-complete-${task.id}`}>
                  <CheckCircle2 className="h-4 w-4" /> Completada
                </span>
                <Button size="sm" variant="ghost" onClick={() => changeStatus("pending")} disabled={updating} data-testid={`button-reopen-task-${task.id}`}>
                  Reabrir
                </Button>
                <Button size="sm" variant="ghost" onClick={() => changeStatus("in_progress")} disabled={updating} data-testid={`button-resume-task-${task.id}`}>
                  En curso
                </Button>
              </>
            )}
          </div>
        </div>
        {showResolution && (
          <form onSubmit={confirmResolution} className="mt-5 border-t border-border pt-4" data-testid={`form-resolution-${task.id}`}>
            <label htmlFor={`resolution-${task.id}`} className="mb-2 block text-sm font-medium">
              ¿Qué se ha resuelto?
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Textarea
                id={`resolution-${task.id}`}
                value={resolution}
                onChange={(event) => setResolution(event.target.value)}
                placeholder="Deja una nota breve para mantener el seguimiento."
                rows={2}
                required
                className="min-h-[72px] flex-1 resize-y bg-background"
                data-testid={`input-resolution-${task.id}`}
              />
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowResolution(false)} data-testid={`button-cancel-resolution-${task.id}`}>
                  Cancelar
                </Button>
                <Button type="submit" size="sm" disabled={!resolution.trim() || updating} data-testid={`button-save-resolution-${task.id}`}>
                  Guardar resolución
                </Button>
              </div>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export default function CoordinatorTasksPage() {
  const queryClient = useQueryClient();
  const queryKey = getListCoordinatorTasksQueryKey();
  const { data, isLoading, isError, refetch } = useListCoordinatorTasks({
    query: { queryKey },
  });
  const createTask = useCreateCoordinatorTask();
  const analyzeSources = useAnalyzeCoordinatorTaskSources();
  const updateTask = useUpdateCoordinatorTask();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [analysis, setAnalysis] = useState<CoordinatorTaskAnalysis | null>(null);
  const [actionError, setActionError] = useState("");

  const refreshList = () => queryClient.invalidateQueries({ queryKey });
  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    setActionError("");
    createTask.mutate(
      { data: { title: cleanTitle, ...(description.trim() ? { description: description.trim() } : {}) } },
      {
        onSuccess: () => {
          void refreshList();
          setTitle("");
          setDescription("");
          setFormOpen(false);
        },
        onError: () => setActionError("No se pudo guardar la tarea. Inténtalo de nuevo."),
      },
    );
  };
  const onUpdate = (
    task: CoordinatorTask,
    update: Omit<CoordinatorTaskUpdate, "revision">,
    onSuccess?: () => void,
  ) => {
    setActionError("");
    updateTask.mutate(
      { id: task.id, data: { revision: task.revision, ...update } },
      {
        onSuccess: () => {
          void refreshList();
          onSuccess?.();
        },
        onError: () => setActionError("No se pudo actualizar la tarea. Puede que haya cambiado; vuelve a cargar la lista."),
      },
    );
  };
  const onAnalyze = () => {
    setActionError("");
    setAnalysis(null);
    analyzeSources.mutate(undefined, {
      onSuccess: (result) => {
        setAnalysis(result);
        void refreshList();
      },
      onError: () => setActionError("No se pudieron revisar las fuentes. Comprueba la conexión e inténtalo de nuevo."),
    });
  };

  if (isLoading) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8" data-testid="tasks-loading">
        <Skeleton className="mb-3 h-4 w-32" />
        <Skeleton className="mb-8 h-10 w-72" />
        <Skeleton className="mb-6 h-28 w-full rounded-xl" />
        <div className="space-y-3"><Skeleton className="h-36 w-full" /><Skeleton className="h-36 w-full" /></div>
      </main>
    );
  }

  if (isError || !data) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-8">
        <div className="mx-auto max-w-xl rounded-xl border border-rose-200 bg-rose-50 p-7 text-center" data-testid="tasks-error">
          <AlertCircle className="mx-auto mb-3 h-6 w-6 text-rose-700" />
          <h1 className="text-lg font-semibold text-foreground">No se han podido cargar tus tareas</h1>
          <p className="mt-2 text-sm text-muted-foreground">La lista sigue intacta. Comprueba la conexión e inténtalo de nuevo.</p>
          <Button variant="outline" className="mt-5" onClick={() => void refetch()} data-testid="button-retry-tasks">Volver a intentar</Button>
        </div>
      </main>
    );
  }

  const activeTasks = data.tasks.filter((task) => task.reviewStatus !== "dismissed");
  const suggestions = activeTasks.filter((task) => task.reviewStatus === "suggested");
  const accepted = activeTasks.filter((task) => task.reviewStatus !== "suggested");
  const pendingCount = accepted.filter((task) => task.status === "pending").length;
  const progressCount = accepted.filter((task) => task.status === "in_progress").length;
  const resolvedCount = accepted.filter((task) => task.status === "resolved").length;
  const gmailNeedsAttention = !data.gmailConnected || ["error", "needs_reauthorization", "needs_configuration"].includes(data.gmailSyncStatus);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-12 pt-7 sm:px-8 sm:pt-10" data-testid="coordinator-tasks-page">
      <header className="mb-7 flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary/75">Coordinación · Seguimiento</p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-[2.15rem]" data-testid="heading-pending-tasks">
            Tareas pendientes
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Un lugar claro para los compromisos de actas, mensajes y correo. Cada seguimiento queda bajo tu control.
          </p>
        </div>
        <Button onClick={() => setFormOpen((open) => !open)} data-testid="button-new-task">
          <Plus className="mr-2 h-4 w-4" /> Nueva tarea
        </Button>
      </header>

      <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Resumen de tareas">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3.5" data-testid="summary-pending">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-amber-50 text-amber-800"><Circle className="h-4 w-4" /></span>
          <div><p className="text-2xl font-semibold leading-none tabular-nums">{pendingCount}</p><p className="mt-1 text-xs text-muted-foreground">Pendientes</p></div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3.5" data-testid="summary-in-progress">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-sky-50 text-sky-800"><Clock3 className="h-4 w-4" /></span>
          <div><p className="text-2xl font-semibold leading-none tabular-nums">{progressCount}</p><p className="mt-1 text-xs text-muted-foreground">En curso</p></div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3.5" data-testid="summary-resolved">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-emerald-50 text-emerald-800"><CheckCircle2 className="h-4 w-4" /></span>
          <div><p className="text-2xl font-semibold leading-none tabular-nums">{resolvedCount}</p><p className="mt-1 text-xs text-muted-foreground">Resueltas</p></div>
        </div>
      </section>

      {formOpen && (
        <Card className="mb-6 border-primary/20 bg-primary/[0.025]" data-testid="create-task-panel">
          <CardContent className="p-5 sm:p-6">
            <div className="mb-4">
              <h2 className="font-semibold">Añadir una tarea</h2>
              <p className="mt-1 text-sm text-muted-foreground">Registra un compromiso que quieras mantener visible.</p>
            </div>
            <form onSubmit={onCreate} className="space-y-3" data-testid="form-create-task">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Tarea</span>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required placeholder="Ej. Confirmar calendario de coordinación" data-testid="input-task-title" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Detalle <span className="font-normal text-muted-foreground">(opcional)</span></span>
                <Textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} rows={3} placeholder="Añade contexto para retomarla más adelante." data-testid="input-task-description" />
              </label>
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setFormOpen(false)} data-testid="button-cancel-create-task">Cancelar</Button>
                <Button type="submit" disabled={!title.trim() || createTask.isPending} data-testid="button-save-task">
                  {createTask.isPending && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />} Guardar tarea
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {!data.aiAvailable && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3.5" data-testid="warning-ai-unavailable">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div><p className="text-sm font-medium">Revisión automática no disponible</p><p className="mt-0.5 text-sm text-muted-foreground">Puedes seguir añadiendo y gestionando tareas manualmente. La revisión automática no está configurada ahora.</p></div>
        </div>
      )}
      {gmailNeedsAttention && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3.5" data-testid="warning-gmail">
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" />
          <div>
            <p className="text-sm font-medium text-amber-950">{!data.gmailConnected ? "Gmail no está conectado" : "La sincronización de Gmail necesita atención"}</p>
            <p className="mt-0.5 text-sm leading-5 text-amber-900/80">
              {!data.gmailConnected
                ? "Las tareas de correo propio no se pueden revisar hasta que se conecte la cuenta."
                : data.gmailSyncStatus === "needs_reauthorization"
                  ? "La conexión requiere volver a autorizarse para recibir nuevos seguimientos."
                  : data.gmailSyncStatus === "needs_configuration"
                    ? "La integración de Gmail necesita configuración."
                    : "La sincronización ha indicado un error. Los mensajes recibidos y las tareas existentes siguen visibles."}
            </p>
          </div>
        </div>
      )}
      {data.gmailConnected && ["queued", "syncing"].includes(data.gmailSyncStatus) && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50/70 px-4 py-3 text-sm text-sky-900" data-testid="status-gmail-syncing">
          <RefreshCw className="h-4 w-4 animate-spin" /> Gmail se está sincronizando. Los nuevos seguimientos aparecerán al terminar.
        </div>
      )}

      <section className="mb-7 overflow-hidden rounded-xl border border-primary/15 bg-[linear-gradient(115deg,hsl(var(--primary)/0.07),hsl(var(--card))_56%)]" data-testid="source-analysis-panel">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
          <div className="flex items-start gap-3.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm"><Sparkles className="h-5 w-5" /></span>
            <div>
              <h2 className="font-semibold tracking-tight">Revisar nuevas fuentes</h2>
              <p className="mt-1 max-w-xl text-sm leading-5 text-muted-foreground">Busca compromisos en actas publicadas, mensajes recibidos y, si está conectado, en tu Gmail.</p>
            </div>
          </div>
          <Button onClick={onAnalyze} disabled={!data.aiAvailable || analyzeSources.isPending} variant="outline" className="shrink-0 border-primary/25 bg-card" data-testid="button-analyze-sources">
            {analyzeSources.isPending ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            {analyzeSources.isPending ? "Revisando fuentes…" : "Revisar fuentes"}
          </Button>
        </div>
        {analysis && (
          <div className="border-t border-primary/10 bg-card/65 px-5 py-4 sm:px-6" data-testid="analysis-result">
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <span><strong className="tabular-nums">{analysis.scanned}</strong> fuentes revisadas</span>
              <span><strong className="tabular-nums">{analysis.suggestionsCreated}</strong> sugerencias creadas</span>
              <span className="text-muted-foreground"><strong className="tabular-nums text-foreground">{analysis.remaining}</strong> por revisar</span>
            </div>
            {analysis.remaining > 0 && <p className="mt-2 text-xs text-muted-foreground" data-testid="analysis-remaining">Quedan fuentes por revisar; vuelve a ejecutar la revisión para continuar.</p>}
            {analysis.warnings.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-amber-900" data-testid="analysis-warnings">
                {analysis.warnings.map((warning, index) => <li key={`${index}-${warning}`} className="flex gap-2"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{warning}</li>)}
              </ul>
            )}
          </div>
        )}
      </section>

      {actionError && (
        <div role="alert" className="mb-5 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900" data-testid="task-action-error">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{actionError}
        </div>
      )}

      {activeTasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/60 px-6 py-14 text-center" data-testid="empty-tasks">
          <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground"><Inbox className="h-5 w-5" /></span>
          <h2 className="text-lg font-semibold tracking-tight">Tu lista está despejada</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">No hay tareas visibles por ahora. Añade una tarea o revisa las fuentes para detectar nuevos seguimientos.</p>
          <Button variant="outline" className="mt-5" onClick={() => setFormOpen(true)} data-testid="button-empty-new-task"><Plus className="mr-2 h-4 w-4" /> Añadir tarea</Button>
        </div>
      ) : (
        <div className="space-y-7">
          {suggestions.length > 0 && (
            <section aria-labelledby="suggestions-heading" data-testid="suggestions-section">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <div><h2 id="suggestions-heading" className="text-base font-semibold tracking-tight">Para revisar</h2><p className="mt-0.5 text-sm text-muted-foreground">Confirma solo los compromisos que quieras asumir.</p></div>
                <Badge variant="outline" className="tabular-nums" data-testid="suggestions-count">{suggestions.length}</Badge>
              </div>
              <div className="space-y-3">{suggestions.map((task) => <TaskCard key={task.id} task={task} onUpdate={onUpdate} updating={updateTask.isPending} />)}</div>
            </section>
          )}
          {accepted.length > 0 && (
            <section aria-labelledby="commitments-heading" data-testid="commitments-section">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <div><h2 id="commitments-heading" className="text-base font-semibold tracking-tight">Tus compromisos</h2><p className="mt-0.5 text-sm text-muted-foreground">Tareas confirmadas y anotadas manualmente.</p></div>
                <Badge variant="outline" className="tabular-nums" data-testid="commitments-count">{accepted.length}</Badge>
              </div>
              <div className="space-y-3">{accepted.map((task) => <TaskCard key={task.id} task={task} onUpdate={onUpdate} updating={updateTask.isPending} />)}</div>
            </section>
          )}
        </div>
      )}
      {activeTasks.length > 0 && data.tasks.some((task) => task.reviewStatus === "dismissed") && (
        <p className="mt-6 text-center text-xs text-muted-foreground" data-testid="dismissed-tasks-note">
          Las sugerencias descartadas se mantienen fuera de esta lista.
        </p>
      )}
    </main>
  );
}
