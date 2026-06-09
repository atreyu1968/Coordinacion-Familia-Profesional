import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListFeedback,
  useCreateFeedback,
  useUpdateFeedback,
  getListFeedbackQueryKey,
  type Feedback,
  type CreateFeedbackInputType,
  type UpdateFeedbackInputStatus,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Lightbulb, Bug, MessageSquarePlus } from "lucide-react";

const TYPE_LABELS: Record<CreateFeedbackInputType, string> = {
  suggestion: "Sugerencia de mejora",
  incident: "Incidencia",
};

const STATUS_LABELS: Record<UpdateFeedbackInputStatus, string> = {
  open: "Abierta",
  reviewed: "En revisión",
  resolved: "Resuelta",
};

const STATUS_VARIANT: Record<
  UpdateFeedbackInputStatus,
  "default" | "secondary" | "outline"
> = {
  open: "default",
  reviewed: "secondary",
  resolved: "outline",
};

function formatDate(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// ---------------------------------------------------------------------------
// Submission form (any authenticated user)
// ---------------------------------------------------------------------------
function SubmitForm() {
  const qc = useQueryClient();
  const createMut = useCreateFeedback();

  const [type, setType] = useState<CreateFeedbackInputType>("suggestion");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!subject.trim() || !message.trim()) {
      setError("El asunto y el mensaje son obligatorios.");
      return;
    }
    try {
      await createMut.mutateAsync({
        data: { type, subject: subject.trim(), message: message.trim() },
      });
      await qc.invalidateQueries({ queryKey: getListFeedbackQueryKey() });
      toast({
        title: type === "incident" ? "Incidencia enviada" : "Sugerencia enviada",
        description: "Gracias, el equipo la revisará.",
      });
      setType("suggestion");
      setSubject("");
      setMessage("");
    } catch {
      setError("No se pudo enviar. Inténtalo de nuevo.");
    }
  };

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <MessageSquarePlus className="w-5 h-5 text-primary" /> Enviar
          sugerencia o incidencia
        </h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as CreateFeedbackInputType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TYPE_LABELS) as CreateFeedbackInputType[]).map(
                  (t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="f-subject">Asunto *</Label>
            <Input
              id="f-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Resumen breve"
              maxLength={140}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="f-message">Mensaje *</Label>
            <Textarea
              id="f-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder={
                type === "incident"
                  ? "Describe el problema y, si puedes, cómo reproducirlo."
                  : "Describe tu propuesta de mejora."
              }
            />
          </div>
          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}
          <Button type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? "Enviando..." : "Enviar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Single feedback row
// ---------------------------------------------------------------------------
function FeedbackRow({
  item,
  canManage,
}: {
  item: Feedback;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const updateMut = useUpdateFeedback();
  const status = item.status as UpdateFeedbackInputStatus;

  const onStatusChange = async (value: string) => {
    try {
      await updateMut.mutateAsync({
        id: item.id,
        data: { status: value as UpdateFeedbackInputStatus },
      });
      await qc.invalidateQueries({ queryKey: getListFeedbackQueryKey() });
      toast({ title: "Estado actualizado" });
    } catch {
      toast({
        title: "Error",
        description: "No se pudo actualizar el estado.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="rounded-md border p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1">
              {item.type === "incident" ? (
                <Bug className="w-3 h-3" />
              ) : (
                <Lightbulb className="w-3 h-3" />
              )}
              {TYPE_LABELS[item.type as CreateFeedbackInputType]}
            </Badge>
            <span className="font-medium truncate">{item.subject}</span>
          </div>
          {canManage && item.userName && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {item.userName}
            </div>
          )}
        </div>
        {canManage ? (
          <Select value={status} onValueChange={onStatusChange}>
            <SelectTrigger className="w-36 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(STATUS_LABELS) as UpdateFeedbackInputStatus[]).map(
                (s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        ) : (
          <Badge variant={STATUS_VARIANT[status]} className="shrink-0">
            {STATUS_LABELS[status]}
          </Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
        {item.message}
      </p>
      <div className="text-xs text-muted-foreground">
        {formatDate(item.createdAt)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function SugerenciasPage() {
  const { user } = useAuth();
  const canManage = user?.role === "superadmin";
  const { data: items = [], isLoading } = useListFeedback();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Sugerencias e incidencias
        </h1>
        <p className="text-muted-foreground">
          {canManage
            ? "Revisa y gestiona las sugerencias de mejora e incidencias enviadas por los usuarios."
            : "Propón mejoras o informa de incidencias de la aplicación."}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SubmitForm />

        <Card>
          <CardContent className="p-5 space-y-3">
            <h2 className="font-semibold">
              {canManage ? "Todas las entradas" : "Mis envíos"}
              <span className="text-muted-foreground font-normal">
                {" "}
                ({items.length})
              </span>
            </h2>
            {isLoading ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Cargando...
              </p>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                {canManage
                  ? "Todavía no hay envíos."
                  : "Aún no has enviado ninguna sugerencia o incidencia."}
              </p>
            ) : (
              <div className="space-y-3">
                {items.map((item) => (
                  <FeedbackRow
                    key={item.id}
                    item={item}
                    canManage={canManage}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
