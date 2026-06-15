import { useState, useEffect, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDocumentForms,
  useCreateDocumentForm,
  useDeleteDocumentForm,
  useListDocumentFormSubmissions,
  useGetDocumentForm,
  useSubmitDocumentForm,
  useRequestUploadUrl,
  getListDocumentFormsQueryKey,
  getListDocumentFormSubmissionsQueryKey,
  getGetDocumentFormQueryKey,
  useListProvinces,
  type CreateDocumentFormInput,
  type CreateDocumentFormFieldInput,
  type CreateDocumentFormFieldInputType,
  type DocumentFormSummary,
  type DocumentFormField,
  type SubmitDocumentFormValueInput,
  type DocumentFormSubmissionDetail,
  type DocumentSubmissionValue,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useModuleParam } from "@/lib/use-module-param";
import {
  AudiencePicker,
  useFormSurveyCreator,
  defaultAudienceValue,
  audienceNeedsIds,
  type AudienceValue,
} from "@/components/audience-picker";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  FileText,
  FileCheck2,
  Plus,
  Trash2,
  Users,
  X,
  Download,
  Inbox,
  CheckCircle2,
  Paperclip,
  PencilLine,
} from "lucide-react";

const TOKEN_KEY = "coordina_adg_token";

function canManageForms(role: string | undefined): boolean {
  return role === "superadmin" || role === "coordinator";
}

const FIELD_TYPE_LABELS: Record<CreateDocumentFormFieldInputType, string> = {
  text: "Texto",
  textarea: "Texto largo",
  select: "Selección",
  file: "Documento",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  open: "Abierto",
  closed: "Cerrado",
};

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function downloadSubmissionFile(valueId: number, fileName: string) {
  const token = localStorage.getItem(TOKEN_KEY);
  try {
    const res = await fetch(
      `${import.meta.env.BASE_URL}api/document-forms/submission-values/${valueId}/file`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    );
    if (!res.ok) {
      toast({
        title: "No se pudo descargar",
        description: "Comprueba tus permisos o inténtalo de nuevo.",
        variant: "destructive",
      });
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "documento";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    toast({
      title: "No se pudo descargar",
      description: "Error de red. Inténtalo de nuevo.",
      variant: "destructive",
    });
  }
}

// ---------------------------------------------------------------------------
// Create form dialog
// ---------------------------------------------------------------------------
type DraftField = {
  label: string;
  type: CreateDocumentFormFieldInputType;
  required: boolean;
  options: string[];
};

function emptyField(): DraftField {
  return { label: "", type: "text", required: false, options: ["", ""] };
}

function CreateFormDialog() {
  const qc = useQueryClient();
  const { isSuperadmin, isProvincialCoordinator, user } =
    useFormSurveyCreator();
  const createMut = useCreateDocumentForm();

  const makeDefaultAudience = (): AudienceValue =>
    defaultAudienceValue({
      isSuperadmin,
      isProvincialCoordinator,
      provinceId: user?.provinceId ?? null,
    });

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [audience, setAudience] = useState<AudienceValue>(makeDefaultAudience);
  const [fields, setFields] = useState<DraftField[]>([emptyField()]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setClosesAt("");
      setAudience(makeDefaultAudience());
      setFields([emptyField()]);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const updateField = (i: number, patch: Partial<DraftField>) => {
    setFields((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  };

  const updateOption = (fi: number, oi: number, value: string) => {
    setFields((fs) =>
      fs.map((f, idx) =>
        idx === fi
          ? { ...f, options: f.options.map((o, j) => (j === oi ? value : o)) }
          : f,
      ),
    );
  };

  const addOption = (fi: number) =>
    setFields((fs) =>
      fs.map((f, idx) =>
        idx === fi ? { ...f, options: [...f.options, ""] } : f,
      ),
    );

  const removeOption = (fi: number, oi: number) =>
    setFields((fs) =>
      fs.map((f, idx) =>
        idx === fi
          ? { ...f, options: f.options.filter((_, j) => j !== oi) }
          : f,
      ),
    );

  const needsOptions = (t: CreateDocumentFormFieldInputType) => t === "select";

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("El título es obligatorio.");
      return;
    }
    if (fields.length === 0) {
      setError("Añade al menos un campo.");
      return;
    }
    if (
      audienceNeedsIds(audience.audienceType) &&
      audience.audienceIds.length === 0
    ) {
      setError("Selecciona al menos un destinatario.");
      return;
    }
    const builtFields: CreateDocumentFormFieldInput[] = [];
    for (const [i, f] of fields.entries()) {
      if (!f.label.trim()) {
        setError(`El campo ${i + 1} necesita una etiqueta.`);
        return;
      }
      if (needsOptions(f.type)) {
        const opts = f.options.map((o) => o.trim()).filter(Boolean);
        if (opts.length < 2) {
          setError(`El campo ${i + 1} necesita al menos dos opciones.`);
          return;
        }
        builtFields.push({
          label: f.label.trim(),
          type: f.type,
          required: f.required,
          options: opts,
          order: i,
        });
      } else {
        builtFields.push({
          label: f.label.trim(),
          type: f.type,
          required: f.required,
          order: i,
        });
      }
    }

    const payload: CreateDocumentFormInput = {
      title: title.trim(),
      description: description.trim() || undefined,
      closesAt: closesAt ? new Date(closesAt).toISOString() : null,
      audienceType: audience.audienceType,
      audienceIds: audience.audienceIds,
      fields: builtFields,
    };

    try {
      await createMut.mutateAsync({ data: payload });
      await qc.invalidateQueries({ queryKey: getListDocumentFormsQueryKey() });
      toast({ title: "Formulario creado", description: title.trim() });
      setOpen(false);
    } catch {
      setError("No se pudo crear. Inténtalo de nuevo.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="w-4 h-4" /> Nuevo formulario
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo formulario de entrega</DialogTitle>
          <DialogDescription>
            Crea un formulario para recoger documentos y datos del profesorado.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="f-title">Título *</Label>
            <Input
              id="f-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="f-desc">Descripción</Label>
            <Textarea
              id="f-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="f-closes">Fecha de cierre</Label>
            <Input
              id="f-closes"
              type="datetime-local"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
            />
          </div>

          <AudiencePicker value={audience} onChange={setAudience} />

          <div className="space-y-3 pt-2 border-t">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Campos</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => setFields((fs) => [...fs, emptyField()])}
              >
                <Plus className="w-3.5 h-3.5" /> Campo
              </Button>
            </div>

            {fields.map((f, fi) => (
              <Card key={fi} className="border-dashed">
                <CardContent className="p-3 space-y-3">
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-medium text-muted-foreground pt-2.5">
                      {fi + 1}.
                    </span>
                    <div className="flex-1 space-y-2">
                      <Input
                        value={f.label}
                        onChange={(e) =>
                          updateField(fi, { label: e.target.value })
                        }
                        placeholder="Etiqueta del campo"
                      />
                      <Select
                        value={f.type}
                        onValueChange={(v) =>
                          updateField(fi, {
                            type: v as CreateDocumentFormFieldInputType,
                          })
                        }
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(
                            Object.keys(
                              FIELD_TYPE_LABELS,
                            ) as CreateDocumentFormFieldInputType[]
                          ).map((t) => (
                            <SelectItem key={t} value={t}>
                              {FIELD_TYPE_LABELS[t]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`f-req-${fi}`}
                          checked={f.required}
                          onCheckedChange={(c) =>
                            updateField(fi, { required: c === true })
                          }
                        />
                        <Label
                          htmlFor={`f-req-${fi}`}
                          className="font-normal cursor-pointer text-sm"
                        >
                          Obligatorio
                        </Label>
                      </div>
                    </div>
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive shrink-0"
                        onClick={() =>
                          setFields((fs) => fs.filter((_, idx) => idx !== fi))
                        }
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>

                  {needsOptions(f.type) && (
                    <div className="space-y-2 pl-5">
                      {f.options.map((o, oi) => (
                        <div key={oi} className="flex items-center gap-2">
                          <Input
                            value={o}
                            onChange={(e) =>
                              updateOption(fi, oi, e.target.value)
                            }
                            placeholder={`Opción ${oi + 1}`}
                            className="h-8 text-sm"
                          />
                          {f.options.length > 2 && (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 shrink-0"
                              onClick={() => removeOption(fi, oi)}
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
                        onClick={() => addOption(fi)}
                      >
                        <Plus className="w-3 h-3" /> Añadir opción
                      </Button>
                    </div>
                  )}
                  {f.type === "file" && (
                    <p className="text-xs text-muted-foreground pl-5 flex items-center gap-1">
                      <Paperclip className="w-3 h-3" /> El usuario subirá un
                      documento desde la app.
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
              {createMut.isPending ? "Creando..." : "Crear formulario"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Submission value cell
// ---------------------------------------------------------------------------
function ValueCell({
  field,
  value,
}: {
  field: DocumentFormField;
  value: DocumentSubmissionValue | undefined;
}) {
  if (!value) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (field.type === "file") {
    if (!value.objectPath || !value.fileName) {
      return <span className="text-muted-foreground">—</span>;
    }
    return (
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 h-8"
        onClick={() =>
          downloadSubmissionFile(value.id, value.fileName ?? "documento")
        }
      >
        <Download className="w-3.5 h-3.5" />
        <span className="max-w-[160px] truncate">{value.fileName}</span>
      </Button>
    );
  }
  return <span>{value.value || "—"}</span>;
}

// ---------------------------------------------------------------------------
// Submissions (results) dialog
// ---------------------------------------------------------------------------
function SubmissionsDialog({
  formId,
  formTitle,
  open,
  onOpenChange,
}: {
  formId: number | null;
  formTitle: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { data, isLoading } = useListDocumentFormSubmissions(formId ?? 0, {
    query: {
      queryKey: getListDocumentFormSubmissionsQueryKey(formId ?? 0),
      enabled: open && formId != null,
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCheck2 className="w-5 h-5" /> Entregas
          </DialogTitle>
          <DialogDescription>{formTitle}</DialogDescription>
        </DialogHeader>

        {isLoading || !data ? (
          <p className="text-muted-foreground py-8 text-center">Cargando...</p>
        ) : data.submissions.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground flex flex-col items-center gap-2">
            <Inbox className="w-8 h-8" />
            <p>Todavía no hay entregas.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="w-4 h-4" />
              {data.total} {data.total === 1 ? "entrega" : "entregas"}
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Fecha</TableHead>
                    {data.fields.map((f) => (
                      <TableHead key={f.id}>{f.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.submissions.map((s) => {
                    const byField = new Map(
                      s.values.map((v) => [v.fieldId, v]),
                    );
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">
                          {s.userName || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {s.userEmail || "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDate(s.createdAt)}
                        </TableCell>
                        {data.fields.map((f) => (
                          <TableCell key={f.id}>
                            <ValueCell field={f} value={byField.get(f.id)} />
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Fill form dialog (participant view)
// ---------------------------------------------------------------------------
function FillFormDialog({
  formId,
  open,
  onOpenChange,
}: {
  formId: number | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const submitMut = useSubmitDocumentForm();
  const uploadMut = useRequestUploadUrl();

  const { data: form, isLoading } = useGetDocumentForm(formId ?? 0, {
    query: {
      queryKey: getGetDocumentFormQueryKey(formId ?? 0),
      enabled: open && formId != null,
    },
  });

  const [textValues, setTextValues] = useState<Record<number, string>>({});
  const [files, setFiles] = useState<Record<number, File | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const fields = form?.fields ?? [];
  const submissionByField = new Map(
    (form?.mySubmission?.values ?? []).map((v) => [v.fieldId, v]),
  );

  useEffect(() => {
    if (open && form) {
      const initial: Record<number, string> = {};
      for (const field of form.fields) {
        if (field.type === "file") continue;
        const existing = (form.mySubmission?.values ?? []).find(
          (v) => v.fieldId === field.id,
        );
        if (existing?.value != null) initial[field.id] = existing.value;
      }
      setTextValues(initial);
      setFiles({});
      setError(null);
    }
  }, [open, form]);

  const setText = (fieldId: number, value: string) =>
    setTextValues((t) => ({ ...t, [fieldId]: value }));

  const closed = form?.status !== "open";
  const hasSubmitted = form?.mySubmission != null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    for (const field of fields) {
      if (!field.required) continue;
      if (field.type === "file") {
        const hasNew = files[field.id] != null;
        const hasExisting = submissionByField.get(field.id)?.objectPath != null;
        if (!hasNew && !hasExisting) {
          setError(`El campo «${field.label}» es obligatorio.`);
          return;
        }
      } else {
        if (!(textValues[field.id] ?? "").trim()) {
          setError(`El campo «${field.label}» es obligatorio.`);
          return;
        }
      }
    }

    try {
      setUploading(true);
      const values: SubmitDocumentFormValueInput[] = [];
      for (const field of fields) {
        if (field.type === "file") {
          const file = files[field.id];
          if (file) {
            const res = await uploadMut.mutateAsync({
              data: {
                name: file.name,
                size: file.size,
                contentType: file.type,
              },
            });
            await fetch(res.uploadURL, {
              method: "PUT",
              headers: { "Content-Type": file.type },
              body: file,
            });
            values.push({
              fieldId: field.id,
              objectPath: res.objectPath,
              fileName: file.name,
              fileSize: file.size,
              contentType: file.type,
            });
          } else {
            const existing = submissionByField.get(field.id);
            if (existing?.objectPath) {
              values.push({
                fieldId: field.id,
                objectPath: existing.objectPath,
                fileName: existing.fileName,
                fileSize: existing.fileSize,
                contentType: existing.contentType,
              });
            }
          }
        } else {
          const val = (textValues[field.id] ?? "").trim();
          if (val) values.push({ fieldId: field.id, value: val });
        }
      }

      await submitMut.mutateAsync({ id: form!.id, data: { values } });
      await qc.invalidateQueries({ queryKey: getListDocumentFormsQueryKey() });
      await qc.invalidateQueries({
        queryKey: getGetDocumentFormQueryKey(form!.id),
      });
      await qc.invalidateQueries({
        queryKey: getListDocumentFormSubmissionsQueryKey(form!.id),
      });
      toast({
        title: "Entrega registrada",
        description: "¡Gracias! Tu entrega se ha guardado.",
      });
      onOpenChange(false);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 409) {
        toast({
          title: "Formulario cerrado",
          description: "Este formulario ya no está abierto a entregas.",
          variant: "destructive",
        });
        onOpenChange(false);
      } else {
        setError("No se pudo enviar tu entrega. Inténtalo de nuevo.");
      }
    } finally {
      setUploading(false);
    }
  };

  const pending = submitMut.isPending || uploading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        {isLoading || !form ? (
          <p className="text-muted-foreground py-8 text-center">Cargando...</p>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">
                  {STATUS_LABELS[form.status] ?? form.status}
                </Badge>
                {form.closesAt && (
                  <Badge variant="outline" className="text-xs">
                    Cierra {formatDate(form.closesAt)}
                  </Badge>
                )}
              </div>
              <DialogTitle className="pt-1">{form.title}</DialogTitle>
              {form.description && (
                <DialogDescription>{form.description}</DialogDescription>
              )}
            </DialogHeader>

            {hasSubmitted && (
              <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4" /> Ya has realizado una entrega.
                Puedes editarla.
              </div>
            )}

            {closed ? (
              <p className="text-sm text-muted-foreground py-4">
                Este formulario ya no está abierto a entregas.
              </p>
            ) : (
              <form onSubmit={onSubmit} className="space-y-5">
                {fields.map((field) => {
                  const existing = submissionByField.get(field.id);
                  return (
                    <div key={field.id} className="space-y-2">
                      <Label htmlFor={`field-${field.id}`}>
                        {field.label}
                        {field.required && (
                          <span className="text-destructive"> *</span>
                        )}
                      </Label>
                      {field.type === "text" && (
                        <Input
                          id={`field-${field.id}`}
                          value={textValues[field.id] ?? ""}
                          onChange={(e) => setText(field.id, e.target.value)}
                        />
                      )}
                      {field.type === "textarea" && (
                        <Textarea
                          id={`field-${field.id}`}
                          value={textValues[field.id] ?? ""}
                          onChange={(e) => setText(field.id, e.target.value)}
                          rows={3}
                        />
                      )}
                      {field.type === "select" && (
                        <Select
                          value={textValues[field.id] ?? ""}
                          onValueChange={(v) => setText(field.id, v)}
                        >
                          <SelectTrigger id={`field-${field.id}`}>
                            <SelectValue placeholder="Selecciona una opción" />
                          </SelectTrigger>
                          <SelectContent>
                            {(field.options ?? []).map((o) => (
                              <SelectItem key={o} value={o}>
                                {o}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {field.type === "file" && (
                        <div className="space-y-1.5">
                          <Input
                            id={`field-${field.id}`}
                            type="file"
                            onChange={(e) =>
                              setFiles((f) => ({
                                ...f,
                                [field.id]: e.target.files?.[0] ?? null,
                              }))
                            }
                          />
                          {!files[field.id] && existing?.fileName && (
                            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Paperclip className="w-3.5 h-3.5" />
                              Documento actual: {existing.fileName}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {error && (
                  <p className="text-sm font-medium text-destructive">
                    {error}
                  </p>
                )}

                <DialogFooter>
                  <Button type="submit" disabled={pending}>
                    {pending
                      ? "Enviando..."
                      : hasSubmitted
                        ? "Actualizar entrega"
                        : "Enviar entrega"}
                  </Button>
                </DialogFooter>
              </form>
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
export default function FormulariosPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const moduleParam = useModuleParam();
  const { data: allForms = [], isLoading } = useListDocumentForms();
  const forms =
    moduleParam == null
      ? allForms
      : allForms.filter(
          (f) =>
            f.audienceType === "module" &&
            (f.audienceIds ?? []).includes(moduleParam),
        );
  const { data: provinces = [] } = useListProvinces();
  const deleteMut = useDeleteDocumentForm();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedTitle, setSelectedTitle] = useState("");
  const [submissionsOpen, setSubmissionsOpen] = useState(false);
  const [fillId, setFillId] = useState<number | null>(null);
  const [fillOpen, setFillOpen] = useState(false);

  const { canCreate } = useFormSurveyCreator();
  const manager = canManageForms(user?.role);

  const openFill = (form: DocumentFormSummary) => {
    setFillId(form.id);
    setFillOpen(true);
  };

  const provinceName = (id: number | null | undefined) =>
    id == null ? "Global" : provinces.find((p) => p.id === id)?.name ?? "—";

  const canDelete = (f: DocumentFormSummary) =>
    user?.role === "superadmin" ||
    (user?.role === "coordinator" &&
      user?.provinceId != null &&
      f.provinceId === user.provinceId);

  const openSubmissions = (form: DocumentFormSummary) => {
    setSelectedId(form.id);
    setSelectedTitle(form.title);
    setSubmissionsOpen(true);
  };

  const onDelete = async (id: number) => {
    try {
      await deleteMut.mutateAsync({ id });
      await qc.invalidateQueries({ queryKey: getListDocumentFormsQueryKey() });
      toast({ title: "Formulario eliminado" });
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
            <FileText className="w-6 h-6" /> Formularios de entrega
          </h1>
          <p className="text-muted-foreground mt-1">
            Crea formularios para recoger documentos y datos del profesorado, y
            consulta las entregas recibidas.
          </p>
        </div>
        {canCreate && <CreateFormDialog />}
      </div>

      {isLoading ? (
        <p className="text-muted-foreground py-8 text-center">Cargando...</p>
      ) : forms.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No hay formularios de entrega todavía.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {forms.map((f) => (
            <Card key={f.id} className="flex flex-col">
              <CardContent className="p-4 flex flex-col gap-3 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {provinceName(f.provinceId)}
                  </Badge>
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold leading-tight">{f.title}</h3>
                  {f.description && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {f.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant="outline" className="text-xs">
                    {STATUS_LABELS[f.status] ?? f.status}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {f.fieldCount}{" "}
                    {f.fieldCount === 1 ? "campo" : "campos"}
                  </Badge>
                  {f.closesAt && (
                    <Badge variant="outline" className="text-xs">
                      Cierra {formatDate(f.closesAt)}
                    </Badge>
                  )}
                </div>
                {f.status === "open" && (
                  <Button
                    size="sm"
                    variant={f.hasSubmitted ? "outline" : "default"}
                    className="gap-1.5 w-full"
                    onClick={() => openFill(f)}
                  >
                    {f.hasSubmitted ? (
                      <>
                        <PencilLine className="w-4 h-4" /> Editar entrega
                      </>
                    ) : (
                      <>
                        <FileText className="w-4 h-4" /> Rellenar
                      </>
                    )}
                  </Button>
                )}
                {manager && (
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => openSubmissions(f)}
                    >
                      <FileCheck2 className="w-4 h-4" /> Ver entregas
                    </Button>
                    {canDelete(f) && (
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
                              ¿Eliminar formulario?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              Se eliminará «{f.title}» y todas sus entregas. Esta
                              acción no se puede deshacer.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => onDelete(f.id)}>
                              Eliminar
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <SubmissionsDialog
        formId={selectedId}
        formTitle={selectedTitle}
        open={submissionsOpen}
        onOpenChange={setSubmissionsOpen}
      />

      <FillFormDialog
        formId={fillId}
        open={fillOpen}
        onOpenChange={setFillOpen}
      />
    </div>
  );
}
