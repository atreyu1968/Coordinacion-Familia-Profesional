import { useState, useEffect, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSurveys,
  useCreateSurvey,
  useGetSurvey,
  useDeleteSurvey,
  useSubmitSurveyResponse,
  useGetSurveyResults,
  getListSurveysQueryKey,
  getGetSurveyQueryKey,
  getGetSurveyResultsQueryKey,
  useListProvinces,
  type CreateSurveyInput,
  type CreateSurveyQuestionInput,
  type CreateSurveyQuestionInputType,
  type Survey,
  type SurveyQuestion,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
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
  DialogTrigger,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import {
  Vote,
  BarChart3,
  Plus,
  Trash2,
  CheckCircle2,
  Lock,
  Users,
  ArrowLeft,
  X,
  Download,
} from "lucide-react";

const GLOBAL = "global";

const QUESTION_TYPE_LABELS: Record<CreateSurveyQuestionInputType, string> = {
  single: "Opción única",
  multiple: "Opción múltiple",
  text: "Respuesta abierta",
  scale: "Escala (1-5)",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  open: "Abierta",
  closed: "Cerrada",
};

function canManageSurveys(role: string | undefined): boolean {
  return role === "superadmin" || role === "coordinator";
}

// ---------------------------------------------------------------------------
// Create survey dialog
// ---------------------------------------------------------------------------
type DraftQuestion = {
  text: string;
  type: CreateSurveyQuestionInputType;
  options: string[];
};

function emptyQuestion(): DraftQuestion {
  return { text: "", type: "single", options: ["", ""] };
}

function CreateSurveyDialog() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: provinces = [] } = useListProvinces();
  const createMut = useCreateSurvey();

  const isSuperadmin = user?.role === "superadmin";

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"survey" | "vote">("survey");
  const [anonymous, setAnonymous] = useState(false);
  const [provinceId, setProvinceId] = useState<string>(GLOBAL);
  const [questions, setQuestions] = useState<DraftQuestion[]>([emptyQuestion()]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setType("survey");
      setAnonymous(false);
      setProvinceId(GLOBAL);
      setQuestions([emptyQuestion()]);
      setError(null);
    }
  }, [open]);

  const updateQuestion = (i: number, patch: Partial<DraftQuestion>) => {
    setQuestions((qs) =>
      qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)),
    );
  };

  const updateOption = (qi: number, oi: number, value: string) => {
    setQuestions((qs) =>
      qs.map((q, idx) =>
        idx === qi
          ? { ...q, options: q.options.map((o, j) => (j === oi ? value : o)) }
          : q,
      ),
    );
  };

  const addOption = (qi: number) =>
    setQuestions((qs) =>
      qs.map((q, idx) =>
        idx === qi ? { ...q, options: [...q.options, ""] } : q,
      ),
    );

  const removeOption = (qi: number, oi: number) =>
    setQuestions((qs) =>
      qs.map((q, idx) =>
        idx === qi
          ? { ...q, options: q.options.filter((_, j) => j !== oi) }
          : q,
      ),
    );

  const needsOptions = (t: CreateSurveyQuestionInputType) =>
    t === "single" || t === "multiple";

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("El título es obligatorio.");
      return;
    }
    if (questions.length === 0) {
      setError("Añade al menos una pregunta.");
      return;
    }
    const builtQuestions: CreateSurveyQuestionInput[] = [];
    for (const [i, q] of questions.entries()) {
      if (!q.text.trim()) {
        setError(`La pregunta ${i + 1} necesita un enunciado.`);
        return;
      }
      if (needsOptions(q.type)) {
        const opts = q.options.map((o) => o.trim()).filter(Boolean);
        if (opts.length < 2) {
          setError(`La pregunta ${i + 1} necesita al menos dos opciones.`);
          return;
        }
        builtQuestions.push({
          text: q.text.trim(),
          type: q.type,
          options: opts,
          order: i,
        });
      } else if (q.type === "scale") {
        builtQuestions.push({
          text: q.text.trim(),
          type: q.type,
          options: ["1", "2", "3", "4", "5"],
          order: i,
        });
      } else {
        builtQuestions.push({ text: q.text.trim(), type: q.type, order: i });
      }
    }

    const payload: CreateSurveyInput = {
      title: title.trim(),
      description: description.trim() || null,
      type,
      anonymous,
      provinceId: isSuperadmin
        ? provinceId === GLOBAL
          ? null
          : Number(provinceId)
        : null,
      questions: builtQuestions,
    };

    try {
      await createMut.mutateAsync({ data: payload });
      await qc.invalidateQueries({ queryKey: getListSurveysQueryKey() });
      toast({ title: "Publicada", description: title.trim() });
      setOpen(false);
    } catch {
      setError("No se pudo crear. Inténtalo de nuevo.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="w-4 h-4" /> Nueva encuesta
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva encuesta o votación</DialogTitle>
          <DialogDescription>
            Crea una consulta para el profesorado. Las votaciones anónimas no
            registran quién eligió cada opción.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="s-title">Título *</Label>
            <Input
              id="s-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-desc">Descripción</Label>
            <Textarea
              id="s-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as "survey" | "vote")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="survey">Encuesta</SelectItem>
                  <SelectItem value="vote">Votación</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isSuperadmin && (
              <div className="space-y-2">
                <Label>Provincia</Label>
                <Select value={provinceId} onValueChange={setProvinceId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={GLOBAL}>Todas (global)</SelectItem>
                    {provinces.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="s-anon"
              checked={anonymous}
              onCheckedChange={(c) => setAnonymous(c === true)}
            />
            <Label htmlFor="s-anon" className="font-normal cursor-pointer">
              Anónima (no se guarda quién votó qué)
            </Label>
          </div>

          <div className="space-y-3 pt-2 border-t">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Preguntas</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => setQuestions((qs) => [...qs, emptyQuestion()])}
              >
                <Plus className="w-3.5 h-3.5" /> Pregunta
              </Button>
            </div>

            {questions.map((q, qi) => (
              <Card key={qi} className="border-dashed">
                <CardContent className="p-3 space-y-3">
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-medium text-muted-foreground pt-2.5">
                      {qi + 1}.
                    </span>
                    <div className="flex-1 space-y-2">
                      <Input
                        value={q.text}
                        onChange={(e) =>
                          updateQuestion(qi, { text: e.target.value })
                        }
                        placeholder="Enunciado de la pregunta"
                      />
                      <Select
                        value={q.type}
                        onValueChange={(v) =>
                          updateQuestion(qi, {
                            type: v as CreateSurveyQuestionInputType,
                          })
                        }
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(
                            Object.keys(
                              QUESTION_TYPE_LABELS,
                            ) as CreateSurveyQuestionInputType[]
                          ).map((t) => (
                            <SelectItem key={t} value={t}>
                              {QUESTION_TYPE_LABELS[t]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {questions.length > 1 && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive shrink-0"
                        onClick={() =>
                          setQuestions((qs) =>
                            qs.filter((_, idx) => idx !== qi),
                          )
                        }
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>

                  {needsOptions(q.type) && (
                    <div className="space-y-2 pl-5">
                      {q.options.map((o, oi) => (
                        <div key={oi} className="flex items-center gap-2">
                          <Input
                            value={o}
                            onChange={(e) =>
                              updateOption(qi, oi, e.target.value)
                            }
                            placeholder={`Opción ${oi + 1}`}
                            className="h-8 text-sm"
                          />
                          {q.options.length > 2 && (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 shrink-0"
                              onClick={() => removeOption(qi, oi)}
                            >
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      ))}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="gap-1 h-7 text-xs"
                        onClick={() => addOption(qi)}
                      >
                        <Plus className="w-3 h-3" /> Añadir opción
                      </Button>
                    </div>
                  )}
                  {q.type === "scale" && (
                    <p className="text-xs text-muted-foreground pl-5">
                      Escala del 1 al 5.
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? "Publicando..." : "Publicar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Vote form (detail view)
// ---------------------------------------------------------------------------
function VoteForm({
  surveyId,
  questions,
  onVoted,
}: {
  surveyId: number;
  questions: SurveyQuestion[];
  onVoted: () => void;
}) {
  const qc = useQueryClient();
  const submitMut = useSubmitSurveyResponse();
  const [answers, setAnswers] = useState<Record<number, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  const setSingle = (qid: number, value: string) =>
    setAnswers((a) => ({ ...a, [qid]: [value] }));

  const toggleMultiple = (qid: number, value: string) =>
    setAnswers((a) => {
      const cur = a[qid] ?? [];
      return {
        ...a,
        [qid]: cur.includes(value)
          ? cur.filter((v) => v !== value)
          : [...cur, value],
      };
    });

  const setText = (qid: number, value: string) =>
    setAnswers((a) => ({ ...a, [qid]: value ? [value] : [] }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    for (const q of questions) {
      const val = answers[q.id] ?? [];
      if (val.length === 0) {
        setError("Responde todas las preguntas antes de enviar.");
        return;
      }
    }

    try {
      await submitMut.mutateAsync({
        id: surveyId,
        data: {
          answers: questions.map((q) => ({
            questionId: q.id,
            value: answers[q.id] ?? [],
          })),
        },
      });
      await qc.invalidateQueries({ queryKey: getGetSurveyQueryKey(surveyId) });
      await qc.invalidateQueries({
        queryKey: getGetSurveyResultsQueryKey(surveyId),
      });
      toast({ title: "Respuesta registrada", description: "¡Gracias!" });
      onVoted();
    } catch (err) {
      const status = (err as { status?: number })?.status;
      setError(
        status === 409
          ? "Ya has participado en esta encuesta."
          : "No se pudo enviar tu respuesta. Inténtalo de nuevo.",
      );
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {questions.map((q, qi) => (
        <div key={q.id} className="space-y-3">
          <p className="font-medium">
            {qi + 1}. {q.text}
          </p>
          {q.type === "single" && (
            <RadioGroup
              value={(answers[q.id] ?? [])[0] ?? ""}
              onValueChange={(v) => setSingle(q.id, v)}
              className="space-y-1"
            >
              {(q.options ?? []).map((o) => (
                <div key={o} className="flex items-center gap-2">
                  <RadioGroupItem value={o} id={`q${q.id}-${o}`} />
                  <Label
                    htmlFor={`q${q.id}-${o}`}
                    className="font-normal cursor-pointer"
                  >
                    {o}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          )}
          {q.type === "scale" && (
            <RadioGroup
              value={(answers[q.id] ?? [])[0] ?? ""}
              onValueChange={(v) => setSingle(q.id, v)}
              className="flex gap-4"
            >
              {(q.options ?? ["1", "2", "3", "4", "5"]).map((o) => (
                <div key={o} className="flex flex-col items-center gap-1">
                  <RadioGroupItem value={o} id={`q${q.id}-${o}`} />
                  <Label
                    htmlFor={`q${q.id}-${o}`}
                    className="font-normal cursor-pointer text-sm"
                  >
                    {o}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          )}
          {q.type === "multiple" && (
            <div className="space-y-1">
              {(q.options ?? []).map((o) => {
                const checked = (answers[q.id] ?? []).includes(o);
                return (
                  <div key={o} className="flex items-center gap-2">
                    <Checkbox
                      id={`q${q.id}-${o}`}
                      checked={checked}
                      onCheckedChange={() => toggleMultiple(q.id, o)}
                    />
                    <Label
                      htmlFor={`q${q.id}-${o}`}
                      className="font-normal cursor-pointer"
                    >
                      {o}
                    </Label>
                  </div>
                );
              })}
            </div>
          )}
          {q.type === "text" && (
            <Textarea
              value={(answers[q.id] ?? [])[0] ?? ""}
              onChange={(e) => setText(q.id, e.target.value)}
              rows={3}
              placeholder="Tu respuesta"
            />
          )}
        </div>
      ))}
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      <Button type="submit" disabled={submitMut.isPending}>
        {submitMut.isPending ? "Enviando..." : "Enviar respuesta"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Results view
// ---------------------------------------------------------------------------
function ResultsView({ surveyId }: { surveyId: number }) {
  const { data: results, isLoading } = useGetSurveyResults(surveyId, {
    query: {
      queryKey: getGetSurveyResultsQueryKey(surveyId),
      refetchInterval: 5000,
      refetchOnWindowFocus: true,
    },
  });

  const handleExportCsv = () => {
    if (!results) return;
    const escape = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows: string[] = [];
    rows.push(["Pregunta", "Tipo", "Respuesta", "Recuento"].map(escape).join(","));
    results.questions.forEach((q, qi) => {
      const label = `${qi + 1}. ${q.text}`;
      if (q.options && q.options.length > 0) {
        q.options.forEach((o) => {
          rows.push([label, "opción", o.label, o.count].map(escape).join(","));
        });
      }
      if (q.textAnswers) {
        if (q.textAnswers.length === 0) {
          rows.push([label, "texto", "", 0].map(escape).join(","));
        } else {
          q.textAnswers.forEach((t) => {
            rows.push([label, "texto", t, ""].map(escape).join(","));
          });
        }
      }
    });
    const csv = "\uFEFF" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `resultados-encuesta-${surveyId}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <p className="text-muted-foreground py-8 text-center">
        Cargando resultados...
      </p>
    );
  }
  if (!results) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="w-4 h-4" />
          {results.totalResponses}{" "}
          {results.totalResponses === 1 ? "participación" : "participaciones"}
          <span className="flex items-center gap-1 ml-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
            En vivo
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportCsv}
          disabled={results.totalResponses === 0}
        >
          <Download className="w-4 h-4 mr-2" />
          Exportar CSV
        </Button>
      </div>
      {results.questions.map((q, qi) => {
        const totalForOptions = (q.options ?? []).reduce(
          (sum, o) => sum + o.count,
          0,
        );
        return (
          <div key={q.questionId} className="space-y-3">
            <p className="font-medium">
              {qi + 1}. {q.text}
            </p>
            {q.options && q.options.length > 0 && (
              <div className="space-y-2">
                {q.options.map((o) => {
                  const pct =
                    totalForOptions > 0
                      ? Math.round((o.count / totalForOptions) * 100)
                      : 0;
                  return (
                    <div key={o.label} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>{o.label}</span>
                        <span className="text-muted-foreground">
                          {o.count} ({pct}%)
                        </span>
                      </div>
                      <Progress value={pct} />
                    </div>
                  );
                })}
              </div>
            )}
            {q.textAnswers && (
              <div className="space-y-2">
                {q.textAnswers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Sin respuestas todavía.
                  </p>
                ) : (
                  q.textAnswers.map((t, ti) => (
                    <div
                      key={ti}
                      className="text-sm bg-muted rounded-md px-3 py-2"
                    >
                      {t}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Survey detail dialog
// ---------------------------------------------------------------------------
function SurveyDetailDialog({
  surveyId,
  open,
  onOpenChange,
}: {
  surveyId: number | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { user } = useAuth();
  const { data: survey, isLoading } = useGetSurvey(surveyId ?? 0, {
    query: {
      queryKey: getGetSurveyQueryKey(surveyId ?? 0),
      enabled: open && surveyId != null,
    },
  });

  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    if (open) setShowResults(false);
  }, [open, surveyId]);

  const manager = canManageSurveys(user?.role);
  const hasVoted = survey?.hasVoted === true;
  const closed = survey?.status === "closed";
  const canVote = !hasVoted && !closed && !manager;
  // Managers and people who already voted (or closed surveys) see results.
  const viewingResults = showResults || hasVoted || closed || manager;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        {isLoading || !survey ? (
          <p className="text-muted-foreground py-8 text-center">Cargando...</p>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={survey.type === "vote" ? "default" : "secondary"}>
                  {survey.type === "vote" ? "Votación" : "Encuesta"}
                </Badge>
                {survey.anonymous && (
                  <Badge variant="outline" className="gap-1">
                    <Lock className="w-3 h-3" /> Anónima
                  </Badge>
                )}
                <Badge variant="outline">
                  {STATUS_LABELS[survey.status] ?? survey.status}
                </Badge>
              </div>
              <DialogTitle className="pt-1">{survey.title}</DialogTitle>
              {survey.description && (
                <DialogDescription>{survey.description}</DialogDescription>
              )}
            </DialogHeader>

            {hasVoted && !manager && (
              <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4" /> Ya has participado.
              </div>
            )}

            {viewingResults ? (
              <>
                {canVote && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 w-fit -mt-2"
                    onClick={() => setShowResults(false)}
                  >
                    <ArrowLeft className="w-4 h-4" /> Volver a votar
                  </Button>
                )}
                <ResultsView surveyId={survey.id} />
              </>
            ) : (
              <>
                <VoteForm
                  surveyId={survey.id}
                  questions={survey.questions ?? []}
                  onVoted={() => setShowResults(true)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 w-fit"
                  onClick={() => setShowResults(true)}
                >
                  <BarChart3 className="w-4 h-4" /> Ver resultados
                </Button>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function EncuestasPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: surveys = [], isLoading } = useListSurveys();
  const { data: provinces = [] } = useListProvinces();
  const deleteMut = useDeleteSurvey();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const manager = canManageSurveys(user?.role);

  const provinceName = (id: number | null | undefined) =>
    id == null ? "Global" : provinces.find((p) => p.id === id)?.name ?? "—";

  const canDelete = (s: Survey) =>
    user?.role === "superadmin" ||
    (user?.role === "coordinator" &&
      user?.provinceId != null &&
      s.provinceId === user.provinceId);

  const openDetail = (id: number) => {
    setSelectedId(id);
    setDetailOpen(true);
  };

  const onDelete = async (id: number) => {
    try {
      await deleteMut.mutateAsync({ id });
      await qc.invalidateQueries({ queryKey: getListSurveysQueryKey() });
      toast({ title: "Encuesta eliminada" });
    } catch {
      toast({
        title: "No se pudo eliminar",
        description: "Comprueba tus permisos.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Vote className="w-6 h-6" /> Encuestas y Votaciones
          </h1>
          <p className="text-muted-foreground mt-1">
            Consulta la opinión del profesorado y organiza votaciones, con la
            opción de mantener el anonimato.
          </p>
        </div>
        {manager && <CreateSurveyDialog />}
      </div>

      {isLoading ? (
        <p className="text-muted-foreground py-8 text-center">Cargando...</p>
      ) : surveys.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No hay encuestas ni votaciones todavía.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {surveys.map((s) => (
            <Card
              key={s.id}
              className="flex flex-col cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => openDetail(s.id)}
            >
              <CardContent className="p-4 flex flex-col gap-3 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                    {s.type === "vote" ? (
                      <Vote className="w-4 h-4" />
                    ) : (
                      <BarChart3 className="w-4 h-4" />
                    )}
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {provinceName(s.provinceId)}
                  </Badge>
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold leading-tight">{s.title}</h3>
                  {s.description && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {s.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant="outline" className="text-xs">
                    {s.type === "vote" ? "Votación" : "Encuesta"}
                  </Badge>
                  {s.anonymous && (
                    <Badge variant="outline" className="text-xs gap-1">
                      <Lock className="w-3 h-3" /> Anónima
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-xs">
                    {STATUS_LABELS[s.status] ?? s.status}
                  </Badge>
                </div>
                {canDelete(s) && (
                  <div
                    className="flex justify-end pt-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            ¿Eliminar encuesta?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Se eliminará «{s.title}» y todas sus respuestas. Esta
                            acción no se puede deshacer.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => onDelete(s.id)}>
                            Eliminar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <SurveyDetailDialog
        surveyId={selectedId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
}
